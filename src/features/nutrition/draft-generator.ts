import {
  nutritionAthleteReportSignalsRequireCoachReview,
  type NutritionAthleteReportSignal,
} from "@/features/nutrition/athlete-signals";
import {
  buildNutritionSafetyFlags,
  nutritionContextNarrativePreferences,
  type NutritionFatFeedbackPolicy,
  type NutritionFoodItem,
  type NutritionMealSection,
  type NutritionNarrativePreferences,
  type NutritionStudentContext,
} from "@/features/nutrition/context";
import { buildNutritionDayProseFacts } from "@/features/nutrition/combined-message";
import { EVENING_SECTIONS, pickNotableFoods } from "@/features/nutrition/narrative-composer";
import { validateNutritionDayProse } from "@/features/nutrition/telegram-renderer";
import { enqueueOpenAiCall } from "@/features/nutrition/nutrition-generation-queue";
import {
  buildNutritionModelRequest,
  classifyAiError,
  extractNutritionFinishReason,
  extractNutritionModelId,
  extractNutritionModelText,
  extractNutritionModelUsage,
  resolveNutritionAiApiKey,
  resolveNutritionAiModel,
  resolveNutritionAiProvider,
} from "@/features/nutrition/nutrition-ai-provider";
import {
  buildNutritionMethodologyContext,
  NUTRITION_REVIEW_METHODOLOGY_VERSION,
  selectNutritionWeeklyFocus,
  type CarbProgressionStrategy,
} from "@/features/nutrition/methodology";
import {
  buildNutritionInterpretationShadowMetadata,
  generateNutritionWeeklyInterpretationShadow,
  type NutritionInterpretationShadowMetadata,
} from "@/features/nutrition/interpretation-generator";
import {
  buildNutritionVoiceFewShotDynamic,
  NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES,
  NUTRITION_VOICE_FEWSHOT_STABLE_LINES,
  NUTRITION_VOICE_STYLE_SPEC_LINES,
} from "@/features/nutrition/narrative-guardrails";

export { NUTRITION_REVIEW_METHODOLOGY_VERSION };
import { detectNutritionMacroReviewWeekMismatch } from "@/features/nutrition/report-date-coverage";
import { stableHash } from "@/features/nutrition/repository";
import type {
  TrainingPeaksStudentMemoryItem,
  TrainingPeaksStudentMemoryType,
  TrainingPeaksTelegramFormality,
} from "@/features/trainingpeaks/repository";
import { getTrainingPeaksReplyDraftFormalityInstruction } from "@/features/trainingpeaks/telegram-context";

const NUTRITION_REVIEW_PROMPT_VERSION = "nutrition-weekly-review-v3-ai";

export type GeneratedNutritionWeeklyAnalysis = {
  data_quality_summary: {
    parsed_days: number;
    low_confidence_days: number;
    quality_flags: string[];
  };
  safety_flags: {
    hard_flags: string[];
    soft_flags: string[];
    blocked: boolean;
  };
  internal_summary: {
    student: string;
    cache_status: {
      past_week: string;
      next_week: string;
    };
    notes: string[];
    one_focus_category: string;
    carb_progression_strategy: CarbProgressionStrategy;
  };
  nutrition_summary: {
    avg_kcal: number | null;
    avg_protein_g: number | null;
    avg_fat_g: number | null;
    avg_carbs_g: number | null;
    data_quality_summary?: {
      parsed_days: number;
      low_confidence_days: number;
      quality_flags: string[];
    };
    daily_analysis?: Array<Record<string, unknown>>;
    training_nutrition_links?: string[];
    one_focus?: {
      category: string;
      statement_ru: string;
      progression_strategy: CarbProgressionStrategy;
    };
    methodology_signals?: {
      protein_sufficient: boolean;
      carb_reference_band_used: true;
      carb_reference_not_prescriptive: true;
      long_run_fueling_instruction_detected: boolean;
      during_run_fuel_planned: boolean;
      adjacent_training_without_nutrition_days?: Array<{
        date: string;
        trainingLabel: string;
        durationMinutes: number | null;
      }>;
    };
    bodyweight_kg?: number | null;
    carb_progression_strategy?: CarbProgressionStrategy;
    coach_summary_text?: string;
    day_by_day_analysis_text?: string;
    generation_mode?: "ai" | "fallback" | "awaiting_generation";
    methodology_version?: string;
    prompt_version?: string;
    quality_notes?: string[];
    do_not_send_reasons?: string[];
    interpretation_shadow?: NutritionInterpretationShadowMetadata | null;
    narrative_preferences?: NutritionNarrativePreferences;
    coach_context_ru?: string | null;
  };
  tp_context_summary: {
    past_week_key_sessions: number;
    next_week_key_sessions: number;
    past_week_long_run: string | null;
    next_week_long_run: string | null;
  };
  past_week_findings: string[];
  next_week_targets: string[];
  main_focus: string;
  status: "draft_ready" | "needs_review" | "blocked_safety";
  daily_analysis: Array<Record<string, unknown>>;
  training_nutrition_links: string[];
  one_focus: {
    category: string;
    statement_ru: string;
    progression_strategy: CarbProgressionStrategy;
  };
  methodology_signals: {
    protein_sufficient: boolean;
    carb_reference_band_used: true;
    carb_reference_not_prescriptive: true;
    long_run_fueling_instruction_detected: boolean;
    during_run_fuel_planned: boolean;
    adjacent_training_without_nutrition_days?: Array<{
      date: string;
      trainingLabel: string;
      durationMinutes: number | null;
    }>;
  };
  athlete_message_draft: string | null;
  coach_summary_text: string;
  day_by_day_analysis_text: string;
  generation_mode: "ai" | "fallback" | "awaiting_generation";
  methodology_version: string;
  prompt_version: string;
  do_not_send_reasons: string[];
  athlete_report_signals: NutritionAthleteReportSignal[];
  prompt_hash: string;
  context_hash: string;
  ai_model: string;
};

function avg(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  const total = present.reduce((sum, value) => sum + value, 0);
  return Number((total / present.length).toFixed(1));
}

function buildNutritionDraftAddress(formality: TrainingPeaksTelegramFormality): {
  lead: string;
  proteinOk: string;
  noSharpJumps: string;
  lookAhead: string;
} {
  switch (formality) {
    case "ty":
      return {
        lead: "На этой неделе главный фокус",
        proteinOk: "По белку у тебя всё хорошо, здесь ничего не меняем.",
        noSharpJumps: "Делаем небольшой шаг без резких скачков и без жёстких цифр.",
        lookAhead: "На следующем разборе посмотрим, как это повлияло на энергию и восстановление.",
      };
    case "vy":
      return {
        lead: "На этой неделе главный фокус",
        proteinOk: "По белку у вас всё хорошо, здесь ничего не меняем.",
        noSharpJumps: "Делаем небольшой шаг без резких скачков и без жёстких цифр.",
        lookAhead: "На следующем разборе посмотрим, как это повлияло на энергию и восстановление.",
      };
    default:
      return {
        lead: "На этой неделе главный фокус",
        proteinOk: "По белку всё хорошо, здесь ничего не меняем.",
        noSharpJumps: "Делаем небольшой шаг без резких скачков и без жёстких цифр.",
        lookAhead: "На следующем разборе посмотрим, как это повлияло на энергию и восстановление.",
      };
  }
}

function buildProgressionStepText(strategy: CarbProgressionStrategy, formality: TrainingPeaksTelegramFormality): string {
  if (strategy === "maintain") {
    return formality === "vy"
      ? "Сохраняем текущий режим и точечно поддерживаем ключевые дни."
      : "Сохраняем текущий режим и точечно поддерживаем ключевые дни.";
  }
  if (strategy === "moderate_step") {
    return formality === "vy"
      ? "Начните с умеренного шага: добавьте одну полноценную углеводную порцию до и после ключевой работы."
      : "Начинаем с умеренного шага: добавляем одну полноценную углеводную порцию до и после ключевой работы.";
  }
  if (strategy === "toward_reference_band") {
    return formality === "vy"
      ? "Вы уже близко к рабочему диапазону, поэтому достаточно аккуратно докрутить углеводы вокруг ключевых сессий."
      : "Ты уже близко к рабочему диапазону, поэтому достаточно аккуратно докрутить углеводы вокруг ключевых сессий.";
  }
  return formality === "vy"
    ? "Начните с простого шага: не занижайте углеводы в день до ключевой тренировки и в день ключевой тренировки."
    : "Начинаем с простого шага: не занижаем углеводы в день до ключевой тренировки и в день ключевой тренировки.";
}

