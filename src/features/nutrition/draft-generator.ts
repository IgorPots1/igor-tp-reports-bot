import {
  nutritionAthleteReportSignalsRequireCoachReview,
  type NutritionAthleteReportSignal,
} from "@/features/nutrition/athlete-signals";
import {
  buildNutritionSafetyFlags,
  isNutritionNoTrainingNextWeek,
  nutritionContextNarrativePreferences,
  type NutritionFatFeedbackPolicy,
  type NutritionFoodItem,
  type NutritionMealSection,
  type NutritionNarrativePreferences,
  type NutritionStudentContext,
} from "@/features/nutrition/context";
import { buildNutritionDayProseFacts } from "@/features/nutrition/combined-message";
import {
  buildNutritionNextWeekPlan,
  computeNutritionGoalDayTarget,
  computeNutritionRaceProtocol,
  estimatePlanDayExerciseKcal,
  type NutritionNextWeekPlan,
  type NutritionPlanDayType,
} from "@/features/nutrition/weekly-plan-formulas";
import type { NutritionPlanTargetWeekMode } from "@/features/nutrition/plan-week-policy";
import {
  EVENING_SECTIONS,
  pickNotableFoods,
  pickNotableCarbItemsWithGrams,
  resolveWeekNarrativeDayRoles,
} from "@/features/nutrition/narrative-composer";
import { classifyCarbItem, classifyProteinItem, CARB_CONTRIBUTOR_MIN_G, type CarbClass } from "@/features/nutrition/carb-quality";
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
  formatAthleteWorkoutTitleRu,
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
  NUTRITION_ATHLETE_FORBIDDEN_COACH_TERM_WORDS,
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
    /**
     * Carbs averaged over LOAD days only (role !== rest) — what the methodology is actually about,
     * unlike avg_carbs_g, which averages rest days in. null on a week with no load days.
     */
    avg_carbs_g_load_days?: number | null;
    /**
     * Code-computed week-over-week averages + deltas (never model-authored). Persisted so the
     * derived weekly summary can name a real shift at render time without a second DB read.
     * null when there is no prior week; absent on reviews generated before this field existed.
     * The weekly summary's trend line reads delta_carbs_g_load_days — never delta_carbs_g.
     */
    week_over_week?: {
      previous_week_from: string;
      previous_avg_kcal: number | null;
      current_avg_kcal: number | null;
      delta_kcal: number | null;
      previous_avg_carbs_g: number | null;
      current_avg_carbs_g: number | null;
      delta_carbs_g: number | null;
      previous_avg_protein_g: number | null;
      current_avg_protein_g: number | null;
      delta_protein_g: number | null;
      previous_avg_carbs_g_load_days?: number | null;
      current_avg_carbs_g_load_days?: number | null;
      delta_carbs_g_load_days?: number | null;
    } | null;
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
    /** Block 3: warm opening line for the athlete (qualitative, no numbers). */
    athlete_opening_note_ru?: string | null;
    generation_mode?: "ai" | "fallback" | "awaiting_generation";
    methodology_version?: string;
    prompt_version?: string;
    quality_notes?: string[];
    do_not_send_reasons?: string[];
    interpretation_shadow?: NutritionInterpretationShadowMetadata | null;
    narrative_preferences?: NutritionNarrativePreferences;
    coach_context_ru?: string | null;
    /** Task 6: next-week plan prose from the same Claude call (null if held/blocked). */
    next_week_plan_text?: string | null;
    /** Task 6: deterministic next-week plan numbers the model was shown. */
    next_week_plan?: NutritionNextWeekPlan;
    /** Task 6: the plan target week these numbers/prose cover. */
    plan_week?: { from: string; to: string; mode: NutritionPlanTargetWeekMode };
    /** Task 7: non-null once coach-approved history exists (flips hasPreviousWeeksContext). */
    previous_weeks_context?: Record<string, unknown> | null;
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
  /** Task 6: next-week plan prose from the same Claude call (null if held/blocked). */
  next_week_plan_text: string | null;
  /** Task 6: deterministic next-week plan numbers the model was shown. */
  next_week_plan: NutritionNextWeekPlan;
  /** Task 6: the plan target week these numbers/prose cover. */
  plan_week: { from: string; to: string; mode: NutritionPlanTargetWeekMode };
};

function avg(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  const total = present.reduce((sum, value) => sum + value, 0);
  return Number((total / present.length).toFixed(1));
}

// Anomalous-input days (suspect kcal/macros — rowLooksUnrealistic) become a NON-blocking
// data_quality advisory: combined-message treats data_quality:* like safety advisories, so
// it is visible to the coach but never hides the athlete text. The athlete sees the soft
// per-day "перепроверь продукт" note instead (see the suspect_macro_values prompt rule).
function buildDataQualityDoNotSendReasons(context: NutritionStudentContext): string[] {
  return context.dataQuality.unrealisticRows > 0
    ? ["data_quality:нереалистичные числа в днях — вероятно ошибка ввода (вес/порция продукта), проверь данные"]
    : [];
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
      // ПЕРЕВОДИМ ЗДЕСЬ. Этот титул уезжает в факты дня для модели (workoutTitle) и в
      // training_label как фолбэк. Раньше уезжал СЫРЫМ, и модель цитировала «Hiit» в тексте
      // ученице — англицизм писала не она, его подсовывали мы. Приоритет выше считается по
      // СЫРОМУ названию, так что выбор тренировки дня не меняется.
      map.set(workout.date, formatAthleteWorkoutTitleRu(title));
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
  // Deterministic carb-speed class (code-owned, from the PDF item carbs). The
  // model may only repeat this; it must NEVER call a fast/neutral item "slow".
  carb_class: CarbClass;
  // Deterministic protein-source flag (code-owned). The model may call an item a
  // protein source ONLY when this is true; guards against "грибы=белок" inventions.
  protein_contributor: boolean;
};

function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Наряд 3: dates within race-week (lead-up + race day + recovery) where a losing
 * athlete's deficit is switched off. Built from the review-window race events.
 */
function buildRaceWeekDeficitOffDates(context: NutritionStudentContext): Set<string> {
  const dates = new Set<string>();
  for (const race of context.raceEvents ?? []) {
    const leadDays = computeNutritionRaceProtocol({ distanceKm: race.distanceKm, title: race.title }).loading?.days ?? 2;
    for (let offset = -leadDays; offset <= 1; offset += 1) {
      dates.add(shiftIsoDate(race.eventDate, offset));
    }
  }
  return dates;
}

const NUTRITION_WEEKDAY_NAMES: Array<{ rx: RegExp; dow: number }> = [
  { rx: /понедельник/iu, dow: 1 },
  { rx: /вторник/iu, dow: 2 },
  { rx: /сред[аеуы]/iu, dow: 3 },
  { rx: /четверг/iu, dow: 4 },
  { rx: /пятниц[аеуы]/iu, dow: 5 },
  { rx: /суббот[аеуы]/iu, dow: 6 },
  { rx: /воскресень[ея]/iu, dow: 0 },
];

/**
 * Цель 4: split the athlete's week-level comment into per-day segments by Russian
 * weekday markers ("Среда перед интервалами … Пятница … Суббота …") and map each
 * to the ISO date of that weekday inside the review week. So a day-specific food
 * note lands on the right day's facts (and the model reflects it in THAT day's
 * comment). Text only — never a source of numbers (the day_prose validator still
 * gates numbers to the PDF facts).
 */
export function buildAthleteDayNotes(comment: string | null, weekFrom: string, weekTo: string): Map<string, string> {
  const result = new Map<string, string>();
  const text = (comment ?? "").trim();
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(weekFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(weekTo)) {
    return result;
  }
  // Map each weekday-of-week to its ISO date within the review window.
  const dateByDow = new Map<number, string>();
  for (let cursor = weekFrom; cursor <= weekTo; ) {
    dateByDow.set(new Date(`${cursor}T00:00:00Z`).getUTCDay(), cursor);
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  // Find weekday markers with positions, then take the text up to the next marker.
  const markers: Array<{ index: number; dow: number }> = [];
  for (const { rx, dow } of NUTRITION_WEEKDAY_NAMES) {
    const m = new RegExp(rx.source, "giu");
    let hit: RegExpExecArray | null;
    while ((hit = m.exec(text)) !== null) {
      markers.push({ index: hit.index, dow });
    }
  }
  markers.sort((a, b) => a.index - b.index);
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
    const date = dateByDow.get(markers[i].dow);
    if (!date) {
      continue;
    }
    const segment = text.slice(start, end).trim();
    if (segment) {
      result.set(date, result.has(date) ? `${result.get(date)} ${segment}` : segment);
    }
  }
  return result;
}

type NutritionPreWorkoutAdequacy = "good" | "medium" | "low";

/** Parse a "за час / за 2 часа / за 30 минут / за полчаса" timing hint, if present. */
function parsePreWorkoutTiming(segment: string): string | null {
  if (/за\s*(?:30|тридцать)\s*мин|за\s*полчаса/u.test(segment)) return "~30 мин до старта";
  const minutes = segment.match(/за\s*(\d{1,3})\s*мин/u);
  if (minutes) return `~${minutes[1]} мин до старта`;
  if (/за\s*час\b|за\s*1\s*час/u.test(segment)) return "~1 ч до старта";
  const hours = segment.match(/за\s*(\d)\s*(?:час|ч\b)/u);
  if (hours) return `~${hours[1]} ч до старта`;
  return null;
}

/**
 * Наряд 3 Пункт 3 (вариант A): link the athlete's words ("перед интервалами
 * батончик и печенье") to the day's REAL diary items, sum their carbs from the
 * PDF, and rate adequacy against the day's LOAD (intervals/long need more, easy
 * less). Numbers stay in the calculation; delivery is QUALITATIVE (good/medium/
 * low + foods + optional timing) so the strict day-prose validator never drops
 * the day. Returns null when nothing matches (no invented numbers).
 */
