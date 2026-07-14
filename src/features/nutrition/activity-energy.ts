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
  // Coach's call: light-tempo effort — same coefficient as "easy" (8), not the
  // unknown-type default (9) it fell back to with no keyword match at all.
  { key: "elliptical", pattern: /\belliptical\b|эллипс/iu, perKgPerHour: 8 },
  // Coach's call (2026-07-14) — unqualified "Cardio" is the same light-tempo effort
  // as elliptical (no further detail to go on).
  { key: "cardio", pattern: /\bcardio\b|кардио/iu, perKgPerHour: 8 },
  // Coach's call (2026-07-14, draft — see checkpoint): flexibility/core work, very low
  // glycogen depletion — same tier as walk, matches the cross_training_light corridor
  // these two are also classified into (isLightIntermittentCrossTrainingTitle).
  { key: "yoga", pattern: /\byoga\b|йога/iu, perKgPerHour: 3.5 },
  { key: "pilates", pattern: /\bpilates\b|пилатес/iu, perKgPerHour: 3.5 },
  // Coach's call (2026-07-14, draft — see checkpoint): intense per-minute, real
  // calorie-burning cardio — priced above bike/swim, below run intensities.
  { key: "jump-rope", pattern: /jump\s*rope|скакалк/iu, perKgPerHour: 10 },
  // Coach's call (2026-07-14, draft — see checkpoint): moderate continuous cardio.
  { key: "ice-skating", pattern: /ice\s*skating|коньк/iu, perKgPerHour: 6 },
  // Coach's call (2026-07-14, draft — see checkpoint): intermittent team sport, real
  // effort but with pauses — same tier as ice skating, below continuous endurance.
  { key: "volleyball", pattern: /volleyball|волейбол/iu, perKgPerHour: 6 },
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

// Поток D-5: minimum duration (minutes) for a non-essential activity to count as a
// real load. A trivially short activity (a 10-min open-water dip, a 15-min stroll) is
// dropped from the day's load AGGREGATE so it doesn't inflate the day type/label — it
// does NOT change the expenditure formula of full activities. Run has no entry here
// (never in the coef map → never trivial); strength is intentionally omitted so it has
// NO threshold (always counts). Coach-tunable.
const NUTRITION_ACTIVITY_MIN_SIGNIFICANT_MINUTES: Partial<Record<string, number>> = {
  walk: 20,
  hike: 20,
  padel: 20,
  tennis: 20,
  swim: 15,
  bike: 15,
};

/**
 * Is this a trivially short non-essential activity that should NOT enter the day's
 * load aggregate? Keyed on the same title patterns as the coefficient map. Returns
 * false (keep) for runs, strength, unknown activities, or unknown duration — only a
 * matched activity strictly under its threshold is dropped.
 */
export function isNutritionTrivialShortActivity(input: {
  title: string | null | undefined;
  durationMinutes: number | null | undefined;
}): boolean {
  const { title, durationMinutes } = input;
  if (!title || typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes)) {
    return false;
  }
  for (const activity of NUTRITION_ACTIVITY_COEF_BY_TITLE) {
    if (activity.pattern.test(title)) {
      const threshold = NUTRITION_ACTIVITY_MIN_SIGNIFICANT_MINUTES[activity.key];
      return typeof threshold === "number" && durationMinutes < threshold;
    }
  }
  return false;
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