function extractJsonOnly(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
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

function buildWorkoutTitleMap(context: NutritionStudentContext): Map<string, string> {
  const map = new Map<string, string>();
  for (const workout of context.tpPastWeek.workouts) {
    const title = workout.title.trim();
    if (!title) {
      continue;
    }
    const current = map.get(workout.date);
    if (!current || /длитель|long run|интерв|tempo|темп|race|гонк/i.test(title)) {
      map.set(workout.date, title);
    }
  }
  return map;
}

function formatTrainingTypeRu(type: string): string {
  switch (type) {
    case "long_run":
      return "длительная";
    case "intervals":
      return "интервалы";
    case "tempo":
      return "темпо";
    case "race":
      return "гонка";
    case "easy":
      return "лёгкая тренировка";
    case "strength":
      return "силовая";
    case "rest":
      return "отдых";
    default:
      return "тренировка";
  }
}

function mapNutritionStatusToAssessment(status: string): string {
  switch (status) {
    case "low_for_load":
      return "low_carbs_or_energy";
    case "moderate_for_load":
      return "recovery_support";
    case "rest_ok":
    case "ample":
    case "adequate":
      return "ok";
    case "missing":
      return "missing_data";
    case "suspect":
      return "suspect";
    default:
      return "ok";
  }
}

function buildCarbReferenceHint(input: {
  trainingType: string;
  bodyweightKg: number | null;
}): string | null {
  if (!input.bodyweightKg || input.bodyweightKg <= 0) {
    return null;
  }
  if (input.trainingType === "long_run" || input.trainingType === "race") {
    return "ориентир для дня длительной/гонки: выше обычного, без жёсткой цифры ученику";
  }
  if (input.trainingType === "intervals" || input.trainingType === "tempo") {
    return "ориентир для ключевой работы: углеводы выше дня отдыха";
  }
  if (input.trainingType === "rest") {
    return "ориентир для отдыха: умеренно, без занижения перед ключевым днём";
  }
  return "ориентир по нагрузке: сравнение с типом дня, без жёсткой нормы";
}

function buildCoachReasonForDay(day: Record<string, unknown>): string {
  const findings = Array.isArray(day.findings) ? day.findings.filter((item): item is string => typeof item === "string") : [];
  if (findings.length > 0) {
    return findings[0] ?? "Явных несоответствий нагрузки и питания в этот день не видно.";
  }
  const status = typeof day.nutritionStatus === "string" ? day.nutritionStatus : "adequate";
  if (status === "low_for_load") {
    return "Питание выглядит ниже потребности для нагрузки этого дня.";
  }
  if (status === "moderate_for_load") {
    return "После нагрузки восстановление можно усилить.";
  }
  if (status === "ample" || status === "adequate" || status === "rest_ok") {
    return "Питание выглядит спокойно относительно нагрузки.";
  }
  return "Данных или контекста недостаточно для точного вывода.";
}

/**
 * Day role hint for the narrative model: tells it how much to write.
 * steady -> 1-2 phrases; key/hard/pre_long -> detailed paragraph.
 * Deterministic from canonical flags / training type. No numbers here.
 */
function resolveNutritionNarrativeDayRole(input: {
  isRestDay: boolean;
  preLong: boolean;
  isLongRun: boolean;
  trainingType: string;
  isHardSession: boolean;
}): "rest" | "pre_long" | "key" | "hard" | "steady" {
  if (input.isRestDay) {
    return "rest";
  }
  if (input.preLong) {
    return "pre_long";
  }
  if (input.isLongRun || input.trainingType === "race" || input.trainingType === "long_endurance") {
    return "key";
  }
  if (input.isHardSession) {
    return "hard";
  }
  return "steady";
}

type NutritionNarrativeNotableItem = {
  name: string;
  fat_contributor: boolean;
  carb_contributor: boolean;
};

/**
 * Notable food items for a day, grouped by meal section, as raw material for the
 * model to name food in prose. IMPORTANT: only names + contribution markers are
 * exposed — never per-item gram numbers — so the model cannot quote item-level
 * numbers that are not in the day-total facts whitelist (see validator task).
 */
function buildNotableItemsForNarrative(items: NutritionFoodItem[] | undefined): {
  by_section: Partial<Record<NutritionMealSection, NutritionNarrativeNotableItem[]>>;
  carb_foods: string[];
  evening_fat_foods: string[];
} {
  const safeItems = Array.isArray(items) ? items : [];
  const sections: NutritionMealSection[] = ["breakfast", "lunch", "dinner", "snack"];
  const bySection: Partial<Record<NutritionMealSection, NutritionNarrativeNotableItem[]>> = {};
  for (const section of sections) {
    const sectionItems = safeItems
      .filter((item) => item.section === section)
      .filter((item) => typeof item.name === "string" && item.name.trim().length >= 2)
      .sort((a, b) => (b.kcal ?? 0) - (a.kcal ?? 0))
      .slice(0, 4)
      .map((item) => ({
        name: item.name.trim().slice(0, 120),
        fat_contributor: typeof item.fatG === "number" && item.fatG >= 10,
        carb_contributor: typeof item.carbsG === "number" && item.carbsG >= 20,
      }));
    if (sectionItems.length > 0) {
      bySection[section] = sectionItems;
    }
  }
  return {
    by_section: bySection,
    carb_foods: pickNotableFoods(safeItems, "carbsG", { limit: 4 }),
    evening_fat_foods: pickNotableFoods(safeItems, "fatG", { sections: EVENING_SECTIONS, limit: 3 }),
  };
}

export function buildNutritionDailyFactsForNarrative(input: {
  context: NutritionStudentContext;
  dailyAnalysis: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  const workoutTitles = buildWorkoutTitleMap(input.context);
  const fatPolicy: NutritionFatFeedbackPolicy = nutritionContextNarrativePreferences(input.context).fatFeedbackPolicy;
  const itemsByDate = new Map<string, NutritionFoodItem[]>();
  for (const row of input.context.manualMacroRows) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.day)) {
      itemsByDate.set(row.day, Array.isArray(row.items) ? row.items : []);
    }
  }
  const reviewWeekFrom = input.context.tpPastWeek.periodFrom;
  const reviewWeekTo = input.context.tpPastWeek.periodTo;
  const macroDates = input.context.manualMacroRows
    .map((row) => row.day)
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  const dateRangeMismatchDetected = detectNutritionMacroReviewWeekMismatch({
    reviewWeekFrom,
    reviewWeekTo,
    macroDates,
  });

  return input.dailyAnalysis
    .filter((day) => typeof day.date === "string")
    .map((day) => {
      const date = day.date as string;
      const trainingType = typeof day.trainingType === "string" ? day.trainingType : "rest";
      const previousDayTrainingType =
        typeof day.previousDayTrainingType === "string" ? day.previousDayTrainingType : null;
      const nextDayTrainingType = typeof day.nextDayTrainingType === "string" ? day.nextDayTrainingType : null;
      const nutritionStatus = typeof day.nutritionStatus === "string" ? day.nutritionStatus : "adequate";
      const relevance = typeof day.relevance === "string" ? day.relevance : "low";
      const bodyweightKg = typeof day.bodyweightKg === "number" ? day.bodyweightKg : input.context.currentWeightKg;
      const isHardSession =
        trainingType === "intervals" || trainingType === "tempo" || trainingType === "race" || trainingType === "strength";
      const isLongRun = trainingType === "long_run";
      const isRestDay = trainingType === "rest";
      const dayBeforeKeyWorkout =
        nextDayTrainingType === "long_run" ||
        nextDayTrainingType === "intervals" ||
        nextDayTrainingType === "tempo" ||
        nextDayTrainingType === "race";
      const dayAfterKeyWorkout =
        previousDayTrainingType === "long_run" ||
        previousDayTrainingType === "intervals" ||
        previousDayTrainingType === "tempo" ||
        previousDayTrainingType === "race";
      const canonical =
        day.canonicalDailyAnalysis && typeof day.canonicalDailyAnalysis === "object" && !Array.isArray(day.canonicalDailyAnalysis)
          ? (day.canonicalDailyAnalysis as Record<string, unknown>)
          : null;
      const canonicalActual =
        canonical?.actual && typeof canonical.actual === "object" && !Array.isArray(canonical.actual)
          ? (canonical.actual as Record<string, unknown>)
          : null;
      const canonicalFlags =
        canonical?.flags && typeof canonical.flags === "object" && !Array.isArray(canonical.flags)
          ? (canonical.flags as Record<string, unknown>)
          : null;
      const canonicalTarget =
        canonical?.target && typeof canonical.target === "object" && !Array.isArray(canonical.target)
          ? (canonical.target as Record<string, unknown>)
          : null;
      const canonicalSourceQuality =
        canonical?.sourceQuality && typeof canonical.sourceQuality === "object" && !Array.isArray(canonical.sourceQuality)
          ? (canonical.sourceQuality as Record<string, unknown>)
          : null;
      const baseSourceQualityNotes = Array.isArray(canonicalSourceQuality?.notes)
        ? canonicalSourceQuality.notes.filter((item): item is string => typeof item === "string")
        : [];
      const sourceQualityNotes = dateRangeMismatchDetected
        ? [...new Set([...baseSourceQualityNotes, "date_range_mismatch_detected"])]
        : baseSourceQualityNotes;
      const dayFindings = Array.isArray(canonical?.findings)
        ? canonical.findings.filter((item): item is string => typeof item === "string")
        : Array.isArray(day.findings)
          ? day.findings.filter((item): item is string => typeof item === "string")
          : [];
      const preLong = canonicalFlags?.preLong === true;
      const dayRole = resolveNutritionNarrativeDayRole({
        isRestDay,
        preLong,
        isLongRun,
        trainingType,
        isHardSession,
      });
      const fatDisplacedCarbs = dayFindings.includes("high_fat_may_displace_carbs_on_load_day");
      const notableItems = buildNotableItemsForNarrative(itemsByDate.get(date));
      return {
        date,
        weekday_ru: typeof canonical?.weekdayRu === "string" ? canonical.weekdayRu : null,
        date_label: typeof canonical?.dateLabel === "string" ? canonical.dateLabel : formatDateRu(date),
        training_type: typeof canonical?.trainingType === "string" ? canonical.trainingType : trainingType,
        training_label:
          typeof canonical?.trainingLabel === "string"
            ? canonical.trainingLabel
            : workoutTitles.get(date) ?? formatTrainingTypeRu(trainingType),
        actual: canonicalActual ?? {
          kcal: typeof day.kcal === "number" ? day.kcal : null,
          proteinG: typeof day.proteinG === "number" ? day.proteinG : null,
          fatG: typeof day.fatG === "number" ? day.fatG : null,
          carbsG: typeof day.carbsG === "number" ? day.carbsG : null,
          proteinGPerKg: typeof day.proteinGPerKg === "number" ? day.proteinGPerKg : null,
          carbsGPerKg: typeof day.carbsGPerKg === "number" ? day.carbsGPerKg : null,
        },
        target: canonicalTarget ?? { formulaCode: "legacy_daily_v1" },
        flags: canonicalFlags ?? {
          rest: isRestDay,
          easy: trainingType === "easy",
          hard: isHardSession,
          preLong: false,
          longRun: isLongRun,
          dayBeforeKeyWorkout,
          dayAfterKeyWorkout,
          suspect: nutritionStatus === "suspect",
        },
        nutrition_status: typeof canonical?.nutritionStatus === "string" ? canonical.nutritionStatus : nutritionStatus,
        relevance: typeof canonical?.relevance === "string" ? canonical.relevance : relevance,
        hint_for_comment:
          typeof canonical?.hintForComment === "string"
            ? canonical.hintForComment
            : buildCoachReasonForDay(day),
        findings: dayFindings,
        training_nutrition_links:
          Array.isArray(canonical?.trainingNutritionLinks)
            ? canonical.trainingNutritionLinks
            : [],
        items_notable: notableItems,
        day_role: dayRole,
        fat_displaced_carbs: fatDisplacedCarbs,
        fat_policy: fatPolicy,
        source_quality: canonicalSourceQuality
          ? {
              ...canonicalSourceQuality,
              confidence: dateRangeMismatchDetected ? "low" : canonicalSourceQuality.confidence ?? "medium",
              notes: sourceQualityNotes,
            }
          : {
              hasNutritionData:
                typeof day.kcal === "number" ||
                typeof day.carbsG === "number" ||
                typeof day.proteinG === "number" ||
                typeof day.fatG === "number",
              hasTrainingContext: workoutTitles.has(date),
              confidence: dateRangeMismatchDetected ? "low" : "medium",
              notes: sourceQualityNotes,
            },
        canonical_daily_analysis: canonical,
        canonicalDailyAnalysis: canonical,
        macro_guardrails: canonical?.macroGuardrails ?? null,
        macroGuardrails: canonical?.macroGuardrails ?? null,
        energy_availability: canonical?.energyAvailability ?? null,
        energyAvailability: canonical?.energyAvailability ?? null,
        energy_floor: canonical?.energyFloor ?? null,
        energyFloor: canonical?.energyFloor ?? null,
        methodology_version: NUTRITION_REVIEW_METHODOLOGY_VERSION,
        caloriesActual: typeof day.kcal === "number" ? day.kcal : null,
        caloriesTargetOrEstimate: null,
        proteinActual: typeof day.proteinG === "number" ? day.proteinG : null,
        fatActual: typeof day.fatG === "number" ? day.fatG : null,
        carbsActual: typeof day.carbsG === "number" ? day.carbsG : null,
        carbsTargetOrRange: buildCarbReferenceHint({ trainingType, bodyweightKg }),
        carbsPerKg: typeof day.carbsGPerKg === "number" ? day.carbsGPerKg : null,
        proteinPerKg: typeof day.proteinGPerKg === "number" ? day.proteinGPerKg : null,
        workoutTitle: workoutTitles.get(date) ?? null,
        workoutType: trainingType,
        workoutIntensity: isLongRun || isHardSession ? "high" : isRestDay ? "rest" : "moderate",
        isRestDay,
        isHardSession,
        isLongRun,
        dayBeforeKeyWorkout,
        dayAfterKeyWorkout,
        assessment: mapNutritionStatusToAssessment(nutritionStatus),
        legacy_relevance: relevance,
        coachReason: buildCoachReasonForDay(day),
      };
    });
}

