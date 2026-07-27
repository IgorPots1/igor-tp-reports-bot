import { formatNutritionAthleteReportSignalCategory } from "@/features/nutrition/admin-labels";
import type { NutritionAthleteReportSignal } from "@/features/nutrition/athlete-signals";
import {
  resolveNutritionNarrativePreferencesFromStored,
  sanitizeNutritionFoodItems,
  type NutritionFatFeedbackPolicy,
  type NutritionNarrativeFocusPriority,
} from "@/features/nutrition/context";
import { isNutritionLongRunWorkout } from "@/features/nutrition/long-run";
import {
  buildNutritionWeeklySummary,
  EVENING_SECTIONS,
  isNutritionDayJudgeable,
  formatNutritionWorkoutLabelForCoach,
  isCombinedLoadLabel,
  pickNotableFoods,
  readLoadDayCarbsDeltaG,
  reconcileNarrativeRoleWithCarbLoadBasis,
  resolveNutritionNarrativeWorkoutRole,
  resolveWeekNarrativeDayRoles,
  type NutritionWeeklySummaryDayFact,
} from "@/features/nutrition/narrative-composer";
import type { NutritionFoodItem } from "@/features/nutrition/context";
import type { NutritionPageConsistencyIssue } from "@/features/nutrition/page-consistency";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";

type CanonicalDailyFact = {
  date?: string;
  training_type?: string;
  trainingType?: string;
  training_label?: string;
  trainingLabel?: string;
  nutrition_status?: string | null;
  nutritionStatus?: string | null;
  relevance?: string | null;
  findings?: unknown;
  macro_guardrails?: unknown;
  macroGuardrails?: unknown;
  items?: NutritionFoodItem[];
  canonical_daily_analysis?: Record<string, unknown>;
  canonicalDailyAnalysis?: Record<string, unknown>;
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

function extractMacroGuardrailStatuses(macroGuardrails: unknown): {
  proteinStatus: string | null;
  fatStatus: string | null;
  fatPercentStatus: string | null;
  fatG: number | null;
  fatPercentEnergy: number | null;
  carbsStatus: string | null;
  carbsG: number | null;
  carbsGPerKg: number | null;
  carbsLoadBasis: string | null;
} {
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
    carbsLoadBasis: typeof carbsGuard.loadBasis === "string" ? carbsGuard.loadBasis : null,
  };
}

const WEEKDAY_SHORT_RU: Record<number, string> = {
  0: "вс",
  1: "пн",
  2: "вт",
  3: "ср",
  4: "чт",
  5: "пт",
  6: "сб",
};

function formatWeekdayShortRu(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return WEEKDAY_SHORT_RU[date.getUTCDay()] ?? isoDate;
}

type HighFatCoachDayObservation = {
  date: string;
  weekdayShort: string;
  fatG: number | null;
  fatPercentEnergy: number | null;
  mayDisplaceCarbs: boolean;
  eveningFatFoods: string[];
};

function collectHighFatCoachObservations(days: NutritionWeeklySummaryDayFact[], findingsByDate: Map<string, string[]>): HighFatCoachDayObservation[] {
  const observations: HighFatCoachDayObservation[] = [];
  for (const day of days) {
    const isHigh = day.macro.fatStatus === "high" || day.macro.fatPercentStatus === "high";
    if (!isHigh) {
      continue;
    }
    const findings = findingsByDate.get(day.date) ?? [];
    observations.push({
      date: day.date,
      weekdayShort: formatWeekdayShortRu(day.date),
      fatG: day.macro.fatG ?? null,
      fatPercentEnergy: day.macro.fatPercentEnergy ?? null,
      mayDisplaceCarbs: findings.includes("high_fat_may_displace_carbs_on_load_day"),
      eveningFatFoods: pickNotableFoods(day.items, "fatG", { sections: EVENING_SECTIONS, limit: 3 }),
    });
  }
  return observations;
}

