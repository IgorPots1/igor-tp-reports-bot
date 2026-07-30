// Normalizes fit-file-parser@3 output (ParsedRecord[]/ParsedLap[]) into the
// shapes the ingest pipeline works with. Field names are taken from the
// package's own dist/fit_types.d.ts (ParsedRecord/ParsedLap) and cross-checked
// against tools/trainingpeaks-export/scripts/local/hr-drift-elevation-audit.ts
// and tp-race-prediction-probe.ts, which already read a subset of these same
// fields from real FIT files.
//
// FIT "unset" markers (uint8/16/32 max, scaled) are rejected per field — see
// fit-sentinel.ts. Without this a lap's total_timer_time = 4294967.295 s or
// total_distance = 42949672.95 m survives and poisons every aggregate.

import {
  rejectFitSentinel,
  U8_INVALID,
  U16_INVALID,
  U16_SPEED_MPS,
  U32_DIST_M,
  U32_INVALID,
  U32_SPEED_MPS,
  U32_TIME_S,
} from "./fit-sentinel.ts";

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
    heartRate: rejectFitSentinel(toPositiveFiniteNumber(record.heart_rate), U8_INVALID),
    cadenceRpm: rejectFitSentinel(toPositiveFiniteNumber(record.cadence), U8_INVALID),
    speedMps:
      rejectFitSentinel(toPositiveFiniteNumber(record.enhanced_speed), U32_INVALID, U32_SPEED_MPS) ??
      rejectFitSentinel(toPositiveFiniteNumber(record.speed), U16_INVALID, U16_SPEED_MPS),
    distanceM: rejectFitSentinel(toFiniteNumber(record.distance), U32_INVALID, U32_DIST_M),
    altitudeM:
      rejectFitSentinel(toFiniteNumber(record.enhanced_altitude), U32_INVALID) ??
      rejectFitSentinel(toFiniteNumber(record.altitude), U16_INVALID),
    power: rejectFitSentinel(toPositiveFiniteNumber(record.power), U16_INVALID),
  }));
}

// Extra record fields for the GPS track (Phase 4). Kept separate from
// RawFitRecordLike so the HR/pace normalization path stays byte-for-byte unchanged.
type RawFitRecordWithPos = { timestamp?: unknown; position_lat?: unknown; position_long?: unknown };

/**
 * Phase 4 — extract the GPS route as ordered [lat, lng] points from FIT records.
 * fit-file-parser converts position_lat/position_long to degrees. Records are
 * time-sorted so the sequence is in route order. Returns [] when the workout has no
 * GPS (treadmill/indoor). Coordinate sanity (range, 0/0, semicircle) is enforced
 * downstream by simplifyTrack — here we only collect finite pairs.
 */