function buildDetailedDayObservationLines(input: {
  context: NutritionStudentContext;
  dailyAnalysis: Array<Record<string, unknown>>;
  maxDays?: number;
}): string[] {
  const dailyFacts = buildNutritionDailyFactsForNarrative({
    context: input.context,
    dailyAnalysis: input.dailyAnalysis,
  });
  return dailyFacts
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .slice(0, input.maxDays ?? 7)
    .map((day) => {
      const weekday = typeof day.weekday_ru === "string" ? day.weekday_ru : "День";
      const dateLabel = typeof day.date_label === "string" ? day.date_label : formatDateRu(String(day.date));
      const rawTrainingLabel =
        typeof day.training_label === "string" && day.training_label.trim()
          ? day.training_label.trim()
          : formatTrainingTypeRu(String(day.training_type ?? day.workoutType ?? "rest"));
      const trainingLabel = /[A-Za-z]{3,}/.test(rawTrainingLabel)
        ? formatTrainingTypeRu(String(day.training_type ?? day.workoutType ?? "rest"))
        : rawTrainingLabel;
      const actual = day.actual && typeof day.actual === "object" && !Array.isArray(day.actual)
        ? (day.actual as Record<string, unknown>)
        : {};
      const kcal = typeof actual.kcal === "number" ? `~${actual.kcal} ккал` : "~ккал н/д";
      const protein = typeof actual.proteinG === "number" ? `белок ${actual.proteinG} г` : "белок н/д";
      const fat = typeof actual.fatG === "number" ? `жиры ${actual.fatG} г` : "жиры н/д";
      const carbs = typeof actual.carbsG === "number" ? `углеводы ${actual.carbsG} г` : "углеводы н/д";
      const carbsPerKg =
        typeof actual.carbsGPerKg === "number" ? ` (~${formatDecimalRu(actual.carbsGPerKg)} г/кг)` : "";
      const sourceQuality =
        day.source_quality && typeof day.source_quality === "object" && !Array.isArray(day.source_quality)
          ? (day.source_quality as Record<string, unknown>)
          : {};
      const confidence = typeof sourceQuality.confidence === "string" ? sourceQuality.confidence : "medium";
      const suspect =
        day.flags && typeof day.flags === "object" && !Array.isArray(day.flags)
          ? Boolean((day.flags as Record<string, unknown>).suspect)
          : false;
      const hint = typeof day.hint_for_comment === "string" && day.hint_for_comment.trim()
        ? day.hint_for_comment.trim()
        : "Нужна аккуратная интерпретация по этому дню.";
      const cautiousPrefix =
        suspect || confidence === "low"
          ? "Комментарий: по качеству данных здесь возможна неполная картина. "
          : "Комментарий: ";
      return `🔹 ${weekday} (${dateLabel}) — ${trainingLabel}\n${kcal} · ${protein} · ${fat} · ${carbs}${carbsPerKg}.\n${cautiousPrefix}${hint}`;
    });
}

