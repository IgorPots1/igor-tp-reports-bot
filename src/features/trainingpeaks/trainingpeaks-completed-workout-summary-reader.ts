import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";
import { enforceGetOnlyMethod } from "@/features/trainingpeaks/trainingpeaks-completed-workout-details-probe";
import {
  extractTrainingPeaksCompletedWorkoutDetails,
  type TrainingPeaksCompletedWorkoutDetailsExtraction,
} from "@/features/trainingpeaks/trainingpeaks-completed-workout-details-extractor";

type UnknownRecord = Record<string, unknown>;

export type TrainingPeaksCompletedWorkoutSummaryDetails = {
  source: "tp_date_range_endpoint";
  athleteId: string;
  date: string;
  workoutId: string | null;
  title: string | null;

  dataAvailability: {
    hasDuration: boolean;
    hasDistance: boolean;
    hasAveragePace: boolean;
    hasAverageSpeed: boolean;
    hasAverageHeartRate: boolean;
    hasMaxHeartRate: boolean;
    hasPlannedStructure: boolean;
    hasTargetPaceOrHr: boolean;
    hasCoachComments: boolean;

    hasLaps: false;
    hasSplits: false;
    hasIntervalActuals: false;
    hasSamples: false;
  };

  metrics: {
    durationSeconds?: number;
    distanceMeters?: number;
    averagePaceSecPerKm?: number;
    averageSpeedMetersPerSecond?: number;
    averageHeartRateBpm?: number;
    maxHeartRateBpm?: number;
    computedAveragePaceFromDistanceDuration?: boolean;
  };

  plannedContext: {
    hasStructure: boolean;
    hasTargetPaceOrHr: boolean;
    hasCoachComments: boolean;
    coachCommentsPreview?: string;
  };

  warnings: string[];
};

export type TrainingPeaksCompletedWorkoutSummaryReaderResult =
  | {
      status: "success";
      details: TrainingPeaksCompletedWorkoutSummaryDetails;
    }
  | {
      status: "ambiguous";
      candidateWorkoutIds: string[];
      warnings: string[];
    }
  | {
      status: "not_found";
      warnings: string[];
    }
  | {
      status: "missing_bearer";
      warnings: string[];
    }
  | {
      status: "error";
      warnings: string[];
    };

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractWorkoutId(entry: unknown): string | null {
  const record = asRecord(entry);
  if (!record) {
    return null;
  }
  const raw = record.workoutId ?? record.workout_id ?? record.id;
  if (raw === null || raw === undefined) {
    return null;
  }
  const normalized = String(raw).trim();
  return normalized || null;
}

