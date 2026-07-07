// Task 7: detect repeating nutrition patterns across weeks so the coach can
// approve them into student memory (draft->approve). Pure functions over stored
// daily_analysis — no DB, no model. Conservative: only a curated set of
// athlete-meaningful findings becomes a candidate, and only when it repeats.

export type NutritionWeekDaily = {
  /** ISO week-from of the week these days belong to. */
  weekFrom: string;
  days: Array<Record<string, unknown>>;
};

export type NutritionPatternCandidate = {
  /** Stable finding code the pattern is derived from. */
  code: string;
  /** Short athlete-meaningful pattern text (coach-facing proposal + memory). */
  text: string;
  /** Earliest week_from where the finding was observed (for "третью неделю"). */
  since_week: string;
  /** How many distinct weeks (incl. current) show the finding. */
  weeks_observed: number;
};

// Curated finding -> short RU pattern text. Only nutrition-behaviour patterns
// worth surfacing to the athlete; safety/data-quality findings are excluded.
const NUTRITION_PATTERN_TEXT: Record<string, string> = {
  low_carbs_for_load_type: "углеводы в нагрузочные (беговые) дни ниже ориентира",
  low_carbs_before_long_run: "мало углеводов накануне длительной",
  high_fat_may_displace_carbs_on_load_day: "жиры вытесняют углеводы в нагрузочные дни",
  below_load_energy_floor: "энергии мало под нагрузку",
  protein_low: "белок ниже ориентира",
};

// Reverse of NUTRITION_PATTERN_TEXT, built once. Approved pattern texts are the
// curated strings verbatim (Task 7 always wrote them via NUTRITION_PATTERN_TEXT),
// so an exact case-insensitive match reliably recovers the finding code — unless
// the curated text for that code changed since the pattern was approved (see
// resolveNutritionPatternCodeByText's null case).
const NUTRITION_PATTERN_TEXT_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(NUTRITION_PATTERN_TEXT).map(([code, text]) => [text.toLowerCase(), code])
);

/**
 * Resolve the curated finding code an approved pattern's stored text came from.
 * Returns null when the text doesn't match any CURRENT curated string (e.g. the
 * wording for that code was edited after this pattern was approved) — callers
 * must treat null as "can't judge freshness, leave the pattern alone".
 */
