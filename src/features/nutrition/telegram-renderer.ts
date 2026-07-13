import { formatNutritionWorkoutLabelForAthlete, buildNutritionTargetWeekMainStepLine } from "@/features/nutrition/narrative-composer";
import { findForbiddenAthleteCoachTerm } from "@/features/nutrition/narrative-guardrails";
import { formatDistanceKmRu } from "@/features/nutrition/methodology";
import { getNutritionAdminLocalDate } from "@/features/nutrition/plan-week-policy";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import type {
  NutritionDayTypeTarget,
  NutritionNextWeekPlan,
  NutritionNextWeekPlanDay,
  NutritionPlanDayType,
} from "@/features/nutrition/weekly-plan-formulas";
import type { NutritionPlanTargetWeekMode } from "@/features/nutrition/plan-week-policy";

export type NutritionTelegramRenderIssue = {
  rule: string;
  message: string;
  severity: "error" | "warning";
  /**
   * Task 10d: blocking tier, orthogonal to severity.
   * - "hard": genuine athlete danger leaking into the text (clinical terms) →
   *   withhold the message. (The primary medical gate is upstream `blocked`.)
   * - "soft" (default): technical/borderline → never block; either cleaned
   *   silently or surfaced to the coach as a review note.
   */
  tier: "hard" | "soft";
};

/**
 * Athlete-safe plan sections, exposed structurally so the mini-app can render the
 * plan as cards/panels instead of one text wall. SAME text the plan already
 * produces — just split, never re-generated. Carries NO coach-only data and does
 * NOT affect `parts`/`text` (the Telegram coach copy) or plan_week matching.
 */
export type NutritionAthletePlanSections = {
  focus: string | null;
  raceDay: string | null;
  keyTraining: string | null;
  note: string | null;
};

/**
 * Athlete-safe review sections for the mini-app: the lead-in and the week summary,
 * exposed structurally so the screen can show day CARDS (with per-day prose) between
 * them instead of one prose wall. SAME text, split; the per-day blocks live in the
 * cards, not here. Does NOT affect `parts`/`text` (the Telegram coach copy).
 */
export type NutritionAthleteReviewSections = {
  intro: string | null;
  weekSummary: string | null;
};

export type NutritionTelegramRenderResult = {
  ok: boolean;
  /** Full message (both parts joined) — single-copy / backward compatible. */
  text: string | null;
  /**
   * The message split for Telegram's 4096-char cap: [past-week review, next-week
   * plan]. Copy each part as its own Telegram message. One element if it all fits.
   */
  parts: string[];
  issues: NutritionTelegramRenderIssue[];
  /**
   * Task 10d: coach-facing review notes for SOFT issues (text still ships, but the
   * coach should glance at these spots). Empty when nothing needs a look.
   */
  coachReviewNotes: string[];
  charCount: number;
  /** Athlete-safe plan sections for the mini-app card layout (see type doc). */
  planSections: NutritionAthletePlanSections;
  /** Athlete-safe review sections (lead-in + week summary) for the card layout. */
  reviewSections: NutritionAthleteReviewSections;
};

export type NutritionMessageInterpretation = {
  dayComments: string[];
  weekSummaryRu: string | null;
  focusLinesRu: string[];
  weekComparisonLineRu: string | null;
  /**
   * Block 3: optional warm opening line from the athlete's own words (effort /
   * circumstances), rendered right after the greeting. Qualitative only — any line
   * containing a digit is dropped here as a final guard.
   */
  athleteOpeningNoteRu?: string | null;
};

export type NutritionTelegramRendererInput = {
  formality: TrainingPeaksTelegramFormality;
  athleteName: string;
  planWeekMode: NutritionPlanTargetWeekMode;
  interpretation: NutritionMessageInterpretation;
  nextWeekPlan: NutritionNextWeekPlan | null;
  fallbackPlanLines: string[];
  hasTargetWeekTrainingContext: boolean;
  hasPreviousWeeksContext: boolean;
  forceDayTypePlan?: boolean;
  todayLocalDate?: string;
  miniTableMode?: "athlete_remaining_only" | "full_week";
};

function formatDateRu(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  return `${match[3]}.${match[2]}`;
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatNutritionAthleteKcal(value: number | null | undefined, options?: { mode?: "actual" | "target" }): string {
  if (value == null || !Number.isFinite(value)) {
    return "ккал н/д";
  }
  return `~${roundToNearest(value, options?.mode === "target" ? 100 : 50)} ккал`;
}

function formatNutritionAthletePlanMacro(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "н/д";
  }
  return `${Math.round(value)} г`;
}

function dayTypeEmoji(dayType: NutritionPlanDayType): string {
  switch (dayType) {
    case "rest":
      return "🟦";
    case "hard":
      return "🟧";
    case "pre_long":
      return "🟪";
    case "long_run":
    case "long_endurance":
    case "race":
      return "🟥";
    default:
      return "🟩";
  }
}

function resolveConsistentDayType(day: NutritionNextWeekPlanDay): NutritionPlanDayType {
  const declared = day.training_type;
  const label = (day.workout_title ?? day.training_label ?? "").toLocaleLowerCase("ru");
  const hasLongCue = /длительн|long\s*run|long\s*endurance|длинн|вело\s+\d+:\d{2}|лонг/.test(label);
  if (declared === "easy" || declared === "rest" || declared === "cross_training" || declared === "strength") {
    return declared;
  }
  if ((declared === "long_run" || declared === "long_endurance") && hasLongCue) {
    return declared;
  }
  if ((declared === "long_run" || declared === "long_endurance") && !hasLongCue) {
    return "easy";
  }
  if (declared === "hard" || declared === "pre_long" || declared === "race") {
    return declared;
  }
  return declared;
}

function dayTypeRu(dayType: NutritionPlanDayType): string {
  switch (dayType) {
    case "rest":
      return "День отдыха";
    case "easy":
      return "Лёгкий день";
    case "hard":
      return "Ключевая нагрузка";
    case "pre_long":
      return "День перед длительной";
    case "long_run":
    case "long_endurance":
      return "Длительная";
    case "strength":
      return "Силовая";
    case "cross_training":
      return "Кросс-тренировка";
    case "race":
      return "Соревнование";
    default:
      return "День недели";
  }
}

/**
 * Telegram-readable divider between the numbers line and the feedback of a day.
 * Spaced em-dashes survive cleanupPlainText (em → hyphen) as "- - -" — a visible
 * dashed divider that is NOT a markdown rule (3 consecutive hyphens) and NOT a
 * long dash, so it passes validateTelegramReadyNutritionMessage.
 */
export const NUTRITION_TELEGRAM_DAY_DIVIDER = "— — —";

/**
 * Break a long block into short, phone-readable chunks of up to `maxSentences`
 * sentences separated by a blank line. Splits only at sentence end followed by a
 * capital letter, so decimals ("1.5"), "г/кг" and abbreviations are not split.
 * Render-layer only: never changes wording, just inserts paragraph breaks.
 */
export function paragraphizeForTelegram(text: string | null | undefined, maxSentences = 2): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return "";
  }
  const sentences = trimmed.split(/(?<=[.!?…])\s+(?=[А-ЯЁA-Z0-9«])/u).filter((s) => s.trim());
  if (sentences.length <= maxSentences) {
    return trimmed;
  }
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += maxSentences) {
    chunks.push(sentences.slice(i, i + maxSentences).join(" ").trim());
  }
  return chunks.join("\n\n");
}

