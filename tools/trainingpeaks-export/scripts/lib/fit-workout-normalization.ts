// Normalizes fit-file-parser@3 output (ParsedRecord[]/ParsedLap[]) into the
// shapes the ingest pipeline works with. Field names are taken from the
// package's own dist/fit_types.d.ts (ParsedRecord/ParsedLap) and cross-checked
// against tools/trainingpeaks-export/scripts/local/hr-drift-elevation-audit.ts
// and tp-race-prediction-probe.ts, which already read a subset of these same
// fields from real FIT files.

export type NormalizedFitRecord = {
  timeS: number; // seconds elapsed since the first record (monotonic)
  heartRate: number | null; // raw bpm from the device, uncleaned
  cadenceRpm: number | null; // raw FIT cadence; running: steps/min = x2
  speedMps: number | null; // enhanced_speed ?? speed
  distanceM: number | null;
  altitudeM: number | null; // enhanced_altitude ?? altitude
  power: number | null;
};

export type NormalizedFitLap = {
  lapIndex: number;
  startOffsetS: number | null; // lap start relative to the first record's timestamp
  timerTimeS: number | null; // FIT total_timer_time
  elapsedTimeS: number | null; // FIT total_elapsed_time
  distanceM: number | null; // FIT total_distance
  avgSpeedMps: number | null; // enhanced_avg_speed ?? avg_speed
  maxSpeedMps: number | null; // enhanced_max_speed ?? max_speed
  avgHr: number | null; // FIT avg_heart_rate, RAW device value
  maxHr: number | null;
  minHr: number | null;
  avgCadenceRpm: number | null;
  maxCadenceRpm: number | null;
  avgPower: number | null;
  totalAscentM: number | null;
  totalDescentM: number | null;
  lapTrigger: string | null;
  intensity: string | null;
  wktStepIndex: number | null;
};

// Loose shapes for the fields we read off the parser's runtime output.
// Deliberately untyped against fit-file-parser's exported interfaces because
// elapsedRecordField-injected fields (elapsed_time) aren't part of the strict
// ParsedRecord type, and we want tolerance for fields missing at runtime.
type RawFitRecordLike = {
  timestamp?: unknown;
  heart_rate?: unknown;
  cadence?: unknown;
  speed?: unknown;
  enhanced_speed?: unknown;
  distance?: unknown;
  altitude?: unknown;
  enhanced_altitude?: unknown;
  power?: unknown;
};

type RawFitLapLike = {
  start_time?: unknown;
  total_timer_time?: unknown;
  total_elapsed_time?: unknown;
  total_distance?: unknown;
  avg_speed?: unknown;
  max_speed?: unknown;
  enhanced_avg_speed?: unknown;
  enhanced_max_speed?: unknown;
  avg_heart_rate?: unknown;
  max_heart_rate?: unknown;
  min_heart_rate?: unknown;
  avg_cadence?: unknown;
  max_cadence?: unknown;
  avg_power?: unknown;
  total_ascent?: unknown;
  total_descent?: unknown;
  lap_trigger?: unknown;
  intensity?: unknown;
  wkt_step_index?: unknown;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toPositiveFiniteNumber(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function toTimestampMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

// records must already be time-ordered (fit-file-parser emits them in file order).
export function normalizeFitRecords(rawRecords: unknown[]): NormalizedFitRecord[] {
  const withTimestamp = rawRecords
    .filter((entry): entry is RawFitRecordLike => Boolean(entry) && typeof entry === "object")
    .map((record) => ({ record, tsMs: toTimestampMs(record.timestamp) }))
    .filter((entry): entry is { record: RawFitRecordLike; tsMs: number } => entry.tsMs !== null)
    .sort((a, b) => a.tsMs - b.tsMs);

  if (withTimestamp.length === 0) return [];
  const startMs = withTimestamp[0]!.tsMs;

  return withTimestamp.map(({ record, tsMs }) => ({
    timeS: (tsMs - startMs) / 1000,
    heartRate: toPositiveFiniteNumber(record.heart_rate),
    cadenceRpm: toPositiveFiniteNumber(record.cadence),
    speedMps: toPositiveFiniteNumber(record.enhanced_speed) ?? toPositiveFiniteNumber(record.speed),
    distanceM: toFiniteNumber(record.distance),
    altitudeM: toFiniteNumber(record.enhanced_altitude) ?? toFiniteNumber(record.altitude),
    power: toPositiveFiniteNumber(record.power),
  }));
}

export function normalizeFitLaps(rawLaps: unknown[], workoutStartMs: number | null): NormalizedFitLap[] {
  return rawLaps
    .filter((entry): entry is RawFitLapLike => Boolean(entry) && typeof entry === "object")
    .map((lap, lapIndex) => {
      const startMs = toTimestampMs(lap.start_time);
      return {
        lapIndex,
        startOffsetS:
          startMs !== null && workoutStartMs !== null ? (startMs - workoutStartMs) / 1000 : null,
        timerTimeS: toPositiveFiniteNumber(lap.total_timer_time),
        elapsedTimeS: toPositiveFiniteNumber(lap.total_elapsed_time),
        distanceM: toPositiveFiniteNumber(lap.total_distance),
        avgSpeedMps: toPositiveFiniteNumber(lap.enhanced_avg_speed) ?? toPositiveFiniteNumber(lap.avg_speed),
        maxSpeedMps: toPositiveFiniteNumber(lap.enhanced_max_speed) ?? toPositiveFiniteNumber(lap.max_speed),
        avgHr: toPositiveFiniteNumber(lap.avg_heart_rate),
        maxHr: toPositiveFiniteNumber(lap.max_heart_rate),
        minHr: toPositiveFiniteNumber(lap.min_heart_rate),
        avgCadenceRpm: toPositiveFiniteNumber(lap.avg_cadence),
        maxCadenceRpm: toPositiveFiniteNumber(lap.max_cadence),
        avgPower: toPositiveFiniteNumber(lap.avg_power),
        totalAscentM: toFiniteNumber(lap.total_ascent),
        totalDescentM: toFiniteNumber(lap.total_descent),
        lapTrigger: typeof lap.lap_trigger === "string" ? lap.lap_trigger : null,
        intensity: typeof lap.intensity === "string" ? lap.intensity : null,
        wktStepIndex: Number.isInteger(lap.wkt_step_index) ? (lap.wkt_step_index as number) : null,
      };
    });
}

// duration from timer_time (moving time) first, falling back to elapsed_time,
// mirroring fitLapDurationSeconds in tp-race-prediction-probe.ts.
export function lapDurationSeconds(lap: NormalizedFitLap): number | null {
  return lap.timerTimeS ?? lap.elapsedTimeS;
}

// Prefers distance/duration (steadier over a whole lap) over instantaneous
// avg_speed, mirroring fitLapPaceMinPerKm in tp-race-prediction-probe.ts.
export function lapPaceSecPerKm(lap: NormalizedFitLap): number | null {
  const durationS = lapDurationSeconds(lap);
  if (durationS !== null && durationS > 0 && lap.distanceM !== null && lap.distanceM > 0) {
    return durationS / (lap.distanceM / 1000);
  }
  const speed = lap.avgSpeedMps;
  if (speed !== null && speed > 0) {
    return 1000 / speed;
  }
  return null;
}

export function findWorkoutStartMs(rawRecords: unknown[]): number | null {
  for (const entry of rawRecords) {
    if (!entry || typeof entry !== "object") continue;
    const ts = toTimestampMs((entry as RawFitRecordLike).timestamp);
    if (ts !== null) return ts;
  }
  return null;
}
