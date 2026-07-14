import type { NutritionPlanTargetWeekMode } from "@/features/nutrition/plan-week-policy";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import type { NutritionNextWeekPlan } from "@/features/nutrition/weekly-plan-formulas";
import {
  buildKeyWorkoutPhraseLabel,
  buildNutritionTargetWeekFocusNarrative,
  buildNutritionWeeklySummary,
  composeNutritionDayComment,
  formatNutritionWorkoutLabelForAthlete,
  NutritionNarrativeRepetitionState,
  readLoadDayCarbsDeltaG,
  resolveNutritionNarrativeWorkoutRole,
  reconcileNarrativeRoleWithCarbLoadBasis,
  resolveWeekNarrativeDayRoles,
  type MacroGuardrailStatuses,
} from "@/features/nutrition/narrative-composer";
import { resolveNutritionNarrativePreferencesFromStored } from "@/features/nutrition/context";
import {
  NUTRITION_TELEGRAM_DAY_DIVIDER,
  paragraphizeForTelegram,
  renderNutritionTelegramMessage,
  simplifyAthleteWording,
  stripAthleteTechJargon,
  validateNutritionDayProse,
  type NutritionDayProseFacts,
  type NutritionTelegramRenderResult,
} from "@/features/nutrition/telegram-renderer";
import { getNutritionAdminLocalDate } from "@/features/nutrition/plan-week-policy";

type CanonicalDailyFact = {
  date?: unknown;
  weekday_ru?: unknown;
  weekdayRu?: unknown;
  date_label?: unknown;
  dateLabel?: unknown;
  training_type?: unknown;
  trainingType?: unknown;
  training_label?: unknown;
  trainingLabel?: unknown;
  actual_kcal?: unknown;
  actual?: unknown;
  protein_g?: unknown;
  fat_g?: unknown;
  carbs_g?: unknown;
  carbs_g_per_kg?: unknown;
  hint_for_comment?: unknown;
  hintForComment?: unknown;
  nutrition_status?: unknown;
  nutritionStatus?: unknown;
  findings?: unknown;
  source_quality?: unknown;
  sourceQuality?: unknown;
  macro_guardrails?: unknown;
  macroGuardrails?: unknown;
  athlete_prose?: unknown;
  target?: unknown;
  goal_day_target?: unknown;
  items_notable?: unknown;
  /**
   * Extra numbers this day's prose is ALLOWED to cite — week-over-week averages/deltas and the
   * weight-trend figures, all computed by code in draft-generator and injected onto every day.
   * buildNutritionDayProseFacts reads them, so the normalizer MUST carry them: dropping them made
   * the render-time validator stricter than the generation-time one, and days the model was told
   * were fine silently fell to the dry comment on the way to the athlete.
   */
  previous_week_numbers?: unknown;
  /** Pre-workout carbs summed by code from the day's real diary items — also a citable fact. */
  pre_workout?: unknown;
  /**
   * The athlete's own weekly check-in ratings (1–10), injected onto every day by draft-generator.
   * Read by buildNutritionDayProseFacts to police the scores the prose quotes back at her, so —
   * per the RULE below — it must be carried by the normalizer like the two above.
   */
  checkin_numbers?: unknown;
};

export type NutritionCombinedMessageResult = {
  status: "ready" | "missing_review" | "missing_plan" | "blocked_safety" | "needs_review" | "awaiting_generation";
  athleteMessageDraft: string | null;
  /** Telegram-split copy blocks: [last-week review, next-week plan]. Empty unless ready. */
  athleteMessageDraftParts: string[];
  renderResult: NutritionTelegramRenderResult;
  warnings: string[];
  sourceReviewId: string | null;
  sourcePlanId: string | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized || null;
}

function emptyRenderResult(): NutritionTelegramRenderResult {
  return {
    ok: false,
    text: null,
    parts: [],
    issues: [],
    coachReviewNotes: [],
    charCount: 0,
    planSections: { focus: null, raceDay: null, keyTraining: null, note: null },
    reviewSections: { intro: null, weekSummary: null },
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDateRu(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  return `${match[3]}.${match[2]}`;
}

function formatDecimalRu(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function formatNutritionAthleteKcal(value: number | null | undefined, options?: { mode?: "actual" | "target" }): string {
  if (value == null || !Number.isFinite(value)) {
    return "ккал н/д";
  }
  return `~${roundToNearest(value, options?.mode === "target" ? 100 : 50)} ккал`;
}

export function formatNutritionAthleteMacro(value: number | null | undefined, options?: { approximate?: boolean }): string {
  if (value == null || !Number.isFinite(value)) {
    return "н/д";
  }
  const rounded = roundToNearest(value, 5);
  return `${options?.approximate ? "~" : ""}${rounded} г`;
}

export function formatNutritionAthletePlanMacro(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "н/д";
  }
  return `${Math.round(value)} г`;
}

export function formatNutritionAthletePerKg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "н/д";
  }
  return `~${formatDecimalRu(value, 1)} г/кг`;
}

function normalizeStoredDailyFactItem(raw: unknown): CanonicalDailyFact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const embedded = asObject(item.canonicalDailyAnalysis ?? item.canonical_daily_analysis);
  const source = Object.keys(embedded).length > 0 ? embedded : item;
  const actualSource = asObject(source.actual);
  const actual =
    Object.keys(actualSource).length > 0
      ? actualSource
      : {
          kcal: item.kcal ?? source.kcal ?? item.actual_kcal ?? source.actual_kcal,
          proteinG: item.proteinG ?? source.proteinG ?? item.protein_g ?? source.protein_g,
          fatG: item.fatG ?? source.fatG ?? item.fat_g ?? source.fat_g,
          carbsG: item.carbsG ?? source.carbsG ?? item.carbs_g ?? source.carbs_g,
          carbsGPerKg: item.carbsGPerKg ?? source.carbsGPerKg ?? item.carbs_g_per_kg ?? source.carbs_g_per_kg,
        };
  const date = typeof source.date === "string" ? source.date : typeof item.date === "string" ? item.date : null;
  if (!date) {
    return null;
  }
  const weekday =
    typeof source.weekdayRu === "string"
      ? source.weekdayRu
      : typeof source.weekday_ru === "string"
        ? source.weekday_ru
        : typeof item.weekdayRu === "string"
          ? item.weekdayRu
          : typeof item.weekday_ru === "string"
            ? item.weekday_ru
            : null;
  const dateLabel =
    typeof source.dateLabel === "string"
      ? source.dateLabel
      : typeof source.date_label === "string"
        ? source.date_label
        : typeof item.dateLabel === "string"
          ? item.dateLabel
          : typeof item.date_label === "string"
            ? item.date_label
            : formatDateRu(date);
  const trainingType =
    typeof source.trainingType === "string"
      ? source.trainingType
      : typeof source.training_type === "string"
        ? source.training_type
        : typeof item.trainingType === "string"
          ? item.trainingType
          : typeof item.training_type === "string"
            ? item.training_type
            : "unknown";
  const trainingLabel =
    typeof source.trainingLabel === "string"
      ? source.trainingLabel
      : typeof source.training_label === "string"
        ? source.training_label
        : typeof item.trainingLabel === "string"
          ? item.trainingLabel
          : typeof item.training_label === "string"
            ? item.training_label
            : "день недели";
  const sourceQuality = asObject(source.sourceQuality) ?? asObject(source.source_quality);
  return {
    date,
    weekday_ru: weekday,
    date_label: dateLabel,
    training_type: trainingType,
    training_label: trainingLabel,
    actual,
    actual_kcal:
      toFiniteNumber(actual.kcal) ?? toFiniteNumber(item.actual_kcal) ?? toFiniteNumber(source.actual_kcal),
    protein_g: toFiniteNumber(actual.proteinG) ?? toFiniteNumber(item.protein_g) ?? toFiniteNumber(source.protein_g),
    fat_g: toFiniteNumber(actual.fatG) ?? toFiniteNumber(item.fat_g) ?? toFiniteNumber(source.fat_g),
    carbs_g: toFiniteNumber(actual.carbsG) ?? toFiniteNumber(item.carbs_g) ?? toFiniteNumber(source.carbs_g),
    carbs_g_per_kg:
      toFiniteNumber(actual.carbsGPerKg) ??
      toFiniteNumber(item.carbs_g_per_kg) ??
      toFiniteNumber(source.carbs_g_per_kg),
    nutrition_status:
      typeof source.nutritionStatus === "string"
        ? source.nutritionStatus
        : typeof source.nutrition_status === "string"
          ? source.nutrition_status
          : typeof item.nutritionStatus === "string"
            ? item.nutritionStatus
            : typeof item.nutrition_status === "string"
              ? item.nutrition_status
              : null,
    findings: source.findings ?? item.findings,
    source_quality: Object.keys(sourceQuality).length > 0 ? sourceQuality : undefined,
    macro_guardrails:
      source.macroGuardrails ??
      source.macro_guardrails ??
      item.macroGuardrails ??
      item.macro_guardrails ??
      embedded.macroGuardrails ??
      embedded.macro_guardrails,
    athlete_prose: source.athlete_prose ?? item.athlete_prose,
    // Use the GOAL-AWARE target (top-level item.target = goalAwareCanonicalTarget,
    // what the prose and plan were generated against), NOT the embedded
    // canonicalDailyAnalysis.target which keeps the pre-goal raw band. For a lose/gain
    // student the two diverge (e.g. 290–330 goal vs 350–455 raw band); validating the
    // prose's deficit against the raw band falsely rejected the whole day to the dry
    // fallback. For maintain they are byte-identical, so this is a no-op there.
    target: item.target ?? source.target,
    // Task 10d (Bug 1): carry the goal "deficit line" through normalization so the
    // render-time validator allows its numbers and the goal-aware fallback can fire.
    goal_day_target: source.goal_day_target ?? item.goal_day_target,
    // Часть А: carry items_notable (with per-item carb_class) so the render-time
    // carb_quality_mismatch guard can see which foods are fast/neutral.
    items_notable: source.items_notable ?? item.items_notable,
    // These two are the allow-lists of code-computed numbers the prose may cite, injected onto every
    // day by draft-generator. This normalizer builds a NEW object rather than spreading the stored
    // one, so anything not listed here is DROPPED — and these two were. The consequence was not
    // cosmetic: buildNutritionDayProseFacts reads both, so the render-time validator saw a narrower
    // fact set than the generation-time audit and silently refused prose that generation had passed.
    // Ponomareva 12.07 is the case in point — «Чек-ин 9/10» survived generation because the 9
    // coincided with a week-over-week protein delta in previous_week_numbers, then died at render
    // where that list no longer existed, and the athlete got the dry comment while the editor still
    // showed the model's text.
    //
    // RULE: every field buildNutritionDayProseFacts reads must be carried here. Add one there → add
    // it here, or the two paths drift apart again.
    previous_week_numbers: item.previous_week_numbers ?? source.previous_week_numbers,
    pre_workout: source.pre_workout ?? item.pre_workout,
    // Her check-in ratings: the render must judge a quoted «9/10» against the same scores the
    // generation-time audit judged it against. Absent on reviews generated before this field
    // existed — the validator then scrubs the score instead of policing it, so they keep rendering.
    checkin_numbers: source.checkin_numbers ?? item.checkin_numbers,
  };
}

