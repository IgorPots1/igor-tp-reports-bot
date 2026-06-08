type UnknownRecord = Record<string, unknown>;

export type TrainingPeaksCompletedWorkoutDetailsAvailability = {
  hasCompletedDuration: boolean;
  hasCompletedDistance: boolean;
  hasAveragePace: boolean;
  hasAverageHeartRate: boolean;
  hasLaps: boolean;
  hasIntervalActuals: boolean;
  hasPlannedStructure: boolean;
  hasTargetPaceOrHr: boolean;
  hasCoachComments: boolean;
};

export type TrainingPeaksCompletedWorkoutDetailsMetrics = {
  durationSeconds?: number;
  distanceMeters?: number;
  averagePaceSecPerKm?: number;
  averageHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  lapCount?: number;
  intervalCount?: number;
};

export type TrainingPeaksCompletedWorkoutDetailsExtraction = {
  dataAvailability: TrainingPeaksCompletedWorkoutDetailsAvailability;
  extractedMetrics: TrainingPeaksCompletedWorkoutDetailsMetrics;
};

const SECRET_KEY_PATTERN = /(token|cookie|authorization|secret|password|session|bearer|apikey)/i;

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
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function findValueByNormalizedKeys(root: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5 || root === null || root === undefined) {
    return undefined;
  }
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findValueByNormalizedKeys(item, keys, depth + 1);
      if (hit !== undefined) {
        return hit;
      }
    }
    return undefined;
  }
  const record = asRecord(root);
  if (!record) {
    return undefined;
  }
  const normalizedKeys = keys.map((key) => key.toLowerCase());
  for (const [key, value] of Object.entries(record)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.includes(normalized)) {
      return value;
    }
  }
  for (const value of Object.values(record)) {
    const hit = findValueByNormalizedKeys(value, keys, depth + 1);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}

function hasAnyKeyDeep(root: unknown, keyHints: string[], depth = 0): boolean {
  if (depth > 6 || root === null || root === undefined) {
    return false;
  }
  if (Array.isArray(root)) {
    return root.some((item) => hasAnyKeyDeep(item, keyHints, depth + 1));
  }
  const record = asRecord(root);
  if (!record) {
    return false;
  }
  const hints = keyHints.map((hint) => hint.toLowerCase());
  for (const [key, value] of Object.entries(record)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (hints.some((hint) => normalized.includes(hint))) {
      return true;
    }
    if (hasAnyKeyDeep(value, keyHints, depth + 1)) {
      return true;
    }
  }
  return false;
}

function countLikelyArray(root: unknown, keyHints: string[]): number | undefined {
  const value = findValueByNormalizedKeys(root, keyHints);
  if (Array.isArray(value)) {
    return value.length;
  }
  return undefined;
}

function chooseFirstNumber(root: unknown, candidates: string[]): number | undefined {
  for (const key of candidates) {
    const value = findValueByNormalizedKeys(root, [key]);
    const numberValue = toNumber(value);
    if (numberValue !== null) {
      return numberValue;
    }
  }
  return undefined;
}

function normalizeDistanceMeters(root: unknown): number | undefined {
  const distanceMeters = chooseFirstNumber(root, [
    "distanceMeters",
    "completedDistanceMeters",
    "distancemeters",
    "rawDistance",
  ]);
  if (distanceMeters !== undefined) {
    return distanceMeters;
  }
  const distanceKm = chooseFirstNumber(root, ["distanceKm", "distance", "completedDistance"]);
  if (distanceKm !== undefined) {
    return distanceKm > 1000 ? distanceKm : Math.round(distanceKm * 1000);
  }
  return undefined;
}

function normalizeDurationSeconds(root: unknown): number | undefined {
  const directSeconds = chooseFirstNumber(root, ["durationSeconds", "elapsedTime"]);
  if (directSeconds !== undefined) {
    return directSeconds;
  }
  for (const key of ["totalTime", "completedTimeRaw", "rawTotalTime"]) {
    const value = findValueByNormalizedKeys(root, [key]);
    const numberValue = toNumber(value);
    if (numberValue === null || numberValue <= 0) {
      continue;
    }
    // TrainingPeaks list/detail payloads often store these fields as decimal hours.
    if (numberValue <= 48) {
      return Math.round(numberValue * 3600);
    }
    return numberValue;
  }
  return undefined;
}

function normalizeAveragePaceSecPerKm(root: unknown): number | undefined {
  const directPace = chooseFirstNumber(root, [
    "averagePaceSecPerKm",
    "avgPace",
    "averagePace",
    "paceAvg",
  ]);
  if (directPace !== undefined) {
    return directPace;
  }
  const velocityMetersPerSecond = chooseFirstNumber(root, ["normalizedSpeedActual", "velocityAverage"]);
  if (velocityMetersPerSecond !== undefined && velocityMetersPerSecond > 0) {
    return Math.round(1000 / velocityMetersPerSecond);
  }
  return undefined;
}

