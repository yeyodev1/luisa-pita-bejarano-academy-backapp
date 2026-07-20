import { Resend } from "resend";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVerificationEmail(
  to: string,
  token: string,
  frontendUrl: string,
): Promise<void> {
  const link = `${frontendUrl}/verificar-email?token=${token}`;

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: "Verifica tu cuenta — Luisa Pita Bejarano Academy",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #111;">Confirma tu correo electrónico</h2>
        <p>Gracias por registrarte en <strong>Luisa Pita Bejarano Academy</strong>. Haz clic en el botón para verificar tu cuenta:</p>
        <a href="${link}" style="display: inline-block; margin: 16px 0; padding: 14px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Verificar mi cuenta</a>
        <p style="font-size: 14px; color: #666;">O copia y pega este enlace en tu navegador:</p>
        <p style="font-size: 14px; word-break: break-all;">${link}</p>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">Este enlace expira en 24 horas.</p>
      </div>
    `,
  });
}

export async function sendLoginEmail(to: string, name: string): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: "Nuevo inicio de sesión — Luisa Pita Bejarano Academy",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #111;">Hola, ${name}</h2>
        <p>Acabas de iniciar sesión en tu cuenta de <strong>Luisa Pita Bejarano Academy</strong>.</p>
        <p style="font-size: 14px; color: #666;">Si no fuiste tú, por favor cambia tu contraseña de inmediato.</p>
      </div>
    `,
  });
}

export async function sendAdminInviteEmail(
  to: string,
  name: string,
  password: string,
  verificationLink: string,
): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: "Tu invitación a Luisa Pita Bejarano Academy",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #111;">Bienvenido, ${name}</h2>
        <p>Has sido invitado a unirte a <strong>Luisa Pita Bejarano Academy</strong>.</p>
        <p>Tus credenciales de acceso son:</p>
        <ul style="font-size: 14px; color: #666;">
          <li><strong>Correo:</strong> ${to}</li>
          <li><strong>Contraseña:</strong> ${password}</li>
        </ul>
        <p>Para activar tu cuenta, verifica tu correo haciendo clic en el siguiente botón:</p>
        <a href="${verificationLink}" style="display: inline-block; margin: 16px 0; padding: 14px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Verificar mi cuenta</a>
        <p style="font-size: 14px; color: #666;">O copia y pega este enlace:</p>
        <p style="font-size: 14px; word-break: break-all;">${verificationLink}</p>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">Este enlace expira en 24 horas. Te recomendamos cambiar tu contraseña después de iniciar sesión.</p>
      </div>
    `,
  });
}

export async function sendAccessExtendedEmail(
  to: string,
  name: string,
  accessUntil: Date,
): Promise<void> {
  const dateLabel = accessUntil.toLocaleDateString("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: "Tu acceso fue extendido — Luisa Pita Bejarano Academy",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #111;">Hola, ${name}</h2>
        <p>Tu acceso a <strong>Luisa Pita Bejarano Academy</strong> ha sido extendido exitosamente.</p>
        <p style="font-size: 16px; margin: 16px 0;">Ahora tienes acceso activo hasta el <strong>${dateLabel}</strong>.</p>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">Si tienes preguntas, escríbenos por WhatsApp.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: "Restablece tu contraseña — Luisa Pita Bejarano Academy",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #111;">Hola, ${name}</h2>
        <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>Luisa Pita Bejarano Academy</strong>.</p>
        <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
        <a href="${resetUrl}" style="display: inline-block; margin: 16px 0; padding: 14px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Restablecer contraseña</a>
        <p style="font-size: 14px; color: #666;">O copia y pega este enlace:</p>
        <p style="font-size: 14px; word-break: break-all;">${resetUrl}</p>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">Este enlace expira en 1 hora. Si no solicitaste este cambio, ignora este mensaje.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetConfirmationEmail(
  to: string,
  name: string,
): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: "Contraseña actualizada — Luisa Pita Bejarano Academy",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #111;">Hola, ${name}</h2>
        <p>Tu contraseña de <strong>Luisa Pita Bejarano Academy</strong> fue actualizada correctamente.</p>
        <p style="font-size: 14px; color: #666;">Si no fuiste tú quien realizó este cambio, por favor contacta a soporte de inmediato.</p>
      </div>
    `,
  });
}