/** What the render-time gate decided for one day: the prose it kept, and why it dropped it. */
type NutritionDayProseGateResult = {
  /** Prose that passed the gate, or null when the day falls back to the deterministic comment. */
  prose: string | null;
  /**
   * Why the gate dropped the prose. Empty when it passed — and also empty when there was no prose
   * at all: a day with no athlete_prose is deterministic BY DESIGN and is not a rejection.
   */
  rejectedRules: string[];
  /** The same reasons in the coach's language — the admin page shows these verbatim. */
  rejectedMessages: string[];
};

/** Coach-facing wording for the gate's own rejections (the validator supplies its own messages). */
const NUTRITION_GATE_REJECTION_MESSAGES: Record<string, string> = {
  empty_prose: "После очистки от разметки и техтокенов от прозы ничего не осталось.",
  markdown_in_prose: "В прозе markdown-разметка (**, __, ```) — ученице она уйдёт как мусор.",
  tech_token_in_prose: "В прозе технический токен (TrainingPeaks, JSON, day_role и т.п.).",
};

/**
 * Hybrid path guard (task 1): basic gate before model day prose may replace the
 * deterministic comment. Rigorous per-day number/status validation is layered on
 * top in the validator task. Returns the prose to use, or null to fall back — plus the reasons,
 * so the swap can be REPORTED (getNutritionDayProseRejections) instead of happening in silence.
 *
 * This is the only place that knows what the athlete actually gets: it validates the prose AFTER
 * cleanup (jargon strip, dash normalization) and rejects on markdown/tech tokens too, none of which
 * a bare validateNutritionDayProse call on the raw day can see.
 */