function buildHighFatCoachVisibilityLine(input: {
  observations: HighFatCoachDayObservation[];
  fatFeedbackPolicy: NutritionFatFeedbackPolicy;
}): string | null {
  if (input.observations.length === 0) {
    return null;
  }
  const dayLabels = input.observations.map((item) => item.weekdayShort).join("/");
  const detailParts = input.observations.map((item) => {
    const grams = item.fatG != null ? `${Math.round(item.fatG)} г` : "н/д";
    const percent = item.fatPercentEnergy != null ? `${item.fatPercentEnergy.toFixed(0)}%` : "н/д";
    return `${item.weekdayShort}: ${grams}, ${percent} энергии из жиров`;
  });
  const policyNote =
    input.fatFeedbackPolicy === "normal"
      ? "High-fat feedback разрешён athlete-facing."
      : `Athlete-facing скрыто по политике ${input.fatFeedbackPolicy}.`;
  const displacementNote = input.observations.some((item) => item.mayDisplaceCarbs)
    ? " Может смещать углеводы в дни нагрузки."
    : "";
  // Coach-only: notable evening fat sources (factual product names, no judgement).
  const eveningFoods = [
    ...new Set(input.observations.flatMap((item) => item.eveningFatFoods)),
  ].slice(0, 4);
  const notableFoodsNote =
    eveningFoods.length > 0 ? ` Заметные источники вечером: ${eveningFoods.join(", ")}.` : "";
  return `Жиры: высокий процент энергии из жиров (${dayLabels}). ${detailParts.join("; ")}. ${policyNote}${displacementNote}${notableFoodsNote}`;
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

function normalizeStoredDailyFactItem(raw: unknown): CanonicalDailyFact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const embedded = asObject(item.canonicalDailyAnalysis ?? item.canonical_daily_analysis);
  const source = Object.keys(embedded).length > 0 ? embedded : item;
  const date = typeof source.date === "string" ? source.date : typeof item.date === "string" ? item.date : null;
  if (!date) {
    return null;
  }
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
  const items = sanitizeNutritionFoodItems(
    embedded.items ?? embedded.food_items ?? item.items ?? item.food_items
  );
  return {
    date,
    training_type: trainingType,
    training_label: trainingLabel,
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
    macro_guardrails:
      source.macroGuardrails ??
      source.macro_guardrails ??
      item.macroGuardrails ??
      item.macro_guardrails ??
      embedded.macroGuardrails ??
      embedded.macro_guardrails,
    ...(Object.keys(embedded).length > 0
      ? { canonical_daily_analysis: embedded, canonicalDailyAnalysis: embedded }
      : {}),
    ...(items.length > 0 ? { items } : {}),
  };
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

function filterFactsToReviewWeek(review: NutritionWeeklyAnalysis, facts: CanonicalDailyFact[]): CanonicalDailyFact[] {
  return facts.filter((fact) => {
    const date = typeof fact.date === "string" ? fact.date : "";
    return date >= review.weekFrom && date <= review.weekTo;
  });
}

function asAthleteReportSignals(value: unknown): NutritionAthleteReportSignal[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowedCategories = new Set(["fatigue", "gi", "illness", "cycle", "injury", "psych"]);
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const row = item as Record<string, unknown>;
    const category = typeof row.category === "string" ? row.category : "";
    const evidence = typeof row.evidence === "string" ? row.evidence : "";
    const keyword = typeof row.keyword === "string" ? row.keyword : "";
    const severity = row.severity === "coach_review" || row.severity === "info" ? row.severity : null;
    if (!allowedCategories.has(category) || !evidence || !keyword || !severity) {
      return [];
    }
    return [
      {
        category: category as NutritionAthleteReportSignal["category"],
        evidence,
        keyword,
        severity,
      },
    ];
  });
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
  const fromSafety = asStringArray(safety.do_not_send_reasons);
  const hard = asStringArray(safety.hard_flags).map((flag) => `manual_review_required:${flag}`);
  return [...new Set([...fromSummary, ...fromSafety, ...hard].map((item) => item.trim()).filter(Boolean))];
}