export function computePreWorkoutCarbsFromDiary(
  dayNote: string | null,
  items: NutritionFoodItem[] | undefined,
  dayType?: string | null,
  bodyweightKg?: number | null
): {
  foods: string[];
  carbs_g: number;
  adequacy: NutritionPreWorkoutAdequacy;
  timing: string | null;
  heavy_foods: string[];
} | null {
  const note = (dayNote ?? "").toLowerCase();
  const safeItems = Array.isArray(items) ? items : [];
  if (!note.trim() || safeItems.length === 0) {
    return null;
  }
  // Pre-workout part = text before "после"/"сразу после"/"after" (drop post-workout).
  const preSegment = note.split(/после|сразу\s+после|after|\bпотом\b/u)[0] ?? note;
  if (!/перед|до\s+трениров|до\s+забег|до\s+пробеж|до\s+старта|до\s+интервал/u.test(preSegment)) {
    return null;
  }
  const foods: string[] = [];
  const heavyFoods: string[] = [];
  let carbs = 0;
  for (const item of safeItems) {
    const name = (item.name ?? "").trim();
    if (!name) {
      continue;
    }
    // A diary item counts as pre-workout if any of its meaningful name tokens
    // (≥4 letters/latin) appears in the pre-workout text.
    const tokens = name
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((t) => t.length >= 4);
    if (tokens.some((t) => preSegment.includes(t)) && typeof item.carbsG === "number") {
      foods.push(name);
      carbs += item.carbsG;
      // Heavy/fatty pre-workout food (slow to digest → heaviness/GI on the run).
      if (typeof item.fatG === "number" && item.fatG >= 12) {
        heavyFoods.push(name);
      }
    }
  }
  if (foods.length === 0) {
    return null;
  }
  // Methodology orientation: a harder/longer effort needs more pre-workout carbs.
  // Rate by g/kg when bodyweight is known, else by absolute grams. Numbers stay
  // internal — only the verdict is delivered.
  const needsMore = ["intervals", "tempo", "race", "long_run", "long_endurance", "hard"].includes(dayType ?? "");
  const perKg = typeof bodyweightKg === "number" && bodyweightKg > 0 ? carbs / bodyweightKg : null;
  let adequacy: NutritionPreWorkoutAdequacy;
  if (needsMore) {
    adequacy = perKg != null ? (perKg >= 1 ? "good" : perKg >= 0.5 ? "medium" : "low") : carbs >= 75 ? "good" : carbs >= 45 ? "medium" : "low";
  } else {
    adequacy = perKg != null ? (perKg >= 0.5 ? "good" : perKg >= 0.25 ? "medium" : "low") : carbs >= 30 ? "good" : carbs >= 15 ? "medium" : "low";
  }
  return { foods, carbs_g: Math.round(carbs), adequacy, timing: parsePreWorkoutTiming(preSegment), heavy_foods: heavyFoods };
}

/**
 * Notable food items for a day, grouped by meal section, as raw material for the
 * model to name food in prose. IMPORTANT: only names + contribution markers are
 * exposed — never per-item gram numbers — so the model cannot quote item-level
 * numbers that are not in the day-total facts whitelist (see validator task).
 */