const PHANTOM_PREVIOUS_COMPARISON = /прошл[а-я]+\s+недел|по сравнению с прошл/i;

/**
 * Task 10d: when there is no saved history, the model sometimes references "прошлая
 * неделя" — a false claim. Remove only the offending sentence(s) (not the whole
 * day) and report whether anything was removed, so the coach gets a note.
 */
function stripPhantomPreviousComparison(text: string): { text: string; removed: boolean } {
  if (!PHANTOM_PREVIOUS_COMPARISON.test(text)) {
    return { text, removed: false };
  }
  let removed = false;
  const lines = text.split("\n").map((line) => {
    if (!PHANTOM_PREVIOUS_COMPARISON.test(line)) {
      return line;
    }
    const sentences = line.split(/(?<=[.!?…])\s+/);
    const kept = sentences.filter((sentence) => {
      if (PHANTOM_PREVIOUS_COMPARISON.test(sentence)) {
        removed = true;
        return false;
      }
      return true;
    });
    return kept.join(" ").replace(/ {2,}/g, " ").trim();
  });
  return { text: lines.join("\n"), removed };
}

// Raw coach-only/technical tokens that must NEVER reach the athlete text. These are
// fields the model is given in facts (pre_workout.adequacy, day_role, loadBasis,
// nutrition_status enums, …) and occasionally leaks verbatim. We cut the labelled
// "key: value" form and the bare snake_case enums — never normal prose words.
const NUTRITION_ATHLETE_TECH_JARGON_PATTERNS: RegExp[] = [
  // labelled fields: "adequacy: medium", "day_role = key", "fatFeedbackPolicy: coach_only"
  /\b(?:adequacy|day_role|dayRole|load_basis|loadBasis|carb_load_basis|fat_policy|fatFeedbackPolicy|nutrition_status|nutritionStatus|role_info|roleInfo|source_quality|hint_for_comment|formula_code|formulaCode)\s*[:=]\s*[A-Za-z_]+/gi,
  // bare leaked status/role enums (snake_case technical literals)
  /\b(?:below_energy_availability|below_energy_floor|low_for_load|low_for_strength|low_for_cross_training|low_for_cross|moderate_for_load|rest_ok|pre_long_low|long_run_low|aligned_or_ok|needs_fuel_support|key_interval|key_tempo|combined_load|long_endurance)\b/gi,
];

// Deterministic plain-language replacements — the model occasionally writes florid
// or bookish phrasings; rewrite them to Igor's simple voice. Pairs only; numbers,
// food names and normal prose are untouched. Declension/case handled per pattern.
const NUTRITION_ATHLETE_WORDING_REPLACEMENTS: Array<[RegExp, string]> = [
  // Cyrillic \w doesn't work in JS regex — use explicit [а-яё] for declensions.
  [/правильн[а-яё]*\s+инстинкт[а-яё]*/gi, "правильный подход"],
  // Only the SUBSTANTIVAL roundabout «что-то/чего-то крупяное» → «какую-нибудь крупу».
  // The «что-то/чего-то» prefix is REQUIRED (was optional): as an ADJECTIVE «крупян…»
  // modifies its own noun («крупяной основы», «крупяного гарнира», «крупяные хлопья»),
  // and dropping in the noun phrase «какую-нибудь крупу» there broke the case
  // («без крупяной основы» → «без какую-нибудь крупу основы»). No prefix → leave as written.
  [/(?:что-то|чего-то)\s+крупян[а-яё]+/gi, "какую-нибудь крупу"],
  // Absorb a trailing «порци…» so the fixed replacement «порцию побольше» does not
  // duplicate the noun («более щедрая порция каши» → «порцию побольше порция каши»).
  [/более\s+щедр[а-яё]+(?:\s+порци[а-яё]+)?/gi, "порцию побольше"],
  [/поплотнее/gi, "порцию побольше"],
  [/тарелк[а-яё]*\s+(?:должна\s+быть\s+|была\s+бы\s+)?плотн[а-яё]*/gi, "порцию побольше"],
  [/плотн[а-яё]*\s+тарелк[а-яё]*/gi, "порцию побольше"],
  // Strip only the «макро-» prefix and KEEP the «вывод…» ending, so number/case survive
  // («макро-выводы такие» → «выводы такие», not the disagreeing «вывод такие»).
  [/макро-?(вывод[а-яё]*)/gi, "$1"],
  // Тавтология «немного невысок…»: «невысоко» уже значит «чуть ниже», «немного»
  // сверху лишнее. Убираем ТОЛЬКО дублирующее «немного » перед словом; само слово
  // «невысокий/невысоко» нормальное и остаётся. «невысокого роста» не трогаем (нет
  // «немного» перед ним).
  [/немного\s+(?=невысок)/gi, ""],
  // Rephrase a leaked TECHNICAL carb-loading parenthetical into a human clause — keep
  // the MEANING (loading before a long start is real advice), drop the bracket-note.
  // Matches only parens that actually contain загрузк/carb-loading, so legitimate
  // parentheses like «(открытая вода)» in an activity name are untouched.
  [/\s*\(\s*(?:нужна\s+)?(?:углеводная\s+)?загрузк[а-яё]*\s*\)/gi, " - накануне стоит загрузиться углеводами"],
  [/\s*\(\s*carb[\s-]?loading\s*\)/gi, " - накануне стоит загрузиться углеводами"],
  // Drop the INTERNAL time-threshold justification from athlete text (90 min / 1.5h is
  // a classification cutoff, not a fact for the runner — wrong for fast HM runners).
  // Keyed on a "больше/дольше" threshold phrase, so factual timing advice ("за 2-3 часа
  // до старта", "гель за 10 минут") and real day descriptions are untouched.
  [/,?\s*(?:больше|дольше)\s*~?\s*(?:полу(?:тора|торы)\s+час[а-яё]*|\d+(?:[.,]\d+)?\s*(?:час[а-яё]*|ч|мин(?:ут[а-яё]*)?))(?:\s+на\s+ногах)?/gi, ""],
  [/,?\s*(?:полтора\s+часа|полутора\s+часов)\s+на\s+ногах/gi, ""],
  // Carb-slang anglicism «карбовый/карбовые/…» → «углеводный/углеводные/…». Both
  // roots take the SAME hard-stem adjective endings (-ый/-ая/-ое/-ые/-ых/-ым/-ому…),
  // so stripping only the «карбов» root and keeping whatever ending followed it
  // preserves case/number exactly (same trick as the «макро-вывод» pair above).
  // Requires >=1 trailing char so the bare noun genitive-plural «карбов» (see next
  // two pairs) never matches this adjective pattern.
  [/карбов([а-яё]+)/gi, "углеводн$1"],
  // Bare noun forms («карбы» — carbs, nominative/accusative plural; «карбов» —
  // genitive plural, "недостаток карбов") → the plain Russian noun.
  // JS \b relies on \w, which does NOT include Cyrillic letters — using \b here
  // would silently fail to match at a Cyrillic-word boundary. Lookaround against
  // [а-яё] instead (same fix class as the rest of this file's comment above).
  [/(?<![а-яё])карбы(?![а-яё])/gi, "углеводы"],
  [/(?<![а-яё])карбов(?![а-яё])/gi, "углеводов"],
  // Jargon construction «с жировой точки зрения» → plain «по жирам».
  [/с\s+жиров[а-яё]*\s+точки\s+зрения/gi, "по жирам"],
];