function extractWorkoutTitle(entry: unknown): string | null {
  const record = asRecord(entry);
  if (!record) {
    return null;
  }
  const title = record.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function extractCoachCommentsPreview(entry: unknown): string | undefined {
  const record = asRecord(entry);
  if (!record) {
    return undefined;
  }
  const raw = record.coachComments ?? record.coachComment ?? record.coach_comments;
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

function isCompletedWorkoutEntry(entry: unknown): boolean {
  const record = asRecord(entry);
  if (!record) {
    return false;
  }
  const completedFlag = record.completed;
  if (completedFlag === true) {
    return true;
  }
  const durationSeconds = toNumber(record.totalTime);
  if (durationSeconds !== null && durationSeconds > 0) {
    return true;
  }
  const distance = toNumber(record.distance) ?? toNumber(record.distanceMeters);
  if (distance !== null && distance > 0) {
    return true;
  }
  const elapsed = toNumber(record.elapsedTime) ?? toNumber(record.durationSeconds);
  return elapsed !== null && elapsed > 0;
}

function isRunPlausibleWorkoutEntry(entry: unknown): boolean {
  const record = asRecord(entry);
  if (!record) {
    return false;
  }
  return classifyTrainingPeaksWorkoutActivity({
    title: extractWorkoutTitle(entry),
    sportOrTypeCode: typeof record.code === "string" ? record.code : null,
    workoutTypeValueId: toNumber(record.workoutTypeValueId),
    workoutSubTypeId: toNumber(record.workoutSubTypeId),
    sourceSnapshot: record,
  }).isRunning;
}

function normalizeWorkoutsArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  for (const key of ["workouts", "items", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function chooseAverageSpeedMetersPerSecond(
  extraction: TrainingPeaksCompletedWorkoutDetailsExtraction,
  workoutPayload: unknown
): number | undefined {
  const record = asRecord(workoutPayload);
  const direct =
    toNumber(record?.velocityAverage) ??
    toNumber(record?.normalizedSpeedActual) ??
    toNumber(record?.averageSpeedMetersPerSecond);
  if (direct !== null && direct > 0) {
    return direct;
  }
  const pace = extraction.extractedMetrics.averagePaceSecPerKm;
  if (pace !== undefined && pace > 0) {
    return 1000 / pace;
  }
  return undefined;
}

export function buildTrainingPeaksCompletedWorkoutSummaryDetails(input: {
  workoutPayload: unknown;
  athleteId: string;
  date: string;
  workoutId: string | null;
}): TrainingPeaksCompletedWorkoutSummaryDetails {
  const extraction = extractTrainingPeaksCompletedWorkoutDetails(input.workoutPayload);
  const warnings: string[] = [];
  const metrics: TrainingPeaksCompletedWorkoutSummaryDetails["metrics"] = {
    durationSeconds: extraction.extractedMetrics.durationSeconds,
    distanceMeters: extraction.extractedMetrics.distanceMeters,
    averageHeartRateBpm: extraction.extractedMetrics.averageHeartRateBpm,
    maxHeartRateBpm: extraction.extractedMetrics.maxHeartRateBpm,
  };

  let averagePaceSecPerKm = extraction.extractedMetrics.averagePaceSecPerKm;
  if (
    averagePaceSecPerKm === undefined &&
    metrics.durationSeconds !== undefined &&
    metrics.distanceMeters !== undefined &&
    metrics.distanceMeters > 0
  ) {
    averagePaceSecPerKm = Math.round(metrics.durationSeconds / (metrics.distanceMeters / 1000));
    metrics.computedAveragePaceFromDistanceDuration = true;
    warnings.push("Average pace computed from duration and distance; not reported directly by TP.");
  } else if (averagePaceSecPerKm !== undefined) {
    metrics.averagePaceSecPerKm = averagePaceSecPerKm;
  }

  if (averagePaceSecPerKm !== undefined) {
    metrics.averagePaceSecPerKm = averagePaceSecPerKm;
  }

  const averageSpeedMetersPerSecond = chooseAverageSpeedMetersPerSecond(extraction, input.workoutPayload);
  if (averageSpeedMetersPerSecond !== undefined) {
    metrics.averageSpeedMetersPerSecond = averageSpeedMetersPerSecond;
  }

  const coachCommentsPreview = extractCoachCommentsPreview(input.workoutPayload);
  const hasCoachComments =
    extraction.dataAvailability.hasCoachComments || Boolean(coachCommentsPreview?.trim());

  return {
    source: "tp_date_range_endpoint",
    athleteId: input.athleteId,
    date: input.date,
    workoutId: input.workoutId,
    title: extractWorkoutTitle(input.workoutPayload),
    dataAvailability: {
      hasDuration: extraction.dataAvailability.hasCompletedDuration,
      hasDistance: extraction.dataAvailability.hasCompletedDistance,
      hasAveragePace: averagePaceSecPerKm !== undefined,
      hasAverageSpeed: averageSpeedMetersPerSecond !== undefined,
      hasAverageHeartRate: extraction.dataAvailability.hasAverageHeartRate,
      hasMaxHeartRate: extraction.dataAvailability.hasMaxHeartRate,
      hasPlannedStructure: extraction.dataAvailability.hasPlannedStructure,
      hasTargetPaceOrHr: extraction.dataAvailability.hasTargetPaceOrHr,
      hasCoachComments,
      hasLaps: false,
      hasSplits: false,
      hasIntervalActuals: false,
      hasSamples: false,
    },
    metrics,
    plannedContext: {
      hasStructure: extraction.dataAvailability.hasPlannedStructure,
      hasTargetPaceOrHr: extraction.dataAvailability.hasTargetPaceOrHr,
      hasCoachComments,
      coachCommentsPreview,
    },
    warnings,
  };
}

export function selectWorkoutFromDateRangePayload(input: {
  payload: unknown;
  workoutId?: string;
}): {
  status: "success" | "ambiguous" | "not_found";
  workoutPayload?: unknown;
  selectedWorkoutId?: string;
  candidateWorkoutIds: string[];
  warnings: string[];
} {
  const entries = normalizeWorkoutsArray(input.payload);
  const candidates = entries.filter((entry) => isCompletedWorkoutEntry(entry) && isRunPlausibleWorkoutEntry(entry));
  const candidateWorkoutIds = candidates
    .map((entry) => extractWorkoutId(entry))
    .filter((value): value is string => Boolean(value));

  if (input.workoutId) {
    const matched = candidates.find((entry) => extractWorkoutId(entry) === input.workoutId);
    if (!matched) {
      return {
        status: "not_found",
        candidateWorkoutIds,
        warnings: [`workout_id ${input.workoutId} was not found among completed run candidates.`],
      };
    }
    return {
      status: "success",
      workoutPayload: matched,
      selectedWorkoutId: input.workoutId,
      candidateWorkoutIds,
      warnings: [],
    };
  }

  if (candidates.length === 1) {
    const selectedWorkoutId = extractWorkoutId(candidates[0]);
    return {
      status: "success",
      workoutPayload: candidates[0],
      selectedWorkoutId: selectedWorkoutId ?? undefined,
      candidateWorkoutIds,
      warnings: [],
    };
  }

  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      candidateWorkoutIds,
      warnings: ["Multiple completed run candidates found; pass workout_id to select explicitly."],
    };
  }

  return {
    status: "not_found",
    candidateWorkoutIds,
    warnings: ["No completed run candidates found in date-range endpoint response."],
  };
}

export async function readTrainingPeaksCompletedWorkoutSummary(input: {
  athleteId: string | number;
  date: string;
  workoutId?: string;
  bearerToken?: string;
}): Promise<TrainingPeaksCompletedWorkoutSummaryReaderResult> {
  const athleteId = String(input.athleteId).trim();
  const date = input.date.trim();
  const bearerToken = input.bearerToken?.trim() ?? "";

  if (!ISO_DATE_PATTERN.test(date)) {
    return {
      status: "error",
      warnings: [`Invalid date "${date}". Expected YYYY-MM-DD.`],
    };
  }

  if (!bearerToken) {
    return {
      status: "missing_bearer",
      warnings: ["TRAININGPEAKS_API_BEARER is missing; live summary reader skipped."],
    };
  }

  enforceGetOnlyMethod("GET");
  const endpoint = `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${athleteId}/workouts/${date}/${date}`;
  let payload: unknown = null;
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${bearerToken}`,
        "x-requested-with": "XMLHttpRequest",
      },
    });
    if (!response.ok) {
      return {
        status: "error",
        warnings: [`Date-range endpoint returned status ${response.status}.`],
      };
    }
    payload = await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      warnings: [`Date-range endpoint request failed: ${message}`],
    };
  }

  const selection = selectWorkoutFromDateRangePayload({
    payload,
    workoutId: input.workoutId,
  });

  if (selection.status === "ambiguous") {
    return {
      status: "ambiguous",
      candidateWorkoutIds: selection.candidateWorkoutIds,
      warnings: selection.warnings,
    };
  }

  if (selection.status === "not_found" || !selection.workoutPayload) {
    return {
      status: "not_found",
      warnings: selection.warnings,
    };
  }

  const details = buildTrainingPeaksCompletedWorkoutSummaryDetails({
    workoutPayload: selection.workoutPayload,
    athleteId,
    date,
    workoutId: selection.selectedWorkoutId ?? null,
  });

  return {
    status: "success",
    details,
  };
}
