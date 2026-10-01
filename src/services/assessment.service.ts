import {
  PhysicalAssessment,
  IPhysicalAssessment,
} from "../models/PhysicalAssessment";
import { cloudinary } from "../config/cloudinary";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import {
  asDate,
  pagination,
  requireObjectId,
} from "../helpers/validation.helper";

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

const USER_FIELDS = "name lastName email profilePicture";

const composicionFields = ["pesoKg", "grasaPct", "musculoPct"];
const medidasFields = [
  "busto",
  "cintura",
  "abdomen",
  "cadera",
  "brazoDer",
  "brazoIzq",
  "musloDer",
  "musloIzq",
  "pantorrillaDer",
  "pantorrillaIzq",
];
const evaluacionFields = [
  "sentadillas",
  "flexiones",
  "planchaSeg",
  "mountainClimbers",
  "burpees",
  "saltosCuerda",
];

const MEDIDA_LABELS: Record<string, string> = {
  busto: "busto",
  cintura: "cintura",
  abdomen: "abdomen",
  cadera: "cadera",
  brazoDer: "brazo derecho",
  brazoIzq: "brazo izquierdo",
  musloDer: "muslo derecho",
  musloIzq: "muslo izquierdo",
  pantorrillaDer: "pantorrilla derecha",
  pantorrillaIzq: "pantorrilla izquierda",
};

const PHOTO_POSES = ["frente", "perfil", "espalda"] as const;
type PhotoPose = (typeof PHOTO_POSES)[number];

const photoFolder = (userId: string) => `academy/assessments/${userId}`;

function asOptionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (Number.isNaN(num) || num < 0)
    throw new CustomError(`Invalid ${field}`, 400);
  return num;
}

function numberGroup(source: unknown, fields: string[], group: string) {
  const body = (source ?? {}) as Body;
  return Object.fromEntries(
    fields.map((field) => [
      field,
      asOptionalNumber(body[field], `${group}.${field}`),
    ]),
  );
}

// Solo se aceptan fotos subidas a la carpeta de esta alumna, una por pose.
function photosInput(value: unknown, userId: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new CustomError("Invalid photos", 400);
  const seen = new Set<PhotoPose>();
  return value.map((item) => {
    const photo = (item ?? {}) as Body;
    const pose = photo.pose as PhotoPose;
    const publicId = typeof photo.publicId === "string" ? photo.publicId : "";
    if (!PHOTO_POSES.includes(pose) || seen.has(pose))
      throw new CustomError("Invalid photo pose", 400);
    if (!publicId.startsWith(`${photoFolder(userId)}/`))
      throw new CustomError("Invalid photo", 400);
    seen.add(pose);
    return { pose, publicId };
  });
}

// El peso y todas las medidas son obligatorios: sin ellos no hay comparativa.
function assertRequiredMetrics(
  composicion: Record<string, number | null>,
  medidas: Record<string, number | null>,
) {
  const missing: string[] = [];
  if (composicion.pesoKg === null) missing.push("peso");
  for (const field of medidasFields)
    if (medidas[field] === null) missing.push(MEDIDA_LABELS[field]);
  if (missing.length)
    throw new CustomError(
      `Falta completar: ${missing.join(", ")}. El peso y las medidas son obligatorios.`,
      400,
    );
}

// PUT semantics: a checkpoint payload always replaces the full checkpoint.
function checkpointInput(body: Body, userId: string) {
  const monthIndex = Number(body.monthIndex);
  if (!Number.isInteger(monthIndex) || monthIndex < 0)
    throw new CustomError("Invalid monthIndex", 400);
  const composicion = numberGroup(
    body.composicion,
    composicionFields,
    "composicion",
  );
  const medidas = numberGroup(body.medidas, medidasFields, "medidas");
  assertRequiredMetrics(composicion, medidas);
  return {
    monthIndex,
    date: body.date ? asDate(body.date, "date") : null,
    composicion,
    medidas,
    evaluacion: numberGroup(body.evaluacion, evaluacionFields, "evaluacion"),
    photos: photosInput(body.photos, userId),
  };
}

function signedPhotoUrl(publicId: string) {
  return cloudinary.url(publicId, {
    resource_type: "image",
    type: "authenticated",
    sign_url: true,
    secure: true,
    transformation: [{ width: 1200, crop: "limit" }, { quality: "auto" }],
  });
}

