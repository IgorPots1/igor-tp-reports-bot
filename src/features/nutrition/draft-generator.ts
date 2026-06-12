import {
  buildNutritionSafetyFlags,
  type NutritionStudentContext,
} from "@/features/nutrition/context";
import {
  buildNutritionMethodologyContext,
  NUTRITION_REVIEW_METHODOLOGY_VERSION,
  selectNutritionWeeklyFocus,
  type CarbProgressionStrategy,
} from "@/features/nutrition/methodology";

export { NUTRITION_REVIEW_METHODOLOGY_VERSION };
import { detectNutritionMacroReviewWeekMismatch } from "@/features/nutrition/report-date-coverage";
import { stableHash } from "@/features/nutrition/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import { getTrainingPeaksReplyDraftFormalityInstruction } from "@/features/trainingpeaks/telegram-context";

const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";
const OPENAI_NUTRITION_REVIEW_MODEL = process.env.OPENAI_NUTRITION_WEEKLY_REVIEW_MODEL?.trim() || "gpt-4o-mini";
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
    };
    bodyweight_kg?: number | null;
    carb_progression_strategy?: CarbProgressionStrategy;
    coach_summary_text?: string;
    day_by_day_analysis_text?: string;
    generation_mode?: "ai" | "fallback";
    methodology_version?: string;
    prompt_version?: string;
    quality_notes?: string[];
    do_not_send_reasons?: string[];
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
  };
  athlete_message_draft: string | null;
  coach_summary_text: string;
  day_by_day_analysis_text: string;
  generation_mode: "ai" | "fallback";
  methodology_version: string;
  prompt_version: string;
  do_not_send_reasons: string[];
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