function resolveUsableNutritionDayProse(value: unknown, facts: NutritionDayProseFacts): NutritionDayProseGateResult {
  const reject = (rule: string): NutritionDayProseGateResult => ({
    prose: null,
    rejectedRules: [rule],
    rejectedMessages: [NUTRITION_GATE_REJECTION_MESSAGES[rule] ?? rule],
  });
  if (typeof value !== "string") {
    return { prose: null, rejectedRules: [], rejectedMessages: [] };
  }
  // Normalize em/en dashes to a hyphen exactly like the whole-message cleanup
  // (cleanupPlainText) does — Igor's voice uses "—" constantly ("белок 133 г —
  // отлично"), and rejecting on it silently dropped live prose to the dry
  // deterministic comment. Markdown emphasis/fences are still rejected.
  // Cut any leaked coach/technical tokens (adequacy: medium, day_role, status
  // enums…) BEFORE validation, so a single leaked token doesn't drop otherwise-good
  // prose to the dry fallback (1a). The reject list below is the backstop (1b).
  const prose = simplifyAthleteWording(stripAthleteTechJargon(value.replace(/\s+/g, " ").replace(/[—–]/g, "-")))
    .replace(/ {2,}/g, " ")
    .trim();
  if (prose.length < 2) {
    return reject("empty_prose");
  }
  if (/\*\*|__|```/.test(prose)) {
    return reject("markdown_in_prose");
  }
  // Backstop (1b): if a raw key:value tech token still slipped through the strip,
  // reject the prose entirely → deterministic fallback.
  if (
    /TrainingPeaks|FatSecret|OpenAI|\bJSON\b|hint_for_comment|source_quality/.test(prose) ||
    /\b(?:adequacy|day_role|loadBasis|load_basis|fat_policy|fatFeedbackPolicy|nutrition_status)\s*[:=]/i.test(prose)
  ) {
    return reject("tech_token_in_prose");
  }
  // Backstop: numbers must be facts of this day and a hard status must not be
  // softened. On any error fall back to the deterministic comment.
  const issues = validateNutritionDayProse({ prose, facts });
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    return {
      prose: null,
      rejectedRules: [...new Set(errors.map((issue) => issue.rule))],
      rejectedMessages: [...new Set(errors.map((issue) => issue.message))],
    };
  }
  return { prose, rejectedRules: [], rejectedMessages: [] };
}

/**
 * Build the per-day prose facts (actual macros + code-owned plan target numbers) from a canonical
 * daily_analysis item. One helper, so the render-time gate (resolveUsableNutritionDayProse), the
 * generation-time audit (draft-generator) and the coach-facing rejection notice
 * (listRejectedNutritionReviewProseDays) all judge prose by the same rules.
 *
 * Sharing the helper is NOT enough on its own, and the claim that it was cost real damage: the
 * three callers feed it DIFFERENT objects — generation and the notice pass the raw stored day, the
 * render passes a normalized one — and the normalizer used to drop previous_week_numbers and
 * pre_workout, two fields read below. Same helper, narrower facts, stricter verdict: prose that
 * generation had passed was silently refused on the way to the athlete, and the coach's own edits
 * with it.
 *
 * The normalizer now carries them (normalizeStoredDailyFactItem). If a new field is read here, it
 * must be carried there too — otherwise the paths drift apart again and the drift is invisible.
 */
export function buildNutritionDayProseFacts(item: Record<string, unknown>): NutritionDayProseFacts {
  const actual = asObject(item.actual);
  const kcal = getDailyFactValue(item, actual, "actual_kcal", "kcal");
  const protein = getDailyFactValue(item, actual, "protein_g", "proteinG");
  const fat = getDailyFactValue(item, actual, "fat_g", "fatG");
  const carbs = getDailyFactValue(item, actual, "carbs_g", "carbsG");
  const carbsGPerKg = toFiniteNumber(item.carbs_g_per_kg) ?? toFiniteNumber(actual.carbsGPerKg);
  const proteinGPerKg = toFiniteNumber(actual.proteinGPerKg);
  const findings = asStringArray(item.findings);
  const nutritionStatus =
    typeof item.nutrition_status === "string"
      ? item.nutrition_status
      : typeof item.nutritionStatus === "string"
        ? item.nutritionStatus
        : null;
  // Code-owned target numbers for this day, so the prose may state coaching
  // orientations ("цель ~350, у тебя 233, недобор ~100") without the number
  // validator treating them as invented.
  const targetObj = asObject(item.target);
  const carbsGMin = toFiniteNumber(targetObj.carbsGMin);
  const carbsGMax = toFiniteNumber(targetObj.carbsGMax);
  const planTargetNumbers: number[] = [];
  // kcalTarget — the day's ENERGY orientation, the same number the athlete reads on her plan line.
  // The day used to carry carb bounds and an energy FLOOR (kcalMin) but never the target itself, so
  // a prose citing it («ориентир около 2300») was scored as an invented number and the whole day
  // fell to the dry comment. It is allowed here on exactly the same terms as the carb bounds —
  // exact value plus the 5/10 roundings below, nothing looser — so an invented «4200 ккал» is still
  // refused. The guard is against invented numbers, not against the category of energy.
  for (const value of [
    carbsGMin,
    carbsGMax,
    toFiniteNumber(targetObj.kcalTarget),
    toFiniteNumber(targetObj.kcalMin),
    toFiniteNumber(targetObj.proteinGMin),
  ]) {
    if (value != null) {
      planTargetNumbers.push(value);
    }
  }
  // Band midpoint, rounded to 10, so a friendly "около 300" for a 280–320 corridor
  // reads as a valid rounded target rather than an invented number (Task 4).
  if (carbsGMin != null && carbsGMax != null) {
    planTargetNumbers.push(Math.round((carbsGMin + carbsGMax) / 2 / 10) * 10);
  }
  if (carbs != null) {
    const mid = carbsGMin != null && carbsGMax != null ? (carbsGMin + carbsGMax) / 2 : null;
    for (const target of [carbsGMin, carbsGMax, mid]) {
      if (target != null && target > carbs) {
        planTargetNumbers.push(target - carbs);
      }
    }
    // The model subtracts from the ROUNDED orientation it just quoted, not from the raw bound:
    // «при ориентире около 300 г — недобор примерно 125 г» is 300 − 175, not 295 − 175 = 120.
    // The raw difference's own 5/10 roundings do not reach 125 (120 is already a multiple of
    // both), so the day died for arithmetic that is correct. Allow the difference from the
    // rounded targets too — still anchored to a REAL bound, so an invented gap stays out.
    for (const target of [carbsGMin, carbsGMax, mid]) {
      if (target == null) continue;
      for (const step of [5, 10]) {
        const rounded = Math.round(target / step) * step;
        if (rounded > carbs) {
          planTargetNumbers.push(rounded - carbs);
        }
      }
    }
  }
  // The same gap, for the other macros the model is asked to comment on. Carbs had it; protein,
  // fat and energy did not, so «белка не хватило примерно 20 г» was an invented number.
  const kcalTargetValue = toFiniteNumber(targetObj.kcalTarget);
  const proteinMinValue = toFiniteNumber(targetObj.proteinGMin);
  for (const [actual, target] of [
    [kcal, kcalTargetValue],
    [kcal, toFiniteNumber(targetObj.kcalMin)],
    [protein, proteinMinValue],
  ] as Array<[number | null, number | null]>) {
    if (actual == null || target == null) continue;
    planTargetNumbers.push(Math.abs(target - actual));
    for (const step of [5, 10, 50]) {
      planTargetNumbers.push(Math.abs(Math.round(target / step) * step - actual));
    }
  }
  // Task 10d (Bug 1): the goal-aware "deficit line" (goal_day_target) is also a
  // code-owned orientation. Without this, a losing athlete's prose citing the
  // deficit target ("ориентир около 1800 ккал") was flagged as an invented number
  // and the whole day's prose was dropped to the goal-blind deterministic comment.
  const goalDayTarget = asObject(item.goal_day_target);
  const goalKcal = toFiniteNumber(goalDayTarget.target_kcal);
  const goalCarbs = toFiniteNumber(goalDayTarget.carbs_g);
  for (const value of [goalKcal, toFiniteNumber(goalDayTarget.protein_g), toFiniteNumber(goalDayTarget.fat_g), goalCarbs]) {
    if (value != null) {
      planTargetNumbers.push(value);
    }
  }
  // Allow the gap to the deficit line ("на ~950 больше ориентира").
  if (goalKcal != null && kcal != null) {
    planTargetNumbers.push(Math.abs(kcal - goalKcal));
  }
  if (goalCarbs != null && carbs != null) {
    planTargetNumbers.push(Math.abs(carbs - goalCarbs));
  }
  // Наряд 3 Пункт 3: pre-workout carbs are summed by code from the day's REAL
  // diary items (PDF), so the prose may state "перед интервалами было ~48 г
  // углеводов" without the validator treating it as invented.
  const preWorkout = asObject(item.pre_workout);
  const preWorkoutCarbs = toFiniteNumber(preWorkout.carbs_g);
  if (preWorkoutCarbs != null) {
    planTargetNumbers.push(preWorkoutCarbs);
    planTargetNumbers.push(Math.round(preWorkoutCarbs / 10) * 10);
    planTargetNumbers.push(Math.round(preWorkoutCarbs / 5) * 5);
  }
  // Часть А: collect this day's carb foods that code classified FAST, so the
  // carb_quality_mismatch guard can catch the prose calling any of them
  // "медленный". Names come from items_notable (built deterministically from PDF).
  // Only fast — see the guard comment for why neutral is deliberately excluded.
  const carbFastFoods = collectCarbFastFoods(item.items_notable);
  // Week-over-week: prev/current avgs + deltas, computed by code in draft-generator
  // and persisted onto each day item so render-time validation also allows them.
  const previousWeekNumbers: number[] = [];
  if (Array.isArray(item.previous_week_numbers)) {
    for (const raw of item.previous_week_numbers) {
      const value = toFiniteNumber(raw);
      if (value != null) {
        previousWeekNumbers.push(value);
      }
    }
  }
  // The athlete's own check-in ratings (1–10), injected per day by draft-generator. They are NOT
  // pushed into the macro allow-set: the validator polices the scores the prose quotes («9/10»)
  // against these, so it can catch the model telling her she reported a 4 when she reported a 9.
  const checkinNumbers: number[] = [];
  if (Array.isArray(item.checkin_numbers)) {
    for (const raw of item.checkin_numbers) {
      const value = toFiniteNumber(raw);
      if (value != null) {
        checkinNumbers.push(value);
      }
    }
  }
  return {
    kcal,
    proteinG: protein,
    fatG: fat,
    carbsG: carbs,
    carbsGPerKg,
    proteinGPerKg,
    planTargetNumbers,
    previousWeekNumbers,
    checkinNumbers,
    workoutNumbers: collectWorkoutNumbers(item),
    itemNumbers: collectItemNumbers(item.items_notable),
    nutritionStatus,
    findings,
    carbFastFoods,
  };
}

/**
 * Numbers the code knows about this day's session, read off the CODE-OWNED training label
 * («8 х 4 мин» → 8 and 4; «длительная 16 км» → 16). The label is built by the methodology from
 * the TrainingPeaks calendar, so every number in it is a fact by construction.
 *
 * This exists because the model describes the session it is writing about — «под 8 интервалов по
 * 4 минуты углеводов маловато» — and the day used to die for it. The minutes were scrubbed as a
 * non-macro span, but the COUNT has no unit after it, so it was policed as an invented macro.
 *
 * Reading the label rather than free-scrubbing «N интервалов» keeps the claim HONEST: the model
 * still cannot say «12 интервалов» when she ran 8.
 */
function collectWorkoutNumbers(item: Record<string, unknown>): number[] {
  const source = asObject(item.canonicalDailyAnalysis ?? item.canonical_daily_analysis);
  const label = [item.training_label, source.trainingLabel, item.workoutTitle]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const numbers: number[] = [];
  for (const match of label.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const value = Number(match[0].replace(",", "."));
    if (Number.isFinite(value)) {
      numbers.push(value);
    }
  }
  const duration = toFiniteNumber(source.workoutDurationMinutes);
  if (duration != null) {
    numbers.push(duration);
  }
  return numbers;
}

/**
 * Per-item macros from her own diary: «картофель дал 64 г углеводов», «семечки — 40 г жира».
 *
 * The code has ALWAYS known these numbers — it reads each item's carbsG/fatG/proteinG to decide
 * whether the item is a carb or fat contributor — but it kept only the verdict and threw the
 * numbers away, passing bare names to the model. So a prose quoting a real product's real macro
 * was scored as invented, and the whole day fell to the dry comment.
 */
function collectItemNumbers(itemsNotable: unknown): number[] {
  const notable = asObject(itemsNotable);
  const bySection = asObject(notable.by_section);
  const numbers: number[] = [];
  for (const list of Object.values(bySection)) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const raw of list) {
      const entry = asObject(raw);
      for (const key of ["carbs_g", "fat_g", "protein_g", "kcal"]) {
        const value = toFiniteNumber(entry[key]);
        if (value != null && value > 0) {
          numbers.push(value);
        }
      }
    }
  }
  return numbers;
}

/** Names of protein sources the code picked from her diary — see pickProteinAdviceSources. */
function collectProteinAdviceSourceNames(itemsNotable: unknown): string[] {
  const notable = asObject(itemsNotable);
  const names: string[] = [];
  if (Array.isArray(notable.protein_advice_sources)) {
    for (const source of notable.protein_advice_sources) {
      const obj = asObject(source);
      if (typeof obj.name === "string" && obj.name.trim().length >= 2) {
        names.push(obj.name.trim());
      }
    }
  }
  return names;
}

/**
 * A prose that advises adding/increasing protein while her diary held a real, code-picked
 * source (protein_advice_sources) and named NONE of them — the exact failure a named-field
 * prompt was supposed to prevent, but a prompt is a request, not a guarantee (Selezneva,
 * 2026-07-11: protein_advice_sources held her own «Блинчики с Курицей», the prose still said
 * «яйцо к завтраку, протеиновый йогурт»).
 *
 * NOT a rejection — the text can be perfectly good coaching, it just did not reference what it
 * could have. Surfaced to the coach as a warning (like the prose-rejection banner), never
 * silently swaps the text for a fallback: a false positive here must cost nothing to the athlete.
 */
function detectNutritionProteinAdviceMismatch(prose: string, adviceSourceNames: string[]): boolean {
  if (adviceSourceNames.length === 0) {
    return false;
  }
  // TWO INDEPENDENT checks, not one adjacency-anchored regex — the real Selezneva sentence
  // was «Белок 61 г - это очень мало. Даже небольшие добавки работают: яйцо к завтраку,
  // протеиновый йогурт к ужину» and an earlier adjacency-anchored version of this regex
  // (requiring "белок" and "добав" to sit next to each other) MISSED it: a full sentence
  // about kcal sits between the two words in ordinary coaching prose. Mentioning protein
  // AND suggesting an addition ANYWHERE in the same day's text is advice enough to check.
  // "белк" alone MISSES the nominative singular "белок" (there is a vowel between "л" and
  // "к" only in that one form — белОК vs genitive белКа, plural белКи, adjective белКовый).
  const mentionsProtein = /белок|белк/iu.test(prose);
  const suggestsAddingSomething =
    /добав|можно\s+добав|стоит\s+добав|не\s+помешает|хорошо\s+бы|подтян|увелич|порци\p{L}*\s+побольше/iu.test(prose);
  const advisesMoreProtein = mentionsProtein && suggestsAddingSomething;
  if (!advisesMoreProtein) {
    return false;
  }
  const proseLower = prose.toLowerCase();
  const referencesHerSource = adviceSourceNames.some((name) => {
    // A significant word from the name is enough — the model paraphrases freely
    // («блинчики с курицей» → «куриное», «куриного»). A 4-char prefix, not 6: the noun
    // «курицей» and the adjective «куриного» (real case) diverge at the 5th letter
    // (курИЦей vs курИНого) — a 6-char prefix missed the real paraphrase entirely.
    const words = name
      .toLowerCase()
      .split(/[\s,()]+/)
      .filter((word) => word.length >= 5);
    return words.some((word) => proseLower.includes(word.slice(0, 4)));
  });
  return !referencesHerSource;
}

function collectCarbFastFoods(itemsNotable: unknown): string[] {
  const notable = asObject(itemsNotable);
  if (!notable) {
    return [];
  }
  const names = new Set<string>();
  const consider = (name: unknown, carbClass: unknown): void => {
    if (typeof name !== "string" || name.trim().length < 2) {
      return;
    }
    if (carbClass === "fast") {
      names.add(name.trim());
    }
  };
  // carb_foods: [{ name, carb_class }]
  if (Array.isArray(notable.carb_foods)) {
    for (const food of notable.carb_foods) {
      const obj = asObject(food);
      if (obj) {
        consider(obj.name, obj.carb_class);
      }
    }
  }
  // by_section[*]: [{ name, carb_class, ... }]
  const bySection = asObject(notable.by_section);
  if (bySection) {
    for (const sectionItems of Object.values(bySection)) {
      if (Array.isArray(sectionItems)) {
        for (const entry of sectionItems) {
          const obj = asObject(entry);
          if (obj) {
            consider(obj.name, obj.carb_class);
          }
        }
      }
    }
  }
  return [...names];
}

function extractMacroGuardrailStatuses(macroGuardrails: unknown): MacroGuardrailStatuses {
  const guardrails = asObject(macroGuardrails);
  const proteinGuard = asObject(guardrails.protein);
  const fatGuard = asObject(guardrails.fat);
  const carbsGuard = asObject(guardrails.carbs);
  return {
    proteinStatus: typeof proteinGuard.status === "string" ? proteinGuard.status : null,
    fatStatus: typeof fatGuard.status === "string" ? fatGuard.status : null,
    fatPercentStatus: typeof fatGuard.percentStatus === "string" ? fatGuard.percentStatus : null,
    fatG: toFiniteNumber(fatGuard.g),
    fatPercentEnergy: toFiniteNumber(fatGuard.percentEnergy ?? fatGuard.percent_energy),
    carbsStatus: typeof carbsGuard.status === "string" ? carbsGuard.status : null,
    carbsG: toFiniteNumber(carbsGuard.g ?? carbsGuard.gActual ?? carbsGuard.actualG),
    carbsGPerKg: toFiniteNumber(carbsGuard.gPerKg ?? carbsGuard.g_per_kg),
  };
}

// amber-only energy-availability (nutritionStatus "below_energy_availability" driven
// by ea_amber_screen alone, no ea_red_screen/floor breach) is a soft screen on an
// often-ESTIMATED FFM (Cunningham fallback, medium confidence) — not a hard finding.
// "below_energy_availability" itself is ambiguous (set for BOTH red and amber zones
// in methodology.ts), so it is deliberately NOT checked here; only the specific
// ea_red_screen finding (or an actual floor breach) counts. Mirrors telegram-renderer.ts's
// NUTRITION_HARD_DAY_STATUSES/NUTRITION_HARD_DAY_FINDINGS split.
function hasDayEnergyIssue(input: {
  nutritionStatus: string | null;
  findings: string[];
}): boolean {
  return (
    input.nutritionStatus === "below_energy_floor" ||
    input.nutritionStatus === "low_for_cross_training" ||
    input.nutritionStatus === "low_for_strength" ||
    input.nutritionStatus === "low_for_load" ||
    input.nutritionStatus === "pre_long_low" ||
    input.nutritionStatus === "long_run_low" ||
    input.findings.includes("below_load_energy_floor") ||
    input.findings.includes("below_cross_training_floor") ||
    input.findings.includes("below_strength_floor") ||
    input.findings.includes("low_energy_with_cross_training") ||
    input.findings.includes("low_energy_with_strength") ||
    input.findings.includes("ea_red_screen")
  );
}

export function buildDayMacroSentence(input: {
  proteinStatus: string | null;
  fatStatus: string | null;
  fatPercentStatus?: string | null;
  carbsStatus: string | null;
  trainingType: string;
  hasEnergyIssue: boolean;
  fatFeedbackPolicy?: import("@/features/nutrition/context").NutritionFatFeedbackPolicy;
}): string | null {
  const { proteinStatus, fatStatus, fatPercentStatus, carbsStatus, trainingType, hasEnergyIssue } = input;
  const fatFeedbackPolicy = input.fatFeedbackPolicy ?? "coach_only";
  const loadDay = trainingType !== "rest";
  const mentionHighFat =
    fatFeedbackPolicy === "normal" && (fatStatus === "high" || fatPercentStatus === "high");
  const mentionLowFat = fatStatus === "low" || fatStatus === "borderline";

  if (hasEnergyIssue && proteinStatus === "ok" && loadDay && (carbsStatus === "low" || carbsStatus === "borderline")) {
    return "Белок закрыт, но общей энергии и углеводов всё равно маловато.";
  }

  const segments: string[] = [];
  if (loadDay && carbsStatus === "low") {
    segments.push("Углеводов для такой нагрузки маловато");
  } else if (loadDay && carbsStatus === "borderline") {
    segments.push("Углеводы на нижней границе");
  }

  if (mentionHighFat && loadDay && (carbsStatus === "low" || carbsStatus === "borderline")) {
    return "Жиры высоковаты, при этом углеводов под нагрузку не хватает — лучше сместить часть энергии в углеводы вокруг тяжёлых дней.";
  }

  const macroParts: string[] = [];
  if (proteinStatus === "borderline") {
    macroParts.push("белок близко к нижней границе");
  } else if (proteinStatus === "low") {
    macroParts.push("белка в этот день маловато");
  }
  if (mentionLowFat) {
    if (fatStatus === "low") {
      macroParts.push("жиры низковаты");
    } else if (fatStatus === "borderline") {
      macroParts.push("жиры на нижней границе");
    }
  }

  if (segments.length > 0 && macroParts.length > 0) {
    return `${segments[0]}; ${macroParts.join(", ")}.`;
  }
  if (segments.length > 0) {
    return `${segments[0]}.`;
  }
  if (macroParts.length === 1) {
    const part = macroParts[0]!;
    if (part.startsWith("белок")) {
      return "Белок близко к нижней границе.";
    }
    if (part.startsWith("белка")) {
      return "Белка в этот день маловато.";
    }
    if (part === "жиры низковаты") {
      return "Жиров получилось низковато.";
    }
    return "Жиры на нижней границе.";
  }
  if (macroParts.length >= 2) {
    return `${macroParts[0]!.charAt(0).toUpperCase()}${macroParts[0]!.slice(1)}, ${macroParts.slice(1).join(", ")}.`;
  }
  return null;
}

function getCanonicalDailyFacts(review: NutritionWeeklyAnalysis): CanonicalDailyFact[] {
  const summary = asObject(review.nutritionSummary);
  const daily = summary.daily_analysis;
  if (!Array.isArray(daily)) {
    return [];
  }
  return daily
    .map((item) => normalizeStoredDailyFactItem(item))
    .filter((item): item is CanonicalDailyFact => Boolean(item));
}

function isIsoDateInRange(date: string | null, from: string, to: string): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  return date >= from && date <= to;
}

function filterFactsToReviewWeek(review: NutritionWeeklyAnalysis, facts: CanonicalDailyFact[]): CanonicalDailyFact[] {
  return facts.filter((item) => {
    const date = typeof item.date === "string" ? item.date : null;
    return isIsoDateInRange(date, review.weekFrom, review.weekTo);
  });
}

function getDailyFactValue(item: CanonicalDailyFact, actual: Record<string, unknown>, snakeKey: keyof CanonicalDailyFact, camelKey: string): number | null {
  return toFiniteNumber(item[snakeKey]) ?? toFiniteNumber(actual[camelKey]);
}

function resolveDailyTrainingLabelForAthlete(trainingType: string, trainingLabel: string): string {
  return formatNutritionWorkoutLabelForAthlete({ trainingLabel, trainingType });
}

function hasNutritionCompletenessIssue(input: {
  sourceQuality: Record<string, unknown>;
  nutritionStatus: string | null;
  findings: string[];
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}): boolean {
  if (input.nutritionStatus === "suspect") {
    return true;
  }
  const hasNutritionData = input.sourceQuality.hasNutritionData;
  if (hasNutritionData === false) {
    return true;
  }
  if (input.kcal == null || input.protein == null || input.fat == null || input.carbs == null) {
    return true;
  }
  if (input.kcal === 0 || input.protein === 0 || input.fat === 0 || input.carbs === 0) {
    return true;
  }
  if (input.findings.includes("suspect_macro_values")) {
    return true;
  }
  const notes = asStringArray(input.sourceQuality.notes).map((note) => note.toLowerCase());
  return notes.some((note) =>
    /missing_nutrition|missing_daily_macros|nutrition_source_confidence_low|parse_confidence_low|low_confidence_pdf_parse|suspect_macro|suspect_kcal|suspect_zero_macros/.test(
      note
    )
  );
}

/** One review day, both as the Telegram line and structured (athlete-safe) for cards. */
type NutritionReviewDayEntry = {
  date: string | null;
  line: string;
  prose: string;
  /** Non-empty when THIS render swapped the day's prose for the deterministic comment. */
  proseRejectedRules: string[];
  /** The same reasons, worded for the coach. */
  proseRejectedMessages: string[];
  /**
   * True when the prose advises adding protein but named none of her code-picked real sources
   * (protein_advice_sources), even though the day had some. NOT a rejection — the text still
   * ships to the athlete; this only flags the day to the coach for a look.
   */
  proteinAdviceMismatch: boolean;
  isRest: boolean;
  isRun: boolean;
  isKey: boolean;
  isRace: boolean;
};

/** A day whose prose the render-time gate replaced with the deterministic comment. */
export type NutritionDayProseRejection = {
  date: string | null;
  rules: string[];
  /** Coach-facing reasons, and the deterministic text the athlete gets in place of the prose. */
  messages: string[];
  willSendProse: string;
};

/**
 * Which days the RENDER actually swapped for the dry comment — reported by the render itself,
 * not re-derived by a second caller running the validator on the raw day.
 *
 * That distinction is the whole point. The gate judges the CLEANED prose and also rejects markdown
 * and leaked tech tokens; a bare validateNutritionDayProse call on the raw day sees neither, so it
 * can both miss a swap and invent one that never happened. Only the gate knows what the athlete got.
 *
 * Deliberately read-only: the render runs inside a server component AND inside the student-facing
 * /api/m/r route, so it must never write to the DB. The rejections travel UP and the coach page
 * shows them as warnings.
 */
export function getNutritionDayProseRejections(review: NutritionWeeklyAnalysis | null): NutritionDayProseRejection[] {
  if (!review) {
    return [];
  }
  return buildDailyFactsEntries(review)
    .filter((entry) => entry.proseRejectedRules.length > 0)
    .map((entry) => ({
      date: entry.date,
      rules: entry.proseRejectedRules,
      messages: entry.proseRejectedMessages,
      // entry.prose IS the deterministic comment here — the gate already swapped it.
      willSendProse: entry.prose,
    }));
}

/** A day whose protein advice did not reference any of her code-picked real sources. */
export type NutritionDayProteinAdviceMismatch = {
  date: string | null;
  /** The prose exactly as it ships — this is a WARNING, the text is not swapped. */
  prose: string;
};

/**
 * Days where the shipping prose advises adding protein but named none of the athlete's own
 * code-picked sources (protein_advice_sources), even though the day had some to name.
 *
 * NOT a rejection: the text still reaches the athlete unchanged. This exists purely to put the
 * day in front of the coach — «совет по белку не опирается на её продукты — проверьте» — the
 * same reporting shape as getNutritionDayProseRejections, for the same reason: a prompt is a
 * request, not a guarantee, and a silent miss here is a worse coaching experience than a
 * generic-sounding tip that a human never gets to catch.
 */
export function getNutritionDayProteinAdviceMismatches(
  review: NutritionWeeklyAnalysis | null
): NutritionDayProteinAdviceMismatch[] {
  if (!review) {
    return [];
  }
  return buildDailyFactsEntries(review)
    .filter((entry) => entry.proteinAdviceMismatch)
    .map((entry) => ({ date: entry.date, prose: entry.prose }));
}

/** Athlete-safe per-day review card data (date + validated prose + flags). */
export type NutritionReviewDayCard = {
  date: string | null;
  prose: string;
  isRest: boolean;
  isRun: boolean;
  isKey: boolean;
  isRace: boolean;
  isRecovery: boolean;
};

export function getNutritionReviewDayCards(review: NutritionWeeklyAnalysis): NutritionReviewDayCard[] {
  return buildDailyFactsEntries(review).map((e) => ({
    date: e.date,
    prose: e.prose,
    isRest: e.isRest,
    isRun: e.isRun,
    isKey: e.isKey,
    isRace: e.isRace,
    isRecovery: false, // the past-week review has no recovery-day concept
  }));
}

function getDailyFactsLines(review: NutritionWeeklyAnalysis): string[] {
  return buildDailyFactsEntries(review).map((entry) => entry.line);
}

/**
 * Merges the coach's overlay (coach_edits) onto the model's review and returns the review the
 * athlete actually gets. The overlay is stored OUTSIDE nutrition_summary precisely so that a
 * regeneration — which upserts nutrition_summary wholesale — cannot destroy it; this is where
 * the two halves are put back together.
 *
 * A missing key means the coach did not touch that field, so the model's text is used. There is
 * no edited_by_coach flag anywhere: the overlay IS the flag.
 *
 * Idempotent — applying it to an already-merged review changes nothing, so entry points may
 * apply it defensively without coordinating.
 */
export function applyNutritionCoachEdits(review: NutritionWeeklyAnalysis): NutritionWeeklyAnalysis {
  const overlay = review.coachEdits;
  if (!overlay) {
    return review;
  }
  const summary = JSON.parse(JSON.stringify(asObject(review.nutritionSummary))) as Record<string, unknown>;

  const dayProse = overlay.day_prose ?? {};
  if (Object.keys(dayProse).length > 0 && Array.isArray(summary.daily_analysis)) {
    for (const raw of summary.daily_analysis) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        continue;
      }
      const item = raw as Record<string, unknown>;
      const date = typeof item.date === "string" ? item.date : null;
      if (!date || !Object.prototype.hasOwnProperty.call(dayProse, date)) {
        continue;
      }
      item.athlete_prose = dayProse[date];
      // The stored day also carries an embedded canonical copy, and normalizeStoredDailyFactItem
      // reads `source.athlete_prose ?? item.athlete_prose` — the embed WINS when it has the field.
      // Today it does not, but writing both keeps the coach's text authoritative whatever the
      // embed grows into, instead of being silently shadowed by a stale model line.
      for (const key of ["canonicalDailyAnalysis", "canonical_daily_analysis"]) {
        const embedded = item[key];
        if (embedded && typeof embedded === "object" && !Array.isArray(embedded)) {
          (embedded as Record<string, unknown>).athlete_prose = dayProse[date];
        }
      }
    }
  }

  if (overlay.one_focus_statement_ru != null) {
    const oneFocus =
      summary.one_focus && typeof summary.one_focus === "object" && !Array.isArray(summary.one_focus)
        ? (summary.one_focus as Record<string, unknown>)
        : {};
    oneFocus.statement_ru = overlay.one_focus_statement_ru;
    summary.one_focus = oneFocus;
  }
  if (overlay.athlete_opening_note_ru != null) {
    summary.athlete_opening_note_ru = overlay.athlete_opening_note_ru;
  }

  return { ...review, nutritionSummary: summary };
}

function buildDailyFactsEntries(review: NutritionWeeklyAnalysis): NutritionReviewDayEntry[] {
  // THE chokepoint. Every day-based reader — the athlete's cards, the day-by-day text, the
  // rejection banner — comes through here, so the coach's overlay is applied once, in one
  // place, and cannot be forgotten by the next reader that needs day prose.
  review = applyNutritionCoachEdits(review);
  const facts = getCanonicalDailyFacts(review);
  const reviewWeekFacts = filterFactsToReviewWeek(review, facts);
  if (reviewWeekFacts.length === 0) {
    return [];
  }

  const summary = asObject(review.nutritionSummary);
  const narrativePreferences = resolveNutritionNarrativePreferencesFromStored({
    nutritionSummary: summary,
    contextSnapshot: asObject(review.contextSnapshot),
  });

  const sortedFacts = [...reviewWeekFacts].sort((left, right) => {
    const leftDate = typeof left.date === "string" ? left.date : "";
    const rightDate = typeof right.date === "string" ? right.date : "";
    return leftDate.localeCompare(rightDate);
  });
  const previousDayByDate = new Map<string, CanonicalDailyFact>();
  for (let index = 1; index < sortedFacts.length; index += 1) {
    const currentItem = sortedFacts[index];
    const currentDate = typeof currentItem?.date === "string" ? currentItem.date : "";
    const previous = sortedFacts[index - 1];
    if (currentDate && previous) {
      previousDayByDate.set(currentDate, previous);
    }
  }

  const roleInputs = reviewWeekFacts.map((item) => {
    const date = typeof item.date === "string" ? item.date : "";
    const trainingType =
      typeof item.training_type === "string" ? item.training_type : typeof item.trainingType === "string" ? item.trainingType : "unknown";
    const trainingLabel =
      typeof item.training_label === "string" ? item.training_label : typeof item.trainingLabel === "string" ? item.trainingLabel : "день недели";
    return { date, trainingType, trainingLabel, mode: "past_review" as const, isCompleted: true };
  });
  const weekRoles = resolveWeekNarrativeDayRoles(roleInputs);
  const repetitionState = new NutritionNarrativeRepetitionState();

  return reviewWeekFacts
    .map((item) => {
      const date = typeof item.date === "string" ? item.date : null;
      const weekday = typeof item.weekday_ru === "string" ? item.weekday_ru : typeof item.weekdayRu === "string" ? item.weekdayRu : null;
      const dateLabel =
        typeof item.date_label === "string" ? item.date_label : typeof item.dateLabel === "string" ? item.dateLabel : date ? formatDateRu(date) : null;
      const trainingType =
        typeof item.training_type === "string" ? item.training_type : typeof item.trainingType === "string" ? item.trainingType : "unknown";
      const trainingLabel =
        typeof item.training_label === "string" ? item.training_label : typeof item.trainingLabel === "string" ? item.trainingLabel : "день недели";
      const actual = asObject(item.actual);
      const kcal = getDailyFactValue(item, actual, "actual_kcal", "kcal");
      const protein = getDailyFactValue(item, actual, "protein_g", "proteinG");
      const fat = getDailyFactValue(item, actual, "fat_g", "fatG");
      const carbs = getDailyFactValue(item, actual, "carbs_g", "carbsG");
      const findings = asStringArray(item.findings);
      const nutritionStatus =
        typeof item.nutrition_status === "string"
          ? item.nutrition_status
          : typeof item.nutritionStatus === "string"
            ? item.nutritionStatus
            : null;
      const sourceQuality = asObject(item.source_quality) ?? asObject(item.sourceQuality);
      const missingNutritionData = sourceQuality.hasNutritionData === false;
      const macroGuardrails = asObject(item.macro_guardrails) ?? asObject(item.macroGuardrails);
      if (!weekday || !dateLabel || (!missingNutritionData && (kcal == null || protein == null || fat == null || carbs == null))) {
        return null;
      }
      const athleteTrainingLabel = resolveDailyTrainingLabelForAthlete(trainingType, trainingLabel);
      const macroStatuses: MacroGuardrailStatuses = extractMacroGuardrailStatuses(macroGuardrails);
      const dateKey = date ?? "";
      const previousDay = dateKey ? previousDayByDate.get(dateKey) : undefined;
      const previousDayTrainingType =
        typeof previousDay?.training_type === "string"
          ? previousDay.training_type
          : typeof previousDay?.trainingType === "string"
            ? previousDay.trainingType
            : null;
      const previousDayTrainingLabel =
        typeof previousDay?.training_label === "string"
          ? previousDay.training_label
          : typeof previousDay?.trainingLabel === "string"
            ? previousDay.trainingLabel
            : null;
      const resolvedRole = resolveNutritionNarrativeWorkoutRole({
        trainingType,
        trainingLabel,
        mode: "past_review",
        isCompleted: true,
      });
      const carbsGuard = asObject(macroGuardrails.carbs);
      const roleInfo = reconcileNarrativeRoleWithCarbLoadBasis(
        weekRoles.get(dateKey) ?? { ...resolvedRole, isKey: false },
        typeof carbsGuard.loadBasis === "string" ? carbsGuard.loadBasis : null
      );
      // Athlete-safe day flags for the mini-app cards (same markers as the plan).
      const isRace = roleInfo.role === "race" || trainingType === "race";
      const isRest = trainingType === "rest";
      const dayFlags = {
        isRest,
        isRace,
        isKey: roleInfo.isKey,
        isRun: !isRest && !isRace,
      };
      const comment = composeNutritionDayComment(
        {
          trainingType,
          trainingLabel,
          athleteTrainingLabel,
          nutritionStatus,
          findings,
          macro: macroStatuses,
          hasNutritionCompletenessIssue: hasNutritionCompletenessIssue({
            sourceQuality,
            nutritionStatus,
            findings,
            kcal,
            protein,
            fat,
            carbs,
          }),
          missingNutritionData,
          hasEnergyIssue: hasDayEnergyIssue({ nutritionStatus, findings }),
          roleInfo,
          fatFeedbackPolicy: narrativePreferences.fatFeedbackPolicy,
          previousDayTrainingType,
          previousDayTrainingLabel,
          // Task 10d (Bug 1): goal-aware fallback for a rest day over the deficit line.
          goalType: (() => {
            const g = asObject(item.goal_day_target).goal;
            return g === "lose" || g === "gain" ? g : undefined;
          })(),
          goalDayTargetKcal: toFiniteNumber(asObject(item.goal_day_target).target_kcal),
          actualKcal: kcal,
          actualFatG: fat,
        },
        repetitionState
      );
      // Telegram-readable day block: header line, blank, numbers line, blank,
      // divider, blank, feedback (long feedback split into short chunks). Real
      // newlines survive copy-paste; no markdown. Structure is goal-independent.
      const header = `🔹 ${weekday} (${dateLabel}) · ${athleteTrainingLabel}`;
      if (missingNutritionData) {
        return {
          date,
          line: `${header}\n\n${paragraphizeForTelegram(comment)}`,
          prose: comment,
          proseRejectedRules: [],
          proseRejectedMessages: [],
          proteinAdviceMismatch: false,
          ...dayFlags,
        };
      }
      // Hybrid: prefer validated model prose (or the coach's edit of it), otherwise the
      // deterministic comment. The fact line above is always code-owned and never replaced.
      //
      // `item` here is the NORMALIZED fact, and it must carry every field buildNutritionDayProseFacts
      // reads — otherwise this gate judges the prose on a narrower fact set than the audit that
      // approved it, and refuses it silently. That is exactly what happened until the normalizer
      // started carrying previous_week_numbers / pre_workout.
      //
      // When the gate DOES drop a day, its reasons ride up with the entry — the swap is reported
      // (getNutritionDayProseRejections → coach warnings), never silent.
      const proseGate = resolveUsableNutritionDayProse(item.athlete_prose, buildNutritionDayProseFacts(item));
      const dayComment = proseGate.prose ?? comment;
      const numbersLine = `${formatNutritionAthleteKcal(kcal, { mode: "actual" })} · Б ${formatNutritionAthleteMacro(protein)} · Ж ${formatNutritionAthleteMacro(fat)} · У ${formatNutritionAthleteMacro(carbs)}`;
      // A WARNING, not a rejection: checked against the text that actually ships (dayComment),
      // so a fallback comment (which never advises anything) never trips it by construction.
      const proteinAdviceMismatch = detectNutritionProteinAdviceMismatch(
        dayComment,
        collectProteinAdviceSourceNames(item.items_notable)
      );
      return {
        date,
        line: [
          header,
          "",
          numbersLine,
          "",
          NUTRITION_TELEGRAM_DAY_DIVIDER,
          "",
          paragraphizeForTelegram(dayComment),
        ].join("\n"),
        prose: dayComment,
        proseRejectedRules: proseGate.rejectedRules,
        proseRejectedMessages: proseGate.rejectedMessages,
        proteinAdviceMismatch,
        ...dayFlags,
      };
    })
    .filter((entry): entry is NutritionReviewDayEntry => entry !== null);
}

function getDailyFactsCoverage(review: NutritionWeeklyAnalysis): {
  totalFacts: number;
  reviewWeekFacts: number;
  hasOutsideWeekFacts: boolean;
} {
  const facts = getCanonicalDailyFacts(review);
  const reviewWeekFacts = filterFactsToReviewWeek(review, facts);
  return {
    totalFacts: facts.length,
    reviewWeekFacts: reviewWeekFacts.length,
    hasOutsideWeekFacts: facts.length > 0 && reviewWeekFacts.length === 0,
  };
}

export function buildDerivedNutritionCoachDayByDayText(review: NutritionWeeklyAnalysis | null): string | null {
  if (!review) {
    return null;
  }
  const lines = getDailyFactsLines(review);
  if (lines.length === 0) {
    return null;
  }
  return lines.join("\n\n");
}

function getReviewWeekSummaryLine(review: NutritionWeeklyAnalysis): string {
  const summary = asObject(review.nutritionSummary);
  const narrativePreferences = resolveNutritionNarrativePreferencesFromStored({
    nutritionSummary: summary,
    contextSnapshot: asObject(review.contextSnapshot),
  });
  const oneFocus = asObject(summary.one_focus);
  const statement = compactText(typeof oneFocus.statement_ru === "string" ? oneFocus.statement_ru : null);
  const coachSummary = compactText(typeof summary.coach_summary_text === "string" ? summary.coach_summary_text : null);
  const proteinSufficient = asObject(summary.methodology_signals).protein_sufficient === true;
  const weeklyProteinAvgGPerKg = toFiniteNumber(summary.avg_protein_g_per_kg) ?? toFiniteNumber(summary.avgProteinGPerKg);
  const dailyFacts = filterFactsToReviewWeek(review, getCanonicalDailyFacts(review));
  const methodologySignals = asObject(summary.methodology_signals);

  const roleInputs = dailyFacts.map((day) => {
    const date = typeof day.date === "string" ? day.date : "";
    const trainingType =
      typeof day.training_type === "string" ? day.training_type : typeof day.trainingType === "string" ? day.trainingType : "unknown";
    const trainingLabel =
      typeof day.training_label === "string" ? day.training_label : typeof day.trainingLabel === "string" ? day.trainingLabel : "день недели";
    return { date, trainingType, trainingLabel, mode: "past_review" as const, isCompleted: true };
  });
  const weekRoles = resolveWeekNarrativeDayRoles(roleInputs);

  // Specific key-workout labels come from the RAW TP workouts (title + distance), which
  // the flattened canonical label has lost. Pick the run/quality session per date when a
  // day has several (e.g. run + pilates).
  const isRunLikeTpTitle = (title: string, type: string): boolean =>
    type === "run" || /бег|интерв|темп|длительн|\b\d+\s*[xх]\s*\d+/iu.test(title);
  type TpSession = { title: string; distanceKm: number | null; type: string };
  const tpWorkoutByDate = new Map<string, TpSession>();
  const tpSessionsByDate = new Map<string, TpSession[]>();
  const tpPastWorkoutsRaw = asObject(review.tpPastWeekContext).workouts;
  for (const raw of Array.isArray(tpPastWorkoutsRaw) ? tpPastWorkoutsRaw : []) {
    const wo = asObject(raw);
    const date = typeof wo.date === "string" ? wo.date : "";
    if (!date) continue;
    const title = typeof wo.title === "string" ? wo.title : "";
    const type = typeof wo.type === "string" ? wo.type : "";
    const distanceKm =
      toFiniteNumber(wo.distanceKm) ?? toFiniteNumber(wo.completedDistanceKm) ?? toFiniteNumber(wo.completed_distance_km) ?? null;
    const session: TpSession = { title, distanceKm, type };
    tpSessionsByDate.set(date, [...(tpSessionsByDate.get(date) ?? []), session]);
    const existing = tpWorkoutByDate.get(date);
    if (!existing || (isRunLikeTpTitle(title, type) && !isRunLikeTpTitle(existing.title, existing.type))) {
      tpWorkoutByDate.set(date, session);
    }
  }
  // On a combined day (run+race / run+long), the merged canonical label is verbose
  // («бег + Угличский полумарафон»). Surface the race or long session so the sentence
  // names it cleanly («забег 21,1 км» / «длительная N км»). A run+strength combined day
  // has no such session → null, so it keeps the merged fallback (unchanged).
  const isRaceTpSession = (s: TpSession): boolean =>
    s.type === "race" || /полумарафон|марафон|забег|гонк|соревнован|паркран|parkrun|race|триатлон|ультрамарафон/iu.test(s.title);
  const pickCombinedKeySession = (date: string): { role: "race" | "long_run"; session: TpSession } | null => {
    const sessions = tpSessionsByDate.get(date) ?? [];
    const race = sessions.find(isRaceTpSession);
    if (race) return { role: "race", session: race };
    const long = sessions.find(
      (s) =>
        (s.type === "run" || /бег|run/iu.test(s.title)) &&
        ((s.distanceKm ?? 0) >= 18 || /длительн|long\s*run|лонг/iu.test(s.title))
    );
    if (long) return { role: "long_run", session: long };
    return null;
  };

  const summaryDays = dailyFacts.map((day) => {
    const date = typeof day.date === "string" ? day.date : "";
    const trainingType =
      typeof day.training_type === "string" ? day.training_type : typeof day.trainingType === "string" ? day.trainingType : "unknown";
    const trainingLabel =
      typeof day.training_label === "string" ? day.training_label : typeof day.trainingLabel === "string" ? day.trainingLabel : "день недели";
    const nutritionStatus =
      typeof day.nutrition_status === "string" ? day.nutrition_status : typeof day.nutritionStatus === "string" ? day.nutritionStatus : null;
    const findings = asStringArray(day.findings);
    const macroGuardrailsRaw = day.macro_guardrails ?? day.macroGuardrails;
    const macroBase = extractMacroGuardrailStatuses(macroGuardrailsRaw);
    const carbsGuard = asObject(asObject(macroGuardrailsRaw).carbs);
    const loadBasis = typeof carbsGuard.loadBasis === "string" ? carbsGuard.loadBasis : null;
    const actual = asObject((day as Record<string, unknown>).actual);
    const macro: MacroGuardrailStatuses = {
      ...macroBase,
      carbsG:
        macroBase.carbsG ??
        toFiniteNumber(day.carbs_g) ??
        toFiniteNumber(actual.carbsG) ??
        toFiniteNumber(actual.carbs_g),
      carbsGPerKg:
        macroBase.carbsGPerKg ??
        toFiniteNumber(day.carbs_g_per_kg) ??
        toFiniteNumber(actual.carbsGPerKg) ??
        toFiniteNumber(actual.carbs_g_per_kg),
    };
    const roleInfo = reconcileNarrativeRoleWithCarbLoadBasis(
      weekRoles.get(date) ?? {
        role: resolveNutritionNarrativeWorkoutRole({ trainingType, trainingLabel, mode: "past_review", isCompleted: true }).role,
        isKey: false,
        reason: "fallback",
      },
      loadBasis
    );
    const tpWorkout = tpWorkoutByDate.get(date);
    const combinedKey = roleInfo.role === "combined_load" ? pickCombinedKeySession(date) : null;
    const specificWorkoutLabel = combinedKey
      ? buildKeyWorkoutPhraseLabel({
          role: combinedKey.role,
          title: combinedKey.session.title,
          distanceKm: combinedKey.session.distanceKm,
          trainingType: combinedKey.session.type || trainingType,
        })
      : roleInfo.isKey && tpWorkout
        ? buildKeyWorkoutPhraseLabel({
            role: roleInfo.role,
            title: tpWorkout.title,
            distanceKm: tpWorkout.distanceKm,
            trainingType: tpWorkout.type || trainingType,
          })
        : null;
    return {
      date,
      trainingType,
      trainingLabel,
      nutritionStatus,
      findings,
      macro,
      hasEnergyIssue: hasDayEnergyIssue({ nutritionStatus, findings }),
      roleInfo,
      specificWorkoutLabel,
    };
  });

  if (summaryDays.length > 0) {
    return buildNutritionWeeklySummary({
      days: summaryDays,
      proteinSufficient,
      weeklyProteinAvgGPerKg,
      fatFeedbackPolicy: narrativePreferences.fatFeedbackPolicy,
      weekSeed: review.weekFrom,
      loadDayCarbsDeltaG: readLoadDayCarbsDeltaG(review.nutritionSummary),
    });
  }
  if (typeof methodologySignals.main_load_day_label === "string" && methodologySignals.main_load_day_label.trim()) {
    const mainLoadLabel = formatNutritionWorkoutLabelForAthlete({
      trainingLabel: methodologySignals.main_load_day_label,
      trainingType:
        typeof methodologySignals.main_load_day_type === "string"
          ? methodologySignals.main_load_day_type
          : "long_endurance",
    });
    return `Главный тренировочный день недели — ${mainLoadLabel}. Фокус — углеводы вокруг тяжёлых дней, а не просто «есть больше каждый день».`;
  }
  return statement ?? coachSummary ?? "По неделе держим курс на ровную энергию и восстановление без резких просадок.";
}

function buildAdjacentMissingNutritionLines(review: NutritionWeeklyAnalysis): string[] {
  const summary = asObject(review.nutritionSummary);
  const methodologySignals = asObject(summary.methodology_signals);
  const adjacent = Array.isArray(methodologySignals.adjacent_training_without_nutrition_days)
    ? methodologySignals.adjacent_training_without_nutrition_days
    : [];
  return adjacent
    .map((raw) => asObject(raw))
    .map((item) => {
      const date = typeof item.date === "string" ? item.date : null;
      const label = typeof item.trainingLabel === "string" ? item.trainingLabel : typeof item.training_label === "string" ? item.training_label : "тренировка";
      if (!date) {
        return null;
      }
      return `🔹 ${formatDateRu(date)} · ${formatNutritionWorkoutLabelForAthlete({ trainingLabel: label, trainingType: "cross_training" })}
Питание за этот день не зафиксировано: данных за этот день нет — выводов не делаю, отмечаю только факт нагрузки.`;
    })
    .filter((line): line is string => Boolean(line));
}

function getPlanFocusLines(
  plan: NutritionWeeklyPlan,
  mode: NutritionPlanTargetWeekMode,
  nextWeekPlan: NutritionNextWeekPlan | null,
  input?: {
    todayLocalDate?: string;
    miniTableMode?: "athlete_remaining_only" | "full_week";
  }
): string[] {
  // Task 6: if the plan prose was written by the model (Claude, same call as the
  // review), use it as the focus prose so the whole message is in one voice. The
  // deterministic per-day narrative becomes the fallback. The numbers mini-table
  // is rendered separately from nextWeekPlan, so it is unaffected either way.
  if (plan.generationMode === "ai") {
    // Flow C (plan): the coach's edit (coach_edited_draft) overrides the original AI prose
    // (athlete_message_draft) when present; clearing it restores the original. The numeric
    // mini-table comes from nextWeekPlan, so editing the prose never touches the numbers.
    const planProse = compactText(plan.coachEditedDraft) ? plan.coachEditedDraft : plan.athleteMessageDraft;
    const claudePlanLines = (compactText(planProse) ? planProse ?? "" : "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (claudePlanLines.length > 0) {
      return claudePlanLines;
    }
  }

  const narrativeFocus = buildNutritionTargetWeekFocusNarrative(nextWeekPlan, mode, {
    todayLocalDate: input?.todayLocalDate,
    miniTableMode: input?.miniTableMode ?? "athlete_remaining_only",
  });
  if (narrativeFocus.length > 0) {
    return narrativeFocus;
  }

  const planSummary = asObject(plan.planSummary);
  const focus = asObject(planSummary.plan_focus);
  const title = compactText(typeof focus.title === "string" ? focus.title : null);
  const explanation = compactText(typeof focus.explanation === "string" ? focus.explanation : null);
  if (title && explanation) {
    return [title, explanation];
  }
  if (title) {
    return [title];
  }
  if (explanation) {
    return [explanation];
  }
  const draft = compactText(plan.athleteMessageDraft);
  return draft ? [draft] : [formatPlanFocusFallbackLine(mode)];
}

function formatPlanFocusFallbackLine(mode: NutritionPlanTargetWeekMode): string {
  return mode === "current_week"
    ? "Фокус на эту неделю не сформирован."
    : "Фокус на следующую неделю не сформирован.";
}

function getNextWeekPlan(plan: NutritionWeeklyPlan): NutritionNextWeekPlan | null {
  const planSummary = asObject(plan.planSummary);
  const nextWeekPlan = asObject(planSummary.next_week_plan);
  if (!nextWeekPlan || Object.keys(nextWeekPlan).length === 0) {
    return null;
  }
  const formulaVersion = typeof nextWeekPlan.formula_version === "string" ? nextWeekPlan.formula_version : null;
  const days = Array.isArray(nextWeekPlan.days) ? nextWeekPlan.days : null;
  if (formulaVersion !== "nutrition_next_week_plan_v1" || !days) {
    return null;
  }
  return nextWeekPlan as unknown as NutritionNextWeekPlan;
}

const KNOWN_LATIN_FIRST_NAMES_RU: Record<string, string> = {
  nadezhda: "Надя",
  anastasia: "Анастасия",
  kristina: "Кристина",
  anna: "Анна",
};

const LATIN_SURNAME_ONLY_TOKENS = new Set(["polyakova", "ponomareva"]);

function isCyrillicToken(token: string): boolean {
  return /[а-яё]/i.test(token);
}

function isLatinSurnameOnlyToken(token: string): boolean {
  const lower = token.toLocaleLowerCase("en");
  if (LATIN_SURNAME_ONLY_TOKENS.has(lower)) {
    return true;
  }
  return /^[A-Z][a-z]+(?:ova|eva|skaya|sky|ich|enko|uk)$/i.test(token);
}

export function formatNutritionAthleteGreetingName(student: {
  studentName?: string | null;
  profilePreferences?: Record<string, unknown> | null;
}): string {
  const preferences = asObject(student.profilePreferences);
  const explicit =
    compactText(typeof preferences.preferredNameRu === "string" ? preferences.preferredNameRu : null) ??
    compactText(typeof preferences.preferred_name_ru === "string" ? preferences.preferred_name_ru : null) ??
    compactText(typeof preferences.displayNameRu === "string" ? preferences.displayNameRu : null) ??
    compactText(typeof preferences.display_name_ru === "string" ? preferences.display_name_ru : null) ??
    compactText(typeof preferences.firstNameRu === "string" ? preferences.firstNameRu : null) ??
    compactText(typeof preferences.first_name_ru === "string" ? preferences.first_name_ru : null) ??
    compactText(typeof preferences.preferred_name === "string" ? preferences.preferred_name : null) ??
    compactText(typeof preferences.preferredName === "string" ? preferences.preferredName : null) ??
    compactText(typeof preferences.display_name === "string" ? preferences.display_name : null) ??
    compactText(typeof preferences.displayName === "string" ? preferences.displayName : null);
  if (explicit) {
    return explicit;
  }

  const rawName = compactText(student.studentName);
  if (!rawName) {
    return "";
  }

  const tokens = rawName.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }

  if (tokens.some(isCyrillicToken)) {
    const cyrillicTokens = tokens.filter(isCyrillicToken);
    if (cyrillicTokens.length >= 2 && /^[А-ЯЁ][а-яё]+(?:ов|ова|ев|ева|ин|ина|ский|ская)$/u.test(cyrillicTokens[0])) {
      return cyrillicTokens[1];
    }
    return cyrillicTokens[0];
  }

  if (tokens.length >= 2) {
    const first = tokens[0];
    const second = tokens[1];
    if (isLatinSurnameOnlyToken(first)) {
      const mapped = KNOWN_LATIN_FIRST_NAMES_RU[second.toLocaleLowerCase("en")] ?? second;
      return isLatinSurnameOnlyToken(mapped) ? "" : mapped;
    }
    const mapped = KNOWN_LATIN_FIRST_NAMES_RU[first.toLocaleLowerCase("en")] ?? first;
    return isLatinSurnameOnlyToken(mapped) ? "" : mapped;
  }

  const single = tokens[0];
  if (isLatinSurnameOnlyToken(single)) {
    return "";
  }
  return KNOWN_LATIN_FIRST_NAMES_RU[single.toLocaleLowerCase("en")] ?? single;
}

export function getNutritionAthleteDisplayName(student: {
  studentName?: string | null;
  profilePreferences?: Record<string, unknown> | null;
}): string {
  return formatNutritionAthleteGreetingName(student);
}

function extractReviewDoNotSendReasons(review: NutritionWeeklyAnalysis): string[] {
  const summary = asObject(review.nutritionSummary);
  const safety = asObject(review.safetyFlags);
  const fromSummary = asStringArray(summary.do_not_send_reasons);
  const fromSafety = asStringArray(safety.do_not_send_reasons);
  const hard = asStringArray(safety.hard_flags).map((flag) => `manual_review_required:${flag}`);
  return [...new Set([...fromSummary, ...fromSafety, ...hard].map((item) => item.trim()).filter(Boolean))];
}

function extractPlanDoNotSendReasons(plan: NutritionWeeklyPlan): string[] {
  const planSummary = asObject(plan.planSummary);
  const safety = asObject(plan.safetyFlags);
  const fromSummary = asStringArray(planSummary.do_not_send_reasons);
  const fromSafety = asStringArray(safety.do_not_send_reasons).concat(asStringArray(safety.doNotSendReasons));
  const hard = asStringArray(safety.hard_flags).map((flag) => `manual_review_required:${flag}`);
  return [...new Set([...fromSummary, ...fromSafety, ...hard].map((item) => item.trim()).filter(Boolean))];
}

function hasPreviousWeeksContext(review: NutritionWeeklyAnalysis): boolean {
  const summary = asObject(review.nutritionSummary);
  const internalSummary = asObject(review.internalSummary);
  const contextSnapshot = asObject(review.contextSnapshot);
  const candidates = [
    summary.previous_weeks_context,
    summary.previousWeeksContext,
    internalSummary.previous_weeks_context,
    internalSummary.previousWeeksContext,
    contextSnapshot.previous_weeks_context,
    contextSnapshot.previousWeeksContext,
  ];
  return candidates.some((candidate) => {
    if (Array.isArray(candidate)) {
      return candidate.length > 0;
    }
    const objectCandidate = asObject(candidate);
    return Object.keys(objectCandidate).length > 0;
  });
}

function hasTargetWeekTrainingContext(nextWeekPlan: NutritionNextWeekPlan | null, plan: NutritionWeeklyPlan): boolean {
  if (nextWeekPlan?.summary.has_training_context === true) {
    return true;
  }
  if (nextWeekPlan?.days.some((day) => day.flags?.has_training_context === true || day.source === "tp_workout")) {
    return true;
  }
  const snapshot = asObject(plan.trainingContextSnapshot);
  const workoutCount = toFiniteNumber(snapshot.workoutCount) ?? toFiniteNumber(snapshot.totalSessions);
  if (workoutCount != null && workoutCount > 0) {
    return true;
  }
  const workouts = snapshot.workouts;
  return Array.isArray(workouts) && workouts.length > 0;
}

// Safety signals (very-low kcal/carb/weight, рпп/medical notes) are ADVISORY now
// (coach decision) — they must never hide the athlete text. These derive into
// "manual_review_required:<flag>" reasons; we ignore them when deciding to block.
// This also unblocks PRE-POLICY stored rows (status blocked_safety / safety.blocked /
// baked manual_review_required reasons) WITHOUT a regeneration. Block only on a
// genuine non-safety do-not-send reason the model itself emitted.
function isSafetyDerivedReason(reason: string): boolean {
  // manual_review_required:* — advisory safety signals (never hide text, coach decision).
  // data_quality:* — anomalous-input advisories (suspect kcal/macros). Igor decision: a
  // broken-input day must NOT block the review — it is flagged to the coach here and
  // surfaced softly to the athlete in the day prose, but the text still assembles. Only a
  // genuine, model-emitted non-prefixed do-not-send reason blocks (safety escape-hatch).
  const trimmed = reason.trim();
  return trimmed.startsWith("manual_review_required:") || trimmed.startsWith("data_quality:");
}

function isReviewBlockedSafety(review: NutritionWeeklyAnalysis): boolean {
  return extractReviewDoNotSendReasons(review).some((reason) => !isSafetyDerivedReason(reason));
}

/** The model failed to generate this review — it must not be sent, only regenerated. */
function isReviewAwaitingGeneration(review: NutritionWeeklyAnalysis): boolean {
  if (review.status === "awaiting_generation") {
    return true;
  }
  return asObject(review.nutritionSummary).generation_mode === "awaiting_generation";
}

function isPlanBlockedSafety(plan: NutritionWeeklyPlan): boolean {
  // Same policy as the review: ignore the legacy blocked_safety status, the stored
  // safety.blocked flag, and the safety-derived manual_review_required:* reasons —
  // none of them hide the plan anymore. Block only on a genuine non-safety reason.
  return extractPlanDoNotSendReasons(plan).some((reason) => !isSafetyDerivedReason(reason));
}

function hasNeedsReviewStatus(review: NutritionWeeklyAnalysis, plan: NutritionWeeklyPlan): boolean {
  return review.status === "needs_review" || plan.status === "needs_review";
}

export function buildDerivedNutritionCombinedMessage(input: {
  review: NutritionWeeklyAnalysis | null;
  plan: NutritionWeeklyPlan | null;
  formality: TrainingPeaksTelegramFormality;
  studentName: string;
  profilePreferences?: Record<string, unknown> | null;
  planWeekMode?: NutritionPlanTargetWeekMode;
}): NutritionCombinedMessageResult {
  if (!input.review) {
    return {
      status: "missing_review",
      athleteMessageDraft: null,
      athleteMessageDraftParts: [],
      renderResult: emptyRenderResult(),
      warnings: [],
      sourceReviewId: null,
      sourcePlanId: input.plan?.id ?? null,
    };
  }
  // The model failed to generate this review — never assemble a sendable text;
  // the coach must regenerate (master order Task 3, Igor decision #3).
  if (isReviewAwaitingGeneration(input.review)) {
    return {
      status: "awaiting_generation",
      athleteMessageDraft: null,
      athleteMessageDraftParts: [],
      renderResult: emptyRenderResult(),
      warnings: [],
      sourceReviewId: input.review.id,
      sourcePlanId: input.plan?.id ?? null,
    };
  }
  if (!input.plan) {
    return {
      status: "missing_plan",
      athleteMessageDraft: null,
      athleteMessageDraftParts: [],
      renderResult: emptyRenderResult(),
      warnings: [],
      sourceReviewId: input.review.id,
      sourcePlanId: null,
    };
  }

  // Second chokepoint: the week-summary line and the warm opening are read straight off the
  // summary below, not through buildDailyFactsEntries — so the coach overlay is applied to the
  // WHOLE message, not only the day cards. Idempotent: the nested day builder re-applies it.
  const review = applyNutritionCoachEdits(input.review);
  const plan = input.plan;
  const planWeekMode = input.planWeekMode ?? "next_week";
  const blocked = isReviewBlockedSafety(review) || isPlanBlockedSafety(plan);
  const warnings: string[] = [];
  const nextWeekPlan = getNextWeekPlan(plan);
  const reviewDailyLines = getDailyFactsLines(review);
  const adjacentMissingLines = buildAdjacentMissingNutritionLines(review);
  const reviewDailyCoverage = getDailyFactsCoverage(review);

  if (!nextWeekPlan) {
    warnings.push("У этого фокуса нет canonical next_week_plan — пересоздайте фокус.");
  }
  if (reviewDailyCoverage.hasOutsideWeekFacts) {
    warnings.push("Даты daily_analysis не попадают в выбранную неделю обзора — проверьте отчёт/неделю и перегенерируйте обзор.");
  } else if (reviewDailyLines.length === 0) {
    warnings.push("В обзоре нет canonical daily_analysis — использован fallback из текста обзора.");
  }
  // Report the swap the render just made. Straight from the gate, so it says what the athlete will
  // actually get — not what a second run of the validator on the raw day guesses she will get.
  //
  // A WARNING, deliberately, and not a coachReviewNote: notes flip the message to needs_review
  // (see below), and a day on the dry deterministic comment is still correct, sendable text. The
  // coach must be TOLD, not BLOCKED.
  for (const rejection of getNutritionDayProseRejections(review)) {
    const label = rejection.date ? formatDateRu(rejection.date) : "?";
    warnings.push(
      `День ${label}: проза отклонена при рендере (${rejection.rules.join(", ")}) — ученице уйдёт сухой комментарий, а не текст из редактора.`
    );
  }

  if (blocked) {
    return {
      status: "blocked_safety",
      athleteMessageDraft: null,
      athleteMessageDraftParts: [],
      renderResult: emptyRenderResult(),
      warnings,
      sourceReviewId: review.id,
      sourcePlanId: plan.id,
    };
  }

  const athleteName = getNutritionAthleteDisplayName({
    studentName: input.studentName,
    profilePreferences: input.profilePreferences ?? null,
  });
  const summary = asObject(review.nutritionSummary);
  const avgKcal = toFiniteNumber(summary.avg_kcal);
  const restKcal = nextWeekPlan?.day_type_targets.rest?.target_kcal ?? null;
  const previousWeeksContext = hasPreviousWeeksContext(review);
  const comparisonLine =
    previousWeeksContext && avgKcal != null && restKcal != null
      ? `По сравнению с прошлой неделей держим более ровную базу: среднее за неделю ${formatNutritionAthleteKcal(avgKcal, { mode: "actual" })}, ориентир для дня отдыха ${formatNutritionAthleteKcal(restKcal, { mode: "target" })}.`
      : null;
  const weekSummary = getReviewWeekSummaryLine(review);
  // Block 3: warm opening line derived from the athlete's own words. Qualitative
  // only; the generator already digit-guards it, and we re-guard here defensively.
  const openingNoteRaw = compactText(typeof summary.athlete_opening_note_ru === "string" ? summary.athlete_opening_note_ru : null);
  const athleteOpeningNote = openingNoteRaw && !/\d/.test(openingNoteRaw) ? openingNoteRaw : null;
  const todayLocalDate = getNutritionAdminLocalDate();
  const focusLines = getPlanFocusLines(plan, planWeekMode, nextWeekPlan, {
    todayLocalDate,
    miniTableMode: "athlete_remaining_only",
  });
  const renderResult = renderNutritionTelegramMessage({
    formality: input.formality,
    athleteName,
    planWeekMode,
    interpretation: {
      dayComments:
        reviewDailyLines.length > 0
          ? [...adjacentMissingLines, ...reviewDailyLines]
          : reviewDailyCoverage.hasOutsideWeekFacts
            ? [
                "Разбор по дням в этом черновике не показываю: даты в daily_analysis не совпадают с выбранной неделей. Проверь отчёт за нужную неделю и перегенерируй обзор.",
              ]
            : adjacentMissingLines,
      weekSummaryRu: weekSummary,
      focusLinesRu: focusLines,
      weekComparisonLineRu: comparisonLine,
      athleteOpeningNoteRu: athleteOpeningNote,
    },
    nextWeekPlan,
    fallbackPlanLines: [compactText(plan.athleteMessageDraft) ?? "План на неделю не сформирован."],
    hasPreviousWeeksContext: previousWeeksContext,
    hasTargetWeekTrainingContext: hasTargetWeekTrainingContext(nextWeekPlan, plan),
    todayLocalDate,
    miniTableMode: "athlete_remaining_only",
  });
  const athleteMessageDraft = renderResult.ok ? renderResult.text : null;
  // Task 10d: SOFT coach-review notes surface as warnings and flip the status to
  // needs_review (text still ships); only a HARD clinical block (ok=false) withholds.
  const combinedWarnings = [...warnings, ...renderResult.coachReviewNotes];
  const needsReview =
    !renderResult.ok || renderResult.coachReviewNotes.length > 0 || hasNeedsReviewStatus(review, plan);
  return {
    status: needsReview ? "needs_review" : "ready",
    athleteMessageDraft,
    athleteMessageDraftParts: renderResult.ok ? renderResult.parts : [],
    renderResult,
    warnings: combinedWarnings,
    sourceReviewId: review.id,
    sourcePlanId: plan.id,
  };
}
