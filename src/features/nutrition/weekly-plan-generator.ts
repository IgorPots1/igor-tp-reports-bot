import { buildNutritionTrainingPeaksWeekContext } from "@/features/nutrition/context";
import { detectWorkoutFuelingInstructions } from "@/features/nutrition/methodology";
import {
  getNutritionPlanTargetWeekToday,
  resolveNutritionPlanTargetWeek,
  type NutritionPlanTargetWeekMode,
} from "@/features/nutrition/plan-week-policy";
import {
  buildNutritionNextWeekPlan,
  type NutritionNextWeekPlan,
} from "@/features/nutrition/weekly-plan-formulas";
import {
  createNutritionWeeklyPlan,
  getNutritionStudentEssentials,
  getNutritionWeeklyAnalysisById,
  markNutritionWeeklyPlansSuperseded,
  stableHash,
  type NutritionWeeklyAnalysis,
  type NutritionWeeklyPlan,
  type NutritionWeeklyPlanStatus,
} from "@/features/nutrition/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import { getTrainingPeaksReplyDraftFormalityInstruction } from "@/features/trainingpeaks/telegram-context";
import { resolveStudentCommunicationProfile } from "@/features/trainingpeaks/communication-profile";

const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";
const OPENAI_NUTRITION_PLAN_MODEL =
  process.env.OPENAI_NUTRITION_WEEKLY_PLAN_MODEL?.trim() ||
  process.env.OPENAI_NUTRITION_WEEKLY_REVIEW_MODEL?.trim() ||
  "gpt-4o-mini";
export const NUTRITION_WEEKLY_PLAN_PROMPT_VERSION = "nutrition-weekly-plan-v1-ai";
const NUTRITION_WEEKLY_PLAN_FALLBACK_MODEL = "nutrition-weekly-plan-fallback-v2";

export type NutritionWeeklyPlanWorkoutFacts = {
  date: string;
  title: string | null;
  type: string | null;
  plannedDurationMin: number | null;
  plannedDistanceKm: number | null;
  description: string | null;
  coachComments: string | null;
  plannedText: string | null;
  isLongRun: boolean;
  isHardSession: boolean;
  fuelingInstructionPresent: boolean;
  fuelingInstructionText: string | null;
};

export type NutritionWeeklyPlanFacts = {
  student: {
    id: string;
    name: string;
    formality: TrainingPeaksTelegramFormality;
    weightKg: number | null;
  };
  sourceReview: {
    id: string;
    weekFrom: string;
    weekTo: string;
    sourceReportId: string | null;
    generationMode: string | null;
    promptVersion: string | null;
    coachSummaryText: string | null;
    dayByDayAnalysisText: string | null;
    athleteMessageDraft: string | null;
    nutritionSummary: Record<string, unknown>;
    safetyFlags: Record<string, unknown>;
  };
  planWeek: {
    from: string;
    to: string;
  };
  planWeekMode: NutritionPlanTargetWeekMode;
  nextWeekTraining: {
    status: "available" | "empty" | "stale" | "unknown";
    workouts: NutritionWeeklyPlanWorkoutFacts[];
    keyWorkouts: NutritionWeeklyPlanWorkoutFacts[];
  };
  methodology: {
    previousWeekFocus: Record<string, unknown> | null;
    carbProgressionStrategy: Record<string, unknown> | null;
    proteinSufficient: boolean | null;
    limitedData: boolean;
  };
  guardrails: {
    noMedicalAdvice: true;
    noWeightLossFraming: true;
    noMealPlan: true;
    noHallucinatedGels: true;
    carbRangesInternalOnly: true;
    copyOnly: true;
  };
  nextWeekPlan: NutritionNextWeekPlan;
};

export type NutritionWeeklyPlanAiOutput = {
  coach_summary: string;
  athlete_message_draft: string | null;
  plan_focus: {
    category: string;
    title: string;
    explanation: string;
  };
  key_training_days: Array<{
    date: string;
    workout_title: string;
    workout_type: string | null;
    fueling_instruction_present: boolean;
    nutrition_guidance: string;
  }>;
  simple_actions: string[];
  safety_notes: string[];
  do_not_send_reasons: string[];
};

export type NutritionWeeklyPlanTpContextRefresh = {
  source: "fresh_cache" | "source_review_fallback";
  planWeekFrom: string;
  planWeekTo: string;
  freshContext: Record<string, unknown> | null;
  sourceReviewContext: Record<string, unknown>;
  diff: {
    sourceReviewCacheStatus: string;
    freshCacheStatus: string | null;
    sourceReviewWorkoutsCount: number;
    freshWorkoutsCount: number;
    sourceReviewKeyWorkoutsCount: number;
    freshKeyWorkoutsCount: number;
    changed: boolean;
  };
  warnings: string[];
};

