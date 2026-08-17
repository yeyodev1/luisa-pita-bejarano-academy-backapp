import { Schema, model, Document, Types } from "mongoose";

export interface IAssessmentComposicion {
  pesoKg: number | null;
  grasaPct: number | null;
  musculoPct: number | null;
}

export interface IAssessmentMedidas {
  busto: number | null;
  cintura: number | null;
  abdomen: number | null;
  cadera: number | null;
  brazoDer: number | null;
  brazoIzq: number | null;
  musloDer: number | null;
  musloIzq: number | null;
  pantorrillaDer: number | null;
  pantorrillaIzq: number | null;
}

export interface IAssessmentEvaluacion {
  sentadillas: number | null;
  flexiones: number | null;
  planchaSeg: number | null;
  mountainClimbers: number | null;
  burpees: number | null;
  saltosCuerda: number | null;
}

export interface IAssessmentCheckpoint extends Types.Subdocument {
  monthIndex: number; // 0 = Inicial, n = Mes n
  date: Date | null;
  composicion: IAssessmentComposicion;
  medidas: IAssessmentMedidas;
  evaluacion: IAssessmentEvaluacion;
}

export interface IAssessmentProfile {
  fechaInicial: Date | null;
  edad: number | null;
  estaturaCm: number | null;
}

export interface IPhysicalAssessment extends Document {
  user: Types.ObjectId;
  profile: IAssessmentProfile;
  checkpoints: Types.DocumentArray<IAssessmentCheckpoint>;
}

const cm = { type: Number, min: 0, default: null };
const reps = { type: Number, min: 0, default: null };
const pct = { type: Number, min: 0, max: 100, default: null };

const checkpointSchema = new Schema<IAssessmentCheckpoint>({
  monthIndex: { type: Number, required: true, min: 0 },
  date: { type: Date, default: null },
  composicion: {
    pesoKg: { type: Number, min: 0, default: null },
    grasaPct: pct,
    musculoPct: pct,
  },
  medidas: {
    busto: cm,
    cintura: cm,
    abdomen: cm,
    cadera: cm,
    brazoDer: cm,
    brazoIzq: cm,
    musloDer: cm,
    musloIzq: cm,
    pantorrillaDer: cm,
    pantorrillaIzq: cm,
  },
  evaluacion: {
    sentadillas: reps,
    flexiones: reps,
    planchaSeg: reps,
    mountainClimbers: reps,
    burpees: reps,
    saltosCuerda: reps,
  },
});

const schema = new Schema<IPhysicalAssessment>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    profile: {
      fechaInicial: { type: Date, default: null },
      edad: { type: Number, min: 0, default: null },
      estaturaCm: { type: Number, min: 0, default: null },
    },
    checkpoints: { type: [checkpointSchema], default: [] },
  },
  { timestamps: true },
);

schema.index({ user: 1 }, { unique: true });

export const PhysicalAssessment = model<IPhysicalAssessment>(
  "PhysicalAssessment",
  schema,
);