function buildWeeklySummaryDays(review: NutritionWeeklyAnalysis): NutritionWeeklySummaryDayFact[] {
  const dailyFacts = filterFactsToReviewWeek(review, getCanonicalDailyFacts(review));
  const roleInputs = dailyFacts.map((day) => {
    const date = typeof day.date === "string" ? day.date : "";
    const trainingType =
      typeof day.training_type === "string" ? day.training_type : typeof day.trainingType === "string" ? day.trainingType : "unknown";
    const trainingLabel =
      typeof day.training_label === "string" ? day.training_label : typeof day.trainingLabel === "string" ? day.trainingLabel : "день недели";
    return { date, trainingType, trainingLabel, mode: "past_review" as const, isCompleted: true };
  });
  const weekRoles = resolveWeekNarrativeDayRoles(roleInputs);

  return dailyFacts.map((day) => {
    const date = typeof day.date === "string" ? day.date : "";
    const trainingType =
      typeof day.training_type === "string" ? day.training_type : typeof day.trainingType === "string" ? day.trainingType : "unknown";
    const trainingLabel =
      typeof day.training_label === "string" ? day.training_label : typeof day.trainingLabel === "string" ? day.trainingLabel : "день недели";
    const nutritionStatus =
      typeof day.nutrition_status === "string" ? day.nutrition_status : typeof day.nutritionStatus === "string" ? day.nutritionStatus : null;
    const relevance =
      typeof day.relevance === "string" ? day.relevance : null;
    const findings = asStringArray(day.findings);
    const macroRaw = extractMacroGuardrailStatuses(day.macro_guardrails ?? day.macroGuardrails);
    const embedded = asObject(day.canonical_daily_analysis ?? day.canonicalDailyAnalysis);
    const actual = asObject(embedded.actual);
    const macro = {
      proteinStatus: macroRaw.proteinStatus,
      fatStatus: macroRaw.fatStatus,
      fatPercentStatus: macroRaw.fatPercentStatus,
      fatG: macroRaw.fatG,
      fatPercentEnergy: macroRaw.fatPercentEnergy,
      carbsStatus: macroRaw.carbsStatus,
      carbsG:
        macroRaw.carbsG ??
        toFiniteNumber((day as Record<string, unknown>).carbs_g) ??
        toFiniteNumber(actual.carbsG) ??
        toFiniteNumber(actual.carbs_g),
      carbsGPerKg:
        macroRaw.carbsGPerKg ??
        toFiniteNumber((day as Record<string, unknown>).carbs_g_per_kg) ??
        toFiniteNumber(actual.carbsGPerKg) ??
        toFiniteNumber(actual.carbs_g_per_kg),
    };
    const roleInfo = reconcileNarrativeRoleWithCarbLoadBasis(
      weekRoles.get(date) ?? {
        role: resolveNutritionNarrativeWorkoutRole({ trainingType, trainingLabel, mode: "past_review", isCompleted: true }).role,
        isKey: false,
        reason: "fallback",
      },
      macroRaw.carbsLoadBasis
    );
    const items = sanitizeNutritionFoodItems(
      day.items ?? embedded.items ?? embedded.food_items
    );
    return {
      date,
      trainingType,
      trainingLabel,
      nutritionStatus,
      relevance,
      findings,
      macro,
      hasEnergyIssue: hasDayEnergyIssue({ nutritionStatus, findings }),
      roleInfo,
      ...(items.length > 0 ? { items } : {}),
    };
  });
}

function formatCoachWorkoutLine(prefix: string, label: string, date: string): string {
  const lower = label.toLocaleLowerCase("ru");
  if (
    prefix === "Длительная" &&
    (lower.startsWith("длительн") || lower.startsWith("бег") || lower.startsWith("вело") || lower.startsWith("лёгк"))
  ) {
    return `${label} (${date}).`;
  }
  return `${prefix}: ${label} (${date}).`;
}

function buildKeyWorkoutLines(days: NutritionWeeklySummaryDayFact[]): string[] {
  const lines: string[] = [];
  // Наряд 2.3: список ключевых тренировок недели не тянет suspect-дни — он стоит рядом
  // с недельным итогом, и день с нераспознанным дневником в нём читается как разобранный.
  for (const day of days.filter((item) => isNutritionDayJudgeable(item))) {
    const label = formatNutritionWorkoutLabelForCoach({
      trainingLabel: day.trainingLabel,
      trainingType: day.trainingType,
    });
    if (day.roleInfo.role === "long_run" || day.roleInfo.role === "long_endurance" || day.trainingType === "long_run" || day.trainingType === "long_endurance") {
      lines.push(formatCoachWorkoutLine("Длительная", label, day.date));
      continue;
    }
    if (day.roleInfo.role === "combined_load" || isCombinedLoadLabel(day.trainingLabel)) {
      lines.push(formatCoachWorkoutLine("Комбинированная нагрузка", label, day.date));
      continue;
    }
    if (day.roleInfo.isKey) {
      lines.push(formatCoachWorkoutLine("Ключевая тренировка", label, day.date));
    }
    if (
      isNutritionLongRunWorkout({
        title: day.trainingLabel,
        mode: "past_review",
        isCompleted: true,
      })
    ) {
      lines.push(formatCoachWorkoutLine("Long run по правилу", label, day.date));
    }
  }
  return [...new Set(lines)];
}