function buildFallbackAthleteDraft(input: {
  context: NutritionStudentContext;
  dailyAnalysis: Array<Record<string, unknown>>;
  mainFocusRu: string;
  proteinSufficient: boolean;
  progressionStrategy: CarbProgressionStrategy;
}): string {
  const { context, mainFocusRu, proteinSufficient, progressionStrategy } = input;
  const profile = context.resolvedCommunicationProfile;
  const address = buildNutritionDraftAddress(profile.formality);
  const defaultGreeting = profile.formality === "vy" ? "Здравствуйте!" : "Привет!";
  const greeting = profile.preferredGreeting ? `${profile.preferredGreeting}\n\n` : `${defaultGreeting}\n\n`;
  const proteinLine = proteinSufficient ? address.proteinOk : null;
  const stepText = buildProgressionStepText(progressionStrategy, profile.formality);
  const normalizedFocus = mainFocusRu
    .trim()
    .replace(/^главный\s+фокус(?:\s+недели)?\s*[—:-]\s*/i, "")
    .replace(/^главный\s+фокус\s*/i, "")
    .trim()
    .replace(/\.$/, "");
  const focusLine = `${address.lead}: ${normalizedFocus.toLowerCase()}.`;
  const dayLines = buildDetailedDayObservationLines({
    context,
    dailyAnalysis: input.dailyAnalysis,
    maxDays: 7,
  });
  const noJumpLine = address.noSharpJumps;
  const profileNotes = profile.notes ? `\n\n${profile.notes}` : "";
  const intro =
    profile.formality === "vy"
      ? "По неделе в целом питание выглядит рабочим, но есть точки, где нагрузка и питание расходились."
      : "По неделе в целом питание нормальное, но есть моменты, где нагрузка и питание расходились.";
  const lines = [
    greeting.trim(),
    intro,
    proteinLine,
    dayLines.length > 0 ? dayLines.join("\n") : null,
    focusLine,
    stepText,
    noJumpLine,
    address.lookAhead,
  ]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join("\n");
  return `${lines}${profileNotes ? `\n${profileNotes}` : ""}`.trim();
}

type NutritionAiNarrative = {
  coach_summary_text: string;
  day_by_day_analysis_text: string;
  athlete_message_draft: string | null;
  /**
   * Per-day athlete-facing prose keyed by ISO date (YYYY-MM-DD). Hybrid path:
   * code owns the fact line + numbers, the model writes only the prose. Empty /
   * absent for any day falls back to the deterministic comment in the renderer.
   */
  day_prose: Record<string, string>;
  quality_notes: string[];
  do_not_send_reasons: string[];
  /** The model that actually answered (for diagnostics). Set on the success path. */
  ai_model?: string;
};

/**
 * Defensive parse for model-returned per-day prose. Keeps only ISO-dated keys
 * with non-empty string values; strips markdown fences so prose stays plain.
 */