export function extractTrackPoints(rawRecords: unknown[]): Array<[number, number]> {
  const withTimestamp = rawRecords
    .filter((entry): entry is RawFitRecordWithPos => Boolean(entry) && typeof entry === "object")
    .map((record) => ({ record, tsMs: toTimestampMs(record.timestamp) }))
    .filter((entry): entry is { record: RawFitRecordWithPos; tsMs: number } => entry.tsMs !== null)
    .sort((a, b) => a.tsMs - b.tsMs);
  const out: Array<[number, number]> = [];
  for (const { record } of withTimestamp) {
    const lat = toFiniteNumber(record.position_lat);
    const lng = toFiniteNumber(record.position_long);
    if (lat !== null && lng !== null) {
      out.push([lat, lng]);
    }
  }
  return out;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres between two [lat, lng] points. */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type TrackPrivacyCropResult = {
  points: Array<[number, number]>;
  droppedStart: number;
  droppedEnd: number;
  /** Distance from the real start/finish to the first/last KEPT point (≈ radius when trimmed). */
  startMovedM: number;
  endMovedM: number;
};

/**
 * Privacy crop for a GPS track. Trims the contiguous run of points within `radiusM` of the
 * FIRST point (start) and, separately, of the LAST point (finish), so a stored/rendered route
 * never exposes home. Only the two ENDS are trimmed (contiguous from each end), so a loop that
 * passes near the start mid-route is NOT chopped in the middle. If the whole track is within the
 * radius (a short loop around home) nothing is safe to keep and an empty track is returned — the
 * caller then stores no route. Empty input or a non-positive radius returns the input unchanged.
 */
export function cropTrackForPrivacy(
  points: Array<[number, number]>,
  radiusM: number
): TrackPrivacyCropResult {
  if (!Array.isArray(points) || points.length === 0 || !(radiusM > 0)) {
    return { points, droppedStart: 0, droppedEnd: 0, startMovedM: 0, endMovedM: 0 };
  }
  const start = points[0]!;
  const end = points[points.length - 1]!;
  let i = 0;
  while (i < points.length && haversineMeters(points[i]!, start) < radiusM) i += 1;
  let j = points.length - 1;
  while (j >= i && haversineMeters(points[j]!, end) < radiusM) j -= 1;
  if (i > j) {
    // Entire track sits within the privacy radius → keep nothing (no home-revealing route).
    return { points: [], droppedStart: points.length, droppedEnd: 0, startMovedM: 0, endMovedM: 0 };
  }
  const cropped = points.slice(i, j + 1);
  return {
    points: cropped,
    droppedStart: i,
    droppedEnd: points.length - 1 - j,
    startMovedM: haversineMeters(start, cropped[0]!),
    endMovedM: haversineMeters(end, cropped[cropped.length - 1]!),
  };
}

const SPIKE_STEP_M = 1000; // an isolated jump > 1km between neighbours is a GPS glitch, not a stride
const TORN_GAP_M = 2000; // after cropping, a > 2km gap between adjacent points = a torn route

/** Reject coords that are out of range or the (0,0) "null island" garbage a dead GPS emits. */
function isValidLatLng(point: [number, number]): boolean {
  const [lat, lng] = point;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < 0.02 && Math.abs(lng) < 0.02) return false; // (0,0) ± noise → dead fix
  return true;
}

/**
 * Despike a raw GPS track BEFORE privacy-cropping. Drops null-island/out-of-range coords and
 * isolated teleports (a point far from the last kept point whose successor returns near it —
 * a one-sample glitch). A SUSTAINED relocation (several points far away) is kept — that is a
 * real gap, not a spike, and is handled downstream by the torn-route check. Leading/trailing
 * spikes are removed by seeding on the first agreeing pair and dropping a final lone jump.
 * These stray points were why start/finish distances read as tens of km.
 */
export function sanitizeTrackPoints(points: Array<[number, number]>): Array<[number, number]> {
  const valid = points.filter(isValidLatLng);
  const n = valid.length;
  if (n <= 2) return valid;
  // Seed on the first point that agrees with its successor (skips a leading spike).
  let seed = 0;
  while (seed + 1 < n && haversineMeters(valid[seed]!, valid[seed + 1]!) > SPIKE_STEP_M) seed += 1;
  if (seed + 1 >= n) return valid; // no agreeing pair anywhere → cannot despike, leave as-is
  const out: Array<[number, number]> = [valid[seed]!];
  for (let i = seed + 1; i < n; i += 1) {
    const cur = valid[i]!;
    const last = out[out.length - 1]!;
    if (haversineMeters(last, cur) <= SPIKE_STEP_M) {
      out.push(cur);
      continue;
    }
    const next = i + 1 < n ? valid[i + 1]! : null;
    if (next === null) continue; // trailing lone jump, nothing to confirm it → drop
    if (haversineMeters(last, next) <= SPIKE_STEP_M) continue; // isolated spike (successor returns)
    out.push(cur); // sustained relocation → keep (torn-route check decides whether to store)
  }
  // Drop a disconnected SHORT leading/trailing cluster (a stray GPS-lock burst tens of km from
  // the run body that agrees with itself, so the despike loop kept it): split at gaps
  // > SPIKE_STEP_M and drop end segments shorter than the body. This makes the first/last kept
  // point the REAL start/finish, so the crop's start/finish distance reads ~radius, not tens of
  // km. A torn track (two substantial halves) is left intact for isTrackTorn to reject.
  if (out.length >= 3) {
    const segments: Array<Array<[number, number]>> = [];
    let seg: Array<[number, number]> = [out[0]!];
    for (let i = 1; i < out.length; i += 1) {
      if (haversineMeters(out[i - 1]!, out[i]!) > SPIKE_STEP_M) {
        segments.push(seg);
        seg = [];
      }
      seg.push(out[i]!);
    }
    segments.push(seg);
    if (segments.length > 1) {
      const minKeep = Math.max(10, Math.floor(out.length * 0.05));
      while (segments.length > 1 && segments[0]!.length < minKeep) segments.shift();
      while (segments.length > 1 && segments[segments.length - 1]!.length < minKeep) segments.pop();
      return segments.flat();
    }
  }
  return out;
}

