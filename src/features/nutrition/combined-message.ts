import type { NutritionPlanTargetWeekMode } from "@/features/nutrition/plan-week-policy";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import type { NutritionNextWeekPlan } from "@/features/nutrition/weekly-plan-formulas";
import {
  buildNutritionTargetWeekFocusNarrative,
  buildNutritionWeeklySummary,
  composeNutritionDayComment,
  humanizeNutritionTrainingLabel,
  NutritionNarrativeRepetitionState,
  resolveNutritionNarrativeWorkoutRole,
  resolveWeekNarrativeDayRoles,
  type MacroGuardrailStatuses,
} from "@/features/nutrition/narrative-composer";
import {
  renderNutritionTelegramMessage,
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
};

export type NutritionCombinedMessageResult = {
  status: "ready" | "missing_review" | "missing_plan" | "blocked_safety" | "needs_review";
  athleteMessageDraft: string | null;
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
    issues: [],
    charCount: 0,
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
  };
}

function extractMacroGuardrailStatuses(macroGuardrails: unknown): {
  proteinStatus: string | null;
  fatStatus: string | null;
  carbsStatus: string | null;
} {
  const guardrails = asObject(macroGuardrails);
  const proteinGuard = asObject(guardrails.protein);
  const fatGuard = asObject(guardrails.fat);
  const carbsGuard = asObject(guardrails.carbs);
  return {
    proteinStatus: typeof proteinGuard.status === "string" ? proteinGuard.status : null,
    fatStatus: typeof fatGuard.status === "string" ? fatGuard.status : null,
    carbsStatus: typeof carbsGuard.status === "string" ? carbsGuard.status : null,
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
  carbsStatus: string | null;
  trainingType: string;
  hasEnergyIssue: boolean;
}): string | null {
  const { proteinStatus, fatStatus, carbsStatus, trainingType, hasEnergyIssue } = input;
  const loadDay = trainingType !== "rest";

  if (hasEnergyIssue && proteinStatus === "ok" && loadDay && (carbsStatus === "low" || carbsStatus === "borderline")) {
    return "Белок закрыт, но общей энергии и углеводов всё равно маловато.";
  }

  const segments: string[] = [];
  if (loadDay && carbsStatus === "low") {
    segments.push("Углеводов для такой нагрузки маловато");
  } else if (loadDay && carbsStatus === "borderline") {
    segments.push("Углеводы на нижней границе");
  }

  const macroParts: string[] = [];
  if (proteinStatus === "borderline") {
    macroParts.push("белок близко к нижней границе");
  } else if (proteinStatus === "low") {
    macroParts.push("белка в этот день маловато");
  }
  if (fatStatus === "low") {
    macroParts.push("жиры низковаты");
  } else if (fatStatus === "borderline") {
    macroParts.push("жиры на нижней границе");
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
  return humanizeNutritionTrainingLabel(trainingLabel, trainingType);
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

function getDailyFactsLines(review: NutritionWeeklyAnalysis): string[] {
  const facts = getCanonicalDailyFacts(review);
  const reviewWeekFacts = filterFactsToReviewWeek(review, facts);
  if (reviewWeekFacts.length === 0) {
    return [];
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
      const carbsPerKg = toFiniteNumber(item.carbs_g_per_kg) ?? toFiniteNumber(actual.carbsGPerKg);
      const findings = asStringArray(item.findings);
      const nutritionStatus =
        typeof item.nutrition_status === "string"
          ? item.nutrition_status
          : typeof item.nutritionStatus === "string"
            ? item.nutritionStatus
            : null;
      const sourceQuality = asObject(item.source_quality) ?? asObject(item.sourceQuality);
      const macroGuardrails = asObject(item.macro_guardrails) ?? asObject(item.macroGuardrails);
      if (!weekday || !dateLabel || kcal == null || protein == null || fat == null || carbs == null) {
        return null;
      }
      const athleteTrainingLabel = resolveDailyTrainingLabelForAthlete(trainingType, trainingLabel);
      const macroStatuses: MacroGuardrailStatuses = extractMacroGuardrailStatuses(macroGuardrails);
      const dateKey = date ?? "";
      const resolvedRole = resolveNutritionNarrativeWorkoutRole({
        trainingType,
        trainingLabel,
        mode: "past_review",
        isCompleted: true,
      });
      const roleInfo = weekRoles.get(dateKey) ?? { ...resolvedRole, isKey: false };
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
          hasEnergyIssue: hasDayEnergyIssue({ nutritionStatus, findings }),
          roleInfo,
        },
        repetitionState
      );
      const carbsKgText = carbsPerKg != null ? ` (${formatNutritionAthletePerKg(carbsPerKg)})` : "";
      return `🔹 ${weekday} (${dateLabel}) · ${athleteTrainingLabel}
${formatNutritionAthleteKcal(kcal, { mode: "actual" })} · белок ${formatNutritionAthleteMacro(protein)} · жиры ${formatNutritionAthleteMacro(fat)} · углеводы ${formatNutritionAthleteMacro(carbs)}${carbsKgText}.
${comment}`;
    })
    .filter((line): line is string => Boolean(line));
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
    const macro = extractMacroGuardrailStatuses(day.macro_guardrails ?? day.macroGuardrails);
    const roleInfo = weekRoles.get(date) ?? {
      role: resolveNutritionNarrativeWorkoutRole({ trainingType, trainingLabel, mode: "past_review", isCompleted: true }).role,
      isKey: false,
      reason: "fallback",
    };
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
    });
  }
  if (typeof methodologySignals.main_load_day_label === "string" && methodologySignals.main_load_day_label.trim()) {
    return `Главный тренировочный день недели — ${methodologySignals.main_load_day_label}. Фокус — углеводы вокруг тяжёлых дней, а не просто «есть больше каждый день».`;
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
      return `🔹 ${formatDateRu(date)} · ${humanizeNutritionTrainingLabel(label, "cross_training")}
Питание за этот день не зафиксировано. Без данных конкретного макро-вывода не делаю, отмечаю только факт нагрузки.`;
    })
    .filter((line): line is string => Boolean(line));
}