export type NutritionWeeklyPlanFactsBuildResult = {
  facts: NutritionWeeklyPlanFacts;
  tpContextRefresh: NutritionWeeklyPlanTpContextRefresh;
};

export type GeneratedNutritionWeeklyPlan = {
  coachSummary: string;
  athleteMessageDraft: string | null;
  planSummary: Record<string, unknown>;
  trainingContextSnapshot: Record<string, unknown>;
  nutritionContextSnapshot: Record<string, unknown>;
  safetyFlags: Record<string, unknown>;
  status: NutritionWeeklyPlanStatus;
  generationMode: "ai" | "fallback";
  promptVersion: string;
  aiModel: string;
  doNotSendReasons: string[];
};

function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized || null;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
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

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function resolveFactsTargetPlanWeek(input?: { todayLocalDate?: string }): {
  from: string;
  to: string;
  mode: NutritionPlanTargetWeekMode;
  label: string;
} {
  const resolved = input?.todayLocalDate
    ? resolveNutritionPlanTargetWeek({ todayLocalDate: input.todayLocalDate })
    : getNutritionPlanTargetWeekToday();
  return {
    from: resolved.planWeekFrom,
    to: resolved.planWeekTo,
    mode: resolved.mode,
    label: resolved.label,
  };
}

function mapTpCacheStatus(raw: unknown): NutritionWeeklyPlanFacts["nextWeekTraining"]["status"] {
  if (raw === "ok") {
    return "available";
  }
  if (raw === "empty") {
    return "empty";
  }
  if (raw === "stale") {
    return "stale";
  }
  return "unknown";
}

function enrichWorkoutFacts(workout: Record<string, unknown>): NutritionWeeklyPlanWorkoutFacts {
  const date = toStringOrNull(workout.date) ?? "unknown-date";
  const title = toStringOrNull(workout.title);
  const type = toStringOrNull(workout.type);
  const description = toStringOrNull(workout.description);
  const coachComments = toStringOrNull(workout.coachComments);
  const plannedText = toStringOrNull(workout.plannedText);
  const combinedText = [description, plannedText, coachComments].filter(Boolean).join(" ");
  const fueling = detectWorkoutFuelingInstructions(combinedText || null);
  const titleLower = (title ?? "").toLocaleLowerCase("ru");
  const typeLower = (type ?? "").toLocaleLowerCase("ru");
  const isLongRun = typeLower === "long_run" || /длитель|long run|longrun/.test(titleLower);
  const isHardSession =
    typeLower === "intervals" ||
    typeLower === "tempo" ||
    typeLower === "race" ||
    /интерв|tempo|темп|порог|threshold|vo2|race|гонк/.test(titleLower);

  return {
    date,
    title,
    type,
    plannedDurationMin: null,
    plannedDistanceKm: null,
    description,
    coachComments,
    plannedText,
    isLongRun,
    isHardSession,
    fuelingInstructionPresent: fueling.hasFuelingInstruction,
    fuelingInstructionText: fueling.hasFuelingInstruction ? compactText(combinedText) : null,
  };
}

function parseStoredWorkouts(raw: unknown): NutritionWeeklyPlanWorkoutFacts[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map(enrichWorkoutFacts);
}

function isSafetyBlocked(safetyFlags: Record<string, unknown>): boolean {
  if (typeof safetyFlags.blocked === "boolean") {
    return safetyFlags.blocked;
  }
  const hardFlags = Array.isArray(safetyFlags.hard_flags) ? safetyFlags.hard_flags : [];
  return hardFlags.length > 0;
}

function extractDoNotSendReasons(safetyFlags: Record<string, unknown>, nutritionSummary: Record<string, unknown>): string[] {
  const fromSummary = Array.isArray(nutritionSummary.do_not_send_reasons)
    ? nutritionSummary.do_not_send_reasons.filter((item): item is string => typeof item === "string")
    : [];
  const fromSafety = Array.isArray(safetyFlags.doNotSendReasons)
    ? safetyFlags.doNotSendReasons.filter((item): item is string => typeof item === "string")
    : [];
  const hardFlags = Array.isArray(safetyFlags.hard_flags)
    ? safetyFlags.hard_flags.map((flag) => `manual_review_required:${String(flag)}`)
    : [];
  return [...new Set([...fromSummary, ...fromSafety, ...hardFlags])];
}

function buildPlanAddress(formality: TrainingPeaksTelegramFormality): {
  greeting: string;
  you: string;
  your: string;
} {
  switch (formality) {
    case "vy":
      return { greeting: "Здравствуйте!", you: "вы", your: "ваши" };
    case "ty":
      return { greeting: "Привет!", you: "ты", your: "твои" };
    default:
      return { greeting: "Привет!", you: "ты", your: "твои" };
  }
}