/** Devuelve la valoración con una URL firmada en cada foto (son privadas). */
async function withPhotoUrls(
  assessment: IPhysicalAssessment | null,
): Promise<Record<string, unknown> | null> {
  if (!assessment) return null;
  await assessment.populate("user", USER_FIELDS);
  const plain = assessment.toObject() as unknown as {
    checkpoints: { photos?: { publicId: string; url?: string }[] }[];
  };
  for (const checkpoint of plain.checkpoints) {
    checkpoint.photos = (checkpoint.photos ?? []).map((photo) => ({
      ...photo,
      url: signedPhotoUrl(photo.publicId),
    }));
  }
  return plain as unknown as Record<string, unknown>;
}

export async function uploadPhoto(
  userId: string,
  buffer: Buffer,
  mimeType: string,
) {
  await requireUser(userId);
  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: photoFolder(userId),
    resource_type: "image",
    type: "authenticated",
  });
  return { publicId: result.public_id, url: signedPhotoUrl(result.public_id) };
}

async function requireUser(userId: string) {
  requireObjectId(userId, "userId");
  if (!(await User.exists({ _id: userId })))
    throw new CustomError("User not found", 404);
  return userId;
}

export async function listAssessments(query: Query) {
  const { page, limit, skip } = pagination(query);
  const [assessments, total] = await Promise.all([
    PhysicalAssessment.find()
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", USER_FIELDS),
    PhysicalAssessment.countDocuments(),
  ]);
  return {
    assessments,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// Returns null when the student has no assessment yet (frontend empty state).
export async function getAssessmentByUser(userId: string) {
  requireObjectId(userId, "userId");
  return withPhotoUrls(await PhysicalAssessment.findOne({ user: userId }));
}

export async function upsertProfile(userId: string, body: Body) {
  await requireUser(userId);
  const profile = {
    fechaInicial: body.fechaInicial
      ? asDate(body.fechaInicial, "fechaInicial")
      : null,
    edad: asOptionalNumber(body.edad, "edad"),
    estaturaCm: asOptionalNumber(body.estaturaCm, "estaturaCm"),
  };
  return withPhotoUrls(
    await PhysicalAssessment.findOneAndUpdate(
      { user: userId },
      { $set: { profile } },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ),
  );
}

export async function addCheckpoint(userId: string, body: Body) {
  await requireUser(userId);
  const checkpoint = checkpointInput(body, userId);
  let assessment = await PhysicalAssessment.findOne({ user: userId });
  if (!assessment) assessment = new PhysicalAssessment({ user: userId });
  if (
    assessment.checkpoints.some((c) => c.monthIndex === checkpoint.monthIndex)
  )
    throw new CustomError("Checkpoint for that month already exists", 400);
  assessment.checkpoints.push(checkpoint);
  await assessment.save();
  return withPhotoUrls(assessment);
}

export async function updateCheckpoint(
  userId: string,
  checkpointId: string,
  body: Body,
) {
  requireObjectId(userId, "userId");
  requireObjectId(checkpointId, "checkpointId");
  const assessment = await PhysicalAssessment.findOne({ user: userId });
  if (!assessment) throw new CustomError("Assessment not found", 404);
  const checkpoint = assessment.checkpoints.id(checkpointId);
  if (!checkpoint) throw new CustomError("Checkpoint not found", 404);
  const input = checkpointInput(
    { ...body, monthIndex: body.monthIndex ?? checkpoint.monthIndex },
    userId,
  );
  if (
    input.monthIndex !== checkpoint.monthIndex &&
    assessment.checkpoints.some((c) => c.monthIndex === input.monthIndex)
  )
    throw new CustomError("Checkpoint for that month already exists", 400);
  checkpoint.set(input);
  await assessment.save();
  return withPhotoUrls(assessment);
}

export async function deleteCheckpoint(userId: string, checkpointId: string) {
  requireObjectId(userId, "userId");
  requireObjectId(checkpointId, "checkpointId");
  const assessment = await PhysicalAssessment.findOne({ user: userId });
  if (!assessment) throw new CustomError("Assessment not found", 404);
  const checkpoint = assessment.checkpoints.id(checkpointId);
  if (!checkpoint) throw new CustomError("Checkpoint not found", 404);
  checkpoint.deleteOne();
  await assessment.save();
  return withPhotoUrls(assessment);
}