export function resolveNutritionPatternCodeByText(text: string): string | null {
  return NUTRITION_PATTERN_TEXT_TO_CODE[text.trim().toLowerCase()] ?? null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function dayFindings(day: Record<string, unknown>): string[] {
  const canonical = asObject(day.canonicalDailyAnalysis ?? day.canonical_daily_analysis);
  const raw = Array.isArray(day.findings)
    ? day.findings
    : Array.isArray(canonical.findings)
      ? canonical.findings
      : [];
  return raw.filter((item): item is string => typeof item === "string");
}

/** Distinct curated finding codes present in a week. */
function weekFindingCodes(days: Array<Record<string, unknown>>): Set<string> {
  const codes = new Set<string>();
  for (const day of days) {
    for (const finding of dayFindings(day)) {
      if (NUTRITION_PATTERN_TEXT[finding]) {
        codes.add(finding);
      }
    }
  }
  return codes;
}

/**
 * Candidates = curated findings that appear in the current week AND in at least
 * one prior week (>= 2 weeks total), excluding ones already approved. Sorted by
 * how many weeks they span (most persistent first).
 */
export function detectNutritionRepeatingPatterns(input: {
  current: NutritionWeekDaily;
  prior: NutritionWeekDaily[];
  alreadyApprovedTexts?: string[];
}): NutritionPatternCandidate[] {
  const currentCodes = weekFindingCodes(input.current.days);
  if (currentCodes.size === 0) {
    return [];
  }
  const approved = new Set((input.alreadyApprovedTexts ?? []).map((text) => text.toLowerCase()));
  // weekFrom (incl current) where each code appears.
  const weeksByCode = new Map<string, string[]>();
  const allWeeks = [input.current, ...input.prior];
  for (const week of allWeeks) {
    for (const code of weekFindingCodes(week.days)) {
      const list = weeksByCode.get(code) ?? [];
      list.push(week.weekFrom);
      weeksByCode.set(code, list);
    }
  }

  const candidates: NutritionPatternCandidate[] = [];
  for (const code of currentCodes) {
    const weeks = weeksByCode.get(code) ?? [];
    if (weeks.length < 2) {
      continue; // not repeating yet
    }
    const text = NUTRITION_PATTERN_TEXT[code]!;
    if (approved.has(text.toLowerCase())) {
      continue; // already in memory
    }
    const sinceWeek = [...weeks].sort()[0]!;
    candidates.push({ code, text, since_week: sinceWeek, weeks_observed: weeks.length });
  }
  return candidates.sort((a, b) => b.weeks_observed - a.weeks_observed);
}

export type NutritionApprovedPatternStaleness = {
  /** true = suggest removal (not confirmed in either judgeable week). false =
   * still confirmed. null = can't judge (see reason). */
  stale: boolean | null;
  reason: "confirmed_recent" | "not_confirmed_recent" | "unmatched_text" | "insufficient_data";
};

/**
 * Layer 3: judge whether an approved pattern is still supported by recent data.
 * "Recent" = the student's most recent analyses whose week is AFTER the
 * pattern's since_week (so weeks that predate the pattern's own observation
 * baseline never count against it). Needs >=2 such weeks to judge at all — the
 * coach decides for a freshly-approved pattern, code never guesses on thin data.
 * NEVER auto-removes — this only classifies for the UI to show a suggestion.
 */
export function judgeNutritionApprovedPatternStaleness(input: {
  patternText: string;
  sinceWeek: string | null;
  /** Student's recent analyses, most-recent-first (as returned by
   * listRecentNutritionWeeklyAnalysesForStudent). */
  recentWeeks: NutritionWeekDaily[];
}): NutritionApprovedPatternStaleness {
  const code = resolveNutritionPatternCodeByText(input.patternText);
  if (!code) {
    return { stale: null, reason: "unmatched_text" };
  }
  const judgeableWeeks = input.sinceWeek
    ? input.recentWeeks.filter((week) => week.weekFrom > input.sinceWeek!)
    : input.recentWeeks;
  if (judgeableWeeks.length < 2) {
    return { stale: null, reason: "insufficient_data" };
  }
  const lastTwo = judgeableWeeks.slice(0, 2);
  const confirmedRecently = lastTwo.some((week) => weekFindingCodes(week.days).has(code));
  return confirmedRecently ? { stale: false, reason: "confirmed_recent" } : { stale: true, reason: "not_confirmed_recent" };
}

function loadDayCarbs(days: Array<Record<string, unknown>>): number | null {
  const values: number[] = [];
  for (const day of days) {
    const canonical = asObject(day.canonicalDailyAnalysis ?? day.canonical_daily_analysis);
    const type = String(day.training_type ?? canonical.trainingType ?? day.trainingType ?? "");
    const flags = asObject(day.flags ?? canonical.flags);
    const isLoad =
      /intervals|tempo|long_run|long_endurance|race/.test(type) ||
      flags.hard === true ||
      flags.longRun === true;
    if (!isLoad) {
      continue;
    }
    const actual = asObject(day.actual ?? canonical.actual);
    const carbs =
      typeof actual.carbsG === "number" ? actual.carbsG : typeof day.carbsActual === "number" ? (day.carbsActual as number) : null;
    if (typeof carbs === "number" && Number.isFinite(carbs)) {
      values.push(carbs);
    }
  }
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length / 10) * 10;
}

/**
 * One compact numeric trend string for memory key_trends: average carbs on load
 * days across the recent weeks, oldest -> newest. Rounded to 10 (Task 4 rule).
 * Returns null when there is nothing meaningful to show.
 */
export function buildNutritionLoadCarbsTrend(input: {
  current: NutritionWeekDaily;
  prior: NutritionWeekDaily[];
}): string | null {
  const weeks = [...input.prior].reverse().concat(input.current); // oldest -> newest
  const points = weeks
    .map((week) => loadDayCarbs(week.days))
    .filter((value): value is number => value != null);
  if (points.length < 2) {
    return null;
  }
  return `углеводы в нагрузочные дни: ~${points.join("/")} г за ${points.length} нед`;
}