function countTpContextWorkouts(ctx: Record<string, unknown>): number {
  const workouts = ctx.workouts;
  if (Array.isArray(workouts)) {
    return workouts.length;
  }
  if (typeof ctx.plannedSessions === "number") {
    return ctx.plannedSessions;
  }
  if (typeof ctx.totalSessions === "number") {
    return ctx.totalSessions;
  }
  return 0;
}

function countTpContextKeyWorkouts(ctx: Record<string, unknown>): number {
  const keyWorkouts = ctx.keyWorkouts;
  return Array.isArray(keyWorkouts) ? keyWorkouts.length : 0;
}

function tpContextCacheStatus(ctx: Record<string, unknown>): string {
  return typeof ctx.cacheStatus === "string" ? ctx.cacheStatus : "unknown";
}

export function buildNutritionWeeklyPlanTpContextDiff(
  sourceReviewContext: Record<string, unknown>,
  freshContext: Record<string, unknown> | null
): NutritionWeeklyPlanTpContextRefresh["diff"] {
  const sourceReviewWorkoutsCount = countTpContextWorkouts(sourceReviewContext);
  const freshWorkoutsCount = freshContext ? countTpContextWorkouts(freshContext) : 0;
  const sourceReviewKeyWorkoutsCount = countTpContextKeyWorkouts(sourceReviewContext);
  const freshKeyWorkoutsCount = freshContext ? countTpContextKeyWorkouts(freshContext) : 0;
  const sourceReviewCacheStatus = tpContextCacheStatus(sourceReviewContext);
  const freshCacheStatus = freshContext ? tpContextCacheStatus(freshContext) : null;
  const changed =
    sourceReviewCacheStatus !== freshCacheStatus ||
    sourceReviewWorkoutsCount !== freshWorkoutsCount ||
    sourceReviewKeyWorkoutsCount !== freshKeyWorkoutsCount;

  return {
    sourceReviewCacheStatus,
    freshCacheStatus,
    sourceReviewWorkoutsCount,
    freshWorkoutsCount,
    sourceReviewKeyWorkoutsCount,
    freshKeyWorkoutsCount,
    changed,
  };
}

export function buildNutritionWeeklyPlanTrainingContextSnapshot(
  facts: NutritionWeeklyPlanFacts,
  refresh: NutritionWeeklyPlanTpContextRefresh | null
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    status: facts.nextWeekTraining.status,
    planWeekFrom: facts.planWeek.from,
    planWeekTo: facts.planWeek.to,
    keyWorkouts: facts.nextWeekTraining.keyWorkouts,
    workoutCount: facts.nextWeekTraining.workouts.length,
    next_week_plan_summary: {
      formula_version: facts.nextWeekPlan.formula_version,
      missing_bodyweight: facts.nextWeekPlan.summary.missing_bodyweight,
      has_training_context: facts.nextWeekPlan.summary.has_training_context,
      key_days_count: facts.nextWeekPlan.summary.key_days_count,
      warnings: facts.nextWeekPlan.warnings,
    },
  };
  if (!refresh) {
    return base;
  }
  return {
    ...base,
    source: refresh.source,
    plan_week_from: refresh.planWeekFrom,
    plan_week_to: refresh.planWeekTo,
    fresh_context: refresh.freshContext,
    source_review_context: refresh.sourceReviewContext,
    diff: {
      source_review_cache_status: refresh.diff.sourceReviewCacheStatus,
      fresh_cache_status: refresh.diff.freshCacheStatus,
      source_review_workouts_count: refresh.diff.sourceReviewWorkoutsCount,
      fresh_workouts_count: refresh.diff.freshWorkoutsCount,
      source_review_key_workouts_count: refresh.diff.sourceReviewKeyWorkoutsCount,
      fresh_key_workouts_count: refresh.diff.freshKeyWorkoutsCount,
      changed: refresh.diff.changed,
    },
    warnings: refresh.warnings,
  };
}

