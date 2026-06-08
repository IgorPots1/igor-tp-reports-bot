import {
  buildNutritionSafetyFlags,
  type NutritionStudentContext,
} from "@/features/nutrition/context";
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

function resolveMainFocus(context: NutritionStudentContext): string {
  if (context.manualMacroRows.some((row) => (row.carbsG ?? 0) > 0) && context.tpNextWeek.runningSessions > 3) {
    return "Stabilize carbs around key run days";
  }
  if (context.manualMacroRows.some((row) => (row.proteinG ?? 0) < 100)) {
    return "Keep protein intake more stable daily";
  }
  if (context.tpNextWeek.cacheStatus !== "ok") {
    return "Keep nutrition steady with conservative adjustments";
  }
  return "Keep nutrition consistency through the training week";
}

function buildNutritionDraftAddress(formality: TrainingPeaksTelegramFormality): {
  lead: string;
  focusVerb: string;
} {
  switch (formality) {
    case "ty":
      return {
        lead: "Предлагаю тебе на этой неделе",
        focusVerb: "Держим фокус на одном шаге.",
      };
    case "vy":
      return {
        lead: "Предлагаю вам на этой неделе",
        focusVerb: "Держите фокус на одном шаге.",
      };
    default:
      return {
        lead: "На этой неделе предлагаю",
        focusVerb: "Сфокусируемся на одном шаге.",
      };
  }
}

function buildAthleteDraft(context: NutritionStudentContext, mainFocus: string): string {
  const profile = context.resolvedCommunicationProfile;
  const address = buildNutritionDraftAddress(profile.formality);
  const greeting = profile.preferredGreeting ? `${profile.preferredGreeting}\n\n` : "";
  const longRunText = context.tpNextWeek.longRun
    ? `с акцентом на питание перед/после длительной ${context.tpNextWeek.longRun.date}`
    : "с акцентом на стабильность перед ключевыми тренировками";

  let toneSuffix = ".";
  if (profile.tone === "direct") {
    toneSuffix = ` ${address.focusVerb}`;
  } else if (profile.tone === "warm") {
    toneSuffix =
      profile.formality === "vy"
        ? " Буду рядом, если понадобится уточнить детали."
        : profile.formality === "ty"
          ? " Буду на связи, если понадобится уточнить детали."
          : " Буду на связи при необходимости уточнить детали.";
  } else if (profile.tone === "formal") {
    toneSuffix = profile.formality === "vy" ? " Сохраняйте ровный режим." : " Сохраняй ровный режим.";
  }

  const profileNotes = profile.notes ? `\n\n${profile.notes}` : "";

  return `${greeting}${address.lead} ${mainFocus.toLocaleLowerCase("ru")} и ровный режим в течение недели, ${longRunText}${toneSuffix}${profileNotes}`;
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

  const mainFocus = resolveMainFocus(context);
  const athleteDraft = safety.blocked ? null : buildAthleteDraft(context, mainFocus);
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
    role: "nutrition-weekly-analysis-v1",
    guardrails: [
      "no_medical_advice",
      "no_diagnosis",
      "no_recipes",
      "single_main_focus",
      "resolved_formality_mandatory",
      "block_draft_on_hard_safety",
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
    athlete_message_draft: athleteDraft,
    do_not_send_reasons: safety.doNotSendReasons,
    prompt_hash: promptHash,
    context_hash: contextHash,
    ai_model: "nutrition-phase1-template-v1",
  };
}
