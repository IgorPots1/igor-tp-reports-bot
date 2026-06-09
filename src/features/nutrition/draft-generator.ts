import {
  buildNutritionSafetyFlags,
  type NutritionStudentContext,
} from "@/features/nutrition/context";
import {
  buildNutritionMethodologyContext,
  selectNutritionWeeklyFocus,
  type CarbProgressionStrategy,
} from "@/features/nutrition/methodology";
import { stableHash } from "@/features/nutrition/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import { getTrainingPeaksReplyDraftFormalityInstruction } from "@/features/trainingpeaks/telegram-context";

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
    ? "Начните с простого шага: не занижайте углеводы в день до ключевой тренировки и в день самой работы."
    : "Начинаем с простого шага: не занижаем углеводы в день до ключевой тренировки и в день самой работы.";
}

function buildAthleteDraft(input: {
  context: NutritionStudentContext;
  mainFocusRu: string;
  proteinSufficient: boolean;
  progressionStrategy: CarbProgressionStrategy;
}): string {
  const { context, mainFocusRu, proteinSufficient, progressionStrategy } = input;
  const profile = context.resolvedCommunicationProfile;
  const address = buildNutritionDraftAddress(profile.formality);
  const greeting = profile.preferredGreeting ? `${profile.preferredGreeting}\n\n` : "";
  const proteinLine = proteinSufficient ? address.proteinOk : null;
  const stepText = buildProgressionStepText(progressionStrategy, profile.formality);
  const focusLine = `${address.lead} — ${mainFocusRu.toLowerCase()}.`;
  const noJumpLine = address.noSharpJumps;
  const profileNotes = profile.notes ? `\n\n${profile.notes}` : "";
  const lines = [greeting.trim(), proteinLine, focusLine, stepText, noJumpLine, address.lookAhead]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join("\n");
  return `${lines}${profileNotes ? `\n${profileNotes}` : ""}`.trim();
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
  const athleteDraft = safety.blocked
    ? null
    : buildAthleteDraft({
        context,
        mainFocusRu: selectedFocus.statementRu,
        proteinSufficient: methodology.proteinSufficient,
        progressionStrategy: selectedFocus.progressionStrategy,
      });
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
  const promptHash = stableHash({
    role: "nutrition-weekly-analysis-methodology-v1",
    guardrails: [
      "no_medical_advice",
      "no_diagnosis",
      "no_recipes",
      "single_main_focus",
      "resolved_formality_mandatory",
      "block_draft_on_hard_safety",
      "day_by_day_training_aware_analysis",
      "no_hallucinated_workouts_or_gels",
      "carb_reference_not_prescriptive",
      "small_step_progression_if_low_carbs",
      "no_english",
      "no_weight_loss_pressure",
      "no_mixed_ty_vy",
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
    : methodology.focusCandidateSignals.limitedData
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
    daily_analysis: methodology.dailyAnalysis as Array<Record<string, unknown>>,
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
    athlete_message_draft: athleteDraft,
    do_not_send_reasons: safety.doNotSendReasons,
    prompt_hash: promptHash,
    context_hash: contextHash,
    ai_model: "nutrition-methodology-v1-template",
  };
}