export function buildNutritionWeeklyPlanFactsFromSources(input: {
  studentId: string;
  studentName: string;
  formality: TrainingPeaksTelegramFormality;
  weightKg: number | null;
  sourceAnalysis: NutritionWeeklyAnalysis;
  sourceReportId?: string | null;
  tpNextWeekContextOverride?: Record<string, unknown>;
  todayLocalDate?: string;
}): NutritionWeeklyPlanFacts {
  const nutritionSummary = input.sourceAnalysis.nutritionSummary;
  const safetyFlags = input.sourceAnalysis.safetyFlags;
  const tpNextWeek = input.tpNextWeekContextOverride ?? input.sourceAnalysis.tpNextWeekContext;
  const workouts = parseStoredWorkouts(tpNextWeek.workouts);
  const keyWorkoutDates = new Set(
    (Array.isArray(tpNextWeek.keyWorkouts) ? tpNextWeek.keyWorkouts : [])
      .map((item) => (item && typeof item === "object" ? toStringOrNull((item as Record<string, unknown>).date) : null))
      .filter((date): date is string => Boolean(date))
  );
  const keyWorkouts =
    keyWorkoutDates.size > 0
      ? workouts.filter((workout) => keyWorkoutDates.has(workout.date))
      : workouts.filter((workout) => workout.isLongRun || workout.isHardSession);

  const oneFocus = toObject(nutritionSummary.one_focus);
  const methodologySignals = toObject(nutritionSummary.methodology_signals);
  const dataQuality = toObject(nutritionSummary.data_quality_summary);
  const parsedDays = typeof dataQuality.parsed_days === "number" ? dataQuality.parsed_days : 0;
  const targetPlanWeek = resolveFactsTargetPlanWeek({ todayLocalDate: input.todayLocalDate });
  const planWeek = { from: targetPlanWeek.from, to: targetPlanWeek.to };
  const nextWeekPlan = buildNutritionNextWeekPlan({
    bodyweightKg: input.weightKg,
    planWeekFrom: planWeek.from,
    planWeekTo: planWeek.to,
    trainingContext: tpNextWeek,
  });

  return {
    student: {
      id: input.studentId,
      name: input.studentName,
      formality: input.formality,
      weightKg: input.weightKg,
    },
    sourceReview: {
      id: input.sourceAnalysis.id,
      weekFrom: input.sourceAnalysis.weekFrom,
      weekTo: input.sourceAnalysis.weekTo,
      sourceReportId: input.sourceAnalysis.reportId ?? input.sourceReportId ?? null,
      generationMode: toStringOrNull(nutritionSummary.generation_mode),
      promptVersion: toStringOrNull(nutritionSummary.prompt_version),
      coachSummaryText: toStringOrNull(nutritionSummary.coach_summary_text),
      dayByDayAnalysisText: toStringOrNull(nutritionSummary.day_by_day_analysis_text),
      athleteMessageDraft: input.sourceAnalysis.athleteMessageDraft,
      nutritionSummary,
      safetyFlags,
    },
    planWeek,
    planWeekMode: targetPlanWeek.mode,
    nextWeekTraining: {
      status: mapTpCacheStatus(tpNextWeek.cacheStatus),
      workouts,
      keyWorkouts,
    },
    methodology: {
      previousWeekFocus: Object.keys(oneFocus).length > 0 ? oneFocus : null,
      carbProgressionStrategy: toStringOrNull(nutritionSummary.carb_progression_strategy)
        ? { strategy: nutritionSummary.carb_progression_strategy }
        : null,
      proteinSufficient: toBooleanOrNull(methodologySignals.protein_sufficient),
      limitedData: parsedDays < 4 || isSafetyBlocked(safetyFlags),
    },
    guardrails: {
      noMedicalAdvice: true,
      noWeightLossFraming: true,
      noMealPlan: true,
      noHallucinatedGels: true,
      carbRangesInternalOnly: true,
      copyOnly: true,
    },
    nextWeekPlan,
  };
}

export function buildNutritionWeeklyPlanFacts(input: {
  studentId: string;
  sourceAnalysis: NutritionWeeklyAnalysis;
  sourceReportId?: string | null;
}): Promise<NutritionWeeklyPlanFactsBuildResult> {
  return buildNutritionWeeklyPlanFactsInternal(input);
}