/** Rewrite florid/bookish phrasings to Igor's plain voice (see replacements above). */
export function simplifyAthleteWording(input: string): string {
  let out = input;
  for (const [re, to] of NUTRITION_ATHLETE_WORDING_REPLACEMENTS) {
    out = out.replace(re, to);
  }
  return out.replace(/ {2,}/g, " ");
}

/**
 * When the plan week has ALREADY started (review sent Mon/Tue → current week),
 * rewrite model prose «на следующей неделе» → «на этой неделе». Applied ONLY for
 * current_week; a genuinely-next week keeps «следующая». Touches «… недел…» phrases
 * only — «на следующем разборе» is untouched.
 */
export function relabelPlanWeekWordingToThisWeek(input: string): string {
  const keepCase = (sample: string, lower: string): string =>
    sample[0] === sample[0].toLocaleUpperCase("ru") ? lower[0].toLocaleUpperCase("ru") + lower.slice(1) : lower;
  return input
    .replace(/на следующей неделе/gi, (m) => keepCase(m, "на этой неделе"))
    .replace(/на следующую неделю/gi, (m) => keepCase(m, "на эту неделю"))
    .replace(/следующая неделя/gi, (m) => keepCase(m, "эта неделя"))
    .replace(/следующей недел([иеёю])/gi, (m, g1) => keepCase(m, `этой недел${g1}`));
}

/** Cut leaked coach/technical tokens from athlete-facing prose (see patterns above). */
export function stripAthleteTechJargon(input: string): string {
  let out = input;
  for (const re of NUTRITION_ATHLETE_TECH_JARGON_PATTERNS) {
    out = out.replace(re, "");
  }
  // Tidy leftovers: orphan "; ." / doubled punctuation / spaces from the removals.
  return out
    .replace(/\s*;\s*([.!?,)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;!?])/g, "$1")
    .replace(/ {2,}/g, " ");
}

// Latin glyphs that visually collide with a Cyrillic letter. The model occasionally
// emits one inside a Russian word (mixed keyboard layout / homoglyph), e.g. a Latin
// "m" in «moмент». Targets are the visual twins; the few letters with no distinct
// lowercase twin (h, t, b) reuse their UPPERCASE homoglyph (H→Н, T→Т, B→В).
const LATIN_TO_CYRILLIC_HOMOGLYPH: Record<string, string> = {
  a: "а", e: "е", o: "о", c: "с", p: "р", x: "х", y: "у", m: "м", k: "к", h: "н", t: "т", b: "в",
  A: "А", E: "Е", O: "О", C: "С", P: "Р", X: "Х", Y: "У", M: "М", K: "К", H: "Н", T: "Т", B: "В",
};

// Fix isolated Latin homoglyphs ONLY inside a token that ALSO contains Cyrillic
// (a mixed-script word is always a glitch). Pure-Latin tokens — brands, VO2, HIIT,
// km, PR — contain no Cyrillic, so they are left completely untouched. Non-homoglyph
// Latin letters (g, w, z, …) are kept as-is even inside a mixed token.
export function normalizeMixedScriptHomoglyphs(input: string): string {
  return input.replace(/[A-Za-zА-Яа-яЁё]+/gu, (token) => {
    if (!/[А-Яа-яЁё]/u.test(token) || !/[A-Za-z]/.test(token)) {
      return token; // pure-Latin (leave VO2/HIIT/km/brands) or pure-Cyrillic
    }
    return token.replace(/[A-Za-z]/g, (ch) => LATIN_TO_CYRILLIC_HOMOGLYPH[ch] ?? ch);
  });
}