function isStaleManualReviewFocus(text: string): boolean {
  return /данных пока недостаточно|нужен ручной разбор/i.test(text);
}

function hasCanonicalMacroGuardrails(days: NutritionWeeklySummaryDayFact[]): boolean {
  return days.some((day) => day.macro.carbsStatus != null || day.macro.proteinStatus != null);
}

export function buildNutritionCanonicalCoachFocus(input: {
  days: NutritionWeeklySummaryDayFact[];
  dataQuality: Record<string, unknown>;
  storedFocus?: string | null;
  reviewBlocked?: boolean;
  hasDateMismatch?: boolean;
  focusPriority?: NutritionNarrativeFocusPriority[];
}): string | null {
  const parsedDays =
    toFiniteNumber(input.dataQuality.parsed_days) ?? toFiniteNumber(input.dataQuality.parsedDays) ?? input.days.length;
  const lowConfidenceDays =
    toFiniteNumber(input.dataQuality.low_confidence_days) ?? toFiniteNumber(input.dataQuality.lowConfidenceDays) ?? 0;
  const hasMacroGuardrails = hasCanonicalMacroGuardrails(input.days);
  const needsManualReview =
    input.reviewBlocked === true ||
    input.hasDateMismatch === true ||
    parsedDays < 4 ||
    !hasMacroGuardrails ||
    (lowConfidenceDays > 0 && parsedDays < 5);

  if (needsManualReview) {
    if (input.storedFocus && isStaleManualReviewFocus(input.storedFocus)) {
      return input.storedFocus;
    }
    return null;
  }

  if (input.storedFocus && !isStaleManualReviewFocus(input.storedFocus)) {
    return input.storedFocus;
  }

  const focusPriorities = input.focusPriority ?? ["carbs", "energy"];
  const emphasizeCarbsEnergy = focusPriorities.includes("carbs") || focusPriorities.includes("energy");
  if (!emphasizeCarbsEnergy) {
    return input.storedFocus ?? null;
  }

  const longLabels = input.days
    .filter((day) => day.roleInfo.role === "long_endurance" || day.roleInfo.role === "long_run")
    .map((day) => formatNutritionWorkoutLabelForCoach({ trainingLabel: day.trainingLabel, trainingType: day.trainingType }));
  const keyLabels = input.days
    .filter(
      (day) =>
        day.roleInfo.isKey &&
        day.roleInfo.role !== "long_endurance" &&
        day.roleInfo.role !== "long_run" &&
        day.roleInfo.role !== "combined_load"
    )
    .map((day) => formatNutritionWorkoutLabelForCoach({ trainingLabel: day.trainingLabel, trainingType: day.trainingType }));
  const combinedLabels = input.days
    .filter((day) => day.roleInfo.role === "combined_load")
    .map((day) => formatNutritionWorkoutLabelForCoach({ trainingLabel: day.trainingLabel, trainingType: day.trainingType }));

  const details: string[] = [];
  const longVelo = longLabels.find((label) => label.startsWith("вело"));
  const longRun = longLabels.find((label) => /бег|длительн/i.test(label));
  if (longVelo) {
    details.push(`перед/после ${longVelo}`);
  }
  if (longRun) {
    details.push("перед беговой работой");
  }
  if (keyLabels[0]) {
    details.push(`перед ${keyLabels[0]}`);
  } else if (combinedLabels[0]) {
    details.push(`вокруг ${combinedLabels[0]}`);
  }

  let focus = "углеводы и энергия вокруг длинных нагрузок";
  if (details.length > 0) {
    focus += `, особенно ${details.join(" и ")}`;
  }
  return focus;
}

function buildMacroPatternLine(summary: Record<string, unknown>): string | null {
  const avgKcal = toFiniteNumber(summary.avg_kcal) ?? toFiniteNumber(summary.avgKcal);
  const avgProtein = toFiniteNumber(summary.avg_protein_g) ?? toFiniteNumber(summary.avgProteinG);
  const avgFat = toFiniteNumber(summary.avg_fat_g) ?? toFiniteNumber(summary.avgFatG);
  const avgCarbs = toFiniteNumber(summary.avg_carbs_g) ?? toFiniteNumber(summary.avgCarbsG);
  const avgProteinGPerKg = toFiniteNumber(summary.avg_protein_g_per_kg) ?? toFiniteNumber(summary.avgProteinGPerKg);
  const parts: string[] = [];
  if (avgKcal != null) {
    parts.push(`~${Math.round(avgKcal)} ккал`);
  }
  if (avgProtein != null) {
    parts.push(`белок ~${Math.round(avgProtein)} г`);
  }
  if (avgFat != null) {
    parts.push(`жиры ~${Math.round(avgFat)} г`);
  }
  if (avgCarbs != null) {
    parts.push(`углеводы ~${Math.round(avgCarbs)} г`);
  }
  if (parts.length === 0) {
    return null;
  }
  const proteinNote =
    avgProteinGPerKg != null && avgProteinGPerKg >= 1.5 ? " · белок по неделе ближе к норме" : "";
  return `Средние макросы: ${parts.join(", ")}${proteinNote}.`;
}