async function buildNutritionWeeklyPlanFactsInternal(input: {
  studentId: string;
  sourceAnalysis: NutritionWeeklyAnalysis;
  sourceReportId?: string | null;
  todayLocalDate?: string;
}): Promise<NutritionWeeklyPlanFactsBuildResult> {
  const essentials = await getNutritionStudentEssentials(input.studentId);
  const student = essentials.student;
  if (!student) {
    throw new Error(`Nutrition plan student not found: ${input.studentId}`);
  }
  const profile = resolveStudentCommunicationProfile({
    telegramFormality: student.telegramFormality,
    telegramContextNotes: student.telegramContextNotes,
    activeMemoryItems: essentials.activeMemoryItems,
  });
  const latestConfirmedWeight =
    essentials.weightLogs.find((item) => item.confirmedByCoach)?.weightKg ?? null;
  const latestWeight = essentials.weightLogs[0]?.weightKg ?? null;
  const weightKg = essentials.profile?.currentWeightKg ?? latestConfirmedWeight ?? latestWeight ?? null;

  const targetPlanWeek = resolveFactsTargetPlanWeek({ todayLocalDate: input.todayLocalDate });
  const planWeek = { from: targetPlanWeek.from, to: targetPlanWeek.to };
  const sourceReviewContext = toObject(input.sourceAnalysis.tpNextWeekContext);
  let freshContext: Record<string, unknown> | null = null;
  let tpNextWeekContextOverride = sourceReviewContext;
  let tpContextRefresh: NutritionWeeklyPlanTpContextRefresh;
  try {
    const fresh = await buildNutritionTrainingPeaksWeekContext(
      input.studentId,
      planWeek.from,
      planWeek.to
    );
    freshContext = fresh as unknown as Record<string, unknown>;
    tpNextWeekContextOverride = freshContext;
    const diff = buildNutritionWeeklyPlanTpContextDiff(sourceReviewContext, freshContext);
    const warnings: string[] = [];
    if (diff.changed) {
      warnings.push("Saved review TP context differed from fresh cache; plan used fresh cache.");
    }
    tpContextRefresh = {
      source: "fresh_cache",
      planWeekFrom: planWeek.from,
      planWeekTo: planWeek.to,
      freshContext,
      sourceReviewContext,
      diff,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diff = buildNutritionWeeklyPlanTpContextDiff(sourceReviewContext, null);
    tpContextRefresh = {
      source: "source_review_fallback",
      planWeekFrom: planWeek.from,
      planWeekTo: planWeek.to,
      freshContext: null,
      sourceReviewContext,
      diff,
      warnings: [`Fresh TP context build failed (${message}); used saved review context.`],
    };
  }

  const facts = buildNutritionWeeklyPlanFactsFromSources({
    studentId: input.studentId,
    studentName: student.studentName,
    formality: profile.formality,
    weightKg,
    sourceAnalysis: input.sourceAnalysis,
    sourceReportId: input.sourceReportId,
    tpNextWeekContextOverride,
    todayLocalDate: input.todayLocalDate,
  });

  return { facts, tpContextRefresh };
}

function buildFallbackPlanFocus(facts: NutritionWeeklyPlanFacts): NutritionWeeklyPlanAiOutput["plan_focus"] {
  const hasTraining = facts.nextWeekTraining.status === "available" && facts.nextWeekTraining.keyWorkouts.length > 0;
  if (hasTraining) {
    return {
      category: "carbs_around_key_sessions",
      title: "Не просаживать углеводы и энергию вокруг ключевых тренировок",
      explanation:
        "На следующей неделе в TrainingPeaks есть ключевые работы — держим питание в дни нагрузки и восстановления ровным, без резких ограничений.",
    };
  }
  return {
    category: "general_load_support",
    title: "Не просаживать питание в дни нагрузки и держать регулярность",
    explanation:
      "Плана тренировок на следующую неделю в TrainingPeaks не видно, поэтому фокус общий: поддерживать энергию в дни нагрузки и не копить слишком лёгкие дни подряд.",
  };
}

function buildFallbackKeyTrainingDays(facts: NutritionWeeklyPlanFacts): NutritionWeeklyPlanAiOutput["key_training_days"] {
  if (facts.nextWeekTraining.status !== "available" || facts.nextWeekTraining.keyWorkouts.length === 0) {
    return [];
  }
  return facts.nextWeekTraining.keyWorkouts.slice(0, 4).map((workout) => {
    const dateLabel = formatDateRu(workout.date);
    const title = workout.title ?? "ключевая тренировка";
    let guidance = `${dateLabel}: ${title} — поддержи углеводы и энергию до и после работы.`;
    if (workout.fuelingInstructionPresent) {
      guidance += " Если в плане тренировки указано питание во время — не пропускай его.";
    }
    return {
      date: workout.date,
      workout_title: title,
      workout_type: workout.type,
      fueling_instruction_present: workout.fuelingInstructionPresent,
      nutrition_guidance: guidance,
    };
  });
}

function buildFallbackAthleteDraft(facts: NutritionWeeklyPlanFacts, planFocus: NutritionWeeklyPlanAiOutput["plan_focus"]): string {
  const address = buildPlanAddress(facts.student.formality);
  const keyDays = buildFallbackKeyTrainingDays(facts);
  const nextWeekPlanLines = facts.nextWeekPlan.days.slice(0, 7).map((day) => {
    const kcal = typeof day.target_kcal === "number" ? `~${roundToNearest(day.target_kcal, 100)} ккал` : "~ккал н/д";
    const protein = typeof day.protein_g === "number" ? `${day.protein_g} г белка` : "белок н/д";
    const fat = typeof day.fat_g === "number" ? `${day.fat_g} г жиров` : "жиры н/д";
    const carbs = typeof day.carbs_g === "number" ? `${day.carbs_g} г углеводов` : "углеводы н/д";
    const carbsPerKg =
      typeof day.carbs_g_per_kg === "number" ? ` (~${formatDecimalRu(day.carbs_g_per_kg)} г/кг)` : "";
    return `🔹 ${day.weekday_ru} (${formatDateRu(day.date)}) — ${day.training_label}: ${kcal} · ${protein} · ${fat} · ${carbs}${carbsPerKg}.`;
  });
  const lines = [
    address.greeting,
    "",
    `На следующую неделю главный фокус по питанию: ${planFocus.title.toLowerCase()}.`,
    planFocus.explanation,
    "",
    "Ориентиры по дням из согласованного плана:",
    ...nextWeekPlanLines,
  ];
  if (keyDays.length > 0) {
    lines.push("", "Ключевые дни:", ...keyDays.map((day) => day.nutrition_guidance));
  } else {
    lines.push("", "Без привязки к конкретным дням: держи регулярность и не занижай питание в дни, когда чувствуешь нагрузку.");
  }
  lines.push("", "Это ориентир для энергии и восстановления. Числа берём только из согласованного плана.");
  return lines.join("\n").trim();
}

export function generateNutritionWeeklyPlanFallback(
  facts: NutritionWeeklyPlanFacts,
  tpContextRefresh?: NutritionWeeklyPlanTpContextRefresh | null
): GeneratedNutritionWeeklyPlan {
  const blocked = isSafetyBlocked(facts.sourceReview.safetyFlags);
  const doNotSendReasons = extractDoNotSendReasons(facts.sourceReview.safetyFlags, facts.sourceReview.nutritionSummary);
  const planFocus = buildFallbackPlanFocus(facts);
  const keyTrainingDays = buildFallbackKeyTrainingDays(facts);
  const simpleActions =
    facts.nextWeekTraining.status === "available" && keyTrainingDays.length > 0
      ? [
          "Добавить углеводную порцию в день до ключевой работы.",
          "Не оставлять день ключевой тренировки слишком лёгким по энергии.",
          "После тяжёлой работы закрыть восстановление едой, а не пропуском приёмов пищи.",
        ]
      : [
          "Держать регулярность питания в дни нагрузки.",
          "Не копить слишком лёгкие дни подряд без причины.",
          "Смотреть на энергию и восстановление, а не на жёсткие цифры.",
        ];

  const planWeekLabel =
    facts.planWeekMode === "current_week"
      ? `Фокус питания на текущую неделю (${facts.planWeek.from}..${facts.planWeek.to}).`
      : `Фокус питания на следующую неделю (${facts.planWeek.from}..${facts.planWeek.to}).`;
  const tpContextLabel =
    facts.planWeekMode === "current_week"
      ? "План тренировок на целевую неделю в TrainingPeaks не виден или cache ограничен."
      : "План тренировок на следующую неделю в TrainingPeaks не виден или cache ограничен.";
  const coachLines = [
    planWeekLabel,
    `Главный фокус: ${planFocus.title}.`,
    facts.nextWeekTraining.status === "available"
      ? `Ключевых тренировок в TP cache: ${facts.nextWeekTraining.keyWorkouts.length}.`
      : tpContextLabel,
    blocked ? "Блок безопасности из недельного обзора: черновик для ученика не формируем." : "Черновик для ученика сформирован (copy-only).",
  ];

  return {
    coachSummary: coachLines.join("\n"),
    athleteMessageDraft: blocked ? null : buildFallbackAthleteDraft(facts, planFocus),
    planSummary: {
      plan_focus: planFocus,
      key_training_days: keyTrainingDays,
      simple_actions: simpleActions,
      next_week_plan: facts.nextWeekPlan,
      safety_notes: blocked ? ["Источник недельного обзора заблокирован по безопасности."] : [],
      do_not_send_reasons: doNotSendReasons,
      facts_version: 1,
    },
    trainingContextSnapshot: buildNutritionWeeklyPlanTrainingContextSnapshot(facts, tpContextRefresh ?? null),
    nutritionContextSnapshot: facts as unknown as Record<string, unknown>,
    safetyFlags: {
      ...facts.sourceReview.safetyFlags,
      blocked,
      doNotSendReasons,
      copyOnly: true,
    },
    status: blocked ? "blocked_safety" : facts.methodology.limitedData ? "needs_review" : "draft_generated",
    generationMode: "fallback",
    promptVersion: NUTRITION_WEEKLY_PLAN_PROMPT_VERSION,
    aiModel: NUTRITION_WEEKLY_PLAN_FALLBACK_MODEL,
    doNotSendReasons,
  };
}

async function generateNutritionWeeklyPlanWithAiInternal(
  facts: NutritionWeeklyPlanFacts
): Promise<NutritionWeeklyPlanAiOutput | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const blocked = isSafetyBlocked(facts.sourceReview.safetyFlags);
  const allowAthleteDraft = !blocked;
  const formalityInstruction = getTrainingPeaksReplyDraftFormalityInstruction(facts.student.formality);
  const systemPrompt = [
    "Пиши только на русском языке.",
    "Ты пишешь текст для weekly nutrition plan только по deterministic facts.",
    "LLM writes. Code calculates.",
    "Ничего не пересчитывай и не придумывай: формулы, kcal, БЖУ, г/кг, day type, one_focus, safety, race, workouts.",
    "next_week_plan канонический и deterministic. Используй exact значения для логики, но в athlete draft kcal показывай display-rounded до ближайших 100.",
    "Пример: если rest target_kcal=1950 во facts, пиши ~2000 ккал.",
    "Return strict JSON only with keys: coach_summary, athlete_message_draft, plan_focus, key_training_days, simple_actions, safety_notes, do_not_send_reasons.",
    "coach_summary: concise Russian text for coach internal use.",
    "plan_focus: object with category, title, explanation — use one focus from facts, do not invent priorities.",
    "key_training_days: array only for real TP next-week workouts from facts; empty if no TP workouts.",
    "simple_actions: short practical bullets in Russian.",
    "safety_notes: internal coach notes.",
    `Formality instruction: ${formalityInstruction}`,
    "Plain Telegram text for athlete draft: no **, no ---, no code fences, no markdown headings.",
    "Строгая формальность: только ты или только вы, без смешивания.",
    "Facts-only. Do not invent workouts.",
    "Do not invent gels/fueling. If fueling_instruction_present is false, do not prescribe gels.",
    "No strict g/kg in athlete text. Carb ranges internal only.",
    "No diagnosis. No medical claims.",
    "No RED-S/REDs/LEA/дефицит энергии/анемия/расстройство in athlete draft.",
    "No weight loss / deficit framing.",
    "No menu / meal plan / prescribed recipes.",
    "Allowed hedged causality only: может, могло, вполне могло, не утверждаю наверняка.",
    "Forbidden deterministic causality: вызвало, из-за этого точно, именно поэтому.",
    "If no TP next-week workouts, no day-specific recommendations.",
    "Copy-only draft for manual coach review before sending.",
    "No medical advice.",
    allowAthleteDraft
      ? "athlete_message_draft is required — short Telegram-ready Russian text."
      : "Safety blocked: athlete_message_draft must be null.",
  ].join("\n");

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_NUTRITION_PLAN_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Facts JSON:\n${JSON.stringify(facts, null, 2)}` },
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
    const parsed = JSON.parse(extractJsonOnly(content)) as Partial<NutritionWeeklyPlanAiOutput>;
    const coachSummary = typeof parsed.coach_summary === "string" ? parsed.coach_summary.trim() : "";
    const planFocusRaw = parsed.plan_focus;
    if (!coachSummary || !planFocusRaw || typeof planFocusRaw !== "object" || Array.isArray(planFocusRaw)) {
      return null;
    }
    const planFocus = planFocusRaw as NutritionWeeklyPlanAiOutput["plan_focus"];
    if (!planFocus.title?.trim() || !planFocus.explanation?.trim()) {
      return null;
    }
    const athleteDraftRaw =
      typeof parsed.athlete_message_draft === "string" ? parsed.athlete_message_draft.trim() : null;
    const keyTrainingDays = Array.isArray(parsed.key_training_days)
      ? parsed.key_training_days.filter(
          (item): item is NutritionWeeklyPlanAiOutput["key_training_days"][number] =>
            Boolean(item && typeof item === "object" && typeof (item as { date?: unknown }).date === "string")
        )
      : [];
    return {
      coach_summary: coachSummary,
      athlete_message_draft: allowAthleteDraft ? athleteDraftRaw : null,
      plan_focus: {
        category: typeof planFocus.category === "string" ? planFocus.category : "weekly_focus",
        title: planFocus.title.trim(),
        explanation: planFocus.explanation.trim(),
      },
      key_training_days: keyTrainingDays,
      simple_actions: Array.isArray(parsed.simple_actions)
        ? parsed.simple_actions.filter((item): item is string => typeof item === "string")
        : [],
      safety_notes: Array.isArray(parsed.safety_notes)
        ? parsed.safety_notes.filter((item): item is string => typeof item === "string")
        : [],
      do_not_send_reasons: Array.isArray(parsed.do_not_send_reasons)
        ? parsed.do_not_send_reasons.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export async function generateNutritionWeeklyPlanWithAi(
  facts: NutritionWeeklyPlanFacts,
  tpContextRefresh?: NutritionWeeklyPlanTpContextRefresh | null
): Promise<GeneratedNutritionWeeklyPlan | null> {
  const aiOutput = await generateNutritionWeeklyPlanWithAiInternal(facts);
  if (!aiOutput) {
    return null;
  }
  const blocked = isSafetyBlocked(facts.sourceReview.safetyFlags);
  const doNotSendReasons = [
    ...new Set([
      ...extractDoNotSendReasons(facts.sourceReview.safetyFlags, facts.sourceReview.nutritionSummary),
      ...aiOutput.do_not_send_reasons,
    ]),
  ];
  return {
    coachSummary: aiOutput.coach_summary,
    athleteMessageDraft: blocked ? null : aiOutput.athlete_message_draft,
    planSummary: {
      plan_focus: aiOutput.plan_focus,
      key_training_days: aiOutput.key_training_days,
      simple_actions: aiOutput.simple_actions,
      next_week_plan: facts.nextWeekPlan,
      safety_notes: aiOutput.safety_notes,
      do_not_send_reasons: doNotSendReasons,
      facts_version: 1,
    },
    trainingContextSnapshot: buildNutritionWeeklyPlanTrainingContextSnapshot(facts, tpContextRefresh ?? null),
    nutritionContextSnapshot: facts as unknown as Record<string, unknown>,
    safetyFlags: {
      ...facts.sourceReview.safetyFlags,
      blocked,
      doNotSendReasons,
      copyOnly: true,
    },
    status: blocked ? "blocked_safety" : facts.methodology.limitedData ? "needs_review" : "draft_generated",
    generationMode: "ai",
    promptVersion: NUTRITION_WEEKLY_PLAN_PROMPT_VERSION,
    aiModel: OPENAI_NUTRITION_PLAN_MODEL,
    doNotSendReasons,
  };
}

export async function generateNutritionWeeklyPlan(input: {
  facts: NutritionWeeklyPlanFacts;
  tpContextRefresh?: NutritionWeeklyPlanTpContextRefresh | null;
  requestedMode?: "ai" | "fallback";
}): Promise<GeneratedNutritionWeeklyPlan> {
  if (input.requestedMode === "fallback") {
    return generateNutritionWeeklyPlanFallback(input.facts, input.tpContextRefresh);
  }
  const aiPlan = await generateNutritionWeeklyPlanWithAi(input.facts, input.tpContextRefresh);
  if (aiPlan) {
    return aiPlan;
  }
  return generateNutritionWeeklyPlanFallback(input.facts, input.tpContextRefresh);
}

export async function generateAndSaveNutritionWeeklyPlan(input: {
  studentId: string;
  sourceAnalysisId: string;
  sourceReportId?: string | null;
  requestedMode?: "ai" | "fallback";
}): Promise<NutritionWeeklyPlan> {
  const sourceAnalysis = await getNutritionWeeklyAnalysisById(input.sourceAnalysisId);
  if (!sourceAnalysis) {
    throw new Error(`Nutrition weekly analysis not found: ${input.sourceAnalysisId}`);
  }
  if (sourceAnalysis.studentId !== input.studentId) {
    throw new Error("Source weekly analysis does not belong to the selected student.");
  }
  const resolvedReportId = sourceAnalysis.reportId ?? input.sourceReportId ?? null;

  const { facts, tpContextRefresh } = await buildNutritionWeeklyPlanFacts({
    studentId: input.studentId,
    sourceAnalysis,
    sourceReportId: resolvedReportId,
  });
  const generated = await generateNutritionWeeklyPlan({
    facts,
    tpContextRefresh,
    requestedMode: input.requestedMode,
  });

  const plan = await createNutritionWeeklyPlan({
    studentId: input.studentId,
    sourceReportId: resolvedReportId,
    sourceAnalysisId: sourceAnalysis.id,
    planWeekFrom: facts.planWeek.from,
    planWeekTo: facts.planWeek.to,
    status: generated.status,
    generationMode: generated.generationMode,
    promptVersion: generated.promptVersion,
    aiModel: generated.aiModel,
    coachSummary: generated.coachSummary,
    athleteMessageDraft: generated.athleteMessageDraft,
    planSummary: generated.planSummary,
    trainingContextSnapshot: generated.trainingContextSnapshot,
    nutritionContextSnapshot: {
      ...generated.nutritionContextSnapshot,
      promptHash: stableHash({
        role: generated.promptVersion,
        guardrails: Object.keys(facts.guardrails),
      }),
      contextHash: stableHash({
        studentId: facts.student.id,
        sourceAnalysisId: facts.sourceReview.id,
        planWeek: facts.planWeek,
      }),
    },
    safetyFlags: generated.safetyFlags,
  });

  await markNutritionWeeklyPlansSuperseded({
    studentId: input.studentId,
    planWeekFrom: facts.planWeek.from,
    planWeekTo: facts.planWeek.to,
    supersededByPlanId: plan.id,
    excludePlanId: plan.id,
  });

  return plan;
}

export { calculateNutritionPlanWeekFromReviewEnd as calculateNutritionPlanWeek } from "@/features/nutrition/plan-week-policy";