function getPlanFocusLines(
  plan: NutritionWeeklyPlan,
  mode: NutritionPlanTargetWeekMode,
  nextWeekPlan: NutritionNextWeekPlan | null
): string[] {
  const narrativeFocus = buildNutritionTargetWeekFocusNarrative(nextWeekPlan, mode);
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

export function getNutritionAthleteDisplayName(student: { studentName?: string | null; profilePreferences?: Record<string, unknown> | null }): string {
  const preferences = asObject(student.profilePreferences);
  const preferred =
    compactText(typeof preferences.preferred_name === "string" ? preferences.preferred_name : null) ??
    compactText(typeof preferences.preferredName === "string" ? preferences.preferredName : null) ??
    compactText(typeof preferences.display_name === "string" ? preferences.display_name : null) ??
    compactText(typeof preferences.displayName === "string" ? preferences.displayName : null);
  if (preferred) {
    return preferred;
  }
  const rawName = compactText(student.studentName) ?? "Привет";
  const firstToken = rawName.split(/\s+/)[0] ?? rawName;
  const knownShortNames: Record<string, string> = {
    nadezhda: "Надя",
    надежда: "Надя",
  };
  return knownShortNames[firstToken.toLocaleLowerCase("ru")] ?? firstToken;
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

function isReviewBlockedSafety(review: NutritionWeeklyAnalysis): boolean {
  if (review.status === "blocked_safety") {
    return true;
  }
  return extractReviewDoNotSendReasons(review).length > 0;
}

function isPlanBlockedSafety(plan: NutritionWeeklyPlan): boolean {
  if (plan.status === "blocked_safety") {
    return true;
  }
  const reasons = extractPlanDoNotSendReasons(plan);
  const safety = asObject(plan.safetyFlags);
  const hardFlags = asStringArray(safety.hard_flags);
  const blocked = typeof safety.blocked === "boolean" ? safety.blocked : false;
  if (blocked || hardFlags.length > 0 || reasons.length > 0) {
    return true;
  }
  if (!plan.athleteMessageDraft && reasons.length > 0) {
    return true;
  }
  return false;
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
      renderResult: emptyRenderResult(),
      warnings: [],
      sourceReviewId: null,
      sourcePlanId: input.plan?.id ?? null,
    };
  }
  if (!input.plan) {
    return {
      status: "missing_plan",
      athleteMessageDraft: null,
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
  const focusLines = getPlanFocusLines(plan, planWeekMode, nextWeekPlan);
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
    },
    nextWeekPlan,
    fallbackPlanLines: [compactText(plan.athleteMessageDraft) ?? "План на неделю не сформирован."],
    hasPreviousWeeksContext: previousWeeksContext,
    hasTargetWeekTrainingContext: hasTargetWeekTrainingContext(nextWeekPlan, plan),
    todayLocalDate: getNutritionAdminLocalDate(),
    miniTableMode: "athlete_remaining_only",
  });
  const athleteMessageDraft = renderResult.ok ? renderResult.text : null;
  return {
    status: renderResult.ok && !hasNeedsReviewStatus(review, plan) ? "ready" : "needs_review",
    athleteMessageDraft,
    renderResult,
    warnings,
    sourceReviewId: review.id,
    sourcePlanId: plan.id,
  };
}
