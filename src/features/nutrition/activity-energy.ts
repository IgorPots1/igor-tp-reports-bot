// Task: per-activity energy cost (kcal/kg/h) for non-run activities, whose cost
// differs from the run-intensity defaults. Coach-approved values; checked BEFORE
// the run/day-type coefficient. Energy is always computed from BODYWEIGHT
// (duration × weight × coef) — TrainingPeaks does not provide a measured calorie
// figure in our cache (only TSS), so there is no HR-based cross-check.
//
// Shared by the review path (methodology.ts) and the plan path
// (weekly-plan-formulas.ts) so the two never drift.
const NUTRITION_ACTIVITY_COEF_BY_TITLE: Array<{ key: string; pattern: RegExp; perKgPerHour: number }> = [
  { key: "walk", pattern: /\b(?:walk|walking)\b|ходьб|прогулк|пешех/iu, perKgPerHour: 3.5 },
  { key: "hike", pattern: /\b(?:hike|hiking|trek|trekking)\b|поход|хайк|треккинг/iu, perKgPerHour: 6 },
  { key: "padel", pattern: /\bpadel\b|падел/iu, perKgPerHour: 7 },
  { key: "tennis", pattern: /\btennis\b|теннис/iu, perKgPerHour: 7 },
  { key: "swim", pattern: /\b(?:swim|swimming)\b|плаван|плыв/iu, perKgPerHour: 7 },
  // Mostly easy/recreational cycling for these athletes → moderate coefficient.
  { key: "bike", pattern: /\b(?:bike|cycling|mtb)\b|вело|велосипед/iu, perKgPerHour: 5 },
  // Strength duration varies widely (20–50 min) and we don't read intensity yet —
  // keep it conservative (better to under- than over-credit) until HR is wired in.
  { key: "strength", pattern: /\b(?:strength|gym)\b|силов|тренажёрн|тренажерн/iu, perKgPerHour: 5 },
];

/** Title-based expenditure coefficient (kcal/kg/h), or null when no activity matches. */
export function resolveNutritionActivityCoefByTitle(title: string | null | undefined): number | null {
  if (!title) {
    return null;
  }
  for (const activity of NUTRITION_ACTIVITY_COEF_BY_TITLE) {
    if (activity.pattern.test(title)) {
      return activity.perKgPerHour;
    }
  }
  return null;
}

// Task 10d (Bug б): a day can hold MORE than one session (e.g. an easy run plus a
// strength workout). The day TYPE is decided elsewhere (primary session only), but
// EXPENDITURE must count every session — otherwise a run+strength day is
// under-credited and maintenance/EA come out too low. Each session is estimated by
// its OWN method/intensity (do NOT add durations under one coefficient — that would
// put a run's coef on the strength minutes or vice versa), then summed. Single
// source of truth so the review path and the plan path never drift (урок #3).
export function sumDaySessionsExpenditureKcal<S>(
  sessions: readonly S[],
  estimateOne: (session: S) => number | null
): number {
  let total = 0;
  for (const session of sessions) {
    const kcal = estimateOne(session);
    if (typeof kcal === "number" && Number.isFinite(kcal) && kcal > 0) {
      total += kcal;
    }
  }
  return Math.round(total);
}
