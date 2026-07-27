// The ONE place that knows the comparison window (design doc п.9 "ЦИКЛЫ").
//
// Today: if the student has a future target start in trainingpeaks_race_events,
// this is the pre-race regime; otherwise it is the sliding-8-weeks regime. The
// measured reality is that only ~5 of 18 students had a future start, so the
// sliding window is the MAIN path, not a fallback.
//
// HOOK: real training cycles land later. When they do, ONLY this function
// changes — the matcher asks it for {from, to, label} and knows nothing else
// about cycles. The from-boundary is where the real cycle start will plug in;
// for now both regimes look back a fixed 8 weeks from the workout.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse 'YYYY-MM-DD' as a UTC calendar day. Throws on malformed input so a bad
 *  date surfaces loudly rather than silently skewing a window. */
export function parseDay(dateStr: string): number {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid comparison date: ${dateStr}`);
  return ms;
}

export function addDays(dateStr: string, days: number): string {
  return new Date(parseDay(dateStr) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (b - a). Negative if b precedes a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b) - parseDay(a)) / DAY_MS);
}

export const SLIDING_WINDOW_DAYS = 56; // 8 weeks — the "свежее" lookback
export const OLD_MODE_MIN_AGE_DAYS = 42; // ">6 недель назад" — the "давнее" boundary
// Old-mode ("прогресс vs месяц-плюс назад") speaks ONLY when recent comparable data is too thin to
// judge. With ≥ this many recent comparable runs there IS a fresh norm, and "faster than a month ago"
// is misleading when the recent trend is flat or down (Anton: recent ~362 vs today 369 = slower, yet
// old 383→369 read as +14 progress). Recent is the truth; old just fills the gap for a new/returning
// student. Matches the MAD-points floor: below 3 points a norm has no measurable spread anyway.
export const MIN_RECENT_FOR_STABLE_NORM = 3;

export type ComparisonWindow = {
  from: string; // inclusive 'YYYY-MM-DD'
  to: string; // exclusive upper bound = the workout's own date
  label: "pre_race" | "sliding_8w";
};

/**
 * The recent-comparable window for a workout. `futureRaceDates` are this
 * student's race event dates; any strictly after the workout marks the pre-race
 * regime (label only, for now). Pure and deterministic.
 */
export function resolveComparisonWindow(input: {
  workoutDate: string;
  futureRaceDates: string[];
}): ComparisonWindow {
  const hasFutureRace = input.futureRaceDates.some((d) => daysBetween(input.workoutDate, d) > 0);
  return {
    from: addDays(input.workoutDate, -SLIDING_WINDOW_DAYS),
    to: input.workoutDate,
    label: hasFutureRace ? "pre_race" : "sliding_8w",
  };
}