export function extractTrainingPeaksCompletedWorkoutDetails(
  source: unknown
): TrainingPeaksCompletedWorkoutDetailsExtraction {
  const durationSeconds = normalizeDurationSeconds(source);
  const distanceMeters = normalizeDistanceMeters(source);
  const averagePaceSecPerKm = normalizeAveragePaceSecPerKm(source);
  const averageHeartRateBpm = chooseFirstNumber(source, [
    "averageHeartRateBpm",
    "avgHeartRate",
    "averageHeartRate",
    "heartRateAvg",
    "heartRateAverage",
  ]);
  const maxHeartRateBpm = chooseFirstNumber(source, [
    "maxHeartRateBpm",
    "maxHeartRate",
    "hrMax",
    "heartRateMaximum",
  ]);
  const lapCount =
    countLikelyArray(source, ["laps", "splits", "lapDetails"]) ??
    (hasAnyKeyDeep(source, ["lap", "split"]) ? 1 : undefined);
  const intervalCount =
    countLikelyArray(source, ["intervals", "repetitions", "segments"]) ??
    (hasAnyKeyDeep(source, ["interval", "repetition", "segment"]) ? 1 : undefined);

  return {
    dataAvailability: {
      hasCompletedDuration: durationSeconds !== undefined,
      hasCompletedDistance: distanceMeters !== undefined,
      hasAveragePace: averagePaceSecPerKm !== undefined,
      hasAverageHeartRate: averageHeartRateBpm !== undefined,
      hasLaps: lapCount !== undefined,
      hasIntervalActuals: intervalCount !== undefined,
      hasPlannedStructure: hasAnyKeyDeep(source, ["structure", "plannedstep", "planned"]),
      hasTargetPaceOrHr: hasAnyKeyDeep(source, [
        "targetpace",
        "targethr",
        "heartratezone",
        "pacerange",
        "targets",
        "percentofmaxhr",
      ]),
      hasCoachComments: hasAnyKeyDeep(source, ["coachcomment", "coachnote", "comment"]),
    },
    extractedMetrics: {
      durationSeconds,
      distanceMeters,
      averagePaceSecPerKm,
      averageHeartRateBpm,
      maxHeartRateBpm,
      lapCount,
      intervalCount,
    },
  };
}

export function mergeExtractedMetrics(
  preferred: TrainingPeaksCompletedWorkoutDetailsExtraction,
  fallback: TrainingPeaksCompletedWorkoutDetailsExtraction
): TrainingPeaksCompletedWorkoutDetailsExtraction {
  return {
    dataAvailability: {
      hasCompletedDuration:
        preferred.dataAvailability.hasCompletedDuration || fallback.dataAvailability.hasCompletedDuration,
      hasCompletedDistance:
        preferred.dataAvailability.hasCompletedDistance || fallback.dataAvailability.hasCompletedDistance,
      hasAveragePace: preferred.dataAvailability.hasAveragePace || fallback.dataAvailability.hasAveragePace,
      hasAverageHeartRate:
        preferred.dataAvailability.hasAverageHeartRate || fallback.dataAvailability.hasAverageHeartRate,
      hasLaps: preferred.dataAvailability.hasLaps || fallback.dataAvailability.hasLaps,
      hasIntervalActuals:
        preferred.dataAvailability.hasIntervalActuals || fallback.dataAvailability.hasIntervalActuals,
      hasPlannedStructure:
        preferred.dataAvailability.hasPlannedStructure || fallback.dataAvailability.hasPlannedStructure,
      hasTargetPaceOrHr:
        preferred.dataAvailability.hasTargetPaceOrHr || fallback.dataAvailability.hasTargetPaceOrHr,
      hasCoachComments: preferred.dataAvailability.hasCoachComments || fallback.dataAvailability.hasCoachComments,
    },
    extractedMetrics: {
      durationSeconds: preferred.extractedMetrics.durationSeconds ?? fallback.extractedMetrics.durationSeconds,
      distanceMeters: preferred.extractedMetrics.distanceMeters ?? fallback.extractedMetrics.distanceMeters,
      averagePaceSecPerKm:
        preferred.extractedMetrics.averagePaceSecPerKm ?? fallback.extractedMetrics.averagePaceSecPerKm,
      averageHeartRateBpm:
        preferred.extractedMetrics.averageHeartRateBpm ?? fallback.extractedMetrics.averageHeartRateBpm,
      maxHeartRateBpm: preferred.extractedMetrics.maxHeartRateBpm ?? fallback.extractedMetrics.maxHeartRateBpm,
      lapCount: preferred.extractedMetrics.lapCount ?? fallback.extractedMetrics.lapCount,
      intervalCount: preferred.extractedMetrics.intervalCount ?? fallback.extractedMetrics.intervalCount,
    },
  };
}

export function redactSensitiveForReport(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[truncated-depth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redactSensitiveForReport(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) {
    if (typeof value === "string" && value.length > 800) {
      return `${value.slice(0, 800)}...[truncated]`;
    }
    return value;
  }
  const output: UnknownRecord = {};
  for (const [key, child] of Object.entries(record)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = redactSensitiveForReport(child, depth + 1);
  }
  return output;
}