function buildDataQualityLine(summary: Record<string, unknown>): string {
  const dataQuality = asObject(summary.data_quality_summary);
  const parsedDays = toFiniteNumber(dataQuality.parsed_days) ?? toFiniteNumber(dataQuality.parsedDays);
  const lowConfidenceDays =
    toFiniteNumber(dataQuality.low_confidence_days) ?? toFiniteNumber(dataQuality.lowConfidenceDays);
  if (parsedDays == null && lowConfidenceDays == null) {
    return "Качество данных: сводка по каноническим дням недели.";
  }
  const parsedText = parsedDays != null ? `${parsedDays} дн.` : "—";
  const lowText = lowConfidenceDays != null ? `${lowConfidenceDays} с низкой уверенностью` : "—";
  return `Качество данных: ${parsedText}, ${lowText}.`;
}

function buildWarningLines(input: {
  review: NutritionWeeklyAnalysis;
  plan?: NutritionWeeklyPlan | null;
  consistencyIssues?: NutritionPageConsistencyIssue[];
}): string[] {
  const warnings: string[] = [];
  const summary = asObject(input.review.nutritionSummary);
  const generationMode = typeof summary.generation_mode === "string" ? summary.generation_mode : "fallback";
  if (generationMode === "fallback" || generationMode === "template") {
    warnings.push("Обзор создан в шаблонном режиме — проверьте вручную или перегенерируйте.");
  }

  const athleteSignals = asAthleteReportSignals(summary.athlete_report_signals);
  const coachReviewSignals = athleteSignals.filter((signal) => signal.severity === "coach_review");
  if (coachReviewSignals.length > 0) {
    warnings.push(
      `Сигналы из комментария ученика: ${coachReviewSignals
        .map((signal) => formatNutritionAthleteReportSignalCategory(signal.category))
        .join(", ")}.`
    );
  }

  for (const issue of input.consistencyIssues ?? []) {
    if (issue.severity === "info") {
      continue;
    }
    if (
      issue.code === "report_date_mismatch" ||
      issue.code === "daily_dates_mismatch" ||
      issue.code === "report_date_ui_fallback" ||
      issue.code === "tp_daily_join_mismatch" ||
      issue.code === "review_stale_methodology" ||
      issue.code === "review_fallback_mode" ||
      issue.code === "plan_stale_methodology" ||
      issue.code === "selected_plan_wrong_week" ||
      issue.code === "missing_target_plan"
    ) {
      warnings.push(issue.message);
    }
  }

  const reviewReasons = extractReviewDoNotSendReasons(input.review);
  if (reviewReasons.length > 0) {
    warnings.push(`Безопасность обзора: ${reviewReasons.join("; ")}.`);
  }
  if (input.review.status === "blocked_safety") {
    warnings.push("Обзор заблокирован по безопасности.");
  }

  if (input.plan) {
    const planReasons = extractPlanDoNotSendReasons(input.plan);
    if (planReasons.length > 0) {
      warnings.push(`Безопасность фокуса: ${planReasons.join("; ")}.`);
    }
    if (input.plan.status === "blocked_safety") {
      warnings.push("Фокус заблокирован по безопасности.");
    }
  }

  return [...new Set(warnings.map((line) => line.trim()).filter(Boolean))];
}

/**
 * Заметки тренеру, сохранённые по дням разбора (coach_notes_ru). Старые разборы поля
 * не имеют — тогда пусто, и секция не появляется.
 */
function collectCoachDayNotes(summary: Record<string, unknown>): string[] {
  const days = Array.isArray(summary.daily_analysis) ? (summary.daily_analysis as Array<unknown>) : [];
  const notes: string[] = [];
  for (const rawDay of days) {
    const day = asObject(rawDay);
    for (const note of asStringArray(day.coach_notes_ru)) {
      if (!notes.includes(note)) {
        notes.push(note);
      }
    }
  }
  return notes;
}

