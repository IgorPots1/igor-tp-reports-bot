import { randomUUID } from "node:crypto";

/**
 * Renderer for TrainingPeaks StructuredStrength workouts.
 *
 * The wire shape here is NOT guessed: it mirrors the single body that was
 * actually POSTed to api.peakswaresb.com/rx/activity/v1/workouts/save and
 * persisted (see tp-probe-strength-create-save.ts, PR1 probe, workout id
 * 22291958). check-strength-workout-renderer.ts pins this renderer against
 * that live-proven body, so any drift here fails the check.
 *
 * What this file does NOT do: resolve exercise names to TrainingPeaks library
 * ids. TP exercise ids only exist inside TP; harvest them with
 * tp-harvest-strength-exercises.ts and pass whole exercise records in.
 */

/** One parameter slot of a TP library exercise (Reps, Reps/side, Duration, ...). */
export type StrengthExerciseParameter = {
  /** API name, e.g. "RepsPerSide". Drives setSummaryTemplate tokens. */
  parameter: string;
  /** Display title, e.g. "Reps/side". */
  title: string;
  unit: { title: string; abbreviation: string; unit: string };
  category: string;
  /**
   * Input format for prescribed values. Only "Integer" is attested live; other
   * formats come back from harvested exercises and are forwarded verbatim.
   */
  inputFormat?: string;
};

/** A TP library exercise, harvested verbatim from an existing strength workout. */
export type StrengthExerciseRecord = {
  /** TP library exercise id, e.g. "26". String, not a number. */
  id: string;
  ownerId: number;
  title: string;
  videoUrl?: string | null;
  instructions?: string | null;
  parameters: StrengthExerciseParameter[];
  canEdit?: boolean;
};

/** One set: parameter name -> prescribed value, always as a string. */
export type StrengthSetValues = Record<string, string>;

export type StrengthBlockDefinition = {
  exercise: StrengthExerciseRecord;
  /** Optional per-block coach note, shown under the exercise in TP. */
  coachNotes?: string | null;
  /** One entry per set. 3 sets = 3 entries; sets are objects, not a count. */
  sets: StrengthSetValues[];
  /** Overrides the block title; defaults to the exercise title. */
  title?: string;
};

export type StrengthWorkoutDefinition = {
  athleteId: number;
  /** "YYYY-MM-DD" */
  prescribedDate: string;
  title: string;
  /** Workout-level instructions text shown to the athlete. */
  instructions?: string | null;
  blocks: StrengthBlockDefinition[];
};

type RenderedParameter = StrengthExerciseParameter & { id: string };

type RenderedSet = {
  id: string;
  isComplete: false;
  setOrigin: "Prescribed";
  parameterValues: Array<{
    id: string;
    parameter: string;
    inputFormat: string;
    prescribedValue: string;
    executedValue: null;
  }>;
};

type RenderedPrescription = {
  id: string;
  exercise: {
    id: string;
    ownerId: number;
    title: string;
    videoUrl: string | null;
    instructions: string | null;
    parameters: Array<StrengthExerciseParameter & { id: string }>;
    canEdit: boolean;
  };
  parameters: RenderedParameter[];
  sets: RenderedSet[];
  coachNotes: string | null;
  compliancePercent: 0;
  setSummaryTemplate: string;
};

type RenderedBlock = {
  id: string;
  blockType: "SingleExercise";
  title: string;
  coachNotes: string | null;
  isComplete: false;
  compliancePercent: 0;
  parameters: [];
  prescriptions: [RenderedPrescription];
};

/**
 * The `parsed_payload` of a `strength_workout` action.
 *
 * Deliberately carries `athleteId` and NOT `calendarId`/`workoutType`:
 * tp-write-executor-once.ts destructures athleteId out and adds
 * `workoutType: "StructuredStrength"` + `calendarId` itself.
 */
export type StrengthWorkoutPayloadPreview = {
  athleteId: number;
  prescribedDate: string;
  title: string;
  instructions: string | null;
  blocks: RenderedBlock[];
  snapshot: {
    totalBlocks: number;
    completedBlocks: 0;
    totalSets: number;
    completedSets: 0;
    totalPrescriptions: number;
    completedPrescriptions: 0;
  };
  lastUpdatedAt: null;
  compliancePercent: 0;
  rpe: null;
  feel: null;
  prescribedStartTime: null;
  startDateTime: null;
  completedDateTime: null;
  prescribedDurationInSeconds: null;
  orderOnDay: null;
  executedDurationInSeconds: null;
  isLocked: false;
  isHidden: false;
  workoutSubTypeId: null;
  id: string;
};

