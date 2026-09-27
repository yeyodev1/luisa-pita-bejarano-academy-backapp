import crypto from "crypto";
import jwt from "jsonwebtoken";
import { User, IUser } from "../models/User";
import { Subscription } from "../models/Subscription";
import { CustomError } from "../errors/customError.error";
import { hashPassword } from "../helpers/password.helper";
import { generateResetToken } from "../helpers/token.helper";
import { sendCheckoutAccessEmail, sendCheckoutWelcomeEmail } from "../helpers/email.helper";
import { PAYMENT_PLANS } from "../config/paymentPlans";
import { areSubscriptionsEnabled, findNuveiCredentials, nuveiEnvironment } from "../config/nuvei";
import { SUBSCRIPTION_PLAN, saveCard, subscribe, verifyCardOtp } from "./nuveiSubscription.service";

/**
 * Suscripción sin iniciar sesión. La alumna deja nombre y correo, ingresa la
 * tarjeta en el formulario de Nuvei y paga; la cuenta se crea (o se reutiliza)
 * por detrás y el acceso le llega por correo.
 *
 * Entre pasos se usa un token de checkout firmado (no una sesión): solo sirve
 * para tokenizar una tarjeta nueva y suscribirse, nunca para ver o usar las
 * tarjetas que la cuenta ya tuviera.
 */

const CHECKOUT_PURPOSE = "nuvei-checkout";
const CHECKOUT_TTL = "45m";
const SET_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type CheckoutClaims = { purpose: typeof CHECKOUT_PURPOSE; userId: string; email: string };

function assertEnabled() {
  if (!areSubscriptionsEnabled()) {
    throw new CustomError("Las suscripciones con tarjeta aún no están habilitadas.", 503);
  }
}

function signCheckoutToken(user: IUser) {
  const claims: CheckoutClaims = { purpose: CHECKOUT_PURPOSE, userId: user._id.toString(), email: user.email };
  return jwt.sign(claims, process.env.JWT_SECRET as string, { expiresIn: CHECKOUT_TTL });
}

function readCheckoutToken(token: string): CheckoutClaims {
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET as string) as CheckoutClaims;
    if (claims.purpose !== CHECKOUT_PURPOSE || !claims.userId) throw new Error("wrong purpose");
    return claims;
  } catch {
    throw new CustomError("Tu sesión de pago expiró. Vuelve a ingresar tus datos.", 401);
  }
}

function frontendUrl() {
  return process.env.FRONTEND_URL || "";
}

/** Paso 1: datos personales. Crea la cuenta si no existe y abre el checkout. */
export async function startCheckout(input: { name: string; lastName: string; email: string }) {
  assertEnabled();
  const email = input.email.toLowerCase().trim();
  if (!EMAIL_RE.test(email)) throw new CustomError("Revisa tu correo electrónico.", 400);

  let user = await User.findOne({ email });
  if (user) {
    const live = await Subscription.exists({ user: user._id, status: { $in: ["active", "past_due"] } });
    const lifetime = user.subscriptionStatus === "active" && !user.accessUntil;
    if (live || lifetime || user.role === "admin") {
      throw new CustomError(
        "Este correo ya tiene una suscripción activa. Inicia sesión para gestionarla.",
        409,
      );
    }
  } else {
    user = await User.create({
      name: input.name.trim(),
      lastName: input.lastName.trim() || input.name.trim(),
      email,
      // Contraseña aleatoria que nadie conoce: la alumna crea la suya por correo.
      password: await hashPassword(crypto.randomBytes(24).toString("hex")),
      isVerified: true,
      verificationToken: null,
      verificationTokenExpires: null,
      subscriptionStatus: "none",
      accessUntil: null,
      passwordPending: true,
    });
  }

  const client = findNuveiCredentials("cardClient");
  return {
    checkoutToken: signCheckoutToken(user),
    environment: nuveiEnvironment(),
    appCode: client?.appCode ?? null,
    appKey: client?.appKey ?? null,
    user: { id: user._id.toString(), email: user.email },
    amount: PAYMENT_PLANS[SUBSCRIPTION_PLAN].amount,
  };
}

/** Verifica con el OTP del banco una tarjeta recién agregada en el checkout. */
export async function verifyCheckoutCard(checkoutToken: string, transactionId: string, otp: string) {
  const { userId } = readCheckoutToken(checkoutToken);
  return verifyCardOtp(userId, transactionId, otp);
}

/**
 * Correo de acceso: a una cuenta nueva le llega un enlace para crear su
 * contraseña; a una existente, el aviso con el enlace para entrar.
 */
async function sendAccessEmail(user: IUser) {
  if (user.passwordPending) {
    const token = generateResetToken();
    user.resetToken = token;
    user.resetTokenExpires = new Date(Date.now() + SET_PASSWORD_TTL_MS);
    user.lastAccessEmailAt = new Date();
    await user.save();
    await sendCheckoutWelcomeEmail(
      user.email,
      user.name,
      `${frontendUrl()}/restablecer-contrasena?token=${token}&bienvenida=1`,
    );
    return;
  }
  user.lastAccessEmailAt = new Date();
  await user.save();
  await sendCheckoutAccessEmail(user.email, user.name, `${frontendUrl()}/login`, `${frontendUrl()}/recuperar-contrasena`);
}

/** Paso 2: guarda la tarjeta tokenizada como principal y activa la suscripción. */
export async function completeCheckout(checkoutToken: string, cardToken: string, ip?: string) {
  const { userId } = readCheckoutToken(checkoutToken);
  await saveCard(userId, cardToken, true, ip);
  const result = await subscribe(userId, cardToken, ip, { accessEmail: false });

  if (result.charge && result.charge.status !== "approved" && result.charge.status !== "pending") {
    return { status: "failed" as const, message: result.charge.message ?? "La tarjeta fue rechazada." };
  }

  const user = await User.findById(userId);
  if (user) {
    await sendAccessEmail(user).catch((err) => console.error("[Checkout] Failed to send access email:", err));
  }

  return {
    status: result.charge?.status ?? ("scheduled" as const),
    email: user?.email,
    firstChargeAt: result.firstChargeAt,
    message: result.charge?.message,
  };
}

/**
 * Reenvío del correo de acceso desde la pantalla final. Responde siempre lo
 * mismo para no revelar qué correos tienen cuenta.
 */
export async function resendAccessEmail(emailInput: string) {
  const email = emailInput.toLowerCase().trim();
  const user = EMAIL_RE.test(email) ? await User.findOne({ email }) : null;
  const hasAccess = user?.accessUntil && user.accessUntil > new Date();
  const live = user ? await Subscription.exists({ user: user._id, status: { $in: ["active", "past_due"] } }) : null;
  const cooledDown =
    !user?.lastAccessEmailAt || Date.now() - user.lastAccessEmailAt.getTime() > RESEND_COOLDOWN_MS;

  if (user && (hasAccess || live) && cooledDown) {
    await sendAccessEmail(user).catch((err) => console.error("[Checkout] Failed to resend access email:", err));
  }
  return { sent: true, cooldownSeconds: RESEND_COOLDOWN_MS / 1000 };
}