function buildNotableItemsForNarrative(items: NutritionFoodItem[] | undefined): {
  by_section: Partial<Record<NutritionMealSection, NutritionNarrativeNotableItem[]>>;
  carb_foods: Array<{ name: string; carb_class: CarbClass }>;
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
        carb_contributor: typeof item.carbsG === "number" && item.carbsG >= CARB_CONTRIBUTOR_MIN_G,
        carb_class: classifyCarbItem(item.name, item.carbsG),
        protein_contributor: classifyProteinItem(item.name, item.proteinG),
      }));
    if (sectionItems.length > 0) {
      bySection[section] = sectionItems;
    }
  }
  return {
    by_section: bySection,
    // Each primary carb food carries its deterministic class so the model never
    // has to guess fast vs slow (the root of the банан/булочка "медленные" bug).
    carb_foods: pickNotableCarbItemsWithGrams(safeItems, { limit: 4 }).map((food) => ({
      name: food.name,
      carb_class: classifyCarbItem(food.name, food.carbsG),
    })),
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
  const raceWeekDeficitOffDates = buildRaceWeekDeficitOffDates(input.context);
  const reviewWeekFrom = input.context.tpPastWeek.periodFrom;
  const reviewWeekTo = input.context.tpPastWeek.periodTo;
  const athleteDayNotes = buildAthleteDayNotes(input.context.athleteCommentRu, reviewWeekFrom, reviewWeekTo);
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
      // Task 10++: for lose/gain, the day's "deficit line" — the same goal-aware
      // target the plan uses, anchored on BMR + this day's REAL TP expenditure.
      // The model evaluates the actual intake against THIS, not the maintenance
      // corridor (fixes "2750 in a rest day = calm" for a losing athlete).
      const dayPlanTargets = (() => {
        const goalType = input.context.nutritionGoalType;
        const planDayType: NutritionPlanDayType =
          trainingType === "intervals" || trainingType === "tempo"
            ? "hard"
            : trainingType === "long_run"
              ? "long_run"
              : trainingType === "long_endurance"
                ? "long_endurance"
                : trainingType === "race"
                  ? "race"
                  : trainingType === "strength"
                    ? "strength"
                    : trainingType === "cross_training"
                      ? "cross_training"
                      : trainingType === "easy"
                        ? "easy"
                        : preLong
                          ? "pre_long"
                          : trainingType === "rest"
                            ? "rest"
                            : "unknown";
        const bw = typeof bodyweightKg === "number" ? bodyweightKg : null;
        const ea =
          canonical?.energyAvailability && typeof canonical.energyAvailability === "object"
            ? (canonical.energyAvailability as Record<string, unknown>)
            : null;
        const exerciseFromTp = ea && typeof ea.exerciseEnergyKcal === "number" ? (ea.exerciseEnergyKcal as number) : null;
        // The day's carb corridor scales by the session's duration, so this target must scale
        // by the SAME duration the plan uses — otherwise the review quotes an energy target
        // computed from one corridor while the plan for that very day asks for another
        // (80-min long run: 350 г vs 290 г). Read from the canonical day, never re-derived.
        const canonicalDurationMinutes =
          typeof canonical?.workoutDurationMinutes === "number" ? (canonical.workoutDurationMinutes as number) : null;
        const durationHours = canonicalDurationMinutes !== null ? canonicalDurationMinutes / 60 : null;
        const exerciseKcal =
          exerciseFromTp ??
          (bw ? estimatePlanDayExerciseKcal({ dayType: planDayType, bodyweightKg: bw, durationHours, distanceKm: null }) : 0);
        const target = computeNutritionGoalDayTarget({
          goalType,
          dayType: planDayType,
          bodyweightKg: bw,
          sex: input.context.sex,
          heightCm: input.context.heightCm,
          ageYears: input.context.ageYears,
          exerciseKcal,
          durationHours,
          raceWeekDeficitOff: raceWeekDeficitOffDates.has(date),
        });
        if (!target) {
          return { goalDayTarget: null, energyTargetKcal: null };
        }
        const actualKcal =
          typeof day.kcal === "number"
            ? day.kcal
            : canonicalActual && typeof canonicalActual.kcal === "number"
              ? (canonicalActual.kcal as number)
              : null;
        return {
          // The lose/gain DEFICIT LINE keeps its exact meaning and stays null for maintain: the
          // prompt tells the model to judge the day's intake AGAINST it, and that framing must not
          // reach a maintaining athlete.
          goalDayTarget:
            goalType === "maintain"
              ? null
              : {
                  goal: goalType,
                  target_kcal: target.target_kcal,
                  protein_g: target.protein_g,
                  fat_g: target.fat_g,
                  carbs_g: target.carbs_g,
                  // lose: intake well above the deficit line on this day = more than the
                  // goal needs (gently note as surplus), NOT "ровно/спокойно".
                  over_goal_line: actualKcal !== null ? actualKcal > target.target_kcal + 150 : null,
                },
          // The day's ENERGY ORIENTATION — computed for EVERY goal, maintain included. For maintain
          // computeNutritionGoalDayTarget returns the ideal day-type target, i.e. exactly the kcal
          // the athlete reads on her own plan line («🔥 Тяжёлый день - ~2300 ккал · 95 Б · 65 Ж · 330 У»).
          //
          // It is carried purely as a FACT, so the prose may cite it. Without it the model wrote
          // «Калорийность 2008 ккал — чуть ниже, чем хотелось бы под такую нагрузку (ориентир около
          // 2300)» about a real, code-computed number — and the whole day's prose was thrown away as
          // an invented one, because the review day's target carried carb bounds and nothing else.
          // The number guard exists to stop INVENTED numbers, not to forbid a whole category of true
          // ones; energy is a legitimate part of the conversation (the coach sets it in the plan and
          // the athlete reads it there).
          energyTargetKcal: target.target_kcal,
        };
      })();
      const goalDayTarget = dayPlanTargets.goalDayTarget;
      const dayEnergyTargetKcal = dayPlanTargets.energyTargetKcal;
      // Поток B: for lose/gain, the cited carb ORIENTATION must match the plan's
      // goal target, not the maintenance corridor (g/kg). Reuse the already-computed
      // goalDayTarget (same computeNutritionGoalDayTarget the plan uses — no formula
      // duplication, no rsync) and route its carbs into the day's target band (±20 г,
      // round 10 — same display band as the plan). maintain → goalDayTarget is null →
      // the corridor stays byte-identical.
      const goalAwareCanonicalTarget = (() => {
        const base = canonicalTarget ?? { formulaCode: "legacy_daily_v1" };
        // The day's energy orientation rides along with the carb corridor, for EVERY goal. The
        // canonical target from methodology carries carb bounds (and, for long days, an energy
        // FLOOR) — it never carried the day's actual kcal target, which is why a prose citing it
        // was treated as invented. kcalTarget is that number, and buildNutritionDayProseFacts
        // allows it exactly like the carb bounds: exact value + 5/10 roundings, nothing looser.
        const withEnergy =
          typeof dayEnergyTargetKcal === "number" && Number.isFinite(dayEnergyTargetKcal)
            ? { ...base, kcalTarget: dayEnergyTargetKcal }
            : base;
        const carbs = goalDayTarget?.carbs_g;
        if (!goalDayTarget || typeof carbs !== "number" || !Number.isFinite(carbs)) {
          return withEnergy;
        }
        const bw = typeof bodyweightKg === "number" && bodyweightKg > 0 ? bodyweightKg : null;
        const carbsMin = Math.round((carbs - 20) / 10) * 10;
        const carbsMax = Math.round((carbs + 20) / 10) * 10;
        const baseCode = typeof base.formulaCode === "string" ? base.formulaCode : "canonical_daily_v1";
        return {
          ...withEnergy,
          carbsGMin: carbsMin,
          carbsGMax: carbsMax,
          carbsGPerKgMin: bw ? Number((carbsMin / bw).toFixed(2)) : base.carbsGPerKgMin,
          carbsGPerKgMax: bw ? Number((carbsMax / bw).toFixed(2)) : base.carbsGPerKgMax,
          formulaCode: `${baseCode}_goal`,
        };
      })();
      return {
        date,
        weekday_ru: typeof canonical?.weekdayRu === "string" ? canonical.weekdayRu : null,
        date_label: typeof canonical?.dateLabel === "string" ? canonical.dateLabel : formatDateRu(date),
        training_type: typeof canonical?.trainingType === "string" ? canonical.trainingType : trainingType,
        training_label:
          typeof canonical?.trainingLabel === "string"
            ? canonical.trainingLabel
            : workoutTitles.get(date) ?? formatTrainingTypeRu(trainingType),
        // Factual part of day (start_time of the completed session). null → unknown,
        // the model must give day-level advice without inventing a time (see prompt rule).
        time_of_day: typeof canonical?.timeOfDay === "string" ? canonical.timeOfDay : null,
        actual: canonicalActual ?? {
          kcal: typeof day.kcal === "number" ? day.kcal : null,
          proteinG: typeof day.proteinG === "number" ? day.proteinG : null,
          fatG: typeof day.fatG === "number" ? day.fatG : null,
          carbsG: typeof day.carbsG === "number" ? day.carbsG : null,
          proteinGPerKg: typeof day.proteinGPerKg === "number" ? day.proteinGPerKg : null,
          carbsGPerKg: typeof day.carbsGPerKg === "number" ? day.carbsGPerKg : null,
        },
        target: goalAwareCanonicalTarget,
        goal_day_target: goalDayTarget,
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
        athlete_day_note: athleteDayNotes.get(date) ?? null,
        pre_workout: computePreWorkoutCarbsFromDiary(
          athleteDayNotes.get(date) ?? null,
          itemsByDate.get(date),
          trainingType,
          bodyweightKg
        ),
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
   * Block 3: one warm, qualitative opening line for the athlete, derived from the
   * athlete's own words (student.athlete_comment) — effort/circumstances only,
   * never numbers. Rendered after the greeting in the combined message (part 1).
   * Null/empty when there is nothing genuine to acknowledge (no invented praise).
   */
  athlete_opening_note_ru: string | null;
  /**
   * Athlete-facing prose for next week's nutrition plan, written in the same
   * Claude call as the review (Task 6 merge). Numbers in this prose are the
   * deterministic next_week_plan targets, rounded to 10 (Task 4 rule). Null when
   * safety-blocked or the model produced nothing usable (awaiting_generation).
   */
  next_week_plan_text: string | null;
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
  /**
   * Week-over-week numbers + deltas, computed BY CODE (never the model). Fed into
   * the facts so the model can praise a REAL progress shift using these exact
   * numbers. Null when there is no prior week.
   */
  weekOverWeek: {
    previous_week_from: string;
    previous_avg_kcal: number | null;
    current_avg_kcal: number | null;
    delta_kcal: number | null;
    previous_avg_carbs_g: number | null;
    current_avg_carbs_g: number | null;
    delta_carbs_g: number | null;
    previous_avg_protein_g: number | null;
    current_avg_protein_g: number | null;
    delta_protein_g: number | null;
  } | null;
  dailyAnalysis: Array<Record<string, unknown>>;
  /**
   * Deterministic next-week plan numbers (Task 6). The model writes plan prose
   * (next_week_plan_text) grounded in these targets — it never invents numbers.
   */
  nextWeekPlan: NutritionNextWeekPlan;
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
  safetyFlags: {
    hard_flags: string[];
    soft_flags: string[];
    blocked: boolean;
    /** Days with critically low energy (<1300 kcal) — woven into the review as an
     * honest "так повторять нельзя" note. Non-blocking (coach decision). */
    very_low_kcal_days?: string[];
  };
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
    "Return strict JSON only with keys: coach_summary_text, day_by_day_analysis_text, athlete_message_draft, athlete_opening_note_ru, day_prose, next_week_plan_text, quality_notes, do_not_send_reasons.",
    "do_not_send_reasons — ТОЛЬКО для реально неотправляемых SAFETY-причин (риск здоровья, требующий ручной проверки тренером перед отправкой). АНОМАЛИИ ДАННЫХ (нереалистичные числа: огромные ккал, белок/жир/углеводы вне реального диапазона, явная ошибка ввода веса/порции) сюда НЕ клади — они НЕ блокируют разбор. Про аномальный день пиши в его day_prose (правило про suspect_macro_values ниже): мягко отметь вероятную ошибку ввода продукта и попроси перепроверить. По умолчанию do_not_send_reasons пустой.",
    "next_week_plan_text: athlete-facing проза ПЛАНА на следующую неделю (одним связным куском, тот же тёплый голос Игоря, plain Telegram text). Это продолжение того же сообщения после разбора прошлой недели — не повторяй приветствие. Опиши, на чём сделать акцент по питанию под РЕАЛЬНЫЕ ключевые тренировки следующей недели из next_week_plan (интервалы/длительная/темпо и дни перед ними): что есть и насколько добрать углеводами накануне ключевых дней. Без раскладки по граммам на каждый день — это сделает код-таблица отдельно.",
    "ПЛАН — БЕЗ ВРЕМЕНИ СУТОК: в next_week_plan_text НЕ указывай время следующих тренировок и не привязывай к нему совет — НЕ пиши «тренировка утром/днём/вечером», «утром поешь», «завтрак за 2-3 часа до», «накануне вечером поешь, потому что бежишь утром». Времени БУДУЩИХ тренировок мы не знаем (плановое время ненадёжно), поэтому план даёт только ДНЕВНЫЕ ориентиры по дням (что и сколько за день, где добрать углеводов накануне ключевого дня) — без часа и без времени суток. Тайминг по времени суток («тренировка была утром, поэтому…») допустим ТОЛЬКО в разборе прошлой недели (day_prose), где время взято из факта. Исключение для плана — только день старта по race_protocol.timing (правило ниже).",
    "ЧИСЛА в next_week_plan_text бери ТОЛЬКО из next_week_plan (display_target.carbs_g_min/max, kcal, целевые по типу дня) и округляй до 10 (углеводы/ориентиры) — пиши «около 300 г», «300–320 г»; не выдумывай промежуточных и негладких чисел, г/кг ученику не пиши. Если тренировок на следующей неделе в плане нет (next_week_plan.summary.has_training_context=false) — общий мягкий фокус без привязки к дням.",
    "next_week_plan_text подчиняется тем же запретам, что и athlete_message_draft: без диагнозов/медтерминов, без языка похудения, без меню/рецептов, без выдуманных тренировок и гелей, строгая ты/вы.",
    "СТАРТ/ГОНКА в next_week_plan (день с flags.race=true и объектом race_protocol): отметь его в next_week_plan_text как ОСОБЫЙ день старта (назови старт), не как обычный день. Следуй race_protocol: (1) loading=null → это КОРОТКИЙ старт (короче ~90 мин, 5-10 км): углеводную ЗАГРУЗКУ НЕ предлагай, питание как в интенсивный день; НЕ переоценивай, не пиши про «заряд/загрузку на несколько дней». loading!=null (полумарафон+) → плавная загрузка за несколько дней ШАГАМИ от обычного (без г/кг ученику, без рывков). Совет про загрузку формулируй ЖИВОЙ человеческой фразой, называя причиной ДИСТАНЦИЮ/СОБЫТИЕ («полумарафон — серьёзная нагрузка, к старту стоит подойти с полными запасами, загрузка с пятницы»). НЕ указывай числовую границу времени («дольше 90 минут», «полтора часа на ногах», «больше 1.5 часа») — это внутренний порог, у быстрых бегунов он неверен и путает; дистанция/событие — достаточный сигнал. НЕ техническая пометка в скобках («(нужна загрузка)», «(carb loading)», «(нужна углеводная загрузка)»). (2) gel_before=true (≥10 км) → обязательно «один гель за ~10 минут до старта»; gel_before=false (5 км) — про гель не пиши. (3) timing='evening_or_night' → старт вечером/ночью: углеводы по дню, последний полноценный приём за 2-3 ч до старта, не наедаться тяжёлого днём и не голодать к вечеру; timing='morning' → углеводный ужин накануне + завтрак за 2-3 ч. (4) после старта — углеводы+белок на восстановление. Тон тёплый, «ориентир не обязательство», без медтерминов.",
    "ХУДЕЮЩИЙ + СТАРТ (race-week): для goal=lose в неделю старта дефицит ВЫКЛЮЧАЕТСЯ — питаемся нормально/грузимся под старт, загрузка ПОБЕЖДАЕТ снижение (выходить на старт в дефиците опасно: неполный гликоген, риск «стены»). НЕ смешивай: запрещено «грузись, но оставайся в дефиците». В эти дни не пиши про снижение/дефицит/срез вообще; после старта — день восстановления (углеводы+белок), затем обычный режим цели возвращается. Числа дня уже посчитаны кодом без дефицита — просто поддержи это тоном.",
    "ЦЕЛЬ lose — РАМКА в next_week_plan_text: один раз мягко объясни, ЗАЧЕМ так выстроена неделя, связав с её целью снижения — например «дни отдыха идут в мягком минусе и работают на твою цель, а тренировки питаем полноценно, чтобы снижать вес без потери качества бега». Это даёт ученице понять логику недели, а не просто список советов. По-доброму, в тёплом тоне, без слов диета/худей/урезай/дефицит. Добавляй такую рамку ТОЛЬКО для lose; для maintain/gain — не добавляй.",
    "Числа-тренды из истории ученика (student.history.key_trends) и любые сравнения с прошлыми неделями пиши в «итог недели» (day_by_day_analysis_text/week summary) или в фокус — НЕ в подневную day_prose (там числа проверяются построчно по фактам дня). План пиши вперёд («на следующей неделе держи …»).",
    "day_prose: объект {\"YYYY-MM-DD\": \"проза дня\"} по каждому дню из daily_analysis. Это athlete-facing проза комментария дня. Длину выбирай по day_role: steady/rest — одна-две фразы; key/hard/pre_long — абзац подробнее.",
    "Подача каждого дня как у Игоря, трёхтактно: (1) что хорошо — конкретно похвали («белок 107 отлично, в самую точку», «хорошо, что калорийность подросла»); (2) что недотянуто — с числом и причиной, используя ЦЕЛЬ из target дня («под такую работу хотелось бы ~цель углеводов, у тебя X, недобор ~Z»); (3) мягкий шаг с конкретной едой (каша, рис, паста, картофель, хлеб, фрукты).",
    "АНОМАЛЬНЫЙ ДЕНЬ (finding дня = broken_input_values — числа нереалистичны: огромные ккал/макро, явная ошибка ввода продукта): НЕ считай этот день реальным — НЕ делай по нему выводов/похвал/упрёков, НЕ называй его ккал/Б/Ж/У как факт, не тяни его в недельные средние/итоги. Вместо разбора мягко и по-доброму отметь УЧЕНИЦЕ в day_prose ЭТОГО дня, что данные дня похоже занесены с ошибкой (вес/порция продукта; в hint_for_comment назван подозрительный продукт, если определён — назови его), и попроси перепроверить ввод. Тёплая тренерская фраза: «похоже, [продукт] занесён с ошибкой в весе/порции — это искажает картину дня, перепроверь, пожалуйста». Без морали и без чисел этого дня. (Низкий день <900 ккал — это НЕ broken_input, у него своё правило про very_low_kcal, не путай.)",
    "ЧИСЛА в day_prose только из фактов дня. ФАКТЫ (сколько реально съедено: ккал, Б, Ж, У, г/кг из actual) — пиши фактическое число, можно округлить до целого для читаемости, но НЕ приближай и не заменяй (нельзя «около 250», если по факту 233). ЦЕЛИ/ориентиры бери ТОЛЬКО из чисел дня — carbsGMin/carbsGMax (и их середину), kcalMin, proteinGMin — округлёнными до 10: пиши «около 240» (середина), «200–280» (края коридора) или «около 300»; НЕ придумывай промежуточные числа (если коридор 196–280, нельзя «250–280»). Недобор = цель − факт, тоже округляй до 10. Не давай дробных/негладких краёв («341–372»). Граница: факт — точно, цель — округлённо из чисел дня. Других чисел не выдумывай.",
    "Перед длительной/интервальной/ключевой работой (day_role=key/hard/pre_long или nextDayTrainingType ключевой) прямо скажи догрузиться углеводами накануне и в день работы.",
    "Еду называй из items_notable текущего дня. Углеводную называй свободно. ЖИР УЧЕНИКУ — только при fat_policy=normal, и тогда: рамка ТОПЛИВА, не вредности — «жир занял место углеводов под нагрузку» (вытеснение топлива, не «жир плохой»). НЕ клеймить жир однородно по сумме граммов. Смотри на конкретные продукты дня (items_notable): хорошие источники жира (авокадо, орехи, рыба, жирная рыба, сыр, яйца, семечки, оливковое масло) — НЕ называть «перекосом», «проблемой», «лишним жиром» — это нормальный жир, просто под нагрузку он занял место углеводов. Разовый день с высоким жиром из хороших источников — не повод для замечания; отметить уместно только при систематическом превышении (несколько дней подряд с high_fat) ИЛИ если источник явно дешёвый/плохой (фастфуд, колбаса, пельмени, жирная выпечка, торты, жирное мясо). НЕ склеивай хорошие и плохие источники в один «жировой перекос». При coach_only/soften/suppress_athlete жир ученику не выноси вовсе.",
    "НАЗВАНИЕ ПРОДУКТА — упрости до бытового: убери БРЕНД/марку/магазин/фасовку/форму нарезки и дубли (Геркулес Геркулес Традиционный → геркулес; Макфа Макароны Витки → макароны; Coffee Point Булочка с Творогом → булочка с творогом; Окское Яйцо Вареное → яйцо; Натуральное Хозяйство Шаурма с Курицей → шаурма с курицей). НО сохрани СУТЬ продукта и ключевую характеристику для классификации углеводов ЦЕЛИКОМ — НЕ обрезай до одного слова: «куриное филе» (не «куриное»), «бурый рис» (не «рис»), «цельнозерновой хлеб» (не «хлеб»), «белый хлеб» (не «хлеб»), «овсяная каша» (не «каша»). Бренд — убрать; суть + прилагательное вида продукта (бурый/белый/цельнозерновой/куриное/овсяная) — оставить.",
    "СВОЙ РЕЖИМ (student.own_regime=true): у ученицы свой режим питания, согласованный отдельно. НЕ оценивай калорийность и жир как проблему — не пиши «многовато калорий», «калорий перебор», «жир высоковат», «недобор», не выводи дефицит/профицит. Числа можно называть нейтрально (констатация), тон поддерживающий, «держим твой режим». Углеводы под тренировку и белок обсуждать можно как обычно (это про топливо, не про «много/мало калорий»). Жир в текст ученику не выноси (он на coach_only). Это НЕ снимает safety: реальные клинические сигналы идут тренеру как обычно.",
    "ЯЗЫК про углеводы: слово «крахмалистый/крахмалистое/крахмалистые/крахмал» НЕ использовать НИГДЕ — ни в day_prose, ни в athlete_message_draft, ни в coach_summary_text, ни в next_week_plan_text. Тренер так не говорит. Заменяй на «медленные углеводы» (с примерами) ИЛИ просто называй продукты.",
    "КЛАСС УГЛЕВОДА БЕРИ ИЗ ФАКТОВ, НЕ ПО НАИТИЮ: у каждого продукта в items_notable (by_section[*] и carb_foods) код проставил поле carb_class — это источник правды. Правила: carb_class=slow → можно называть «медленный углевод»; carb_class=fast → это БЫСТРЫЙ углевод, «медленным» НЕ называть НИКОГДА (банан, белый хлеб, булочка, лаваш, выпечка, печенье, сладкое, сок — быстрые, даже если дали много углеводов); carb_class=neutral → просто «углеводы», БЕЗ прилагательного «медленный/быстрый» (белый рис, картофель, обычная паста); carb_class=not_carb_base → НЕ углеводная основа: не зачитывай в углеводную цель и не хвали как источник углеводов под нагрузку (борщ, суп, салат, малоуглеводное). Не придумывай класс для продукта, которого нет в items_notable. Без стыда: быстрый углевод не ругай — просто не зови его медленным. СПОРНЫЕ И НЕЙТРАЛЬНЫЕ — НИКОГДА не угадывай тип скорости по аналогии или «принципу»: стеклянная лапша, фунчоза, рисовая лапша, рисовые лепёшки, мисо-суп, кинза, любой продукт с неоднозначным ГИ — это carb_class=neutral → только «углеводы», НИКОГДА «медленный», «как паста», «по типу гречки». Даже если кажется — не угадывай и не проводи аналогий («стеклянная лапша похожа на пасту»). Классификация скорости — только из поля carb_class, не по здравому смыслу.",
    "БЫСТРЫЙ ≠ ОСНОВА: carb_class=fast (банан, лаваш, белый хлеб, булочка, выпечка, печенье, сладкое) — это углеводы, их числа засчитываются в день, и как быстрый перекус перед/во время нагрузки они ок. НО НЕ называй такой продукт «правильным/удачным источником углеводов» или «углеводной основой» под нагрузку и не строй на нём запас — для запаса гликогена нужны медленные (крупа, паста, картофель, бобовые, цельный хлеб). Без упрёка — просто не подавай быстрый как основу.",
    "КОЛИЧЕСТВО углеводов, не «фрукт=углевод»: малоуглеводные фрукты и ягоды (черешня, клубника, арбуз и т.п.) — это вода/витамины, углеводов в них МАЛО. НЕ называй их «хорошим источником углеводов» / углеводной базой под нагрузку. Можно отметить нейтрально (приятно, витамины), но топливо под тренировку дают крупы/паста/картофель/хлеб/банан, а не ягоды. Банан/сухофрукты — ок как углеводы (но сухофрукты для худеющего не приоритет, см. правило lose).",
    "КАЧЕСТВО ИСТОЧНИКА УГЛЕВОДОВ — это принцип про ПОХВАЛУ, а НЕ про классификацию скорости (скорость — ТОЛЬКО из carb_class, см. правило выше; НЕ угадывай её по принципу). ХВАЛИ / называй удачными только ЦЕЛЬНЫЕ источники: крупы, рис, гречка, картофель, паста, хлеб, бобовые, фрукты, овощи. НЕ называй «хорошим/правильным продуктом» кондитерку, сладости, мороженое, конфеты, печенье, халву, выпечку с сахаром, круассаны, газировку, фастфуд, алкоголь/пиво (в т.ч. безалкогольное) — ДАЖЕ если они дали много углеводов: углеводы засчитываются в числа дня, но источник хвалить нельзя. Тон ПОДДЕРЖИВАЮЩИЙ, НЕ стыдящий: за сладкое/выпечку/фастфуд НЕ упрекай и не морализируй — просто не хвали; максимум один раз мягко «в следующий раз эти углеводы лучше взять из крупы/риса/фрукта». Никакой вины и «ай-ай».",
    "СОВЕТ ОТ РЕАЛЬНОЙ ЕДЫ (не шаблон): прежде чем советовать «добавь X», посмотри items_notable дня. Если углеводов не хватило, но подходящий ЦЕЛЬНЫЙ источник в этот день УЖЕ был (есть в items_notable — гречка/рис/паста/картофель/хлеб) — советуй УВЕЛИЧИТЬ ПОРЦИЮ того, что уже ел («та же гречка, но порцию побольше»), а НЕ «добавь кашу», когда каша уже есть, и не предлагай кашу к блюду, где уже есть макароны. Новый продукт предлагай ТОЛЬКО если подходящего цельного источника в дне не было. Не советуй добавлять то, чего и так в достатке.",
    "НЕ ВЫДУМЫВАЙ ГРАММ-ВЕС варимых продуктов (макароны, паста, рис, гречка, крупа, картофель и любой готовящийся гарнир): их вес НЕ парсится из отчёта (в данных есть калории/углеводы, но не граммы продукта), поэтому ЛЮБАЯ цифра граммов будет выдумкой и вдобавок двусмысленной (сухой/готовый вес непонятен). НЕ пиши «58 г макарон», «100 г риса», «добавь 50 г гречки» и т.п. Говори через ОБЪЁМ порции («порцию макарон побольше», «добавь риса к обеду», «гарнира положи больше») или через углеводы. Точный грамм-вес называй ТОЛЬКО для продуктов, чей вес реально есть в данных. Это усиливает правило «порцию побольше»: не подменяй объём выдуманным граммом.",
    "ИСТОЧНИК БЕЛКА БЕРИ ИЗ ФАКТОВ, НЕ ПО НАИТИЮ: у каждого продукта в items_notable код проставил поле protein_contributor — это источник правды. Источником белка («добавил белок», «закрыл белок», «белковая основа») называй ТОЛЬКО продукт с protein_contributor=true. Продукт с protein_contributor=false источником белка НЕ называй НИКОГДА, даже если кажется — грибы, овощи, фрукты, ягоды, хлеб, крупы белок не дают («грибы добавили белок» неверно). Не придумывай белковую роль для продукта, которого нет в items_notable. Жир тоже не атрибутируй на глаз: насыщенный/тяжёлый жир (выпечка, пломбир, фритюр, жирное мясо) не называй полезным. Это страховка от выдуманных ролей, она НЕ режет конкретику: реальную еду, цифры и связки «съел X → эффект Y» сохраняй. Если СОВЕТУЕШЬ добавить белок — называй РАЗНЫЕ по категории источники (творог, яйца, рыба, птица), НЕ перечисляй частный случай рядом с его же категорией («творог или кисломолочка» — это одно и то же, творог И ЕСТЬ кисломолочный продукт; «творог или йогурт» — оба молочные, лучше дать разнотипное: творог + рыба/яйца).",
    "coach_summary_text и day_by_day_analysis_text — ОБЯЗАТЕЛЬНЫЕ непустые поля, заполняй их всегда (даже если основной фокус ушёл в day_prose). coach_summary_text: 2-4 предложения для тренера. day_by_day_analysis_text: по строке-две на каждый день из daily_analysis. Пустые строки в этих полях недопустимы.",
    "day_by_day_analysis_text: дневные блоки строго по canonical daily_analysis; используй weekday_ru, date_label, training_label, actual, hint_for_comment/findings; комментируй только дневные totals, без intraday (до/во время/после, граммы по таймингу, гели).",
    "Если source_quality.confidence=low или suspect=true, формулируй осторожно как ограничение данных.",
    "athlete_message_draft должен включать 3-7 дневных наблюдений, если daily facts есть.",
    "ЕДИНЫЙ ФОРМАТ для ВСЕХ целей (maintain/lose/gain): структура разбора всегда ПОДНЕВНАЯ — day_prose по каждому дню из daily_analysis и athlete_message_draft как разбор ДЕНЬ ЗА ДНЁМ с числами по каждому дню (как у обычного ученика). Цель меняет ЧИСЛА (ориентиры, дефицитная оценка) и АКЦЕНТЫ, но НЕ структуру. НЕ сворачивай разбор худеющего/набирающего в обобщённое «что хорошо / что подтянуть» без разбивки по дням — это запрещено; дни всегда отдельными блоками с фактическими числами. Общий фокус под цель допустим как короткое вступление или итог, но НЕ вместо подневных блоков.",
    "athlete_message_draft: только plain Telegram text, emoji-разделители ок. Запрещено: **, ---, code fences, markdown headings.",
    "Строгая формальность: только ты ИЛИ только вы, без смешивания.",
    "ВЫ — это ВЕЖЛИВОЕ обращение к ОДНОМУ человеку, не множественное. Существительное-сказуемое при «вы» — в ЕДИНСТВЕННОМ числе: «вы молодец», НЕ «молодцы» (и не «вы все»/«ребята»). Это грамматика ед. числа, без навязанных ласковых слов. Глаголы при «вы» остаются в обычной форме («вы справились»).",
    `Не используй coach/диагностические/методические термины ученику НИ В КАКОМ ВИДЕ (включая аббревиатуру «EA» и оборот «на границе нормы»): ${NUTRITION_ATHLETE_FORBIDDEN_COACH_TERM_WORDS.join(", ")}.`,
    ...NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES,
    "Не используй язык похудения/ограничения: похудеть, сбросить вес, урезать калории, меньше есть, дефицит калорий.",
    "Не давай меню/диету/рецепты. Продукты только как варианты при наличии фактов.",
    "Не придумывай тренировки и не придумывай гели/fueling.",
    "Если тренировка в tp_context имеет status=planned (а не completed / planned_and_completed) — она НЕ состоялась (пропущена). Не оценивай такой день как тренировочный: считай его поддержанием/восстановлением, спокойно, без упрёка за «недобор под нагрузку» — нагрузки в этот день не было. Опирайся на nutrition_status дня (rest_ok и т.п.), а не на запланированную, но не выполненную работу.",
    "Причинность только с хеджами (может, могло, вполне могло); запрещено: вызвало, из-за этого точно, именно поэтому.",
    "Упоминание athlete name допускается при наличии в facts. One focus only: используй exact one_focus из facts.",
    "If illness/cycle/injury signals present, recommend coach review in coach_summary_text and quality_notes; no medical claims/diagnosis in athlete_message_draft. НО только ЕСЛИ такой сигнал реально есть в фактах (athlete_report_signals / заметки тренера / история). НЕ выдумывай сигналы болезни/цикла/травмы и не пиши «зафиксировано в истории», если в данных этого нет.",
    "Углеводную еду называть свободно как варианты («увеличь порцию каши или пасты, что уже была, или добавь, если её не было»). Жирную еду ученику — только при fat_policy=normal; при coach_only/soften/suppress_athlete жирное в текст ученику не выносить — это идёт в coach_summary_text. При fat_policy=normal: рамка жира — вытеснение топлива под нагрузку («жир занял место углеводов»), не «жир плохой»; хорошие источники (авокадо/орехи/рыба/сыр/яйца) — не клеймить; разовое с хорошими источниками — норм.",
    "Силовая тренировка (training_type strength или ярлык «силовая») — в day_prose этого дня сделай мягкий ДНЕВНОЙ акцент: белок в приоритете + немного углеводов для восстановления мышц. БЕЗ привязки ко времени (не «после тренировки» — времени тренировки в данных нет), общий акцент «в силовой день держи белок». Для ВСЕХ целей (lose/maintain/gain).",
    "Заметки тренера (student.coach_report_note — разовая на этот отчёт; student.coach_persistent_notes — постоянные про ученика) — это КОНТЕКСТ для тона и акцентов разбора, НЕ числа и НЕ факты дня. Учитывай их в интерпретации (что уточнил ученик, контекст дня), но не выдумывай по ним числа и не цитируй дословно как медфакт.",
    "ЖЁСТКО про контекст ученика (заметки тренера и история): пересказывай ТОЛЬКО то, что прямо дано в заметке/истории. НЕ предполагай и НЕ додумывай обстоятельства, которых там нет — например, не пиши «после тренировки поели не сразу», «пропустила приём», «наверное, не успела поесть», если этого нет в заметке. Forward-совет разрешён («после интервалов важно поесть плотно»), но утверждать или предполагать незаданные ФАКТЫ о поведении ученика — нельзя. Не сужай формулировку («вторник суматошный» ≠ «вечер вторника суматошный»). Особенно НЕ выдумывай состояния/события: болезнь, простуду, «после болезни», стресс, травму, праздник, поездку — если этого нет в заметке/истории, не упоминай вовсе (нельзя «молодец, что побегала после болезни», если про болезнь ничего не сказано). Это правило относится КО ВСЕМ полям, включая coach_summary_text и day_by_day_analysis_text, не только к тексту ученику.",
    "СЛОВА УЧЕНИКА (student.athlete_comment) — это его собственный комментарий к этому отчёту (дневник, своими словами). РЕАГИРУЙ на них: используй для ТОНА и УЧЁТА ОБСТОЯТЕЛЬСТВ. Усталость / жара / стресс / не было аппетита — формулируй разбор мягче, с пониманием, без упрёка за недобор. Если ученик описал ЧТО и КОГДА он ел («во вторник овсянка с бананом перед интервалами») — отрази это в комментарии нужного дня (day_prose) как контекст. НЕ медикализируй: настоящие сигналы болезни/травмы/цикла идут через athlete_report_signals → coach review, не в текст ученику.",
    "ЧЕК-ИН УЧЕНИКА (student.weekly_checkin) — это его САМООЦЕНКА за неделю по шкалам 1-10, где БОЛЬШЕ = ЛУЧШЕ: energy (энергия), wellbeing (самочувствие), eating_comfort (комфорт следовать питанию). ЕСЛИ объект weekly_checkin есть и поле задано (не null) — учитывай оценку для ТОНА и СВЯЗЕЙ, качественно (низко/средне/высоко). ГДЕ писать: связь/эмпатию ОБЯЗАТЕЛЬНО вынеси в ATHLETE-facing текст — в day_prose релевантного дня И/ИЛИ во вступление next_week_plan_text, чтобы ЭТО ВИДЕЛА УЧЕНИЦА (итоговое сообщение собирается из day_prose + проза плана; coach_summary_text до ученицы НЕ доходит). В athlete-facing тексте пиши ПО-ЧЕЛОВЕЧЕСКИ, БЕЗ клинического «4/10» (само число можно отметить только в coach_summary_text для тренера). Связи: низкая энергия (≈1-4) вместе с недобором калорий/углеводов под нагрузку → мягко отметь вероятную связь прямо ученице («энергии на этой неделе было немного — и питание под нагрузку проседало, тут есть связь, давай добавим топлива»); низкий eating_comfort (≈1-4) → по-доброму отметь, что следовать питанию было тяжело, и предположи/спроси, ЧТО мешало (нет времени готовить, аппетит, обстоятельства) — ОДНОЙ тёплой живой фразой по сути. НЕ проговаривай вслух служебную мета-рамку («не хочу давить», «спрошу по-доброму», «не буду давить», «без давления») — само проговаривание «я не давлю» и ЕСТЬ давление наизнанку, звучит как калька и неестественно; просто тепло спроси по сути («что мешало — жара, аппетит?»). «Без давления» — это указание ТЕБЕ для тона, в текст ученице эти слова не выноси; высокие оценки → можно искренне порадоваться вместе. Тон Потока E (на равных, без диагнозов). Числа оценок НЕ выдумывай: если weekly_checkin=null или поле null — про самочувствие по чек-ину НЕ пиши вовсе, разбор как обычно. Это самооценка, НЕ медицинский сигнал (болезнь/травма идут через athlete_report_signals).",
    "ЕДА ПО ДНЯМ (athlete_day_note у дня в daily_analysis): если у дня есть это поле — это слова ученика про ИМЕННО ЭТОТ день (что и когда он ел вокруг тренировки). ОБЯЗАТЕЛЬНО отрази это в комментарии (day_prose) ЭТОГО дня: учти контекст в оценке и, где уместно, отметь по-доброму («хорошо, что перед интервалами что-то углеводное было», «перед длительной поел заранее — правильно»). НЕ бери из этих слов числа (числа только из PDF-фактов дня). Не путай дни — клади заметку только в свой день.",
    "ОЦЕНКА ПРЕДТРЕНИРОВОЧНОЙ ЕДЫ (pre_workout у дня) — отрази в day_prose ЭТОГО дня, если поле есть. Код уже сопоставил еду перед тренировкой (pre_workout.foods) с её углеводами из дневника и с нагрузкой дня, и выдал вердикт pre_workout.adequacy: good/medium/low. Подавай КАЧЕСТВЕННО, БЕЗ грамм-числа (число оставь коду): good → «перед интервалами зарядилась хорошо (…)»; medium → «перед стартом углеводов было средне, можно чуть плотнее»; low → «перед интервалами углеводов было маловато (батончик+печенье) — под такую работу добавь банан, кашу или хлеб перед стартом». Это про ПЕРЕД тренировкой, не про ужин. Если есть pre_workout.timing (за сколько до старта поел) — учти: близко к старту (~30 мин) нужны лёгкие быстрые углеводы, за 2-3 часа можно полноценнее. Если есть pre_workout.heavy_foods (тяжёлое жирное перед тренировкой) — мягко отметь про КОМФОРТ на тренировке (не про «неправильно поела»): «перед интервалами был [продукт] — он тяжеловат и долго переваривается, на бегу может давить; в следующий раз лучше что-то лёгкое углеводное (банан, тост, каша)». Поддерживающе, про самочувствие и качество тренировки. Граммы предтренировочной еды НЕ называй и не выдумывай.",
    "ТЁПЛАЯ ОПЕНИНГ-СТРОКА (athlete_opening_note_ru): если в словах ученика (student.athlete_comment) есть что искренне отметить — старание, что справился несмотря на обстоятельства (дорога/жара/занятость) — впиши ОДНУ тёплую человеческую фразу в athlete_opening_note_ru (она встанет сразу после приветствия). Пример: «вижу, ты очень старалась, даже в дороге держалась — это дорогого стоит». Качественно, в тёплом тоне Игоря, plain text без markdown, БЕЗ единой цифры. Если отмечать НЕЧЕГО (слов нет, или там только жалобы/нейтральное) — верни athlete_opening_note_ru пустым/null, НЕ придумывай похвалу на пустом месте. Эту похвалу за старание НЕ дублируй в athlete_message_draft — она живёт только в athlete_opening_note_ru.",
    "ЧИСЛА И МАКРОСЫ — ТОЛЬКО из PDF/фактов дня (actual/target). НИКОГДА не бери калории/граммы/«съела ~N» из слов ученика (student.athlete_comment) на веру и не подставляй их как факт — ни в day_prose, ни в итог недели, ни в coach_summary_text. Если слова ученика противоречат числам из PDF — доверяй PDF; расхождение можно мягко отметить ТРЕНЕРУ в coach_summary_text, но не выноси выдуманное число ученику.",
    "WEEK-OVER-WEEK ПОХВАЛА ЗА ПРОГРЕСС: если в фактах есть student.history.previous_week_numbers (числа прошлой недели + дельта, посчитанная КОДОМ) И дельта показывает реальный положительный сдвиг (калории/белок/углеводы выросли к ориентиру), НАЧНИ разбор с искренней похвалы за КОНКРЕТНЫЙ прогресс, называя реальную дельту из previous_week_numbers («на прошлой неделе в среднем 1343 ккал, на этой 1482 — отлично, движемся вверх»). Числа бери ТОЛЬКО из previous_week_numbers, не выдумывай. Эту похвалу пиши в day_prose (опенинг-строка athlete_opening_note_ru цифр НЕ принимает) или в next_week_plan_text. Хвали ТОЛЬКО за реальный сдвиг; если сдвига нет / откат — без ложной похвалы и без упрёка (тон на равных). Если рост в одном (белок) и откат в другом (калории) — честно: похвали рост, мягко отметь просадку. Не хвали пусто и не каждую неделю обязательно.",
    "РАЗЛИЧАЙ НЕДЕЛИ В ОДНОМ СООБЩЕНИИ: day_prose и week-over-week похвала говорят про УЖЕ ПРОЖИТУЮ (отыгранную) неделю — там числа-факты из логов. next_week_plan_text говорит про ПРЕДСТОЯЩУЮ неделю — там рекомендации, а не факты. Оба текста идут ПОДРЯД в одном сообщении (next_week_plan_text — без нового приветствия, продолжение). Если week-over-week похвала («на этой неделе N ккал») стоит рядом с рекомендацией на будущее — НЕ называй обе недели одинаково «эта неделя»: прошедшую называй явно («на прошедшей неделе», «за эту прожитую неделю», «по факту»), а предстоящую — «на следующей неделе»/«в план на будущую неделю». Читатель не должен путать, к какой неделе относится какая фраза.",
    "ПОХВАЛА ЗА УСТОЙЧИВОЕ СНИЖЕНИЕ ВЕСА (только lose): если в фактах есть student.history.weight_trend (НЕ null — код подтвердил устойчивое снижение веса вторую неделю подряд), тепло и по-доброму отметь ученице эту динамику — что вес плавно снижается уже вторую неделю, это отличный устойчивый результат, так и держим. По УМОЛЧАНИЮ БЕЗ цифр в кг (просто «вес плавно снижается вторую неделю — отличная динамика»), без чисел-обязательств и без обещаний скорости. КАТЕГОРИЧЕСКИ без ИМТ, процентов жира, медикализации и языка диеты («минус N кг», «сбросила», «худеешь»). Пиши это в опенинге разбора (day_prose) или в next_week_plan_text — НЕ в athlete_opening_note_ru. Если weight_trend отсутствует (null) — НЕ упоминай вес вообще: ни похвалы за снижение, ни упрёка за его отсутствие, ни «вес держится». Разовое колебание код сюда НЕ передаёт, так что доверяй факту: есть weight_trend → хвали устойчивый тренд, нет → молчи про вес.",
    "ЦЕЛЬ УЧЕНИКА (student.nutrition_goal): maintain — текущая методика. lose (снижение веса): рамка «поддерживаем тренировки в общем мягком минусе». НЕ советуй «добавь углеводов/калорий» там, где у худеющего и так профицит/перебор; топливо догружай ТОЛЬКО в тренировочные/ключевые дни (fuel for the work required), а в дни отдыха — спокойнее, это и есть запланированный дефицит, а не ошибка. ХВАЛИ высокий белок (для худеющего это хорошо: не пиши «белок высоковат» как проблему и НЕ пиши «белок низковат» при ≥1.6 г/кг). Даже когда белок НИЖЕ ориентира — у худеющего подавай это МЯГКО и без упрёка: «белок можно чуть добавить» / «белка чуть больше не помешает», а НЕ «белок ниже нормы»/«стоит отметить»/«недобор белка». Белок для худеющего — приоритет и помощник, не повод ругать. МЯГКО озвучивай высокий жир (>~35% энергии) ученику как лишние калории, которые мешают снижению (для lose жир выносим в текст ученику). Тон поддерживающий, без «ешь больше». target_weight_kg, если задан — можно мягко («до цели ещё ~N кг»), без ИМТ/процентов жира/«минус N кг»/медикализации. gain (набор) — небольшой профицит, углеводы и белок с запасом.",
    "КРИТИЧЕСКИ НИЗКИЕ ДНИ (safety_flags.very_low_kcal_days непуст): в эти дни энергии было критически мало. В тексте ученику ОБЯЗАТЕЛЬНО мягко, тепло, но ПРЯМО отметь: в такие дни энергии вышло очень мало, а при тренировках так повторять нельзя — это бьёт по восстановлению; цель снижения НЕ требует голодания, наоборот, ровное достаточное питание помогает и результату, и восстановлению. Без морали и стыда, как забота. Эти дни НЕ хвали и НЕ называй «спокойными». Дальше — обычный разбор и план по её параметрам, как всегда. Фактические числа дня (ккал/Б/Ж/У) — из PDF, можно называть.",
    "ЦЕЛЬ lose НЕ отменяет safety: при опасно низкой калорийности или сигналах РПП — это блок/ручная проверка как обычно (худеть ≠ голодать; цель снижения НЕ оправдывает опасный дефицит). В тексте ученику при любой цели — без слов похудеть/сбросить вес/урезать калории/дефицит (язык поддержки, а не диеты).",
    "ДЕФИЦИТНАЯ ЛИНИЯ (lose/gain): у каждого дня в daily_analysis есть goal_day_target — это ориентир дня ПОД ЦЕЛЬ (для lose уже с дефицитом, выстроенный от обмена + расхода именно этого дня). Оценивай фактический день ОТНОСИТЕЛЬНО goal_day_target, а НЕ относительно поддержания. Если goal_day_target.over_goal_line=true (факт заметно выше ориентира под цель) в день БЕЗ нагрузки — это «многовато для дня без нагрузки при твоей цели / лишние калории, которые тормозят прогресс», а НЕ «спокойно/ровно». В тренировочные дни питание у/около ориентира — это норма (топливо под работу), не перебор. НИКОГДА не подавай для худеющего рест-день в 2500–2800 ккал как «спокойный/ровный» — для цели снижения это перебор; озвучь мягко и по-доброму.",
    "Еда при дефиците (lose): когда советуешь добавить объём/насыщение при меньшей калорийности — приоритет ОВОЩИ и цельные продукты, а НЕ фрукты/сухофрукты (сухофрукты — это концентрированный сахар и калории). «Добавь овощей/зелени к тарелке», не «добавь сухофруктов».",
    "ТАЙМИНГ ПО ВРЕМЕНИ ДНЯ (только РАЗБОР, по факту): у дня в daily_analysis есть time_of_day — это РЕАЛЬНОЕ время выполненной тренировки (morning/day/evening, из факта старта; надёжно). Если time_of_day задано — можно дать тайминговый совет уверенно, привязав к нему («тренировка была утром, поэтому…»): time_of_day=morning → топливо ищи в УЖИНЕ НАКАНУНЕ + лёгкий завтрак/что-то быстрое углеводное перед стартом (НЕ «полноценно за 2-3 часа до» — слишком рано, человек спит/только встал), а добор и белок — в приёмы ПОСЛЕ; time_of_day=day или evening → перед работой уместен полноценный углеводный приём за ~2-3 часа, плюс восстановление после. Совет про ужин накануне перед ключевой/длительной уместен при любом времени. Если time_of_day НЕ задано (null) — НЕ выдумывай время: давай ДНЕВНЫЕ ориентиры (сколько за день: белок, углеводы, объём) без «когда именно», как раньше. Никогда не привязывай тайминг к ПЛАНОВОЙ тренировке (в плане времени нет — там только дневные ориентиры). Исключение остаётся: режим натощак из заметок тренера (правило ниже) — акцент на ужин накануне и приём после.",
    "Натощак/рано утром: если в заметках тренера указано, что тренировка проходит натощак/рано утром — это осознанный режим, НЕ ошибка питания. Топливо под такую работу ищи в УЖИНЕ НАКАНУНЕ и ЗАВТРАКЕ/восстановлении ПОСЛЕ, а не «в день тренировки до неё мало углеводов». Акцент в разборе и совете смещай на вечер накануне и приём пищи после тренировки.",
    ...NUTRITION_VOICE_STYLE_SPEC_LINES,
    ...NUTRITION_VOICE_FEWSHOT_STABLE_LINES,
  ].join("\n");
  const noTrainingWeek = input.context.noTrainingWeek === true;
  // The PLAN week (next week) has no training and the scan vouches for it. The review
  // week is a different question: an athlete can have trained all last week and fall
  // ill on Sunday — exactly the Селезнёва case, where noTrainingWeek is false (3 TP
  // workouts) while the week ahead is empty. The plan prose (next_week_plan_text) is
  // written in THIS call, so the model has to be told, or it keeps writing about
  // "дни нагрузки" and "энергию под ключевую работу" for a week that has neither.
  const noTrainingNextWeek = isNutritionNoTrainingNextWeek(input.context);
  const hasApprovedHistory = (input.context.studentMemory?.approved_patterns ?? []).length > 0;
  const systemDynamic = [
    allowAthleteDraft
      ? "athlete_message_draft is required and must be useful Telegram-ready text. Use the required ты/вы form from formality instruction."
      : "Hard safety flags present: athlete_message_draft must be null and coach-only text should explain manual review need.",
    hasApprovedHistory
      ? "У ученика ЕСТЬ сохранённая история (student.history.approved_patterns с since_week). Если паттерн из истории повторяется и на этой неделе — мягко, по-доброму и КОЛЛАБОРАТИВНО вернись к нему: «снова всплывает этот момент — давай разберёмся, что мешает (аппетит? время? что-то ещё?)». НЕ СЧИТАЙ вслух недели («N-ю неделю», «третья неделя», «N недель подряд») — это накопленное давление, демотивирует. БЕЗ упрёка и морали (НЕ «опять не доела», НЕ «сколько можно»). Признай движение, если оно есть. Если паттерн на этой неделе НЕ повторился (улучшение) — отметь позитивно: «смотри, в этот раз ... подтянулось — отлично». Ссылаться на «прошлые недели» в общем можно, но без счёта-долбёжки."
      : "Сохранённого контекста прошлых недель нет — НЕ используй обобщённых сравнений «прошлая неделя»/«на прошлой неделе» в тексте ученику; веди разбор по конкретным дням и числам этой недели.",
    ...(hasApprovedHistory
      ? [
          "ГДЕ озвучивать паттерн истории: впиши добрый КОЛЛАБОРАТИВНЫЙ callout (повторяющийся момент, без счёта недель) в next_week_plan_text (проза фокуса/плана) И/ИЛИ в day_prose релевантного дня. Итоговое сообщение ученику собирается ИЗ day_prose + прозы плана (общий athlete_message_draft в него не попадает), поэтому callout только в athlete_message_draft до ученика НЕ доедет.",
        ]
      : []),
    allowAthleteDraft
      ? "next_week_plan_text is required — athlete-facing plan prose for next week in the same voice."
      : "Hard safety flags present: next_week_plan_text must be null.",
    ...(noTrainingWeek
      ? [
          "На этой неделе тренировок не было — считай дни как поддержание (база от веса + восстановление), спокойно и ровно. НЕ пиши про «энергию мало под нагрузку», «недобор под работу» и т.п. — нагрузки не было. Фокус мягкий: ровное питание, белок, восстановление.",
          "В coach_summary_text добавь короткую оговорку для тренера: по тренировкам данных в TrainingPeaks за эту неделю нет, разбор сделан как поддерживающий; если тренировки были — синхронизировать TP и перегенерировать. В athlete_message_draft эту оговорку НЕ выноси (не пугать «нет данных»).",
        ]
      : []),
    ...(noTrainingNextWeek
      ? [
          "НА СЛЕДУЮЩЕЙ НЕДЕЛЕ ТРЕНИРОВОК НЕТ (в TrainingPeaks пусто, скан живой — это не дыра в данных, а неделя БЕЗ НАГРУЗКИ: болезнь / восстановление / пауза). next_week_plan_text пиши как ПОДДЕРЖИВАЮЩУЮ неделю: калораж ровный по всем дням (в фактах next_week_plan у всех дней тип rest), опора на восстановление и самочувствие.",
          "ЗАПРЕЩЕНО в next_week_plan_text при неделе без тренировок: «дни нагрузки», «энергия под нагрузку», «перед ключевой тренировкой», «ключевые работы», «углеводы под работу», планы разгона питания под тренировки — НИЧЕГО ЭТОГО НА НЕДЕЛЕ НЕТ. Не выдумывай тренировок и не привязывай питание к несуществующим дням.",
          "Тон плана на неделю без тренировок: спокойный и заботливый. Уместно: ровное питание, белок и восстановление, «слушай самочувствие», «когда вернёшься к тренировкам — вернём и топливо». Если из заметки тренера или комментария ученицы видно, что она болеет — не давить, не требовать цифр, не подгонять с возвращением к нагрузкам. Диагнозов и медицинских советов не давать.",
          "В coach_summary_text добавь короткую оговорку для тренера: на следующую неделю тренировок в TrainingPeaks нет, план сделан ПОДДЕРЖИВАЮЩИМ (ровные цели по дням); если неделя будет расписана — перегенерировать план. Ученику эту оговорку НЕ выноси.",
        ]
      : []),
    ...(allowAthleteDraft ? buildNutritionVoiceFewShotDynamic({ hasMissingDay }) : []),
    `Formality instruction: ${formalityInstruction}`,
  ].join("\n");

  const coachMemory = buildCoachMemoryFactsPayload(input.context);
  // Slim ONLY the model INPUT: each day already carries its facts at top level
  // (weekday_ru, date_label, training_label, actual, target, findings, flags,
  // source_quality, hint_for_comment…), which the prompt reads. The embedded
  // canonical (canonicalDailyAnalysis + canonical_daily_analysis snake copy) and the
  // duplicate-cased macroGuardrails just repeat that — ~1.6k tok × 2 casings × 7 days,
  // sent UNCACHED every call. The prompt never references the nested canonical, so drop
  // it from the input. persistedDailyAnalysis stays FULL (the render reads its canon).
  const dailyFactsForPrompt = dailyFacts.map((day) => {
    const slim = { ...day };
    delete slim.canonicalDailyAnalysis;
    delete slim.canonical_daily_analysis;
    delete slim.macroGuardrails;
    return slim;
  });
  const factsPayload = {
    student: {
      name: input.context.studentName,
      formality: input.context.resolvedCommunicationProfile.formality,
      // Grammatical gender for Russian prose (past-tense verbs, adjectives). null →
      // the prompt rule defaults to feminine; an explicit male overrides that default.
      sex: input.context.sex,
      nutrition_goal: input.context.nutritionGoalType,
      nutrition_goal_text: input.context.nutritionGoal,
      target_weight_kg: input.context.targetWeightKg,
      coach_context_ru: input.context.coachContextRu,
      coach_report_note: input.context.coachReportNoteRu,
      athlete_comment: input.context.athleteCommentRu,
      // Athlete's self-reported check-in for THIS week (energy / wellbeing /
      // eating_comfort, 1-10, higher = better). null fields = not provided; null
      // object = no check-in. The prompt rule uses it for tone/connections only.
      weekly_checkin: input.context.weeklyCheckin,
      own_regime: input.context.ownRegime,
      coach_persistent_notes: input.context.studentMemory?.persistent_notes ?? [],
      history: {
        approved_patterns: input.context.studentMemory?.approved_patterns ?? [],
        last_focus: input.context.studentMemory?.last_focus ?? null,
        key_trends: input.context.studentMemory?.key_trends ?? [],
        // Week-over-week numbers + deltas (computed by code, never the model). The
        // prompt rule below tells the model to praise a REAL positive shift using
        // ONLY these numbers. Null when no prior week.
        previous_week_numbers: input.weekOverWeek,
        // Sustained weight-loss trend (lose only), computed by code. Non-null ONLY when
        // eligible (2 weeks strictly down, ≥0.6 kg, not rapid). The prompt rule tells the
        // model to warmly note the sustained drop WITHOUT citing kg by default. Null →
        // the model must not mention weight at all.
        weight_trend: input.context.weightTrend,
      },
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
    // The week the PLAN covers, judged separately from the reviewed week: an athlete
    // can have trained last week and be ill for the next one.
    next_week_training_context: noTrainingNextWeek ? "maintenance_no_training" : "training_week",
    next_week_plan: input.nextWeekPlan,
    daily_analysis: dailyFactsForPrompt,
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
    // Task 6: plan prose from the same call. Plain text, stripped of markdown
    // fences; held to null when safety-blocked (no athlete-facing text).
    const planTextRaw =
      typeof parsed.next_week_plan_text === "string"
        ? parsed.next_week_plan_text.replace(/```+/g, "").trim()
        : null;
    const nextWeekPlanText = allowAthleteDraft && planTextRaw ? planTextRaw : null;
    // Block 3: warm opening line from the athlete's words. Plain text only, and a
    // hard digit-guard — qualitative acknowledgment must NOT smuggle any number
    // (numbers belong to the PDF-grounded day/plan facts, never to free praise).
    const openingNoteRaw =
      typeof parsed.athlete_opening_note_ru === "string"
        ? parsed.athlete_opening_note_ru.replace(/[*_`#]+/g, "").replace(/\s+/g, " ").trim()
        : "";
    const athleteOpeningNote =
      allowAthleteDraft && openingNoteRaw && !/\d/.test(openingNoteRaw) ? openingNoteRaw : null;
    return {
      coach_summary_text: coachSummary,
      day_by_day_analysis_text: dayByDay,
      athlete_message_draft: athleteDraft,
      athlete_opening_note_ru: athleteOpeningNote,
      next_week_plan_text: nextWeekPlanText,
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
  // Coach decision (Igor): the week is never hard-blocked anymore (safety.blocked is
  // always false). Critically low days are surfaced as an honest note via the prompt
  // rule below. effectiveBlocked is kept = safety.blocked so the (now inert) gating
  // reads cleanly; it is false in practice.
  const effectiveBlocked = safety.blocked;
  const veryLowKcalDays = context.manualMacroRows
    .filter((row) => (row.kcal ?? 9999) < 1300)
    .map((row) => row.day);

  const avgKcal = avg(context.manualMacroRows.map((row) => row.kcal));
  const avgProtein = avg(context.manualMacroRows.map((row) => row.proteinG));
  const avgFat = avg(context.manualMacroRows.map((row) => row.fatG));
  const avgCarbs = avg(context.manualMacroRows.map((row) => row.carbsG));

  // Week-over-week (Task: WoW praise): the prior week's persisted averages are on
  // context.previousWeekNumbers. The DELTA is computed HERE BY CODE (never by the
  // model). weekOverWeek goes into the model facts (so it can praise a real shift),
  // and previousWeekAllowedNumbers (prev + current avgs + deltas) is injected per
  // day so the prose number-validator allows these numbers at gen + render time.
  const prevWeek = context.previousWeekNumbers;
  const codeDelta = (current: number | null, previous: number | null): number | null =>
    typeof current === "number" &&
    Number.isFinite(current) &&
    typeof previous === "number" &&
    Number.isFinite(previous)
      ? Math.round(current - previous)
      : null;
  const weekOverWeek = prevWeek
    ? {
        previous_week_from: prevWeek.weekFrom,
        previous_avg_kcal: prevWeek.avgKcal,
        current_avg_kcal: avgKcal,
        delta_kcal: codeDelta(avgKcal, prevWeek.avgKcal),
        previous_avg_carbs_g: prevWeek.avgCarbsG,
        current_avg_carbs_g: avgCarbs,
        delta_carbs_g: codeDelta(avgCarbs, prevWeek.avgCarbsG),
        previous_avg_protein_g: prevWeek.avgProteinG,
        current_avg_protein_g: avgProtein,
        delta_protein_g: codeDelta(avgProtein, prevWeek.avgProteinG),
      }
    : null;
  const previousWeekAllowedNumbers: number[] = weekOverWeek
    ? [
        weekOverWeek.previous_avg_kcal,
        weekOverWeek.current_avg_kcal,
        weekOverWeek.delta_kcal,
        weekOverWeek.previous_avg_carbs_g,
        weekOverWeek.current_avg_carbs_g,
        weekOverWeek.delta_carbs_g,
        weekOverWeek.previous_avg_protein_g,
        weekOverWeek.current_avg_protein_g,
        weekOverWeek.delta_protein_g,
      ].filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];
  // Weight-trend praise (lose): code-exact kg figures, so the prose number-validator
  // doesn't strip them if the model cites a weight. The prompt asks for no kg by
  // default — these only ride along to keep an occasional honest figure allowed.
  const weightTrendAllowedNumbers: number[] = context.weightTrend
    ? [
        context.weightTrend.currentWeightKg,
        context.weightTrend.prevWeightKg,
        context.weightTrend.prev2WeightKg,
        context.weightTrend.totalDropKg,
      ].filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];
  const methodology = buildNutritionMethodologyContext({ context });
  const selectedFocus = selectNutritionWeeklyFocus({
    methodology,
    blockedSafety: effectiveBlocked,
    goalType: context.nutritionGoalType,
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
  if (isNutritionNoTrainingNextWeek(context)) {
    // Same caveat for the week the PLAN covers: no training there, scan healthy → the
    // plan is a maintenance plan. Guaranteed in notes even if the model omits it.
    notes.push("no_training_next_week:maintenance_plan_regenerate_if_week_gets_planned");
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

  // Carbs averaged over LOAD DAYS ONLY — the number the methodology is actually about. avg_carbs_g
  // averages the rest days in too, so it can rise purely because the rest days got bigger while the
  // training days did not move; «углеводы подтянулись» built on that would point at the wrong thing.
  // The load-day set is resolved with the SAME role system the weekly summary uses (role !== rest),
  // read off the very array that gets persisted — so the trend and the summary can never disagree
  // about which days were load days. The grams come from the same manualMacroRows that feed
  // avg_carbs_g, so the two averages differ ONLY by the filter and stay directly comparable.
  const weekDayRoles = resolveWeekNarrativeDayRoles(
    persistedDailyAnalysis.map((day) => ({
      date: typeof day.date === "string" ? day.date : "",
      trainingType: typeof day.training_type === "string" ? day.training_type : "unknown",
      trainingLabel: typeof day.training_label === "string" ? day.training_label : "",
      mode: "past_review" as const,
      isCompleted: true,
    }))
  );
  const loadDates = new Set(
    [...weekDayRoles.entries()].filter(([, info]) => info.role !== "rest").map(([date]) => date)
  );
  // No load days (a full rest week) → nothing to compare, so no number and no trend line.
  const avgCarbsLoadDays =
    loadDates.size > 0
      ? avg(context.manualMacroRows.filter((row) => loadDates.has(row.day)).map((row) => row.carbsG))
      : null;
  // Model facts keep the original weekOverWeek untouched; only the PERSISTED copy carries the
  // load-day figures, which is all the derived weekly summary needs.
  const weekOverWeekPersisted = weekOverWeek
    ? {
        ...weekOverWeek,
        previous_avg_carbs_g_load_days: prevWeek?.avgCarbsGLoadDays ?? null,
        current_avg_carbs_g_load_days: avgCarbsLoadDays,
        delta_carbs_g_load_days: codeDelta(avgCarbsLoadDays, prevWeek?.avgCarbsGLoadDays ?? null),
      }
    : null;
  // Inject the week-over-week allow-set onto EACH day so the per-day prose validator
  // allows these code-computed numbers — both at gen-time (validate loop below) and
  // at render-time (persisted → buildNutritionDayProseFacts reads previous_week_numbers).
  // The weight-trend kg figures (lose only) ride in the same allow-set.
  const dayAllowedNumbers = [...previousWeekAllowedNumbers, ...weightTrendAllowedNumbers];
  if (dayAllowedNumbers.length > 0) {
    for (const day of persistedDailyAnalysis) {
      day.previous_week_numbers = dayAllowedNumbers;
    }
  }
  // Her check-in ratings ride onto each day too — but in their OWN field, never in the number
  // allow-set above. A 1–10 rating is not a macro figure: the validator polices the score the prose
  // quotes back at her («чек-ин 9/10») against these exact values, so the model cannot tell her she
  // reported a 4 when she reported a 9. Exact, no rounding — on a 1–10 scale a rounding tolerance
  // would legitimize the neighbours and defeat the whole point.
  //
  // Reviews generated before this field existed simply have no checkin_numbers; the validator then
  // scrubs the score instead of policing it, and they keep rendering exactly as they do today.
  const checkinAllowedNumbers: number[] = [
    context.weeklyCheckin?.energy,
    context.weeklyCheckin?.wellbeing,
    context.weeklyCheckin?.eatingComfort,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (checkinAllowedNumbers.length > 0) {
    for (const day of persistedDailyAnalysis) {
      day.checkin_numbers = checkinAllowedNumbers;
    }
  }

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
  // Task 6: deterministic next-week plan numbers, computed once here and shared
  // by (a) the Claude facts (so plan prose is grounded in real targets) and
  // (b) the persisted analysis (so the chained plan record reuses identical
  // numbers without a second TP fetch). The plan covers the week the review's
  // next-week TP context actually spans (the week after the reviewed week):
  // buildNutritionNextWeekPlan maps workouts BY DATE, so the plan week dates must
  // equal that context's week or the real key workouts would not line up. In the
  // normal flow (review run right after the week) this equals today's target plan
  // week; anchoring to the context keeps prose and numbers aligned even on a
  // re-run of an older week.
  const planWeekFrom = context.tpNextWeek.periodFrom;
  const planWeekTo = context.tpNextWeek.periodTo;
  const planWeekMode: NutritionPlanTargetWeekMode = "next_week";
  const nextWeekPlan = buildNutritionNextWeekPlan({
    bodyweightKg: methodology.bodyweightKg ?? context.currentWeightKg,
    planWeekFrom,
    planWeekTo,
    trainingContext: context.tpNextWeek,
    previousWeekDailyAnalysis: persistedDailyAnalysis,
    goalType: context.nutritionGoalType,
    sex: context.sex,
    heightCm: context.heightCm,
    ageYears: context.ageYears,
    // Without this the formulas cannot tell an athlete who has NO training next week
    // (illness / recovery) from a scan that failed to deliver it — and every day of an
    // empty week came out "unknown", i.e. target_kcal null across the whole plan.
    planWeekScanState: context.nextWeekScanState ?? null,
  });

  let narrative: {
    coach_summary_text: string;
    day_by_day_analysis_text: string;
    athlete_message_draft: string | null;
    athlete_opening_note_ru: string | null;
    next_week_plan_text: string | null;
    day_prose: Record<string, string>;
    quality_notes: string[];
    do_not_send_reasons: string[];
    generation_mode: "ai" | "fallback" | "awaiting_generation";
    ai_model: string;
  } = {
    coach_summary_text: fallbackCoachSummary,
    day_by_day_analysis_text: fallbackDayByDay,
    athlete_message_draft: effectiveBlocked
      ? null
      : buildFallbackAthleteDraft({
          context,
          dailyAnalysis: methodology.dailyAnalysis as Array<Record<string, unknown>>,
          mainFocusRu: selectedFocus.statementRu,
          proteinSufficient: methodology.proteinSufficient,
          progressionStrategy: selectedFocus.progressionStrategy,
        }),
    // The warm opening line only comes from a live Claude call (it reacts to the
    // athlete's words); the deterministic fallback never invents one.
    athlete_opening_note_ru: null,
    // Plan prose comes only from a live Claude call; the deterministic plan
    // narrative is rebuilt downstream from next_week_plan when this is null.
    next_week_plan_text: null,
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
      weekOverWeek,
      dailyAnalysis: methodology.dailyAnalysis as Array<Record<string, unknown>>,
      nextWeekPlan,
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
        blocked: effectiveBlocked,
        very_low_kcal_days: veryLowKcalDays,
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
      if (!effectiveBlocked) {
        narrative = {
          ...narrative,
          athlete_message_draft: null,
          athlete_opening_note_ru: null,
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
        sex: context.sex,
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
  const status = effectiveBlocked
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
      // Load-day carbs average of THIS week — persisted so the NEXT week can compare against it.
      avg_carbs_g_load_days: avgCarbsLoadDays,
      // Persisted so the DERIVED weekly summary can name a week-over-week shift at render time
      // without a second DB read. Deltas are code-computed above (never model-authored); null
      // when there is no prior week. Reviews generated before this field simply have no trend.
      week_over_week: weekOverWeekPersisted,
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
      athlete_opening_note_ru: narrative.athlete_opening_note_ru,
      generation_mode: narrative.generation_mode,
      prompt_version: NUTRITION_REVIEW_PROMPT_VERSION,
      quality_notes: narrative.quality_notes,
      do_not_send_reasons: [
        ...new Set([
          ...safety.doNotSendReasons,
          ...narrative.do_not_send_reasons,
          ...buildDataQualityDoNotSendReasons(context),
        ]),
      ],
      interpretation_shadow: interpretationShadow,
      next_week_plan_text: narrative.next_week_plan_text,
      next_week_plan: nextWeekPlan,
      plan_week: { from: planWeekFrom, to: planWeekTo, mode: planWeekMode },
      // Task 7: flip hasPreviousWeeksContext on once the coach has approved
      // patterns — enables the week-over-week comparison line (renderer phantom
      // guard lifts). NOTE: the prompt rule explicitly forbids counting weeks
      // aloud ("повторяется N-ю неделю") — the model gets a soft collaborative
      // callout instead ("снова всплывает этот момент"), not a week count.
      previous_weeks_context:
        (context.studentMemory?.approved_patterns?.length ?? 0) > 0
          ? {
              approved_patterns: context.studentMemory.approved_patterns,
              key_trends: context.studentMemory.key_trends,
              last_focus: context.studentMemory.last_focus,
            }
          : null,
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
    do_not_send_reasons: [
      ...new Set([
        ...safety.doNotSendReasons,
        ...narrative.do_not_send_reasons,
        ...buildDataQualityDoNotSendReasons(context),
      ]),
    ],
    athlete_report_signals: context.athleteReportSignals,
    prompt_hash: promptHash,
    context_hash: contextHash,
    ai_model: narrative.ai_model,
    next_week_plan_text: narrative.next_week_plan_text,
    next_week_plan: nextWeekPlan,
    plan_week: { from: planWeekFrom, to: planWeekTo, mode: planWeekMode },
  };
}
