import {
  renderRunningWorkoutPayloadPreview,
  type RunningWorkoutCaseId,
  type RunningWorkoutDefinition,
  type RunningWorkoutPayloadPreview,
} from "./running-workout-renderer.ts";

export type CreatePlanValidationStatus = "valid" | "partial" | "invalid";

export type TrainingPeaksCreateWorkoutRequestBodyCandidate = {
  athleteId: number;
  workoutDay: string;
  workoutId: 0;
  title: string;
  workoutTypeValueId: number;
  workoutSubTypeId: number | null;
  description: string;
  coachComments: string | null;
  distancePlanned: number | null;
  totalTimePlanned: number;
  structure: string;
  structureObject: RunningWorkoutPayloadPreview["structure"];
};

export type TrainingPeaksCreateWorkoutPlan = {
  caseId: RunningWorkoutCaseId;
  operation: "create_running_workout";
  endpoint: {
    method: "POST";
    pathTemplate: "/fitness/v6/athletes/{athleteId}/workouts";
    athleteId: number;
  };
  safety: {
    dryRunOnly: true;
    networkCallsAllowed: false;
    liveMutationAllowed: false;
  };
  requestBodyCandidate: TrainingPeaksCreateWorkoutRequestBodyCandidate;
  requestBodySummary: {
    title: string;
    workoutDay: string;
    workoutTypeValueId: number;
    totalTimePlanned: number;
    hasStructure: boolean;
    structureSerialized: boolean;
    primaryIntensityMetric: string;
    repeatBlockCount: number;
  };
  validation: {
    status: CreatePlanValidationStatus;
    errors: string[];
    warnings: string[];
  };
};

function countRepetitionBlocks(structure: RunningWorkoutPayloadPreview["structure"]): number {
  return structure.structure.filter((node) => node.type === "repetition").length;
}

function validatePlanDraft(
  preview: RunningWorkoutPayloadPreview,
  candidate: TrainingPeaksCreateWorkoutRequestBodyCandidate
): TrainingPeaksCreateWorkoutPlan["validation"] {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (candidate.workoutId !== 0) {
    errors.push("workoutId must stay 0 for create dry-run candidate.");
  }
  if (candidate.athleteId !== preview.athleteId) {
    errors.push("athleteId mismatch between renderer preview and request body candidate.");
  }
  if (candidate.workoutTypeValueId !== preview.workoutTypeValueId) {
    errors.push("workoutTypeValueId mismatch between renderer preview and request body candidate.");
  }
  if (candidate.totalTimePlanned !== preview.totalTimePlanned) {
    errors.push("totalTimePlanned mismatch between renderer preview and request body candidate.");
  }
  if (candidate.structure.length === 0) {
    errors.push("structure must be a non-empty JSON string in request body candidate.");
  } else {
    try {
      const parsed = JSON.parse(candidate.structure) as unknown;
      if (JSON.stringify(parsed) !== JSON.stringify(preview.structure)) {
        errors.push("structure JSON does not match renderer structure.");
      }
    } catch {
      errors.push("structure field is not valid JSON.");
    }
  }

  warnings.push(
    "request-side structure wrapper inferred from renderer/response truth because captured request.structureSamples are redacted."
  );

  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "partial" : "valid",
    errors,
    warnings,
  };
}

export function buildRunningWorkoutCreatePlan(definition: RunningWorkoutDefinition): TrainingPeaksCreateWorkoutPlan {
  const preview = renderRunningWorkoutPayloadPreview(definition);
  const structureSerialized = JSON.stringify(preview.structure);

  const requestBodyCandidate: TrainingPeaksCreateWorkoutRequestBodyCandidate = {
    athleteId: preview.athleteId,
    workoutDay: preview.workoutDay,
    workoutId: 0,
    title: preview.title,
    workoutTypeValueId: preview.workoutTypeValueId,
    workoutSubTypeId: preview.workoutSubTypeId,
    description: preview.description,
    coachComments: preview.coachComments,
    distancePlanned: preview.distancePlanned,
    totalTimePlanned: preview.totalTimePlanned,
    structure: structureSerialized,
    structureObject: preview.structure,
  };

  return {
    caseId: definition.caseId,
    operation: "create_running_workout",
    endpoint: {
      method: "POST",
      pathTemplate: "/fitness/v6/athletes/{athleteId}/workouts",
      athleteId: preview.athleteId,
    },
    safety: {
      dryRunOnly: true,
      networkCallsAllowed: false,
      liveMutationAllowed: false,
    },
    requestBodyCandidate,
    requestBodySummary: {
      title: preview.title,
      workoutDay: preview.workoutDay,
      workoutTypeValueId: preview.workoutTypeValueId,
      totalTimePlanned: preview.totalTimePlanned,
      hasStructure: requestBodyCandidate.structure.length > 0,
      structureSerialized: requestBodyCandidate.structure === preview.structureSerialized,
      primaryIntensityMetric: preview.structure.primaryIntensityMetric,
      repeatBlockCount: countRepetitionBlocks(preview.structure),
    },
    validation: validatePlanDraft(preview, requestBodyCandidate),
  };
}