export function buildDerivedNutritionCoachSummary(input: {
  review: NutritionWeeklyAnalysis;
  plan?: NutritionWeeklyPlan | null;
  consistencyIssues?: NutritionPageConsistencyIssue[];
}): string {
  const summary = asObject(input.review.nutritionSummary);
  const oneFocus = asObject(summary.one_focus);
  const oneFocusText = compactText(typeof oneFocus.statement_ru === "string" ? oneFocus.statement_ru : null);
  const methodologySignals = asObject(summary.methodology_signals);
  const proteinSufficient = methodologySignals.protein_sufficient === true;
  const weeklyProteinAvgGPerKg = toFiniteNumber(summary.avg_protein_g_per_kg) ?? toFiniteNumber(summary.avgProteinGPerKg);

  const summaryDays = buildWeeklySummaryDays(input.review);
  const narrativePreferences = resolveNutritionNarrativePreferencesFromStored({
    nutritionSummary: summary,
    contextSnapshot: asObject(input.review.contextSnapshot),
  });
  const findingsByDate = new Map<string, string[]>();
  for (const day of summaryDays) {
    findingsByDate.set(day.date, day.findings);
  }
  const highFatObservations = collectHighFatCoachObservations(summaryDays, findingsByDate);
  const sections: string[] = [];

  sections.push(buildDataQualityLine(summary));

  if (summaryDays.length > 0) {
    sections.push(
      buildNutritionWeeklySummary({
        days: summaryDays,
        proteinSufficient,
        weeklyProteinAvgGPerKg,
        fatFeedbackPolicy: narrativePreferences.fatFeedbackPolicy,
        weekSeed: input.review.weekFrom,
        loadDayCarbsDeltaG: readLoadDayCarbsDeltaG(input.review.nutritionSummary),
      })
    );
    const highFatLine = buildHighFatCoachVisibilityLine({
      observations: highFatObservations,
      fatFeedbackPolicy: narrativePreferences.fatFeedbackPolicy,
    });
    if (highFatLine) {
      sections.push(highFatLine);
    }
    const keyWorkoutLines = buildKeyWorkoutLines(summaryDays);
    if (keyWorkoutLines.length > 0) {
      sections.push(keyWorkoutLines.join(" "));
    }
  } else {
    sections.push(
      "Канонические дни недели не найдены — сводка ограничена. Перегенерируйте обзор или проверьте сохранённый текст в служебных черновиках."
    );
  }

  const macroLine = buildMacroPatternLine(summary);
  if (macroLine) {
    sections.push(macroLine);
  }

  const dataQuality = asObject(summary.data_quality_summary);
  const hasDateMismatch = (input.consistencyIssues ?? []).some(
    (issue) => issue.code === "report_date_mismatch" || issue.code === "daily_dates_mismatch"
  );
  const reviewBlocked =
    input.review.status === "blocked_safety" || extractReviewDoNotSendReasons(input.review).length > 0;
  const canonicalFocus = buildNutritionCanonicalCoachFocus({
    days: summaryDays,
    dataQuality,
    storedFocus: oneFocusText,
    reviewBlocked,
    hasDateMismatch,
    focusPriority: narrativePreferences.focusPriority,
  });
  if (canonicalFocus) {
    sections.push(`Фокус недели: ${canonicalFocus}`);
  } else if (oneFocusText) {
    sections.push(`Фокус недели: ${oneFocusText}`);
  }

  const trainingLinks = asStringArray(summary.training_nutrition_links);
  if (trainingLinks.length > 0) {
    sections.push(`Связки тренировка ↔ питание: ${trainingLinks.join(" · ")}`);
  }

  // Заметки тренеру по дням: сигналы, которые сознательно НЕ вынесены ученице
  // (сейчас — подавленный углеводный finding на pre_long у худеющей). Отдельная
  // секция, а не safety_flags.soft_flags: те в UI не рендерятся вовсе, а этот блок
  // виден в «Главный вывод для тренера» и собирается кодом, не моделью.
  const coachDayNotes = collectCoachDayNotes(summary);
  if (coachDayNotes.length > 0) {
    sections.push(`Заметки тренеру: ${coachDayNotes.join(" ")}`);
  }

  const warningLines = buildWarningLines(input);
  if (warningLines.length > 0) {
    sections.push(`Предупреждения: ${warningLines.join(" ")}`);
  }

  return sections.map((line) => line.trim()).filter(Boolean).join("\n\n");
}
