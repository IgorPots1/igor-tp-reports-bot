// Phase F — pull races that the record reconstruction filtered out, by taking the
// finish time straight from the workout SUMMARY (completed time/distance) instead of a
// lap best-split. A race_events row is "fillable" when the student has a completed run
// on the event date whose summary distance buckets to a standard record distance.
//
// Pure logic, no I/O — shared by the analysis script and the admin mass-entry pre-fill.

import type { RecordDistanceKey } from "./records";

/** Minimal shape of a completed running workout needed to fill a race. */
export type RaceFillWorkout = {
  studentId: string;
  workoutDate: string; // YYYY-MM-DD
  distanceKm: number | null;
  durationSeconds: number | null;
  isCompleted: boolean;
  isRunning: boolean;
};

/** Minimal shape of a race_events row. */
export type RaceFillEvent = {
  studentId: string;
  eventDate: string; // YYYY-MM-DD
  title: string | null;
};

export type RaceFillCandidate = {
  studentId: string;
  date: string;
  distanceKey: RecordDistanceKey;
  timeSeconds: number;
  raceName: string;
};

export type RaceFillReason =
  | "fillable"
  | "future"
  | "no_workout"
  | "no_time"
  | "nonstandard_distance";

export type RaceFillOutcome = { reason: RaceFillReason; candidate: RaceFillCandidate | null };

// Acceptance bands per standard distance. A race measured by GPS usually runs slightly
// long, so bands lean high. They are disjoint — a summary distance falls in at most one.
const RACE_DISTANCE_BANDS: Array<{ key: RecordDistanceKey; minKm: number; maxKm: number }> = [
  { key: "5k", minKm: 4.7, maxKm: 5.6 },
  { key: "10k", minKm: 9.4, maxKm: 10.9 },
  { key: "21k", minKm: 20.0, maxKm: 22.3 },
  { key: "42k", minKm: 40.0, maxKm: 44.2 },
];

/** Nearest standard record distance for a summary distance, or null if nonstandard. */
export function bucketRaceDistanceKey(distanceKm: number | null): RecordDistanceKey | null {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  for (const b of RACE_DISTANCE_BANDS) {
    if (distanceKm >= b.minKm && distanceKm <= b.maxKm) return b.key;
  }
  return null;
}

/**
 * Classify one race_events row against the same student's completed running workouts.
 * `dayWorkouts` are the completed running workouts on the event's date for that student
 * (usually 0 or 1). Returns the fill candidate when recoverable, else the reason it is not.
 */
export function classifyRaceEventFill(
  event: RaceFillEvent,
  dayWorkouts: RaceFillWorkout[],
  todayIso: string
): RaceFillOutcome {
  if (event.eventDate > todayIso) {
    return { reason: "future", candidate: null };
  }
  const runs = dayWorkouts.filter((w) => w.isCompleted && w.isRunning && w.durationSeconds && w.durationSeconds > 0);
  if (runs.length === 0) {
    return { reason: "no_workout", candidate: null };
  }
  // Prefer the longest completed run that day (the race is typically the day's main effort).
  const best = runs.slice().sort((a, b) => (b.distanceKm ?? 0) - (a.distanceKm ?? 0))[0];
  const distanceKey = bucketRaceDistanceKey(best.distanceKm);
  if (!distanceKey) {
    return { reason: "nonstandard_distance", candidate: null };
  }
  if (!best.durationSeconds || best.durationSeconds <= 0) {
    return { reason: "no_time", candidate: null };
  }
  return {
    reason: "fillable",
    candidate: {
      studentId: event.studentId,
      date: event.eventDate,
      distanceKey,
      timeSeconds: Math.round(best.durationSeconds),
      raceName: (event.title ?? "").trim() || "Гонка",
    },
  };
}
