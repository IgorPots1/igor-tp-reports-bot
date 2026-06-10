type UnknownRecord = Record<string, unknown>;

export type TrainingPeaksCompletedWorkoutDetailsAvailability = {
  hasCompletedDuration: boolean;
  hasCompletedDistance: boolean;
  hasAveragePace: boolean;
  hasAverageHeartRate: boolean;
  hasMaxHeartRate: boolean;
  hasLaps: boolean;
  hasSplits: boolean;
  hasIntervalActuals: boolean;
  hasSamples: boolean;
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
  splitCount?: number;
  intervalCount?: number;
  sampleCount?: number;
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

function findLikelyArray(root: unknown, keyHints: string[]): unknown[] | null {
  const value = findValueByNormalizedKeys(root, keyHints);
  return Array.isArray(value) ? value : null;
}

function looksLikeActualIntervalEntry(entry: unknown): boolean {
  const record = asRecord(entry);
  if (!record) {
    return false;
  }
  const actualHints = [
    "duration",
    "elapsed",
    "time",
    "distance",
    "speed",
    "pace",
    "heartrate",
    "cadence",
    "power",
  ];
  const plannedOnlyHints = ["target", "planned", "goal", "zone", "structure", "step"];
  for (const [rawKey, value] of Object.entries(record)) {
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (plannedOnlyHints.some((hint) => key.includes(hint))) {
      continue;
    }
    if (actualHints.some((hint) => key.includes(hint))) {
      if (typeof value === "number") {
        return true;
      }
      if (typeof value === "string" && value.trim()) {
        return true;
      }
    }
  }
  return false;
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
  const lapsArray = findLikelyArray(source, ["laps", "lapDetails"]);
  const splitsArray = findLikelyArray(source, ["splits"]);
  const intervalArray =
    findLikelyArray(source, ["intervals"]) ??
    findLikelyArray(source, ["segments"]) ??
    findLikelyArray(source, ["repeats"]) ??
    findLikelyArray(source, ["sets"]);
  const sampleArray = findLikelyArray(source, ["samples"]);
  const hasActualIntervals = Array.isArray(intervalArray)
    ? intervalArray.some((entry) => looksLikeActualIntervalEntry(entry))
    : false;
  const lapCount = lapsArray?.length;
  const splitCount = splitsArray?.length;
  const intervalCount = hasActualIntervals ? intervalArray?.length : undefined;
  const sampleCount = sampleArray?.length;

  return {
    dataAvailability: {
      hasCompletedDuration: durationSeconds !== undefined,
      hasCompletedDistance: distanceMeters !== undefined,
      hasAveragePace: averagePaceSecPerKm !== undefined,
      hasAverageHeartRate: averageHeartRateBpm !== undefined,
      hasMaxHeartRate: maxHeartRateBpm !== undefined,
      hasLaps: (lapCount ?? 0) > 0,
      hasSplits: (splitCount ?? 0) > 0,
      hasIntervalActuals: (intervalCount ?? 0) > 0,
      hasSamples: (sampleCount ?? 0) > 0,
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
      splitCount,
      intervalCount,
      sampleCount,
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
      hasMaxHeartRate: preferred.dataAvailability.hasMaxHeartRate || fallback.dataAvailability.hasMaxHeartRate,
      hasLaps: preferred.dataAvailability.hasLaps || fallback.dataAvailability.hasLaps,
      hasSplits: preferred.dataAvailability.hasSplits || fallback.dataAvailability.hasSplits,
      hasIntervalActuals:
        preferred.dataAvailability.hasIntervalActuals || fallback.dataAvailability.hasIntervalActuals,
      hasSamples: preferred.dataAvailability.hasSamples || fallback.dataAvailability.hasSamples,
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
      splitCount: preferred.extractedMetrics.splitCount ?? fallback.extractedMetrics.splitCount,
      intervalCount: preferred.extractedMetrics.intervalCount ?? fallback.extractedMetrics.intervalCount,
      sampleCount: preferred.extractedMetrics.sampleCount ?? fallback.extractedMetrics.sampleCount,
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