export async function sendPaymentWelcomeEmail(
  to: string,
  name: string,
  password: string,
  loginUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: "Bienvenida a Luisa Pita Bejarano Academy",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #111;">Bienvenida, ${name}</h2>
        <p>Tu pago fue procesado correctamente y ya tienes acceso a <strong>Luisa Pita Bejarano Academy</strong>.</p>
        <p>Tus credenciales de acceso son:</p>
        <ul style="font-size: 14px; color: #666;">
          <li><strong>Correo:</strong> ${to}</li>
          <li><strong>Contraseña:</strong> ${password}</li>
        </ul>
        <p>Para ingresar, haz clic en el siguiente botón:</p>
        <a href="${loginUrl}" style="display: inline-block; margin: 16px 0; padding: 14px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Iniciar sesión</a>
        <p style="font-size: 14px; color: #666;">O copia y pega este enlace:</p>
        <p style="font-size: 14px; word-break: break-all;">${loginUrl}</p>
        <p style="font-size: 14px; color: #666;">En breve podrás encontrar tus clases grabadas dentro de la comunidad.</p>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">Te recomendamos cambiar tu contraseña después de iniciar sesión.</p>
      </div>
    `,
  });
}

export async function sendPaymentAccessEmail(
  to: string,
  name: string,
  loginUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: "Tu acceso a Vital 360 está activo",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #111;">Hola, ${name}</h2>
        <p>Tu pago fue aprobado y tu acceso a <strong>Vital 360</strong> está activo.</p>
        <p>Tu cuenta de ingreso es:</p>
        <div style="margin: 16px 0; padding: 16px; background: #f0fff8; border: 1px solid #16c784; border-radius: 8px;">
          <strong>Correo:</strong> ${to}
        </div>
        <p>Ingresa con tu contraseña habitual. Si no la recuerdas, utiliza la opción de recuperar contraseña en la pantalla de acceso.</p>
        <a href="${loginUrl}" style="display: inline-block; margin: 16px 0; padding: 14px 24px; background: #0d1117; color: #fff; text-decoration: none; border-radius: 6px;">Entrar a la comunidad</a>
        <p style="font-size: 14px; color: #666;">En breve podrás encontrar tus clases grabadas dentro de la comunidad.</p>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">Si no reconoces este pago, contacta a soporte.</p>
      </div>
    `,
  });
}

export async function sendManualPaymentReceiptEmail(
  to: string,
  name: string,
  plan: PaymentPlan,
  amount: number,
  accessUntil: Date,
  receiptUrl: string,
): Promise<void> {
  const planLabel = PAYMENT_PLANS[plan].label.toLowerCase();
  const dateLabel = accessUntil.toLocaleDateString("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: "Comprobante de pago registrado — Luisa Pita Bejarano Academy",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #111;">Hola, ${name}</h2>
        <p>Hemos registrado tu pago por <strong>USD ${amount}</strong> correspondiente a la ${planLabel}.</p>
        <p style="font-size: 16px; margin: 16px 0;">Tu acceso está activo hasta el <strong>${dateLabel}</strong>.</p>
        <p>Puedes ver el comprobante aquí:</p>
        <a href="${receiptUrl}" style="display: inline-block; margin: 16px 0; padding: 14px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Ver comprobante</a>
        <p style="font-size: 14px; word-break: break-all;">${receiptUrl}</p>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">Gracias por ser parte de Luisa Pita Bejarano Academy.</p>
      </div>
    `,
  });
}
