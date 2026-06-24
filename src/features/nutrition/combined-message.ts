import type { NutritionPlanTargetWeekMode } from "@/features/nutrition/plan-week-policy";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import type { NutritionNextWeekPlan } from "@/features/nutrition/weekly-plan-formulas";
import {
  buildNutritionTargetWeekFocusNarrative,
  buildNutritionWeeklySummary,
  composeNutritionDayComment,
  formatNutritionWorkoutLabelForAthlete,
  NutritionNarrativeRepetitionState,
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
    target: source.target ?? item.target,
    // Task 10d (Bug 1): carry the goal "deficit line" through normalization so the
    // render-time validator allows its numbers and the goal-aware fallback can fire.
    goal_day_target: source.goal_day_target ?? item.goal_day_target,
    // Часть А: carry items_notable (with per-item carb_class) so the render-time
    // carb_quality_mismatch guard can see which foods are fast/neutral.
    items_notable: source.items_notable ?? item.items_notable,
  };
}

/**
 * Hybrid path guard (task 1): basic gate before model day prose may replace the
 * deterministic comment. Rigorous per-day number/status validation is layered on
 * top in the validator task. Returns the prose to use, or null to fall back.
 */
function resolveUsableNutritionDayProse(value: unknown, facts: NutritionDayProseFacts): string | null {
  if (typeof value !== "string") {
    return null;
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
    return null;
  }
  if (/\*\*|__|```/.test(prose)) {
    return null;
  }
  // Backstop (1b): if a raw key:value tech token still slipped through the strip,
  // reject the prose entirely → deterministic fallback.
  if (
    /TrainingPeaks|FatSecret|OpenAI|\bJSON\b|hint_for_comment|source_quality/.test(prose) ||
    /\b(?:adequacy|day_role|loadBasis|load_basis|fat_policy|fatFeedbackPolicy|nutrition_status)\s*[:=]/i.test(prose)
  ) {
    return null;
  }
  // Backstop: numbers must be facts of this day and a hard status must not be
  // softened. On any error fall back to the deterministic comment.
  const issues = validateNutritionDayProse({ prose, facts });
  if (issues.some((issue) => issue.severity === "error")) {
    return null;
  }
  return prose;
}

/**
 * Build the per-day prose facts (actual macros + code-owned plan target numbers)
 * from a canonical daily_analysis item. Single source of truth so the render-time
 * gate (resolveUsableNutritionDayProse) and the generation-time audit in
 * draft-generator validate model prose against identical facts.
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
  for (const value of [carbsGMin, carbsGMax, toFiniteNumber(targetObj.kcalMin), toFiniteNumber(targetObj.proteinGMin)]) {
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
  return {
    kcal,
    proteinG: protein,
    fatG: fat,
    carbsG: carbs,
    carbsGPerKg,
    proteinGPerKg,
    planTargetNumbers,
    previousWeekNumbers,
    nutritionStatus,
    findings,
    carbFastFoods,
  };
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

function hasDayEnergyIssue(input: {
  nutritionStatus: string | null;
  findings: string[];
}): boolean {
  return (
    input.nutritionStatus === "below_energy_availability" ||
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
    input.findings.includes("ea_red_screen") ||
    input.findings.includes("ea_amber_screen")
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
  isRest: boolean;
  isRun: boolean;
  isKey: boolean;
  isRace: boolean;
};

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

function buildDailyFactsEntries(review: NutritionWeeklyAnalysis): NutritionReviewDayEntry[] {
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
          ...dayFlags,
        };
      }
      // Hybrid: prefer validated model prose, otherwise the deterministic comment.
      // The fact line above is always code-owned and never replaced.
      // Facts come from the shared helper so this render-time gate and the
      // generation-time audit (draft-generator) validate against identical facts.
      const dayComment = resolveUsableNutritionDayProse(item.athlete_prose, buildNutritionDayProseFacts(item)) ?? comment;
      const numbersLine = `${formatNutritionAthleteKcal(kcal, { mode: "actual" })} · Б ${formatNutritionAthleteMacro(protein)} · Ж ${formatNutritionAthleteMacro(fat)} · У ${formatNutritionAthleteMacro(carbs)}`;
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
    return {
      date,
      trainingType,
      trainingLabel,
      nutritionStatus,
      findings,
      macro,
      hasEnergyIssue: hasDayEnergyIssue({ nutritionStatus, findings }),
      roleInfo,
    };
  });

  if (summaryDays.length > 0) {
    return buildNutritionWeeklySummary({
      days: summaryDays,
      proteinSufficient,
      weeklyProteinAvgGPerKg,
      fatFeedbackPolicy: narrativePreferences.fatFeedbackPolicy,
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
    const claudePlanLines = (compactText(plan.athleteMessageDraft) ? plan.athleteMessageDraft ?? "" : "")
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
  return reason.trim().startsWith("manual_review_required:");
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

  const review = input.review;
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