export function cleanupPlainText(input: string): string {
  return simplifyAthleteWording(
    stripAthleteTechJargon(
    normalizeMixedScriptHomoglyphs(input)
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/\*\*|__/g, "")
      .replace(/^\s{0,3}#{1,6}\s*/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*-{3,}\s*$/gm, "")
      .replace(/TrainingPeaks/g, "план тренировок")
      .replace(/FatSecret/g, "дневник питания")
      // Task 10d: silently drop internal/technical term leaks (no coach note needed).
      .replace(/OpenAI/gi, "")
      .replace(/\bJSON\b/g, "")
      .replace(/\bAI\b/g, "")
      .replace(/[—–]/g, "-")
    )
  )
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Greeting without the athlete's name — clean and formality-aware (profile ты/вы,
// from the resolved communication profile). Coach decision: drop the name entirely.
export function resolveGreeting(formality: TrainingPeaksTelegramFormality): string {
  return formality === "vy" ? "Здравствуйте!" : "Привет!";
}

function formatPlanFocusSectionHeading(mode: NutritionPlanTargetWeekMode): string {
  return mode === "current_week" ? "📌 Фокус на эту неделю" : "📌 Фокус на следующую неделю";
}

function resolveDayLabel(day: NutritionNextWeekPlanDay): string {
  return formatNutritionWorkoutLabelForAthlete({
    trainingLabel: day.workout_title ?? day.training_label ?? dayTypeRu(resolveConsistentDayType(day)).toLowerCase(),
    trainingType: resolveConsistentDayType(day),
  });
}

function buildPlanByDayTypes(nextWeekPlan: NutritionNextWeekPlan | null, fallbackPlanLines: string[]): string[] {
  if (!nextWeekPlan) {
    return fallbackPlanLines.length > 0 ? fallbackPlanLines : ["План на неделю не сформирован."];
  }
  const targets = nextWeekPlan.day_type_targets;
  const hasStrengthDay = nextWeekPlan.days.some((day) => day.training_type === "strength");
  const hasCrossTrainingDay = nextWeekPlan.days.some((day) => day.training_type === "cross_training");
  const ordered: Array<{ key: NutritionPlanDayType; target: typeof targets.rest }> = [
    { key: "rest", target: targets.rest },
    { key: "easy", target: targets.easy },
    { key: "hard", target: targets.hard },
    { key: "pre_long", target: targets.pre_long },
    { key: "long_run", target: targets.long_run },
    ...(hasStrengthDay ? [{ key: "strength" as const, target: targets.strength ?? null }] : []),
    ...(hasCrossTrainingDay ? [{ key: "cross_training" as const, target: targets.cross_training ?? null }] : []),
  ];
  return ordered
    .map(({ key, target }) => {
      if (!target) {
        return null;
      }
      return `${dayTypeEmoji(key)} ${dayTypeRu(key)} - ${formatNutritionAthleteKcal(target.target_kcal, { mode: "target" })} · ${formatNutritionAthletePlanMacro(target.protein_g)} Б · ${formatNutritionAthletePlanMacro(target.fat_g)} Ж · ${formatNutritionAthletePlanMacro(target.carbs_g)} У`;
    })
    .filter((line): line is string => Boolean(line));
}

export function resolveMiniTableDays(input: {
  nextWeekPlan: NutritionNextWeekPlan;
  planWeekMode: NutritionPlanTargetWeekMode;
  todayLocalDate?: string;
  mode?: "athlete_remaining_only" | "full_week";
}): NutritionNextWeekPlanDay[] {
  // The Mon→next-Mon week (8, incl. the bridge Monday) plus any tail RECOVERY day
  // appended past the window (a Monday-on-bridge race → recovery Tuesday). The
  // recovery tail must show even though it sits outside the 8-day window
  // (see weekly-plan-formulas). A Sunday race's recovery Monday is the bridge day
  // itself, lifted in place — not a tail.
  const weekDays = input.nextWeekPlan.days.slice(0, 8);
  const tailRecoveryDays = input.nextWeekPlan.days.slice(8).filter((day) => day.flags?.recovery);
  const all = [...weekDays, ...tailRecoveryDays];
  const mode = input.mode ?? "athlete_remaining_only";
  if (mode === "full_week" || input.planWeekMode !== "current_week") {
    return all;
  }
  const today = input.todayLocalDate ?? getNutritionAdminLocalDate();
  const remaining = all.filter((day) => day.date >= today);
  return remaining.length > 0 ? remaining : all;
}

function buildDisplayTargetFromTypeTarget(target: NutritionDayTypeTarget): {
  kcal_min: number;
  kcal_max: number;
  carbs_g_min: number;
  carbs_g_max: number;
  protein_g: number;
  fat_g: number;
} {
  return {
    kcal_min: roundToNearest(target.target_kcal - 50, 50),
    kcal_max: roundToNearest(target.target_kcal + 50, 50),
    carbs_g_min: roundToNearest(target.carbs_g - 20, 10),
    carbs_g_max: roundToNearest(target.carbs_g + 20, 10),
    protein_g: target.protein_g,
    fat_g: target.fat_g,
  };
}

function resolveTypeTargetFromPlan(
  plan: NutritionNextWeekPlan,
  dayType: NutritionPlanDayType
): NutritionDayTypeTarget | null {
  switch (dayType) {
    case "rest":
      return plan.day_type_targets.rest;
    case "easy":
      return plan.day_type_targets.easy;
    case "hard":
      return plan.day_type_targets.hard;
    case "pre_long":
      return plan.day_type_targets.pre_long;
    case "long_run":
      return plan.day_type_targets.long_run;
    case "long_endurance":
      return plan.day_type_targets.long_endurance ?? plan.day_type_targets.long_run;
    case "strength":
      return plan.day_type_targets.strength;
    case "cross_training":
      return plan.day_type_targets.cross_training ?? null;
    case "race":
      return plan.day_type_targets.long_run ?? plan.day_type_targets.hard;
    default:
      return null;
  }
}

function resolveMiniTableRowTargets(
  day: NutritionNextWeekPlanDay,
  dayType: NutritionPlanDayType,
  plan: NutritionNextWeekPlan
): {
  kcalMin: number | null;
  kcalMax: number | null;
  carbsMin: number | null;
  carbsMax: number | null;
  proteinG: number | null;
  fatG: number | null;
} {
  if (dayType !== day.training_type) {
    const typeTarget = resolveTypeTargetFromPlan(plan, dayType);
    if (typeTarget) {
      const display = buildDisplayTargetFromTypeTarget(typeTarget);
      return {
        kcalMin: display.kcal_min,
        kcalMax: display.kcal_max,
        carbsMin: display.carbs_g_min,
        carbsMax: display.carbs_g_max,
        proteinG: display.protein_g,
        fatG: display.fat_g,
      };
    }
  }
  return {
    kcalMin: day.display_target?.kcal_min ?? null,
    kcalMax: day.display_target?.kcal_max ?? null,
    carbsMin: day.display_target?.carbs_g_min ?? null,
    carbsMax: day.display_target?.carbs_g_max ?? null,
    proteinG: day.protein_g ?? null,
    fatG: day.fat_g ?? null,
  };
}

function buildMiniTable(input: {
  nextWeekPlan: NutritionNextWeekPlan;
  planWeekMode: NutritionPlanTargetWeekMode;
  todayLocalDate?: string;
  mode?: "athlete_remaining_only" | "full_week";
}): string[] {
  const days = resolveMiniTableDays(input);
  return days.map((day) => {
    const dayType = resolveConsistentDayType(day);
    const label = resolveDayLabel({ ...day, training_type: dayType });
    const targets = resolveMiniTableRowTargets(day, dayType, input.nextWeekPlan);
    const kcal =
      targets.kcalMin != null && targets.kcalMax != null
        ? `~${Math.round(targets.kcalMin)}-${Math.round(targets.kcalMax)} ккал`
        : day.target_kcal != null
          ? formatNutritionAthleteKcal(day.target_kcal, { mode: "target" })
          : "ккал н/д";
    const carbs =
      targets.carbsMin != null && targets.carbsMax != null
        ? `${Math.round(targets.carbsMin)}-${Math.round(targets.carbsMax)}У`
        : day.carbs_g != null
          ? `${Math.round(day.carbs_g)}У`
          : "У н/д";
    const protein = targets.proteinG != null ? `${Math.round(targets.proteinG)}Б` : "Б н/д";
    const fat = targets.fatG != null ? `${Math.round(targets.fatG)}Ж` : "Ж н/д";
    return `${dayTypeEmoji(dayType)} ${day.weekday_ru} (${formatDateRu(day.date)}) · ${label} · ${kcal} · ${protein} · ${fat} · ${carbs}`;
  });
}

function hasKeyTraining(nextWeekPlan: NutritionNextWeekPlan | null): boolean {
  return Boolean(nextWeekPlan?.days.some((day) => day.training_type === "hard" || day.training_type === "long_run" || day.training_type === "race"));
}

function getLongRunTargetKcalText(nextWeekPlan: NutritionNextWeekPlan | null): string | null {
  const targetKcal =
    nextWeekPlan?.day_type_targets.long_run?.target_kcal ??
    nextWeekPlan?.days.find((day) => day.training_type === "long_run")?.target_kcal ??
    null;
  return targetKcal != null ? formatNutritionAthleteKcal(targetKcal, { mode: "target" }) : null;
}

function buildPreTrainingBlock(nextWeekPlan: NutritionNextWeekPlan | null): string[] {
  if (!hasKeyTraining(nextWeekPlan)) {
    return [];
  }
  return [
    "🍽 Перед ключевыми тренировками",
    "",
    "Если тренировка утром: углеводный ужин накануне и лёгкий перекус за 30-60 минут.",
    "Если тренировка днём или вечером: нормальный приём пищи за 2-3 часа, при необходимости лёгкий перекус за 30-60 минут.",
    "После тренировки: углеводы + белок в течение часа.",
  ];
}

/**
 * Наряд 3 Шаг 2: a deterministic race-day block (gel / loading-or-not / morning
 * vs night timing / recovery). Computed from race_protocol so the athlete always
 * sees the right facts even if the model prose varies. No г/кг here — loading is
 * delivered as a gentle step, the gram targets stay an internal coach orientation.
 */
function buildRaceDayBlock(nextWeekPlan: NutritionNextWeekPlan | null): string[] {
  const raceDays = (nextWeekPlan?.days ?? []).filter((day) => day.flags?.race && day.race_protocol);
  if (raceDays.length === 0) {
    return [];
  }
  const lines: string[] = ["🏁 День старта"];
  for (const day of raceDays) {
    const p = day.race_protocol!;
    const name = day.workout_title?.trim() || "Старт";
    const dist = typeof p.distance_km === "number" ? `, ${formatDistanceKmRu(p.distance_km)}` : "";
    lines.push("", `${formatDateRu(day.date)} — ${name}${dist}.`);
    if (p.loading) {
      lines.push(
        `Дистанция длинная (дольше ~90 минут): за ${p.loading.days} дня до старта плавно подними углеводы (шагами от обычного, без рывка) — запасы топлива решают.`
      );
      if (p.loading_hydration_note) {
        lines.push(
          "В дни загрузки больше пей: вместе с углеводами в мышцах запасается вода, поэтому вес на эти дни немного прибавит — это вода, а не жир, пугаться не надо. Часть углеводов удобно добрать жидкими (соки, морсы). Сырых овощей и грубой клетчатки накануне поменьше — они вытесняют углеводы и дают тяжесть в животе."
        );
      }
    } else {
      lines.push("Короткий старт (меньше ~90 минут): углеводная загрузка НЕ нужна, питайся как в интенсивный тренировочный день.");
    }
    if (p.timing === "evening_or_night") {
      lines.push(
        "Старт вечером/ночью: углеводы распредели по дню, последний полноценный приём за 2-3 часа до старта; днём не наедайся тяжёлого и не оставайся голодной к вечеру."
      );
    } else {
      lines.push("Старт утром: углеводный ужин накануне и лёгкий завтрак за 2-3 часа до старта.");
    }
    if (p.gel_before) {
      lines.push("За ~10 минут до старта — один гель (обязательно для 10 км и длиннее).");
    }
    lines.push("После старта — углеводы и белок для восстановления.");
  }
  return lines;
}

// Task 10d: rules whose token is silently cleaned (no coach note) — pure
// formatting / internal-term leaks, handled by cleanupPlainText.
const NUTRITION_SILENT_RENDER_RULES = new Set(["markdown", "plain_dashes", "internal_terms"]);

function pushIssue(
  issues: NutritionTelegramRenderIssue[],
  severity: "error" | "warning",
  rule: string,
  message: string,
  tier: "hard" | "soft" = "soft"
): void {
  issues.push({ severity, rule, message, tier });
}

export type NutritionDayProseFacts = {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  carbsGPerKg: number | null;
  proteinGPerKg: number | null;
  /** Optional plan orientation numbers allowed to appear in prose. */
  planTargetNumbers?: number[];
  /**
   * Week-over-week numbers (prev-week avgs, current avgs, deltas) computed by code
   * and allowed to appear in prose so the model can praise real progress.
   */
  previousWeekNumbers?: number[];
  nutritionStatus: string | null;
  findings: string[];
  /**
   * Names of this day's carb foods classified FAST by code (carb_quality). The
   * prose must NOT call any of these a "медленный/медленные углевод" — that is the
   * банан/булочка/лаваш mislabel bug. Used by the carb_quality_mismatch guard.
   */
  carbFastFoods?: string[];
};

// Statuses that always demand an undershoot note in the prose. NOTE: amber-only
// energy-availability (below_energy_availability driven by ea_amber_screen) is a
// soft screen, NOT a hard day — its "hardness" is decided by the findings below
// (ea_red_screen, floor breaches, low carbs for load), so it is intentionally
// not listed here to avoid flagging reasonable "в целом ок" rest days.
const NUTRITION_HARD_DAY_STATUSES = new Set<string>([
  "low_for_load",
  "below_energy_floor",
  "low_for_strength",
  "low_for_cross_training",
  "pre_long_low",
  "long_run_low",
]);

const NUTRITION_HARD_DAY_FINDINGS = new Set<string>([
  "below_load_energy_floor",
  "below_cross_training_floor",
  "below_strength_floor",
  "ea_red_screen",
  "low_carbs_for_load_type",
  "low_carbs_before_long_run",
]);

// status_softened (Task 4, вариант б): instead of requiring an undershoot word
// from an endless list (which produced false cuts on honest phrasings like
// "меньше"), we catch the CONTRADICTION — a hard (undershoot) day whose prose
// claims the day is fine / needs no change. The list is short, stable, and
// DAY-LEVEL: bare per-macro praise ("белок 133 г — отлично") must stay allowed,
// since the voice opens hard days with praise. Lowercased substring match.
const NUTRITION_HARD_DAY_APPROVAL_PHRASES: readonly string[] = [
  "всё хорошо",
  "все хорошо",
  "всё в порядке",
  "все в порядке",
  "всё в норме",
  "все в норме",
  "всё отлично",
  "все отлично",
  "всё супер",
  "все супер",
  "всё идеально",
  "всё ок",
  "все ок",
  "ничего менять не надо",
  "ничего менять не нужно",
  "менять ничего не надо",
  "ничего не меняем",
  "ничего не меняю",
  "так держать",
  "отличный день",
  "прекрасный день",
];

// Number spans that are NOT macro/energy claims and must not be policed as
// "facts" — workout descriptors, time, dates, percentages, and signed coaching
// steps. Scrubbed before the macro-number check (Task 4).
const NUTRITION_NON_MACRO_NUMBER_PATTERNS: RegExp[] = [
  /\d+(?:[.,]\d+)?\s*%/g, // 41%
  /\d+(?:[.,]\d+)?\s*[×xх]\s*\d+(?:[.,]\d+)?/gi, // intervals 7×5
  // distance / duration: «12 км», «5 мин», «2 ч» AND hyphenated adjective forms
  // «90-минутного», «30-секундные» (separator allows hyphen / non-breaking hyphen,
  // unit covers Cyrillic stems). Units stay distance/time only — macro numbers
  // (число+г/ккал/Б/Ж/У) are a different pattern and are NOT scrubbed here.
  /\d+(?:[.,]\d+)?[\s -]*(?:км|мин(?:ут[а-яё]*)?|сек[а-яё]*|час[а-яё]*|ч|м)/giu,
  /\d+\s*:\s*\d+/g, // time 1:40
  /\d{1,2}\s*(?:янв|фев|март|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)/giu, // 14 июня
  /[+\-–—]\s*\d+(?:[.,]\d+)?/g, // signed steps / range tails: +50, –60
  // Weekly check-in scores: «9/10», «9 из 10» (energy / wellbeing / eating comfort, 1–10).
  //
  // A rating on a 1–10 scale is NOT a macro or energy claim — it is the athlete's own weekly
  // self-report, which the model is given in the facts and is expected to reflect back. It belongs
  // here, with the percentages and durations, exactly per this list's rule: police macro/energy
  // claims, scrub everything else.
  //
  // Until now it was policed as if it were a macro number, and passed only by LUCK: on Ponomareva's
  // 12.07 the «9» of «Чек-ин 9/10» happened to coincide with the week-over-week protein delta in
  // that day's allow-set. Any prose citing a check-in was a coin-flip — and on the render path,
  // where that allow-set was dropped entirely, the coin always came up tails and the whole day fell
  // to the dry deterministic comment.
  /\b\d{1,2}\s*\/\s*10\b/g,
  /\b\d{1,2}\s+из\s+10\b/giu,
];

function roundToNearestStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function buildAllowedNutritionProseNumbers(facts: NutritionDayProseFacts): number[] {
  const allowed: number[] = [];
  // Push a value plus its sensible rounded display forms. The model may render a
  // diary fact (e.g. 103.58) as "104"/"105"/"100", so accept those roundings —
  // but the set stays tight enough that a far-off invented number won't match
  // (tolerance below is < 0.1). Task 4: stop cutting real facts; keep invented out.
  const add = (value: number | null | undefined, steps: number[]) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      allowed.push(value, ...steps.map((step) => roundToNearestStep(value, step)));
    }
  };
  // Actual diary facts (kcal, Б/Ж/У) — exact + rounded display.
  add(facts.kcal, [1, 10, 50]);
  for (const macro of [facts.proteinG, facts.fatG, facts.carbsG]) {
    add(macro, [1, 5, 10]);
  }
  // Week-over-week numbers (prev/current avgs + deltas, computed by code) — same
  // exact + rounded treatment as macros so real progress praise survives the validator.
  for (const wow of facts.previousWeekNumbers ?? []) {
    add(wow, [1, 5, 10]);
  }
  // g/kg are decimals — allow exact, 1-decimal, and whole-number forms.
  for (const perKg of [facts.carbsGPerKg, facts.proteinGPerKg]) {
    if (typeof perKg === "number" && Number.isFinite(perKg)) {
      allowed.push(perKg, Math.round(perKg * 10) / 10, Math.round(perKg));
    }
  }
  // Plan targets / deficits are coaching orientations — accept exact + rounded to
  // 5/10. Round in BOTH directions (floor AND ceil), not just nearest: the model
  // legitimately writes "ориентир 310–370" for a 315 band edge (315 floors to 310,
  // not the nearest 320) and "недобор ~120" for a 114–125 gap. No 25/50 so a distant
  // invented number still can't slip in (every accepted value stays within 10 of a
  // real target). Actual diary macros above remain strict (nearest only).
  for (const target of facts.planTargetNumbers ?? []) {
    if (typeof target === "number" && Number.isFinite(target)) {
      allowed.push(target);
      for (const step of [5, 10]) {
        allowed.push(
          roundToNearestStep(target, step),
          Math.floor(target / step) * step,
          Math.ceil(target / step) * step
        );
      }
    }
  }
  return allowed;
}