export function buildNutritionDailyFactsForNarrative(input: {
  context: NutritionStudentContext;
  dailyAnalysis: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  const workoutTitles = buildWorkoutTitleMap(input.context);
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
        findings:
          Array.isArray(canonical?.findings)
            ? canonical.findings.filter((item): item is string => typeof item === "string")
            : Array.isArray(day.findings)
              ? day.findings.filter((item): item is string => typeof item === "string")
              : [],
        training_nutrition_links:
          Array.isArray(canonical?.trainingNutritionLinks)
            ? canonical.trainingNutritionLinks
            : [],
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
  quality_notes: string[];
  do_not_send_reasons: string[];
};

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
}): Promise<NutritionAiNarrative | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const allowAthleteDraft = !input.safetyFlags.blocked;
  const formalityInstruction = getTrainingPeaksReplyDraftFormalityInstruction(
    input.context.resolvedCommunicationProfile.formality
  );
  const systemPrompt = [
    "Пиши только на русском языке.",
    "Ты пишешь недельный nutrition review только по deterministic facts.",
    "LLM writes. Code calculates.",
    "Ничего не пересчитывай и не придумывай: kcal, белки/жиры/углеводы, г/кг, formula targets, day type, nutrition status, one_focus, safety status, race status, TrainingPeaks workouts.",
    "Используй только exact числа и labels из facts JSON.",
    "Не классифицируй дни и не выводи формулы — это уже сделано в коде.",
    "Return strict JSON only with keys: coach_summary_text, day_by_day_analysis_text, athlete_message_draft, quality_notes, do_not_send_reasons.",
    "coach_summary_text: короткий внутренний текст для тренера.",
    "day_by_day_analysis_text: дневные блоки строго по canonical daily_analysis.",
    "Для каждого дня при наличии данных используй: weekday_ru, date_label, training_label, actual, hint_for_comment/findings.",
    "В day_by_day_analysis_text комментируй только дневные totals; без intraday утверждений (до/во время/после тренировки, граммы по таймингу, гели).",
    "Если source_quality.confidence=low или suspect=true, формулируй осторожно как ограничение данных.",
    "athlete_message_draft должен включать 3-7 дневных наблюдений, если daily facts есть.",
    "athlete_message_draft: только plain Telegram text. Разрешены emoji-разделители.",
    "Запрещено в athlete_message_draft: **, ---, code fences, markdown headings.",
    "Строгая формальность: только ты ИЛИ только вы, без смешивания.",
    "Не используй диагнозы/медицинские термины: RED-S, REDs, LEA, дефицит энергии, расстройство, анемия.",
    "Не используй язык похудения/ограничения: похудеть, сбросить вес, урезать калории, меньше есть, дефицит калорий.",
    "Не давай меню/диету/рецепты. Продукты только как варианты при наличии фактов.",
    "Не придумывай тренировки и не придумывай гели/fueling.",
    "Разрешённая причинность только с хеджами: может, могло, вполне могло, не утверждаю наверняка.",
    "Запрещённая причинность: вызвало, из-за этого точно, именно поэтому.",
    "Use the required ты/вы form from formality instruction.",
    "Упоминание athlete name допускается при наличии в facts.",
    "One focus only: используй exact one_focus из facts.",
    allowAthleteDraft
      ? "athlete_message_draft is required and must be useful Telegram-ready text."
      : "Hard safety flags present: athlete_message_draft must be null and coach-only text should explain manual review need.",
    `Formality instruction: ${formalityInstruction}`,
  ].join("\n");

  const dailyFacts = buildNutritionDailyFactsForNarrative({
    context: input.context,
    dailyAnalysis: input.dailyAnalysis,
  });
  const factsPayload = {
    student: {
      name: input.context.studentName,
      formality: input.context.resolvedCommunicationProfile.formality,
    },
    tp_context: {
      past_week: input.context.tpPastWeek,
      next_week: input.context.tpNextWeek,
    },
    data_quality: input.context.dataQuality,
    daily_analysis: dailyFacts,
    daily_analysis_raw: input.dailyAnalysis,
    training_nutrition_links: input.trainingNutritionLinks,
    one_focus: input.oneFocus,
    methodology_signals: input.methodologySignals,
    safety_flags: input.safetyFlags,
    allow_athlete_draft: allowAthleteDraft,
  };

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_NUTRITION_REVIEW_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Facts JSON:\n${JSON.stringify(factsPayload, null, 2)}` },
        ],
      }),
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return null;
    }
    const parsed = JSON.parse(extractJsonOnly(content)) as Partial<NutritionAiNarrative>;
    const coachSummary = typeof parsed.coach_summary_text === "string" ? parsed.coach_summary_text.trim() : "";
    const dayByDay = typeof parsed.day_by_day_analysis_text === "string" ? parsed.day_by_day_analysis_text.trim() : "";
    if (!coachSummary || !dayByDay) {
      return null;
    }
    const athleteDraftRaw = typeof parsed.athlete_message_draft === "string" ? parsed.athlete_message_draft.trim() : null;
    const athleteDraft = allowAthleteDraft ? athleteDraftRaw : null;
    return {
      coach_summary_text: coachSummary,
      day_by_day_analysis_text: dayByDay,
      athlete_message_draft: athleteDraft,
      quality_notes: Array.isArray(parsed.quality_notes)
        ? parsed.quality_notes.filter((item): item is string => typeof item === "string")
        : [],
      do_not_send_reasons: Array.isArray(parsed.do_not_send_reasons)
        ? parsed.do_not_send_reasons.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
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
  const resolvedMacroDays = context.manualMacroRows.filter((row) => !row.day.startsWith("unresolved:")).length;
  const hasUsableTrainingContext =
    context.tpPastWeek.workouts.length > 0 &&
    (context.tpPastWeek.cacheStatus === "ok" || context.tpPastWeek.cacheStatus === "stale");
  const hasMethodologyFacts =
    resolvedMacroDays > 0 &&
    context.dataQuality.parsedDays > 0 &&
    context.dataQuality.hasResolvedDates &&
    Boolean(selectedFocus.statementRu.trim()) &&
    hasUsableTrainingContext;
  const forceNeedsReview = !hasMethodologyFacts;
  if (!hasMethodologyFacts) {
    notes.push("methodology_facts_incomplete_for_ai_generation");
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
    quality_notes: string[];
    do_not_send_reasons: string[];
    generation_mode: "ai" | "fallback";
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
    quality_notes: [] as string[],
    do_not_send_reasons: [] as string[],
    generation_mode: "fallback" as const,
    ai_model: "nutrition-weekly-review-fallback-v2",
  };
  if (!forceNeedsReview) {
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
    });
    if (aiNarrative) {
      narrative = {
        ...aiNarrative,
        generation_mode: "ai",
        ai_model: OPENAI_NUTRITION_REVIEW_MODEL,
      };
    }
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
    : methodology.focusCandidateSignals.limitedData || forceNeedsReview
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
      bodyweight_kg: methodology.bodyweightKg,
      carb_progression_strategy: selectedFocus.progressionStrategy,
      coach_summary_text: narrative.coach_summary_text,
      day_by_day_analysis_text: narrative.day_by_day_analysis_text,
      generation_mode: narrative.generation_mode,
      prompt_version: NUTRITION_REVIEW_PROMPT_VERSION,
      quality_notes: narrative.quality_notes,
      do_not_send_reasons: [...new Set([...safety.doNotSendReasons, ...narrative.do_not_send_reasons])],
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
    },
    athlete_message_draft: narrative.athlete_message_draft,
    coach_summary_text: narrative.coach_summary_text,
    day_by_day_analysis_text: narrative.day_by_day_analysis_text,
    generation_mode: narrative.generation_mode,
    prompt_version: NUTRITION_REVIEW_PROMPT_VERSION,
    do_not_send_reasons: [...new Set([...safety.doNotSendReasons, ...narrative.do_not_send_reasons])],
    prompt_hash: promptHash,
    context_hash: contextHash,
    ai_model: narrative.ai_model,
  };
}
