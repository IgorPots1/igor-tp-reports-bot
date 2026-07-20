// Workout-metric sanity gate (наряд fit-data-sanity, phase 2). Runs AFTER the
// FIT sentinel rejection (fit-sentinel.ts) — the sentinel fix removes "unset"
// markers; this gate rejects the GENUINE garbage that survives (device GPS
// speed spikes, GPS-lost fragments) which is physically implausible but a finite
// number the sentinel check can't catch.
//
// Filters are Igor's, validated on live data (dev-notes «0. ФИЛЬТРЫ БИТЫХ
// ДАННЫХ»). Rule everywhere: an out-of-range value → the metric goes NULL with a
// reason (never 0), and a trust flag tells consumers what to believe — same
// contract as hr_trusted.
//
// The pace gate uses the WHOLE-workout pace (a run slower than 9:30/km or faster
// than 3:00/km is not a run). It is deliberately NOT a per-lap ceiling: a single
// recovery-jog or walk-break lap legitimately runs at 9–12 min/km, and nulling
// those would corrupt real workouts. Per-lap keeps only its existing floor
// (faster-than-world-record), added in the ingest.

export const PACE_MIN_SEC_PER_KM = 180; // 3:00/km
export const PACE_MAX_SEC_PER_KM = 570; // 9:30/km
export const AEROBIC_EF_MIN = 0.008;
export const AEROBIC_EF_MAX = 0.05;
// Real work-effort peak floor 130 (below → the strap under-read), ceiling 205
// (above → a glitch). The floor was 165, which mislabelled easy/low-intensity
// intervals whose genuine peak sits at 160–162 as broken. A smarter future
// layer would compare against the athlete's OWN observed max, not an absolute.
export const MAX_REP_HR_MIN = 130;
export const MAX_REP_HR_MAX = 205;

export type WorkoutDataSanity = {
  // null = not computable (no FIT distance/time) → consumers treat as unknown, not untrusted
  paceTrusted: boolean | null;
  distanceTrusted: boolean | null;
  aerobicEfSane: boolean; // false → caller must NULL aerobic_ef
  maxHrSane: boolean; // false → caller must set hr_trusted=false
  warnings: string[];
};

export function assessWorkoutDataSanity(input: {
  overallPaceSecPerKm: number | null;
  aerobicEf: number | null;
  repPeakHrs: Array<number | null> | null;
}): WorkoutDataSanity {
  const warnings: string[] = [];

  // ── overall pace / distance ──
  let paceTrusted: boolean | null;
  let distanceTrusted: boolean | null;
  if (input.overallPaceSecPerKm === null) {
    paceTrusted = null;
    distanceTrusted = null;
  } else {
    const inRange = input.overallPaceSecPerKm >= PACE_MIN_SEC_PER_KM && input.overallPaceSecPerKm <= PACE_MAX_SEC_PER_KM;
    paceTrusted = inRange;
    distanceTrusted = inRange; // an impossible pace means the distance or time is garbage
    if (!inRange) {
      warnings.push(`implausible_pace: overall ${input.overallPaceSecPerKm.toFixed(1)} s/km outside [${PACE_MIN_SEC_PER_KM},${PACE_MAX_SEC_PER_KM}]`);
    }
  }

  // ── aerobic_ef (also insane when the distance it was built on is untrusted) ──
  let aerobicEfSane = true;
  if (input.aerobicEf !== null) {
    const efInRange = input.aerobicEf >= AEROBIC_EF_MIN && input.aerobicEf <= AEROBIC_EF_MAX;
    aerobicEfSane = efInRange && distanceTrusted !== false;
    if (!aerobicEfSane) {
      warnings.push(`implausible_ef: aerobic_ef ${input.aerobicEf} ${efInRange ? "(distance untrusted)" : `outside [${AEROBIC_EF_MIN},${AEROBIC_EF_MAX}]`}`);
    }
  }

  // ── max rep peak HR (a broken max-HR reading → don't trust HR) ──
  let maxHrSane = true;
  const peaks = (input.repPeakHrs ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (peaks.length > 0) {
    const maxHr = Math.max(...peaks);
    if (maxHr < MAX_REP_HR_MIN || maxHr > MAX_REP_HR_MAX) {
      maxHrSane = false;
      warnings.push(`implausible_max_hr: max rep peak ${maxHr} outside [${MAX_REP_HR_MIN},${MAX_REP_HR_MAX}]`);
    }
  }

  return { paceTrusted, distanceTrusted, aerobicEfSane, maxHrSane, warnings };
}
