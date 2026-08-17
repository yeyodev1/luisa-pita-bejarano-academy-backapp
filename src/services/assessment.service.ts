import { PhysicalAssessment } from "../models/PhysicalAssessment";
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

// PUT semantics: a checkpoint payload always replaces the full checkpoint.
function checkpointInput(body: Body) {
  const monthIndex = Number(body.monthIndex);
  if (!Number.isInteger(monthIndex) || monthIndex < 0)
    throw new CustomError("Invalid monthIndex", 400);
  return {
    monthIndex,
    date: body.date ? asDate(body.date, "date") : null,
    composicion: numberGroup(body.composicion, composicionFields, "composicion"),
    medidas: numberGroup(body.medidas, medidasFields, "medidas"),
    evaluacion: numberGroup(body.evaluacion, evaluacionFields, "evaluacion"),
  };
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
  return PhysicalAssessment.findOne({ user: userId }).populate(
    "user",
    USER_FIELDS,
  );
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
  return PhysicalAssessment.findOneAndUpdate(
    { user: userId },
    { $set: { profile } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).populate("user", USER_FIELDS);
}

export async function addCheckpoint(userId: string, body: Body) {
  await requireUser(userId);
  const checkpoint = checkpointInput(body);
  let assessment = await PhysicalAssessment.findOne({ user: userId });
  if (!assessment) assessment = new PhysicalAssessment({ user: userId });
  if (
    assessment.checkpoints.some((c) => c.monthIndex === checkpoint.monthIndex)
  )
    throw new CustomError("Checkpoint for that month already exists", 400);
  assessment.checkpoints.push(checkpoint);
  await assessment.save();
  return assessment.populate("user", USER_FIELDS);
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
  const input = checkpointInput({
    ...body,
    monthIndex: body.monthIndex ?? checkpoint.monthIndex,
  });
  if (
    input.monthIndex !== checkpoint.monthIndex &&
    assessment.checkpoints.some((c) => c.monthIndex === input.monthIndex)
  )
    throw new CustomError("Checkpoint for that month already exists", 400);
  checkpoint.set(input);
  await assessment.save();
  return assessment.populate("user", USER_FIELDS);
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
  return assessment.populate("user", USER_FIELDS);
}