/** Largest distance (m) between two adjacent points. A big value means the polyline would draw a
 *  straight line across a gap — a torn route. Zero for < 2 points. */
export function maxAdjacentGapMeters(points: Array<[number, number]>): number {
  let max = 0;
  for (let i = 1; i < points.length; i += 1) max = Math.max(max, haversineMeters(points[i - 1]!, points[i]!));
  return max;
}

/** True when a cropped remainder is torn (some adjacent gap exceeds TORN_GAP_M) and should not
 *  be stored — better no route than a line drawn across half the city. */
export function isTrackTorn(points: Array<[number, number]>): boolean {
  return maxAdjacentGapMeters(points) > TORN_GAP_M;
}

/** Bounding-box diagonal (m) — how far the track spreads. Small span on a kept=0 track confirms
 *  a stadium / small-loop workout (correctly cropped) rather than a defect. */
export function bboxSpanMeters(points: Array<[number, number]>): number {
  if (points.length === 0) return 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return haversineMeters([minLat, minLng], [maxLat, maxLng]);
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
        timerTimeS: rejectFitSentinel(toPositiveFiniteNumber(lap.total_timer_time), U32_INVALID, U32_TIME_S),
        elapsedTimeS: rejectFitSentinel(toPositiveFiniteNumber(lap.total_elapsed_time), U32_INVALID, U32_TIME_S),
        distanceM: rejectFitSentinel(toPositiveFiniteNumber(lap.total_distance), U32_INVALID, U32_DIST_M),
        avgSpeedMps:
          rejectFitSentinel(toPositiveFiniteNumber(lap.enhanced_avg_speed), U32_INVALID, U32_SPEED_MPS) ??
          rejectFitSentinel(toPositiveFiniteNumber(lap.avg_speed), U16_INVALID, U16_SPEED_MPS),
        maxSpeedMps:
          rejectFitSentinel(toPositiveFiniteNumber(lap.enhanced_max_speed), U32_INVALID, U32_SPEED_MPS) ??
          rejectFitSentinel(toPositiveFiniteNumber(lap.max_speed), U16_INVALID, U16_SPEED_MPS),
        avgHr: rejectFitSentinel(toPositiveFiniteNumber(lap.avg_heart_rate), U8_INVALID),
        maxHr: rejectFitSentinel(toPositiveFiniteNumber(lap.max_heart_rate), U8_INVALID),
        minHr: rejectFitSentinel(toPositiveFiniteNumber(lap.min_heart_rate), U8_INVALID),
        avgCadenceRpm: rejectFitSentinel(toPositiveFiniteNumber(lap.avg_cadence), U8_INVALID),
        maxCadenceRpm: rejectFitSentinel(toPositiveFiniteNumber(lap.max_cadence), U8_INVALID),
        avgPower: rejectFitSentinel(toPositiveFiniteNumber(lap.avg_power), U16_INVALID),
        totalAscentM: rejectFitSentinel(toFiniteNumber(lap.total_ascent), U16_INVALID),
        totalDescentM: rejectFitSentinel(toFiniteNumber(lap.total_descent), U16_INVALID),
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