function sanitizeNutritionDayProse(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      continue;
    }
    if (typeof raw !== "string") {
      continue;
    }
    const prose = raw.replace(/```+/g, "").replace(/\s+/g, " ").trim();
    if (prose.length >= 2) {
      result[key] = prose;
    }
  }
  return result;
}

function pickCoachMemorySummaries(
  items: TrainingPeaksStudentMemoryItem[],
  memoryType: TrainingPeaksStudentMemoryType,
  limit = 2
): string[] {
  return items
    .filter((item) => item.memoryType === memoryType)
    .slice(0, limit)
    .map((item) => item.summaryText.trim())
    .filter(Boolean);
}

function buildCoachMemoryFactsPayload(context: NutritionStudentContext): {
  race_or_goal: string[];
  health_status: string[];
  pain_or_injury: string[];
} {
  return {
    race_or_goal: pickCoachMemorySummaries(context.coachMemoryItems, "race_or_goal"),
    health_status: pickCoachMemorySummaries(context.coachMemoryItems, "health_status"),
    pain_or_injury: pickCoachMemorySummaries(context.coachMemoryItems, "pain_or_injury"),
  };
}

function buildFallbackCoachSummary(input: {
  context: NutritionStudentContext;
  selectedFocus: { statementRu: string };
  proteinSufficient: boolean;
  dataQualityFlags: string[];
  nextWeekHasKeySessions: boolean;
}): string {
  const lines: string[] = [];
  lines.push(
    `Главный вывод: ${input.proteinSufficient ? "белок закрыт" : "белок частично закрыт"}, основной ограничитель недели — ${input.selectedFocus.statementRu.replace(/^Главный фокус(?: недели)?\s*[—:-]\s*/i, "").toLowerCase()}.`
  );
  const keySessions = input.context.tpPastWeek.keyWorkouts.length;
  const longRunDate = input.context.tpPastWeek.longRun?.date ? formatDateRu(input.context.tpPastWeek.longRun.date) : null;
  lines.push(
    `Контекст нагрузки: в кэше TrainingPeaks видно ${keySessions} ключевых сессий${longRunDate ? `, длительная ${longRunDate}` : ""}.`
  );
  if (input.dataQualityFlags.length > 0) {
    lines.push(`Качество данных: есть ограничения (${input.dataQualityFlags.join(", ")}), выводы интерпретируем аккуратно.`);
  } else {
    lines.push("Качество данных: неделя заполнена достаточно ровно, сигналы можно использовать в практическом разборе.");
  }
  lines.push("Что сказать ученику: не поднимать питание резко, а точечно добавить углеводы/энергию вокруг длительной и ключевых работ.");
  if (!input.nextWeekHasKeySessions) {
    lines.push("Ограничение: следующая неделя в TP cache пустая/ограниченная, будущие тренировки в тексте не называем.");
  }
  if (input.context.athleteReportSignals.length > 0) {
    const signalLabels = input.context.athleteReportSignals.map((signal) => signal.category).join(", ");
    lines.push(`Сигналы из комментария ученика: ${signalLabels}. Нужна осторожная интерпретация без медицинских выводов в тексте ученику.`);
  }
  if (input.context.coachContextRu) {
    lines.push("Учитывай coach_context_ru как рабочий контекст тренера, но не цитируй его ученику дословно.");
  }
  return lines.join("\n");
}

function buildFallbackDayByDay(input: {
  context: NutritionStudentContext;
  dailyAnalysis: Array<Record<string, unknown>>;
}): string {
  const lines = buildDetailedDayObservationLines({
    context: input.context,
    dailyAnalysis: input.dailyAnalysis,
    maxDays: 7,
  });
  if (lines.length === 0) {
    return "По дням выраженных сигналов не выделилось: питание выглядит относительно ровно, но стоит продолжать наблюдать связку с нагрузкой.";
  }
  return lines.join("\n");
}

async function generateNutritionWeeklyReviewNarrative(input: {
  context: NutritionStudentContext;
  dailyAnalysis: Array<Record<string, unknown>>;
  trainingNutritionLinks: string[];
  oneFocus: {
    category: string;
    statement_ru: string;
    progression_strategy: CarbProgressionStrategy;
  };
  methodologySignals: {
    protein_sufficient: boolean;
    carb_reference_band_used: true;
    carb_reference_not_prescriptive: true;
    long_run_fueling_instruction_detected: boolean;
    during_run_fuel_planned: boolean;
  };
  safetyFlags: { hard_flags: string[]; soft_flags: string[]; blocked: boolean };
  /** Failure reasons are pushed here so the caller can surface them (notes + logs). */
  diagnostics?: string[];
}): Promise<NutritionAiNarrative | null> {
  const note = (reason: string, extra?: Record<string, unknown>) => {
    input.diagnostics?.push(reason);
    console.error("[nutrition-review-ai] generation fell back", { reason, ...extra });
  };
  const provider = resolveNutritionAiProvider();
  const model = resolveNutritionAiModel(provider);
  const apiKey = resolveNutritionAiApiKey(provider);
  if (!apiKey) {
    note("ai_no_api_key", { provider });
    return null;
  }
  const allowAthleteDraft = !input.safetyFlags.blocked;
  const formalityInstruction = getTrainingPeaksReplyDraftFormalityInstruction(
    input.context.resolvedCommunicationProfile.formality
  );
  const dailyFacts = buildNutritionDailyFactsForNarrative({
    context: input.context,
    dailyAnalysis: input.dailyAnalysis,
  });
  const hasMissingDay = dailyFacts.some((day) => {
    const sq = day.source_quality;
    return Boolean(
      sq &&
        typeof sq === "object" &&
        !Array.isArray(sq) &&
        (sq as Record<string, unknown>).hasNutritionData === false
    );
  });
  // Split the system prompt into a STABLE block (invariant rules + style spec +
  // a fixed reference example — byte-identical for every student, so it caches)
  // and a DYNAMIC per-student block (safety line, variable few-shot, formality).
  // (Task 5: prompt caching + token reduction.)
  const systemStable = [
    "Пиши только на русском языке.",
    "Твоя задача: написать day_prose — живую прозу комментария по каждому дню в голосе Игоря (см. блок «КАК ПИСАТЬ» и примеры ниже), плюс coach_summary_text и day_by_day_analysis_text. Это не «причёсывание фактов» и не сухой системный язык, а тёплый человеческий разбор тренера в жёстких рамках ниже.",
    "LLM пишет прозу. Код считает числа и ставит факт-строку.",
    "Ничего не пересчитывай и не придумывай: kcal, белки/жиры/углеводы, г/кг, formula targets, day type, nutrition status, one_focus, safety status, race status, TrainingPeaks workouts.",
    "Используй только exact числа и labels из facts JSON.",
    "Не классифицируй дни и не выводи формулы — это уже сделано в коде.",
    "Return strict JSON only with keys: coach_summary_text, day_by_day_analysis_text, athlete_message_draft, day_prose, quality_notes, do_not_send_reasons.",
    "day_prose: объект {\"YYYY-MM-DD\": \"проза дня\"} по каждому дню из daily_analysis. Это athlete-facing проза комментария дня. Длину выбирай по day_role: steady/rest — одна-две фразы; key/hard/pre_long — абзац подробнее.",
    "Подача каждого дня как у Игоря, трёхтактно: (1) что хорошо — конкретно похвали («белок 107 отлично, в самую точку», «хорошо, что калорийность подросла»); (2) что недотянуто — с числом и причиной, используя ЦЕЛЬ из target дня («под такую работу хотелось бы ~цель углеводов, у тебя X, недобор ~Z»); (3) мягкий шаг с конкретной едой (каша, рис, паста, картофель, хлеб, фрукты).",
    "ЧИСЛА в day_prose разрешены ТОЛЬКО из фактов дня: фактические макросы (actual) и ориентиры из target (carbsGMin/carbsGMax как цель углеводов, kcalMin, proteinGMin) и их разница (недобор = цель − факт). Других чисел не выдумывай. Факт-строку дословно не повторяй.",
    "Перед длительной/интервальной/ключевой работой (day_role=key/hard/pre_long или nextDayTrainingType ключевой) прямо скажи догрузиться углеводами накануне и в день работы.",
    "Еду называй из items_notable текущего дня. Углеводную называй свободно. Жирную/сладкую вечером называй ученику и связывай «жиры пошли вместо углеводов под нагрузку» ТОЛЬКО при fat_policy=normal; при coach_only/soften/suppress_athlete жир ученику не выноси.",
    "coach_summary_text и day_by_day_analysis_text — ОБЯЗАТЕЛЬНЫЕ непустые поля, заполняй их всегда (даже если основной фокус ушёл в day_prose). coach_summary_text: 2-4 предложения для тренера. day_by_day_analysis_text: по строке-две на каждый день из daily_analysis. Пустые строки в этих полях недопустимы.",
    "day_by_day_analysis_text: дневные блоки строго по canonical daily_analysis; используй weekday_ru, date_label, training_label, actual, hint_for_comment/findings; комментируй только дневные totals, без intraday (до/во время/после, граммы по таймингу, гели).",
    "Если source_quality.confidence=low или suspect=true, формулируй осторожно как ограничение данных.",
    "athlete_message_draft должен включать 3-7 дневных наблюдений, если daily facts есть.",
    "athlete_message_draft: только plain Telegram text, emoji-разделители ок. Запрещено: **, ---, code fences, markdown headings.",
    "Строгая формальность: только ты ИЛИ только вы, без смешивания.",
    "Не используй диагнозы/медицинские термины: RED-S, REDs, LEA, энергодоступность, дефицит энергии, медицинский риск, диагноз, расстройство, анемия.",
    ...NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES,
    "Не используй язык похудения/ограничения: похудеть, сбросить вес, урезать калории, меньше есть, дефицит калорий.",
    "Не давай меню/диету/рецепты. Продукты только как варианты при наличии фактов.",
    "Не придумывай тренировки и не придумывай гели/fueling.",
    "Если тренировка в tp_context имеет status=planned (а не completed / planned_and_completed) — она НЕ состоялась (пропущена). Не оценивай такой день как тренировочный: считай его поддержанием/восстановлением, спокойно, без упрёка за «недобор под нагрузку» — нагрузки в этот день не было. Опирайся на nutrition_status дня (rest_ok и т.п.), а не на запланированную, но не выполненную работу.",
    "Причинность только с хеджами (может, могло, вполне могло); запрещено: вызвало, из-за этого точно, именно поэтому.",
    "Упоминание athlete name допускается при наличии в facts. One focus only: используй exact one_focus из facts.",
    "If illness/cycle/injury signals present, recommend coach review in coach_summary_text and quality_notes; no medical claims/diagnosis in athlete_message_draft.",
    "Углеводную еду называть свободно как варианты («добавь каши, риса, картофеля»). Жирную еду ученику называть как акцент только при fat_policy=normal; при coach_only/soften/suppress_athlete жирное в текст ученику не выносить — это идёт в coach_summary_text.",
    ...NUTRITION_VOICE_STYLE_SPEC_LINES,
    ...NUTRITION_VOICE_FEWSHOT_STABLE_LINES,
  ].join("\n");
  const noTrainingWeek = input.context.noTrainingWeek === true;
  const systemDynamic = [
    allowAthleteDraft
      ? "athlete_message_draft is required and must be useful Telegram-ready text. Use the required ты/вы form from formality instruction."
      : "Hard safety flags present: athlete_message_draft must be null and coach-only text should explain manual review need.",
    ...(noTrainingWeek
      ? [
          "На этой неделе тренировок не было — считай дни как поддержание (база от веса + восстановление), спокойно и ровно. НЕ пиши про «энергию мало под нагрузку», «недобор под работу» и т.п. — нагрузки не было. Фокус мягкий: ровное питание, белок, восстановление.",
          "В coach_summary_text добавь короткую оговорку для тренера: по тренировкам данных в TrainingPeaks за эту неделю нет, разбор сделан как поддерживающий; если тренировки были — синхронизировать TP и перегенерировать. В athlete_message_draft эту оговорку НЕ выноси (не пугать «нет данных»).",
        ]
      : []),
    ...(allowAthleteDraft ? buildNutritionVoiceFewShotDynamic({ hasMissingDay }) : []),
    `Formality instruction: ${formalityInstruction}`,
  ].join("\n");

  const coachMemory = buildCoachMemoryFactsPayload(input.context);
  const factsPayload = {
    student: {
      name: input.context.studentName,
      formality: input.context.resolvedCommunicationProfile.formality,
      nutrition_goal: input.context.nutritionGoal,
      coach_context_ru: input.context.coachContextRu,
      coach_memory: coachMemory,
      narrative_preferences: nutritionContextNarrativePreferences(input.context),
    },
    athlete_report_signals: input.context.athleteReportSignals,
    tp_context: {
      past_week: input.context.tpPastWeek,
      next_week: input.context.tpNextWeek,
    },
    data_quality: input.context.dataQuality,
    week_training_context: noTrainingWeek ? "maintenance_no_training" : "training_week",
    daily_analysis: dailyFacts,
    training_nutrition_links: input.trainingNutritionLinks,
    one_focus: input.oneFocus,
    methodology_signals: input.methodologySignals,
    safety_flags: input.safetyFlags,
    allow_athlete_draft: allowAthleteDraft,
  };

  // Build the provider-aware request (OpenAI chat-completions vs Anthropic
  // Messages API). Switching provider/model is env-only and never reproduces an
  // HTTP 400 from mismatched params.
  const { url, headers, body } = buildNutritionModelRequest({
    provider,
    model,
    apiKey,
    systemStable,
    systemDynamic,
    factsPayload,
  });
  try {
    // Serialise through the generation queue so concurrent students / the two
    // calls per student don't burst the provider. The slot is held for the whole
    // retry sequence below.
    const { response, prefetchedBody } = await enqueueOpenAiCall(async () => {
      // Retry transient throttling/server errors (429 / 5xx / 529) with
      // exponential backoff (2s -> 4s -> 8s). Honours Retry-After when present.
      // Rate limits from rapid regenerations recover, so we retry them; quota
      // exhaustion (insufficient_quota) won't recover, so we stop immediately
      // and don't burn attempts. The error body is read once and passed back so
      // the caller doesn't re-read a consumed stream.
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        res = await fetch(url, { method: "POST", headers, body });
        if (res.ok) {
          return { response: res, prefetchedBody: null as string | null };
        }
        // Non-transient errors: stop immediately.
        if (res.status !== 429 && res.status < 500) {
          return { response: res, prefetchedBody: await res.text().catch(() => "") };
        }
        const errorBody = await res.text().catch(() => "");
        // Quota exhausted — retry is useless, stop now.
        if (classifyAiError(provider, res.status, errorBody) === "insufficient_quota") {
          return { response: res, prefetchedBody: errorBody };
        }
        // Out of attempts for a transient error.
        if (attempt === 2) {
          return { response: res, prefetchedBody: errorBody };
        }
        const retryAfterRaw = Number(res.headers.get("retry-after"));
        const delayMs =
          Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
            ? Math.min(retryAfterRaw * 1000, 15000)
            : 2000 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return { response: res, prefetchedBody: null as string | null };
    });
    if (!response || !response.ok) {
      const status = response?.status ?? 0;
      const bodyText = prefetchedBody ?? (response ? await response.text().catch(() => "") : "");
      // Distinguish transient rate limit from exhausted quota / server error so
      // the fallback reason is actionable (master order Task 1).
      const errorType = classifyAiError(provider, status, bodyText);
      if (errorType === "insufficient_quota") {
        console.error(
          `[nutrition-review-ai] ${provider} quota exhausted — проверь баланс/квоту провайдера (ретрай бесполезен)`,
          { provider, status }
        );
        note("ai_insufficient_quota", { provider, status, body: bodyText.slice(0, 300) });
      } else if (errorType === "rate_limit_exceeded") {
        note("ai_rate_limited", { provider, status, body: bodyText.slice(0, 300) });
      } else if (errorType === "server_error") {
        note("ai_server_error", { provider, status, body: bodyText.slice(0, 300) });
      } else {
        note(`ai_http_${status}`, { provider, status, body: bodyText.slice(0, 300) });
      }
      return null;
    }
    const payload = (await response.json()) as unknown;
    const content = extractNutritionModelText(provider, payload);
    const finishReason = extractNutritionFinishReason(provider, payload);
    const answeredModel = extractNutritionModelId(payload) ?? model;
    // Surface real token usage for cost diagnostics (master order Task 5).
    const usage = extractNutritionModelUsage(provider, payload);
    if (usage) {
      input.diagnostics?.push(
        `ai_usage:input=${usage.input},output=${usage.output},cache_creation=${usage.cacheCreation},cache_read=${usage.cacheRead}`
      );
    }
    if (!content) {
      note("ai_empty_content", { provider, model, finishReason });
      return null;
    }
    let parsed: Partial<NutritionAiNarrative>;
    try {
      parsed = JSON.parse(extractJsonOnly(content)) as Partial<NutritionAiNarrative>;
    } catch (parseError) {
      note("ai_parse_failed", {
        finishReason,
        contentLength: content.length,
        contentHead: content.slice(0, 300),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return null;
    }
    let coachSummary = typeof parsed.coach_summary_text === "string" ? parsed.coach_summary_text.trim() : "";
    let dayByDay = typeof parsed.day_by_day_analysis_text === "string" ? parsed.day_by_day_analysis_text.trim() : "";
    const dayProse = allowAthleteDraft ? sanitizeNutritionDayProse(parsed.day_prose) : {};
    if (!coachSummary || !dayByDay) {
      // Salvage: if the model produced per-day prose, keep AI mode and fill the
      // empty coach-facing legacy fields deterministically instead of discarding
      // the whole result (which would also lose the good day_prose).
      if (Object.keys(dayProse).length > 0) {
        if (!dayByDay) {
          dayByDay = buildFallbackDayByDay({ context: input.context, dailyAnalysis: input.dailyAnalysis });
        }
        if (!coachSummary) {
          coachSummary = buildFallbackCoachSummary({
            context: input.context,
            selectedFocus: { statementRu: input.oneFocus.statement_ru },
            proteinSufficient: input.methodologySignals.protein_sufficient,
            dataQualityFlags: input.context.dataQuality.qualityFlags,
            nextWeekHasKeySessions: input.context.tpNextWeek.keyWorkouts.length > 0,
          });
        }
        input.diagnostics?.push("ai_legacy_fields_derived");
        console.warn("[nutrition-review-ai] kept AI day_prose, derived empty coach fields", { finishReason });
      } else {
        note("ai_empty_required_fields", {
          finishReason,
          hasCoachSummary: Boolean(coachSummary),
          hasDayByDay: Boolean(dayByDay),
        });
        return null;
      }
    }
    const athleteDraftRaw = typeof parsed.athlete_message_draft === "string" ? parsed.athlete_message_draft.trim() : null;
    const athleteDraft = allowAthleteDraft ? athleteDraftRaw : null;
    return {
      coach_summary_text: coachSummary,
      day_by_day_analysis_text: dayByDay,
      athlete_message_draft: athleteDraft,
      day_prose: dayProse,
      quality_notes: Array.isArray(parsed.quality_notes)
        ? parsed.quality_notes.filter((item): item is string => typeof item === "string")
        : [],
      do_not_send_reasons: Array.isArray(parsed.do_not_send_reasons)
        ? parsed.do_not_send_reasons.filter((item): item is string => typeof item === "string")
        : [],
      ai_model: answeredModel,
    };
  } catch (error) {
    note("ai_exception", { provider, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function generateNutritionWeeklyAnalysis(input: {
  context: NutritionStudentContext;
}): Promise<GeneratedNutritionWeeklyAnalysis> {
  const context = input.context;
  const safety = buildNutritionSafetyFlags({
    studentName: context.studentName,
    studentNotes: [context.telegramContextNotes ?? "", context.nutritionGoal ?? ""].filter(Boolean),
    nutritionContextItems: context.nutritionContextItems,
    rows: context.manualMacroRows,
    weightLogs: context.weightLogs,
  });

  const avgKcal = avg(context.manualMacroRows.map((row) => row.kcal));
  const avgProtein = avg(context.manualMacroRows.map((row) => row.proteinG));
  const avgFat = avg(context.manualMacroRows.map((row) => row.fatG));
  const avgCarbs = avg(context.manualMacroRows.map((row) => row.carbsG));
  const methodology = buildNutritionMethodologyContext({ context });
  const selectedFocus = selectNutritionWeeklyFocus({
    methodology,
    blockedSafety: safety.blocked,
  });
  const mainFocus = selectedFocus.statementRu;
  const notes: string[] = [];
  if (context.tpPastWeek.cacheStatus !== "ok") {
    notes.push("past_week_tp_context_unavailable_or_stale");
  }
  if (context.tpNextWeek.cacheStatus !== "ok") {
    notes.push("next_week_tp_context_unavailable_or_stale");
  }
  if (context.dataQuality.qualityFlags.length > 0) {
    notes.push(`data_quality:${context.dataQuality.qualityFlags.join(",")}`);
  }
  notes.push(
    `communication_formality:${getTrainingPeaksReplyDraftFormalityInstruction(context.resolvedCommunicationProfile.formality)}`
  );
  notes.push(...context.communicationProfilePromptLines);
  if (context.noTrainingWeek === true) {
    // Coach-facing caveat: maintenance assumed from an empty TP week. Guaranteed in
    // notes so the coach sees it even if the model omits it. Not shown to the athlete.
    notes.push("no_training_week:maintenance_assumed_sync_tp_if_wrong");
  }
  const resolvedMacroDays = context.manualMacroRows.filter((row) => !row.day.startsWith("unresolved:")).length;
  // A genuine no-training week (empty past week, but workouts in nearby weeks) is
  // usable context: days are treated as maintenance and the review generates
  // normally. Only a true data gap (no workouts anywhere) stays needs_review. (Task 5b.)
  const hasUsableTrainingContext =
    (context.tpPastWeek.workouts.length > 0 &&
      (context.tpPastWeek.cacheStatus === "ok" || context.tpPastWeek.cacheStatus === "stale")) ||
    context.noTrainingWeek === true;
  const hasMethodologyFacts =
    resolvedMacroDays > 0 &&
    context.dataQuality.parsedDays > 0 &&
    context.dataQuality.hasResolvedDates &&
    Boolean(selectedFocus.statementRu.trim()) &&
    hasUsableTrainingContext;
  const forceNeedsReview = !hasMethodologyFacts;
  const athleteSignalsNeedCoachReview = nutritionAthleteReportSignalsRequireCoachReview(
    context.athleteReportSignals
  );
  if (!hasMethodologyFacts) {
    notes.push("methodology_facts_incomplete_for_ai_generation");
  }
  if (athleteSignalsNeedCoachReview) {
    notes.push("athlete_report_signals_require_coach_review");
  }
  const persistedDailyAnalysis = buildNutritionDailyFactsForNarrative({
    context,
    dailyAnalysis: methodology.dailyAnalysis as Array<Record<string, unknown>>,
  });

  const fallbackDayByDay = buildFallbackDayByDay({
    context,
    dailyAnalysis: methodology.dailyAnalysis as Array<Record<string, unknown>>,
  });
  const fallbackCoachSummary = buildFallbackCoachSummary({
    context,
    selectedFocus: {
      statementRu: selectedFocus.statementRu,
    },
    proteinSufficient: methodology.proteinSufficient,
    dataQualityFlags: context.dataQuality.qualityFlags,
    nextWeekHasKeySessions: context.tpNextWeek.keyWorkouts.length > 0,
  });
  let narrative: {
    coach_summary_text: string;
    day_by_day_analysis_text: string;
    athlete_message_draft: string | null;
    day_prose: Record<string, string>;
    quality_notes: string[];
    do_not_send_reasons: string[];
    generation_mode: "ai" | "fallback" | "awaiting_generation";
    ai_model: string;
  } = {
    coach_summary_text: fallbackCoachSummary,
    day_by_day_analysis_text: fallbackDayByDay,
    athlete_message_draft: safety.blocked
      ? null
      : buildFallbackAthleteDraft({
          context,
          dailyAnalysis: methodology.dailyAnalysis as Array<Record<string, unknown>>,
          mainFocusRu: selectedFocus.statementRu,
          proteinSufficient: methodology.proteinSufficient,
          progressionStrategy: selectedFocus.progressionStrategy,
        }),
    day_prose: {},
    quality_notes: [] as string[],
    do_not_send_reasons: [] as string[],
    generation_mode: "fallback" as const,
    ai_model: "nutrition-weekly-review-fallback-v2",
  };
  if (!forceNeedsReview) {
    const aiDiagnostics: string[] = [];
    const aiNarrative = await generateNutritionWeeklyReviewNarrative({
      context,
      dailyAnalysis: methodology.dailyAnalysis as Array<Record<string, unknown>>,
      trainingNutritionLinks: methodology.trainingNutritionLinks,
      oneFocus: {
        category: selectedFocus.category,
        statement_ru: selectedFocus.statementRu,
        progression_strategy: selectedFocus.progressionStrategy,
      },
      methodologySignals: {
        protein_sufficient: methodology.proteinSufficient,
        carb_reference_band_used: methodology.carbReferenceBandUsed,
        carb_reference_not_prescriptive: methodology.carbReferenceNotPrescriptive,
        long_run_fueling_instruction_detected: methodology.longRunFuelingInstructionDetected,
        during_run_fuel_planned: methodology.duringRunFuelPlanned,
      },
      safetyFlags: {
        hard_flags: safety.hardFlags,
        soft_flags: safety.softFlags,
        blocked: safety.blocked,
      },
      diagnostics: aiDiagnostics,
    });
    if (aiNarrative) {
      // Surface token usage (cost diagnostics) into notes on the success path too.
      for (const reason of aiDiagnostics) {
        if (reason.startsWith("ai_usage:")) {
          notes.push(reason);
        }
      }
      narrative = {
        ...aiNarrative,
        generation_mode: "ai",
        ai_model: aiNarrative.ai_model ?? resolveNutritionAiModel(resolveNutritionAiProvider()),
      };
    } else {
      // Surface why the AI path fell back (otherwise the fallback is silent).
      for (const reason of aiDiagnostics) {
        notes.push(`ai_generation_fallback:${reason}`);
      }
      // The model was attempted but produced nothing usable (quota / rate limit /
      // server error / empty / parse). This is NOT a valid fallback — do not hand
      // a deterministic template to the student as if ready. Mark it
      // awaiting_generation and hold the athlete text; the coach regenerates.
      // (A safety block is a different, valid state and keeps its coach-only path.)
      if (!safety.blocked) {
        narrative = {
          ...narrative,
          athlete_message_draft: null,
          generation_mode: "awaiting_generation",
          ai_model: "nutrition-weekly-review-awaiting-generation",
        };
      }
    }
  }

  // Hybrid path: attach model per-day prose onto the canonical day facts by date.
  // Code keeps the numbers/fact-line; the renderer uses this prose only if it
  // passes validation, otherwise it falls back to the deterministic comment.
  if (Object.keys(narrative.day_prose).length > 0) {
    for (const dayFact of persistedDailyAnalysis) {
      const date = typeof dayFact.date === "string" ? dayFact.date : null;
      const prose = date ? narrative.day_prose[date] : undefined;
      if (prose) {
        dayFact.athlete_prose = prose;
        // Close the blind per-day cutover (master order Task 3 #8): record which
        // day the renderer will drop to the deterministic comment and why, using
        // the SAME facts/validator the renderer uses, so the silent fallback is
        // visible in notes.
        const issues = validateNutritionDayProse({ prose, facts: buildNutritionDayProseFacts(dayFact) });
        const errors = issues.filter((issue) => issue.severity === "error");
        if (errors.length > 0) {
          const rules = [...new Set(errors.map((issue) => issue.rule))].join(",");
          notes.push(`day_prose_rejected:${date ?? "?"}:${rules}:${prose.slice(0, 80)}`);
        }
      }
    }
  }

  let interpretationShadow: NutritionInterpretationShadowMetadata | null = null;
  try {
    const shadowFactsPayload = {
      student: {
        name: context.studentName,
        formality: context.resolvedCommunicationProfile.formality,
        nutrition_goal: context.nutritionGoal,
        coach_context_ru: context.coachContextRu,
        narrative_preferences: context.narrativePreferences,
      },
      athlete_report_signals: context.athleteReportSignals,
      previous_weeks_context: null,
      daily_analysis: persistedDailyAnalysis,
      one_focus: {
        category: selectedFocus.category,
        statement_ru: selectedFocus.statementRu,
        progression_strategy: selectedFocus.progressionStrategy,
      },
      methodology_signals: {
        protein_sufficient: methodology.proteinSufficient,
        carb_reference_band_used: methodology.carbReferenceBandUsed,
        carb_reference_not_prescriptive: methodology.carbReferenceNotPrescriptive,
        long_run_fueling_instruction_detected: methodology.longRunFuelingInstructionDetected,
        during_run_fuel_planned: methodology.duringRunFuelPlanned,
        adjacent_training_without_nutrition_days: methodology.adjacentTrainingWithoutNutritionDays,
      },
      data_quality: context.dataQuality,
    };
    // Route through the same queue so the shadow call doesn't fire back-to-back
    // with the main narrative call and add to the burst.
    const shadowResult = await enqueueOpenAiCall(() =>
      generateNutritionWeeklyInterpretationShadow({
        factsPayload: shadowFactsPayload,
        formality: context.resolvedCommunicationProfile.formality,
        studentName: context.studentName,
      })
    );
    interpretationShadow = buildNutritionInterpretationShadowMetadata({
      mode: shadowResult.mode,
      interpretation: shadowResult.interpretation,
      issues: shadowResult.issues,
    });
  } catch {
    interpretationShadow = buildNutritionInterpretationShadowMetadata({
      mode: "disabled",
      interpretation: null,
      issues: [
        {
          severity: "error",
          code: "shadow_generation_failed",
          message: "Shadow interpretation generation failed without blocking review.",
        },
      ],
    });
  }

  const promptHash = stableHash({
    role: NUTRITION_REVIEW_PROMPT_VERSION,
    guardrails: [
      "no_medical_advice",
      "no_diagnosis",
      "no_recipes",
      "single_main_focus",
      "resolved_formality_mandatory",
      "block_draft_on_hard_safety",
      "day_by_day_training_aware_analysis",
      "detailed_day_level_athlete_draft",
      "no_generic_athlete_draft_when_daily_facts_exist",
      "no_hallucinated_workouts_or_gels",
      "carb_reference_not_prescriptive",
      "small_step_progression_if_low_carbs",
      "no_english",
      "no_weight_loss_pressure",
      "no_mixed_ty_vy",
      "facts_only_no_recalculation",
      "json_output_required",
      "coach_summary_day_by_day_athlete_draft",
      "interpretation_shadow_v1",
    ],
  });
  const contextHash = stableHash({
    studentId: context.studentUuid,
    weekFrom: context.tpPastWeek.periodFrom,
    weekTo: context.tpPastWeek.periodTo,
    rows: context.manualMacroRows,
    profile: context.resolvedCommunicationProfile,
    tpPastWeek: context.tpPastWeek,
    tpNextWeek: context.tpNextWeek,
    notes,
  });
  const status = safety.blocked
    ? "blocked_safety"
    : methodology.focusCandidateSignals.limitedData || forceNeedsReview || athleteSignalsNeedCoachReview
      ? "needs_review"
      : "draft_ready";

  return {
    data_quality_summary: {
      parsed_days: context.dataQuality.parsedDays,
      low_confidence_days: context.dataQuality.lowConfidenceDays,
      quality_flags: context.dataQuality.qualityFlags,
    },
    safety_flags: {
      hard_flags: safety.hardFlags,
      soft_flags: safety.softFlags,
      blocked: safety.blocked,
    },
    internal_summary: {
      student: context.studentName,
      cache_status: {
        past_week: context.tpPastWeek.cacheStatus,
        next_week: context.tpNextWeek.cacheStatus,
      },
      notes,
      one_focus_category: selectedFocus.category,
      carb_progression_strategy: selectedFocus.progressionStrategy,
    },
    nutrition_summary: {
      avg_kcal: avgKcal,
      avg_protein_g: avgProtein,
      avg_fat_g: avgFat,
      avg_carbs_g: avgCarbs,
      data_quality_summary: {
        parsed_days: context.dataQuality.parsedDays,
        low_confidence_days: context.dataQuality.lowConfidenceDays,
        quality_flags: context.dataQuality.qualityFlags,
      },
      daily_analysis: persistedDailyAnalysis,
      methodology_version: NUTRITION_REVIEW_METHODOLOGY_VERSION,
      training_nutrition_links: methodology.trainingNutritionLinks,
      one_focus: {
        category: selectedFocus.category,
        statement_ru: selectedFocus.statementRu,
        progression_strategy: selectedFocus.progressionStrategy,
      },
      methodology_signals: {
        protein_sufficient: methodology.proteinSufficient,
        carb_reference_band_used: methodology.carbReferenceBandUsed,
        carb_reference_not_prescriptive: methodology.carbReferenceNotPrescriptive,
        long_run_fueling_instruction_detected: methodology.longRunFuelingInstructionDetected,
        during_run_fuel_planned: methodology.duringRunFuelPlanned,
      },
      narrative_preferences: nutritionContextNarrativePreferences(context),
      coach_context_ru: context.coachContextRu,
      bodyweight_kg: methodology.bodyweightKg,
      carb_progression_strategy: selectedFocus.progressionStrategy,
      coach_summary_text: narrative.coach_summary_text,
      day_by_day_analysis_text: narrative.day_by_day_analysis_text,
      generation_mode: narrative.generation_mode,
      prompt_version: NUTRITION_REVIEW_PROMPT_VERSION,
      quality_notes: narrative.quality_notes,
      do_not_send_reasons: [...new Set([...safety.doNotSendReasons, ...narrative.do_not_send_reasons])],
      interpretation_shadow: interpretationShadow,
    },
    tp_context_summary: {
      past_week_key_sessions: context.tpPastWeek.keyWorkouts.length,
      next_week_key_sessions: context.tpNextWeek.keyWorkouts.length,
      past_week_long_run: context.tpPastWeek.longRun?.date ?? null,
      next_week_long_run: context.tpNextWeek.longRun?.date ?? null,
    },
    past_week_findings: [
      `Past week sessions in cache: ${context.tpPastWeek.totalSessions}`,
      `Key workouts detected: ${context.tpPastWeek.keyWorkouts.length}`,
      context.tpPastWeek.cacheStatusNote,
    ],
    next_week_targets: [
      `Next week planned sessions in cache: ${context.tpNextWeek.plannedSessions}`,
      context.tpNextWeek.longRun ? `Long run on ${context.tpNextWeek.longRun.date}` : "Long run not identified in cache",
      context.tpNextWeek.cacheStatusNote,
    ],
    main_focus: mainFocus,
    status,
    daily_analysis: persistedDailyAnalysis,
    methodology_version: NUTRITION_REVIEW_METHODOLOGY_VERSION,
    training_nutrition_links: methodology.trainingNutritionLinks,
    one_focus: {
      category: selectedFocus.category,
      statement_ru: selectedFocus.statementRu,
      progression_strategy: selectedFocus.progressionStrategy,
    },
    methodology_signals: {
      protein_sufficient: methodology.proteinSufficient,
      carb_reference_band_used: methodology.carbReferenceBandUsed,
      carb_reference_not_prescriptive: methodology.carbReferenceNotPrescriptive,
      long_run_fueling_instruction_detected: methodology.longRunFuelingInstructionDetected,
      during_run_fuel_planned: methodology.duringRunFuelPlanned,
      adjacent_training_without_nutrition_days: methodology.adjacentTrainingWithoutNutritionDays,
    },
    athlete_message_draft: narrative.athlete_message_draft,
    coach_summary_text: narrative.coach_summary_text,
    day_by_day_analysis_text: narrative.day_by_day_analysis_text,
    generation_mode: narrative.generation_mode,
    prompt_version: NUTRITION_REVIEW_PROMPT_VERSION,
    do_not_send_reasons: [...new Set([...safety.doNotSendReasons, ...narrative.do_not_send_reasons])],
    athlete_report_signals: context.athleteReportSignals,
    prompt_hash: promptHash,
    context_hash: contextHash,
    ai_model: narrative.ai_model,
  };
}