function allowedNutritionProseNumberMatches(allowed: number[], value: number): boolean {
  return allowed.some((candidate) => Math.abs(candidate - value) < 0.1);
}

/**
 * Per-day prose validator — the key backstop of the hybrid path (задача 4).
 * 1. number_not_in_facts: every number written in the model prose must be a fact
 *    of that day (kcal/Б/Ж/У/г-на-кг or a plan orientation number). Percentages
 *    are whitelisted. Guards against silent number invention.
 * 2. status_softened: if code assigned a hard day status, the prose must contain
 *    at least one undershoot marker; otherwise the model softened the verdict.
 * On any error the caller falls back to the deterministic comment for that day.
 */
export function validateNutritionDayProse(input: {
  prose: string;
  facts: NutritionDayProseFacts;
}): NutritionTelegramRenderIssue[] {
  const issues: NutritionTelegramRenderIssue[] = [];
  const prose = input.prose;
  // Coach/clinical/methodical term leaked INTO a day block (e.g. «EA на границе
  // нормы»). The final message is assembled from day_prose, so a term here would
  // otherwise reach the athlete before the send-gate ever sees it. An error here
  // drops this day to the safe deterministic comment (rewrite path). Same single
  // source of truth as the send-gate — see narrative-guardrails.
  const forbiddenCoachTerm = findForbiddenAthleteCoachTerm(prose);
  if (forbiddenCoachTerm) {
    pushIssue(
      issues,
      "error",
      "forbidden_coach_term",
      `Coach/методический термин «${forbiddenCoachTerm}» в прозе дня — заменяем на детерминированный комментарий.`
    );
  }
  const allowed = buildAllowedNutritionProseNumbers(input.facts);
  // Only police MACRO/ENERGY claims. Non-macro numbers are not facts to validate
  // and were the dominant cause of valid days falling to dry text (Task 4):
  // workout descriptors (12 км, 7×5 мин, 1:40), dates (14 июня), percentages, and
  // "+N" coaching steps. Scrub those spans first; a bare or г/ккал number that
  // remains must still be a fact of this day (invented macro numbers stay blocked).
  let scanText = prose;
  for (const re of NUTRITION_NON_MACRO_NUMBER_PATTERNS) {
    scanText = scanText.replace(re, " ");
  }
  for (const match of scanText.matchAll(/(\d+(?:[.,]\d+)?)/g)) {
    const value = Number(match[1].replace(",", "."));
    if (!Number.isFinite(value)) {
      continue;
    }
    if (!allowedNutritionProseNumberMatches(allowed, value)) {
      pushIssue(
        issues,
        "error",
        "number_not_in_facts",
        `Число ${match[1]} в прозе дня отсутствует в фактах этого дня.`
      );
      break;
    }
  }

  const status = input.facts.nutritionStatus;
  const isHardDay =
    (typeof status === "string" && NUTRITION_HARD_DAY_STATUSES.has(status)) ||
    input.facts.findings.some((finding) => NUTRITION_HARD_DAY_FINDINGS.has(finding));
  if (isHardDay) {
    const lowered = prose.toLowerCase();
    const approval = NUTRITION_HARD_DAY_APPROVAL_PHRASES.find((phrase) => lowered.includes(phrase));
    if (approval) {
      pushIssue(
        issues,
        "error",
        "status_softened",
        `Жёсткий день, а проза хвалит/успокаивает ("${approval}") — модель смягчила вывод.`
      );
    }
  }

  // 3. carb_quality_mismatch (Часть А): catch ONLY the unambiguous error — a FAST
  //    product (банан/булочка/лаваш/сладкое) called "медленный". neutral foods
  //    (рис/картофель/паста) inside the phrase "медленные углеводы" are a coach
  //    idiom and the system's own fallback wording — NOT an error, so we hold them
  //    on the PROMPT rule, never on the hard guard (verified: a fast+neutral guard
  //    false-cut 4/9 real day_prose lines — урок #1). Symmetrically not_carb_base
  //    is held on facts (carb_contributor=false) + prompt, no guard.
  //    Narrow on purpose — only a concrete fast food adjacent to "медленн". Free
  //    words "медленный/быстрый" are NOT policed (timing advice "лёгкие быстрые
  //    углеводы перед стартом" is correct). A contrastive sentence ("гречка
  //    медленная, а банан быстрый") is excluded by the nearby "быстр" check.
  const guardFoods = input.facts.carbFastFoods ?? [];
  if (guardFoods.length > 0) {
    const lowered = prose.toLowerCase();
    for (const food of guardFoods) {
      const f = food.toLowerCase().trim();
      if (f.length < 2) {
        continue;
      }
      const fe = escapeRegExpLiteral(f);
      const adjacent =
        new RegExp(`${fe}[^.!?\\n]{0,12}медленн`, "u").test(lowered) ||
        new RegExp(`медленн\\p{L}*[^.!?\\n]{0,12}${fe}`, "u").test(lowered);
      if (!adjacent) {
        continue;
      }
      // Contrast guard: if "быстр" sits right next to this food, the prose is
      // correctly contrasting it as fast — not mislabeling it slow.
      const idx = lowered.indexOf(f);
      const ctx = lowered.slice(Math.max(0, idx - 15), idx + f.length + 15);
      if (/быстр/u.test(ctx)) {
        continue;
      }
      pushIssue(
        issues,
        "error",
        "carb_quality_mismatch",
        `Быстрый/нейтральный продукт «${food}» назван медленным углеводом.`
      );
      break;
    }
  }
  return issues;
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateTelegramReadyNutritionMessage(input: {
  text: string;
  hasPreviousWeeksContext: boolean;
  hasTargetWeekTrainingContext: boolean;
  hasKeyTraining: boolean;
  longRunTargetKcalText?: string | null;
  /** When the message is split for sending, length is checked per part, not on the whole. */
  messageParts?: string[];
}): NutritionTelegramRenderIssue[] {
  const issues: NutritionTelegramRenderIssue[] = [];
  const text = input.text;

  if (/[—–]/.test(text)) {
    pushIssue(issues, "error", "plain_dashes", "В тексте есть длинное тире.");
  }
  if (/\*\*|__|```|^\s*-{3,}\s*$/m.test(text)) {
    pushIssue(issues, "error", "markdown", "В тексте остались markdown-разметка или разделители.");
  }
  if (/TrainingPeaks|FatSecret|OpenAI|\bJSON\b|\bAI\b/.test(text)) {
    pushIssue(issues, "error", "internal_terms", "В тексте есть внутренние или технические термины.");
  }
  if (!input.hasPreviousWeeksContext && /прошл[а-я]+\s+недел|по сравнению с прошл/i.test(text)) {
    pushIssue(issues, "error", "phantom_previous_comparison", "Сравнение с прошлой неделей запрещено без сохранённого контекста.");
  }
  if (input.hasPreviousWeeksContext && !/прошл[а-я]+\s+недел|по сравнению с прошл/i.test(text)) {
    pushIssue(issues, "warning", "missing_previous_comparison", "Есть контекст прошлых недель, но сравнение не показано.");
  }
  if (/Комментарий:|можно дать|указать факт|hint_for_comment|source_quality/.test(text)) {
    pushIssue(issues, "error", "raw_internal_phrase", "В тексте осталась служебная формулировка.");
  }
  const cautiousMatches = text.match(/по этому дню вывод делаю осторожно/gi) ?? [];
  if (cautiousMatches.length > 1) {
    pushIssue(issues, "error", "repeated_data_thin_caution", "Осторожная оговорка по качеству данных повторяется больше одного раза.");
  }
  const longRunTargetKcalText = input.longRunTargetKcalText ?? "~2500 ккал";
  const longRunGenericLine = text
    .split("\n")
    .some((line) => /Бег по пульсу/.test(line) && line.includes(longRunTargetKcalText) && !/длительн/i.test(line));
  if (longRunGenericLine) {
    pushIssue(issues, "error", "long_run_label", "Длительная не должна отображаться как общий «Бег по пульсу».");
  }
  const redEasyRows = text
    .split("\n")
    .filter((line) => line.startsWith("🟥"))
    .filter((line) => /л[её]гк(?:ий|ая)\s+бег|л[её]гк(?:ий|ая)\s+день/i.test(line));
  if (redEasyRows.length > 0) {
    pushIssue(issues, "error", "red_easy_row", "В мини-таблице найдено несоответствие: 🟥 с лёгким днём.");
  }
  if (input.hasTargetWeekTrainingContext && /План на неделю по типам дней/.test(text) && /Мини-таблица|План по датам/.test(text)) {
    pushIssue(issues, "error", "plan_and_mini_table", "При доступном TP-контексте нельзя одновременно показывать типы дней и dated plan.");
  }
  const lengthBasis =
    input.messageParts && input.messageParts.length > 0
      ? Math.max(...input.messageParts.map((part) => part.length))
      : text.length;
  if (lengthBasis > 4096) {
    pushIssue(issues, "warning", "telegram_length", "Часть сообщения длиннее одного Telegram-сообщения; разбей её ещё.");
  }
  // Task 10d: split the old "forbidden_safety_language" rule by real risk.
  // COACH/CLINICAL/METHODICAL terms leaking into athlete text are genuinely harmful
  // → HARD block (withhold; coach reviews). Single source of truth in
  // narrative-guardrails so this last guard can never fall behind the prompt list
  // again (the был-неполный send-gate list is why «EA на границе нормы» leaked).
  // (The primary РПП/low-kcal gate is upstream `blocked`; this is the last guard.)
  const forbiddenCoachTerm = findForbiddenAthleteCoachTerm(text);
  if (forbiddenCoachTerm) {
    pushIssue(
      issues,
      "error",
      "forbidden_clinical_language",
      `В тексте ученику coach/клинический/методический термин («${forbiddenCoachTerm}») — нужна ручная проверка.`,
      "hard"
    );
  }
  // Diet/weight-loss wording is borderline (often a false positive like the
  // reassuring «не нужно урезать») → SOFT: keep the text, flag the coach. The
  // energy-deficit / EA terms are now HARD above; here only the diet-language.
  if (/опасная зона|урезать|похуд/i.test(text)) {
    pushIssue(
      issues,
      "warning",
      "diet_language_in_athlete_text",
      "Возможна диет-лексика в тексте ученику (урезать/дефицит/похудеть) — проверь формулировку.",
      "soft"
    );
  }
  if (!input.hasKeyTraining && /Перед ключевыми тренировками/.test(text)) {
    pushIssue(issues, "warning", "pre_training_without_key", "Блок перед тренировками показан без hard/long_run.");
  }
  if (input.hasTargetWeekTrainingContext && !/Мини-таблица|План по датам/.test(text)) {
    pushIssue(issues, "warning", "missing_mini_table", "Есть TP-контекст целевой недели, но нет dated mini-table.");
  }
  return issues;
}

export function renderNutritionTelegramMessage(input: NutritionTelegramRendererInput): NutritionTelegramRenderResult {
  const comparisonLine = input.hasPreviousWeeksContext ? input.interpretation.weekComparisonLineRu : null;
  const canUseMiniTable =
    input.hasTargetWeekTrainingContext && !input.forceDayTypePlan && Boolean(input.nextWeekPlan?.days.length);
  const planHeading = canUseMiniTable ? "📋 Мини-таблица" : "📋 План на неделю по типам дней";
  const planLines = canUseMiniTable && input.nextWeekPlan
    ? buildMiniTable({
        nextWeekPlan: input.nextWeekPlan,
        planWeekMode: input.planWeekMode,
        todayLocalDate: input.todayLocalDate,
        mode: input.miniTableMode ?? "athlete_remaining_only",
      })
    : buildPlanByDayTypes(input.nextWeekPlan, input.fallbackPlanLines);
  const keyTrainingPresent = hasKeyTraining(input.nextWeekPlan);
  const raceBlock = buildRaceDayBlock(input.nextWeekPlan);
  const preTrainingBlock = keyTrainingPresent ? buildPreTrainingBlock(input.nextWeekPlan) : [];
  const mainStepLine = buildNutritionTargetWeekMainStepLine(input.nextWeekPlan, input.planWeekMode, {
    todayLocalDate: input.todayLocalDate,
    miniTableMode: input.miniTableMode ?? "athlete_remaining_only",
  });
  // Phone-readable structure: every section has a heading, a blank line, then
  // its body; day blocks are separated by a blank line; long bodies are split
  // into short chunks. One Telegram message, copy-paste-safe (no markdown).
  const dayBlocks =
    input.interpretation.dayComments.length > 0
      ? input.interpretation.dayComments
      : ["Разбор по дням в этом черновике не детализирую: canonical daily_analysis не найден, поэтому лучше проверить исходный обзор вручную."];
  const daySection = dayBlocks.join("\n\n");
  const weekSummary = paragraphizeForTelegram(
    input.interpretation.weekSummaryRu ?? "По неделе держим курс на ровную энергию и восстановление без резких просадок."
  );
  const focusBodyRaw = paragraphizeForTelegram(
    input.interpretation.focusLinesRu.length > 0
      ? input.interpretation.focusLinesRu.join(" ")
      : "Фокус на неделю не сформирован."
  );
  // Plan week already started → «следующая»→«эта» (date-driven via planWeekMode).
  const focusBody =
    input.planWeekMode === "current_week" ? relabelPlanWeekWordingToThisWeek(focusBodyRaw) : focusBodyRaw;
  // Block 3: warm opening line from the athlete's own words, right after the
  // greeting. Final guards: plain text, drop if empty or if it smuggled a digit
  // (numbers belong to the facts, never to free praise).
  const openingNoteRaw = (input.interpretation.athleteOpeningNoteRu ?? "").replace(/[*_`#]+/g, "").replace(/\s+/g, " ").trim();
  const openingNote = openingNoteRaw && !/\d/.test(openingNoteRaw) ? openingNoteRaw : null;
  // Split into two Telegram messages at the natural past/future boundary so each
  // fits the 4096-char cap: part 1 = last-week review (header + days + week
  // summary), part 2 = next-week plan (focus + mini-table + pre-training memo).
  const reviewLines = [
    resolveGreeting(input.formality),
    ...(openingNote ? ["", openingNote] : []),
    "",
    input.formality === "vy"
      ? "Посмотрел ваш отчёт за неделю и сопоставил его с тренировками."
      : "Посмотрел твой отчёт за неделю и сопоставил его с тренировками.",
    ...(comparisonLine ? ["", comparisonLine] : []),
    "",
    "📊 Разбор по дням",
    "",
    daySection,
    "",
    "📌 Итог недели",
    "",
    weekSummary,
  ];
  const planLinesSection = [
    formatPlanFocusSectionHeading(input.planWeekMode),
    "",
    focusBody,
    "",
    "Цифры ниже - ориентиры, не обязательство. Не нужно резко прыгать к ним за один день.",
    ...(mainStepLine ? [mainStepLine] : []),
    "",
    planHeading,
    ...planLines,
    ...(raceBlock.length > 0 ? ["", ...raceBlock] : []),
    ...(preTrainingBlock.length > 0 ? ["", ...preTrainingBlock] : []),
    "",
    "На следующем разборе посмотрим, как это отразится на энергии и восстановлении.",
  ];

  let reviewText = cleanupPlainText(reviewLines.join("\n"));
  let planText = cleanupPlainText(planLinesSection.join("\n"));
  // Task 10d: a phantom "прошлая неделя" reference with no saved history is a false
  // claim — strip the sentence (soft), and tell the coach we did.
  const coachReviewNotes: string[] = [];
  if (!input.hasPreviousWeeksContext) {
    const r = stripPhantomPreviousComparison(reviewText);
    const p = stripPhantomPreviousComparison(planText);
    reviewText = r.text;
    planText = p.text;
    if (r.removed || p.removed) {
      coachReviewNotes.push("Убрал упоминание прошлой недели — сохранённой истории не было.");
    }
  }
  const parts = [reviewText, planText].filter((part) => part.length > 0);
  const text = parts.join("\n\n");

  // Athlete-safe plan sections (SAME text, split for the mini-app card layout).
  // The text mini-table is deliberately NOT included — the app renders day cards
  // from the structured plan days instead. `parts`/`text` above are untouched.
  let planFocusText: string | null = focusBody.trim() ? cleanupPlainText(focusBody) : null;
  let planNoteText: string | null = cleanupPlainText(
    [
      "Цифры ниже - ориентиры, не обязательство. Не нужно резко прыгать к ним за один день.",
      ...(mainStepLine ? [mainStepLine] : []),
      "На следующем разборе посмотрим, как это отразится на энергии и восстановлении.",
    ].join(" ")
  );
  if (!input.hasPreviousWeeksContext) {
    if (planFocusText) {
      planFocusText = stripPhantomPreviousComparison(planFocusText).text || null;
    }
    planNoteText = stripPhantomPreviousComparison(planNoteText).text || null;
  }
  const planSections: NutritionAthletePlanSections = {
    focus: planFocusText,
    raceDay: raceBlock.length > 0 ? cleanupPlainText(raceBlock.join("\n")) : null,
    keyTraining: preTrainingBlock.length > 0 ? cleanupPlainText(preTrainingBlock.join("\n")) : null,
    note: planNoteText && planNoteText.trim() ? planNoteText : null,
  };

  // Athlete-safe review sections: lead-in + week summary (the per-day blocks become
  // cards on the mini-app, so the day section is NOT included here). Same text.
  const introLine = input.formality === "vy"
    ? "Посмотрел ваш отчёт за неделю и сопоставил его с тренировками."
    : "Посмотрел твой отчёт за неделю и сопоставил его с тренировками.";
  let reviewIntroText: string | null = cleanupPlainText(
    [...(openingNote ? [openingNote] : []), introLine, ...(comparisonLine ? [comparisonLine] : [])].join("\n\n")
  );
  let reviewWeekSummaryText: string | null = weekSummary.trim() ? cleanupPlainText(weekSummary) : null;
  if (!input.hasPreviousWeeksContext) {
    if (reviewIntroText) reviewIntroText = stripPhantomPreviousComparison(reviewIntroText).text || null;
    if (reviewWeekSummaryText) reviewWeekSummaryText = stripPhantomPreviousComparison(reviewWeekSummaryText).text || null;
  }
  const reviewSections: NutritionAthleteReviewSections = {
    intro: reviewIntroText && reviewIntroText.trim() ? reviewIntroText : null,
    weekSummary: reviewWeekSummaryText && reviewWeekSummaryText.trim() ? reviewWeekSummaryText : null,
  };
  const issues = validateTelegramReadyNutritionMessage({
    text,
    hasPreviousWeeksContext: input.hasPreviousWeeksContext,
    hasTargetWeekTrainingContext: input.hasTargetWeekTrainingContext,
    hasKeyTraining: keyTrainingPresent,
    longRunTargetKcalText: getLongRunTargetKcalText(input.nextWeekPlan),
    messageParts: parts,
  });
  // Task 10d: only HARD issues (clinical danger) withhold the message. SOFT issues
  // keep the text and surface as coach-review notes (silently-cleaned rules excluded).
  const ok = !issues.some((issue) => issue.tier === "hard");
  for (const issue of issues) {
    if (issue.tier !== "hard" && !NUTRITION_SILENT_RENDER_RULES.has(issue.rule)) {
      coachReviewNotes.push(issue.message);
    }
  }
  return {
    ok,
    // `text` gates sending (null only on a HARD clinical block); `parts` always
    // carries the rendered split so the admin/checkpoints can preview it.
    text: ok ? text : null,
    parts,
    issues,
    coachReviewNotes,
    charCount: text.length,
    planSections,
    reviewSections,
  };
}