export type RenderStrengthWorkoutOptions = {
  /** Injectable for deterministic checks; defaults to randomUUID. */
  idFactory?: () => string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validate(definition: StrengthWorkoutDefinition): void {
  if (!Number.isFinite(definition.athleteId) || definition.athleteId <= 0) {
    throw new Error("Strength workout: athleteId must be a positive number.");
  }
  if (!DATE_PATTERN.test(definition.prescribedDate)) {
    throw new Error(`Strength workout: prescribedDate must be YYYY-MM-DD, got "${definition.prescribedDate}".`);
  }
  if (!definition.title.trim()) {
    throw new Error("Strength workout: title is required.");
  }
  if (definition.blocks.length === 0) {
    throw new Error("Strength workout: at least one block is required.");
  }

  for (const [index, block] of definition.blocks.entries()) {
    const where = `block ${index + 1} ("${block.exercise?.title ?? "?"}")`;
    if (!block.exercise?.id) {
      throw new Error(`Strength workout: ${where} is missing a TrainingPeaks exercise id.`);
    }
    if (block.exercise.parameters.length === 0) {
      throw new Error(`Strength workout: ${where} has no exercise parameters.`);
    }
    if (block.sets.length === 0) {
      throw new Error(`Strength workout: ${where} has no sets.`);
    }
    const declared = new Set(block.exercise.parameters.map((parameter) => parameter.parameter));
    for (const [setIndex, set] of block.sets.entries()) {
      const names = Object.keys(set);
      if (names.length === 0) {
        throw new Error(`Strength workout: ${where}, set ${setIndex + 1} has no prescribed values.`);
      }
      for (const name of names) {
        if (!declared.has(name)) {
          throw new Error(
            `Strength workout: ${where}, set ${setIndex + 1} prescribes "${name}", ` +
              `which the exercise does not declare (has: ${[...declared].join(", ")}).`
          );
        }
      }
    }
  }
}

/** "{RepsPerSide} Reps/side" — token per parameter, exactly as TP renders it. */
function buildSetSummaryTemplate(parameters: StrengthExerciseParameter[]): string {
  return parameters.map((parameter) => `{${parameter.parameter}} ${parameter.title}`).join(" ");
}

function renderBlock(
  block: StrengthBlockDefinition,
  newId: () => string
): RenderedBlock {
  const { exercise } = block;

  const prescription: RenderedPrescription = {
    id: newId(),
    exercise: {
      id: exercise.id,
      ownerId: exercise.ownerId,
      title: exercise.title,
      videoUrl: exercise.videoUrl ?? null,
      instructions: exercise.instructions ?? null,
      // Inside `exercise`, parameter ids are library-local ("0"), not UUIDs.
      parameters: exercise.parameters.map((parameter, index) => ({
        parameter: parameter.parameter,
        title: parameter.title,
        unit: parameter.unit,
        category: parameter.category,
        id: String(index),
      })),
      canEdit: exercise.canEdit ?? false,
    },
    // The prescription-level copy carries fresh UUIDs instead.
    parameters: exercise.parameters.map((parameter) => ({
      parameter: parameter.parameter,
      title: parameter.title,
      unit: parameter.unit,
      category: parameter.category,
      id: newId(),
    })),
    sets: block.sets.map((set) => ({
      id: newId(),
      isComplete: false as const,
      setOrigin: "Prescribed" as const,
      parameterValues: exercise.parameters
        .filter((parameter) => set[parameter.parameter] !== undefined)
        .map((parameter) => ({
          id: newId(),
          parameter: parameter.parameter,
          inputFormat: parameter.inputFormat ?? "Integer",
          prescribedValue: set[parameter.parameter],
          executedValue: null,
        })),
    })),
    coachNotes: null,
    compliancePercent: 0 as const,
    setSummaryTemplate: buildSetSummaryTemplate(exercise.parameters),
  };

  return {
    id: newId(),
    blockType: "SingleExercise",
    title: block.title ?? exercise.title,
    coachNotes: block.coachNotes ?? null,
    isComplete: false,
    compliancePercent: 0,
    parameters: [],
    prescriptions: [prescription],
  };
}

/**
 * Render a strength workout definition into the `parsed_payload` of a
 * `strength_workout` action, ready for tp-write-executor-once.ts.
 */
export function renderStrengthWorkoutPayload(
  definition: StrengthWorkoutDefinition,
  options: RenderStrengthWorkoutOptions = {}
): StrengthWorkoutPayloadPreview {
  validate(definition);

  const newId = options.idFactory ?? randomUUID;
  const blocks = definition.blocks.map((block) => renderBlock(block, newId));
  const totalSets = blocks.reduce(
    (total, block) => total + block.prescriptions[0].sets.length,
    0
  );

  return {
    athleteId: definition.athleteId,
    prescribedDate: definition.prescribedDate,
    title: definition.title,
    instructions: definition.instructions ?? null,
    blocks,
    snapshot: {
      totalBlocks: blocks.length,
      completedBlocks: 0,
      totalSets,
      completedSets: 0,
      totalPrescriptions: blocks.length,
      completedPrescriptions: 0,
    },
    lastUpdatedAt: null,
    compliancePercent: 0,
    rpe: null,
    feel: null,
    prescribedStartTime: null,
    startDateTime: null,
    completedDateTime: null,
    prescribedDurationInSeconds: null,
    orderOnDay: null,
    executedDurationInSeconds: null,
    isLocked: false,
    isHidden: false,
    workoutSubTypeId: null,
    id: newId(),
  };
}

/**
 * The exercise record proven live by the PR1 save probe. Kept here so the
 * renderer check has a real TP exercise to render without needing a harvest.
 */
export const PROVEN_SINGLE_LEG_CALF_RAISE: StrengthExerciseRecord = {
  id: "26",
  ownerId: 2000301,
  title: "Single Leg Calf Raise",
  videoUrl: "https://youtu.be/jRB58gIRAyU",
  instructions: null,
  parameters: [
    {
      parameter: "RepsPerSide",
      title: "Reps/side",
      unit: { title: "Reps", abbreviation: "", unit: "Reps" },
      category: "Reps/side",
    },
  ],
  canEdit: false,
};
