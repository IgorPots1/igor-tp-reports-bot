import type { RecoverySummaryResult } from "./trainingpeaks-recovery-summary.ts";

export type CoachNoteConfidenceLevel = "high" | "medium" | "low";

export type CoachNoteSignalCode =
  | "suspicious_if_tss"
  | "interval_late_fade"
  | "extra_volume_after_plan"
  | "missed_planned_workout"
  | "extra_workout"
  | "unsupported_segments"
  | "partial_segment_coverage"
  | "short_sleep_multiple_nights"
  | "low_body_battery"
  | "hrv_baseline_not_connected"
  | "manual_attention"
  | "high_hr_on_easy_run"
  | "week_volume_over_plan"
  | "week_volume_under_plan"
  | "missing_hr_data"
  | "segment_match_low_confidence"
  | "recovery_data_insufficient";

export type CoachNoteSignal = {
  code: CoachNoteSignalCode | string;
  message: string;
  severity: "info" | "warning" | "critical";
  workout_date?: string | null;
  workout_title?: string | null;
};

export type CoachNotesV1 = {
  schema_version: "coach-notes.v1";
  generated_at: string;
  generator: {
    mode: "deterministic";
    sources: string[];
    model: null;
  };
  locale: "ru";
  summary: string;
  confidence: {
    overall: CoachNoteConfidenceLevel;
    reasons: string[];
  };
  data_quality_flags: CoachNoteSignal[];
  training_signals: CoachNoteSignal[];
  recovery_signals: CoachNoteSignal[];
  workout_notes: CoachNoteSignal[];
  follow_up_suggestions: string[];
  questions_for_athlete: string[];
  planning_notes: string[];
  watch_flags: CoachNoteSignal[];
  athlete_report_alignment: {
    recovery_included_in_athlete_report: boolean;
    technical_topics_suppressed: string[];
  };
};

type MismatchFlags = {
  skipped?: boolean;
  extra_workout?: boolean;
  duration_shorter?: boolean;
  duration_longer?: boolean;
  distance_shorter?: boolean;
  distance_longer?: boolean;
  hr_above_target?: boolean;
  hr_below_target?: boolean;
  pace_too_fast?: boolean;
  pace_too_slow?: boolean;
  missing_hr_data?: boolean;
  missing_planned_target?: boolean;
};

type CoachAttentionFlags = {
  suspicious_if?: boolean;
  suspicious_tss?: boolean;
  high_hr_on_easy_run?: boolean;
};

type SegmentComparisonEntry = {
  order?: number;
  segment_type?: string;
  is_rest?: boolean;
  repeat_iteration?: number | null;
  repeat_group_id?: string | null;
  coverage?: "full" | "partial" | "missing" | "unsupported";
  pace_vs_target?: {
    status?: "too_fast" | "too_slow" | "within" | "unknown";
    outside_by_min_per_km?: number | null;
  };
  data_quality_flags?: string[];
};

type WorkoutSegmentAnalysis = {
  available?: boolean;
  reason?: string;
  match_confidence?: "high" | "medium" | "low" | "none";
  extra_after_plan_seconds?: number;
  comparable_segments_count?: number;
  compared_segments_count?: number;
  data_quality_flags?: string[];
};

type WeeklyWorkout = {
  date?: string | null;
  title?: string | null;
  sport?: string | null;
  data_warnings?: string[];
  intensity_flags?: string[];
  comparison?: {
    mismatch_flags?: MismatchFlags;
    coach_attention_flags?: CoachAttentionFlags;
    data_quality_flags?: Record<string, boolean>;
  };
  segment_analysis?: WorkoutSegmentAnalysis;
  segment_comparison?: SegmentComparisonEntry[];
  classification?: {
    kind?: string;
    confidence?: string;
  };
};

type WeeklySegmentAnalysis = {
  available?: boolean;
  reason?: string;
  workouts_with_planned_segments?: number;
  workouts_analyzed?: number;
  workouts_partial?: number;
  workouts_unsupported?: number;
};

export type WeeklySummaryForCoachNotes = {
  student_id: string;
  week: { from: string; to: string };
  segment_analysis?: WeeklySegmentAnalysis;
  totals?: {
    workouts_count?: number;
    completed_workouts_count?: number;
    data_warnings_count?: number;
    intensity_flags_count?: number;
  };
  week_metrics?: {
    plan_vs_fact?: {
      completion_rate?: number | null;
      duration_delta_percent?: number | null;
      distance_delta_percent?: number | null;
    };
    data_quality?: Record<string, unknown>;
  };
  workouts: WeeklyWorkout[];
};

export type RecoveryContextForCoachNotes = {
  decision?: string;
  include_in_athlete_report?: boolean;
  profile?: {
    recovery_metrics_enabled?: boolean;
  } | null;
  summary?: RecoverySummaryResult | null;
};

function workoutLabel(workout: WeeklyWorkout): {
  workout_date: string | null;
  workout_title: string | null;
} {
  return {
    workout_date: workout.date ?? null,
    workout_title: workout.title ?? null,
  };
}

function formatWorkoutRef(workout: WeeklyWorkout): string {
  const date = workout.date ?? "без даты";
  const title = workout.title?.trim();
  return title ? `${date} · ${title}` : date;
}

function pushUniqueSignal(
  target: CoachNoteSignal[],
  signal: CoachNoteSignal
): void {
  const key = `${signal.code}|${signal.workout_date ?? ""}|${signal.workout_title ?? ""}|${signal.message}`;
  if (target.some((entry) => `${entry.code}|${entry.workout_date ?? ""}|${entry.workout_title ?? ""}|${entry.message}` === key)) {
    return;
  }
  target.push(signal);
}

function detectIntervalLateFade(workout: WeeklyWorkout): boolean {
  const segments = (workout.segment_comparison ?? []).filter(
    (segment) =>
      segment.segment_type === "interval" &&
      segment.is_rest !== true &&
      segment.coverage !== "unsupported" &&
      segment.coverage !== "missing"
  );

  if (segments.length < 2) {
    return false;
  }

  const slowSegments = segments.filter((segment) => segment.pace_vs_target?.status === "too_slow");
  if (slowSegments.length === 0) {
    return false;
  }

  const lastSlow = slowSegments.at(-1);
  const earlierWithin = segments
    .slice(0, segments.indexOf(lastSlow!))
    .some((segment) => segment.pace_vs_target?.status === "within" || segment.pace_vs_target?.status === "too_fast");

  if (!lastSlow || segments.indexOf(lastSlow) < segments.length - 2) {
    return false;
  }

  return earlierWithin || slowSegments.length >= 2;
}

function buildWorkoutSignals(workouts: WeeklyWorkout[]): {
  dataQuality: CoachNoteSignal[];
  training: CoachNoteSignal[];
  workoutNotes: CoachNoteSignal[];
  watch: CoachNoteSignal[];
} {
  const dataQuality: CoachNoteSignal[] = [];
  const training: CoachNoteSignal[] = [];
  const workoutNotes: CoachNoteSignal[] = [];
  const watch: CoachNoteSignal[] = [];

  for (const workout of workouts) {
    const ctx = workoutLabel(workout);
    const ref = formatWorkoutRef(workout);
    const mismatch = workout.comparison?.mismatch_flags ?? {};
    const attention = workout.comparison?.coach_attention_flags ?? {};
    const warnings = workout.data_warnings ?? [];

    if (warnings.includes("suspicious_if") || warnings.includes("suspicious_tss") || attention.suspicious_if || attention.suspicious_tss) {
      pushUniqueSignal(dataQuality, {
        code: "suspicious_if_tss",
        severity: "warning",
        message: `Подозрительные IF/TSS — не показывать спортсмену: ${ref}`,
        ...ctx,
      });
    }

    if (attention.high_hr_on_easy_run) {
      pushUniqueSignal(training, {
        code: "high_hr_on_easy_run",
        severity: "warning",
        message: `Высокий пульс на лёгкой тренировке: ${ref}`,
        ...ctx,
      });
    }

    if (mismatch.missing_hr_data) {
      pushUniqueSignal(dataQuality, {
        code: "missing_hr_data",
        severity: "info",
        message: `Нет данных пульса: ${ref}`,
        ...ctx,
      });
    }

    if (mismatch.skipped) {
      pushUniqueSignal(training, {
        code: "missed_planned_workout",
        severity: "warning",
        message: `Пропущена запланированная тренировка: ${ref}`,
        ...ctx,
      });
    }

    if (mismatch.extra_workout) {
      pushUniqueSignal(training, {
        code: "extra_workout",
        severity: "info",
        message: `Внеплановая тренировка: ${ref}`,
        ...ctx,
      });
    }

    if (mismatch.duration_longer || mismatch.distance_longer) {
      pushUniqueSignal(training, {
        code: "extra_volume_after_plan",
        severity: "info",
        message: `Объём выше плана (длительность/дистанция): ${ref}`,
        ...ctx,
      });
    }

    const extraAfterPlanSeconds = workout.segment_analysis?.extra_after_plan_seconds ?? 0;
    if (extraAfterPlanSeconds >= 60) {
      const minutes = Math.round(extraAfterPlanSeconds / 60);
      pushUniqueSignal(training, {
        code: "extra_volume_after_plan",
        severity: "warning",
        message: `Дополнительная работа после плана (~${minutes} мин): ${ref}`,
        ...ctx,
      });
    }

    if (detectIntervalLateFade(workout)) {
      pushUniqueSignal(training, {
        code: "interval_late_fade",
        severity: "warning",
        message: `Замедление на поздних интервалах: ${ref}`,
        ...ctx,
      });
    }

    const segmentFlags = workout.segment_analysis?.data_quality_flags ?? [];
    const hasUnsupported =
      workout.segment_analysis?.reason === "unsupported_segments" ||
      segmentFlags.includes("contains_unsupported_segments") ||
      (workout.segment_comparison ?? []).some((segment) => segment.coverage === "unsupported");

    if (hasUnsupported) {
      pushUniqueSignal(dataQuality, {
        code: "unsupported_segments",
        severity: "warning",
        message: `Сегментный разбор недоступен или не поддерживается: ${ref}`,
        ...ctx,
      });
    }

    const partialSegments = (workout.segment_comparison ?? []).filter(
      (segment) => segment.coverage === "partial"
    );
    if (partialSegments.length > 0) {
      pushUniqueSignal(dataQuality, {
        code: "partial_segment_coverage",
        severity: "info",
        message: `Частичное покрытие сегментов (${partialSegments.length}): ${ref}`,
        ...ctx,
      });
    }

    if (workout.segment_analysis?.match_confidence === "low" || workout.segment_analysis?.match_confidence === "none") {
      pushUniqueSignal(dataQuality, {
        code: "segment_match_low_confidence",
        severity: "warning",
        message: `Низкая уверенность сопоставления FIT: ${ref}`,
        ...ctx,
      });
    }

    const needsManualAttention =
      attention.suspicious_if ||
      attention.suspicious_tss ||
      attention.high_hr_on_easy_run ||
      hasUnsupported ||
      (workout.segment_analysis?.compared_segments_count ?? 0) <
        (workout.segment_analysis?.comparable_segments_count ?? 0);

    if (needsManualAttention) {
      pushUniqueSignal(watch, {
        code: "manual_attention",
        severity: "warning",
        message: `Нужна ручная проверка тренера: ${ref}`,
        ...ctx,
      });
    }

    const noteMessages: string[] = [];
    if ((workout.intensity_flags ?? []).length > 0) {
      noteMessages.push(`интенсивность: ${workout.intensity_flags!.join(", ")}`);
    }
    if ((workout.data_warnings ?? []).filter((w) => !["suspicious_if", "suspicious_tss"].includes(w)).length > 0) {
      noteMessages.push(
        `предупреждения: ${workout.data_warnings!.filter((w) => !["suspicious_if", "suspicious_tss"].includes(w)).join(", ")}`
      );
    }
    if (noteMessages.length > 0) {
      pushUniqueSignal(workoutNotes, {
        code: "workout_summary",
        severity: "info",
        message: `${ref} — ${noteMessages.join("; ")}`,
        ...ctx,
      });
    }
  }

  return { dataQuality, training, workoutNotes, watch };
}

function buildRecoverySignals(
  recoveryContext: RecoveryContextForCoachNotes | null | undefined
): CoachNoteSignal[] {
  const signals: CoachNoteSignal[] = [];
  if (!recoveryContext) {
    return signals;
  }

  const summary = recoveryContext.summary;
  if (!summary) {
    if (recoveryContext.profile?.recovery_metrics_enabled) {
      pushUniqueSignal(signals, {
        code: "recovery_data_insufficient",
        severity: "info",
        message: "Метрики восстановления включены, но данных за неделю недостаточно.",
      });
    }
    return signals;
  }

  if (summary.signals.low_sleep_multiple_nights) {
    pushUniqueSignal(signals, {
      code: "short_sleep_multiple_nights",
      severity: "warning",
      message: "Несколько ночей с коротким сном (<6 ч).",
    });
  }

  if (summary.signals.low_body_battery_if_avg_below_reasonable_threshold) {
    pushUniqueSignal(signals, {
      code: "low_body_battery",
      severity: "warning",
      message: "Низкий средний Body Battery за неделю.",
    });
  }

  if (recoveryContext.profile?.recovery_metrics_enabled && !summary.signals.hrv_available) {
    pushUniqueSignal(signals, {
      code: "hrv_baseline_not_connected",
      severity: "info",
      message: "HRV за неделю не подключён или не заполнен.",
    });
  }

  if (summary.status === "insufficient_data") {
    pushUniqueSignal(signals, {
      code: "recovery_data_insufficient",
      severity: "info",
      message: "Недостаточно данных восстановления для уверенного вывода.",
    });
  }

  return signals;
}

function buildWeekLevelSignals(summary: WeeklySummaryForCoachNotes): CoachNoteSignal[] {
  const training: CoachNoteSignal[] = [];
  const segmentAnalysis = summary.segment_analysis;

  if ((segmentAnalysis?.workouts_unsupported ?? 0) > 0) {
    pushUniqueSignal(training, {
      code: "unsupported_segments",
      severity: "warning",
      message: `Сегментный анализ недоступен у ${segmentAnalysis!.workouts_unsupported} тренировок с планом.`,
    });
  }

  if ((segmentAnalysis?.workouts_partial ?? 0) > 0) {
    pushUniqueSignal(training, {
      code: "partial_segment_coverage",
      severity: "info",
      message: `Частичный сегментный разбор у ${segmentAnalysis!.workouts_partial} тренировок.`,
    });
  }

  const durationDeltaPercent = summary.week_metrics?.plan_vs_fact?.duration_delta_percent;
  if (typeof durationDeltaPercent === "number") {
    if (durationDeltaPercent >= 15) {
      pushUniqueSignal(training, {
        code: "week_volume_over_plan",
        severity: "info",
        message: `Недельный объём по времени выше плана на ~${Math.round(durationDeltaPercent)}%.`,
      });
    } else if (durationDeltaPercent <= -15) {
      pushUniqueSignal(training, {
        code: "week_volume_under_plan",
        severity: "info",
        message: `Недельный объём по времени ниже плана на ~${Math.abs(Math.round(durationDeltaPercent))}%.`,
      });
    }
  }

  return training;
}

function buildFollowUpSuggestions(input: {
  dataQuality: CoachNoteSignal[];
  training: CoachNoteSignal[];
  recovery: CoachNoteSignal[];
}): string[] {
  const suggestions: string[] = [];

  if (input.training.some((s) => s.code === "missed_planned_workout")) {
    suggestions.push("Уточнить причину пропуска запланированных тренировок.");
  }
  if (input.training.some((s) => s.code === "interval_late_fade")) {
    suggestions.push("Разобрать темповую структуру интервалов и план восстановления между повторами.");
  }
  if (input.recovery.some((s) => s.code === "short_sleep_multiple_nights")) {
    suggestions.push("Обсудить режим сна и нагрузку на ближайшие 3–5 дней.");
  }
  if (input.dataQuality.some((s) => s.code === "suspicious_if_tss")) {
    suggestions.push("Проверить корректность IF/TSS в TP перед планированием следующей недели.");
  }
  if (input.training.some((s) => s.code === "extra_volume_after_plan")) {
    suggestions.push("Сверить фактический объём с планом — возможен перегруз.");
  }

  return suggestions;
}

function buildPlanningNotes(summary: WeeklySummaryForCoachNotes, training: CoachNoteSignal[]): string[] {
  const notes: string[] = [];
  const completionRate = summary.week_metrics?.plan_vs_fact?.completion_rate;

  if (typeof completionRate === "number" && completionRate < 0.75) {
    notes.push("Низкая доля выполнения плана — рассмотреть упрощение или перенос ключевых сессий.");
  }
  if (training.some((s) => s.code === "extra_workout")) {
    notes.push("Учесть внеплановые тренировки при расчёте нагрузки следующей недели.");
  }
  if ((summary.totals?.data_warnings_count ?? 0) > 0) {
    notes.push("Есть предупреждения качества данных — не опираться на IF/TSS без ручной проверки.");
  }

  return notes;
}

function buildQuestionsForAthlete(training: CoachNoteSignal[], recovery: CoachNoteSignal[]): string[] {
  const questions: string[] = [];

  if (training.some((s) => s.code === "missed_planned_workout")) {
    questions.push("Были ли объективные причины пропуска тренировок на этой неделе?");
  }
  if (recovery.some((s) => s.code === "short_sleep_multiple_nights")) {
    questions.push("Как спал на этой неделе — были ли ночи с сильным недосыпом?");
  }
  if (training.some((s) => s.code === "extra_workout")) {
    questions.push("Были ли внеплановые тренировки — намеренно или спонтанно?");
  }

  return questions;
}

function computeConfidence(input: {
  dataQuality: CoachNoteSignal[];
  training: CoachNoteSignal[];
  recovery: CoachNoteSignal[];
  summary: WeeklySummaryForCoachNotes;
}): CoachNotesV1["confidence"] {
  const warningCount =
    input.dataQuality.filter((s) => s.severity !== "info").length +
    input.training.filter((s) => s.severity !== "info").length +
    input.recovery.filter((s) => s.severity === "warning").length;

  const segmentAvailable = input.summary.segment_analysis?.available === true;
  const reasons: string[] = [];

  if (warningCount >= 5) {
    reasons.push("Много предупреждений по тренировкам и данным.");
    return { overall: "low", reasons };
  }

  if (warningCount >= 2 || !segmentAvailable) {
    if (!segmentAvailable) {
      reasons.push("Сегментный анализ недоступен или неполный.");
    }
    if (warningCount >= 2) {
      reasons.push("Есть несколько сигналов, требующих внимания тренера.");
    }
    return { overall: "medium", reasons };
  }

  reasons.push("Критичных расхождений мало, данные в целом согласованы.");
  return { overall: "high", reasons };
}

function buildSummary(input: {
  summary: WeeklySummaryForCoachNotes;
  confidence: CoachNotesV1["confidence"];
  dataQuality: CoachNoteSignal[];
  training: CoachNoteSignal[];
  recovery: CoachNoteSignal[];
}): string {
  const workoutsCount = input.summary.totals?.workouts_count ?? input.summary.workouts.length;
  const completedCount = input.summary.totals?.completed_workouts_count ?? 0;
  const watchCount =
    input.dataQuality.filter((s) => s.severity !== "info").length +
    input.training.filter((s) => s.severity !== "info").length +
    input.recovery.length;

  if (watchCount === 0) {
    return `Неделя ${input.summary.week.from}–${input.summary.week.to}: ${completedCount}/${workoutsCount} тренировок, явных технических рисков нет. Уверенность: ${input.confidence.overall}.`;
  }

  return `Неделя ${input.summary.week.from}–${input.summary.week.to}: ${completedCount}/${workoutsCount} тренировок, ${watchCount} внутренних сигналов для тренера. Уверенность: ${input.confidence.overall}.`;
}

export function buildTrainingPeaksCoachNotes(input: {
  summary: WeeklySummaryForCoachNotes;
  recoveryContext?: RecoveryContextForCoachNotes | null;
  generatedAt?: string;
}): CoachNotesV1 {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const workoutSignals = buildWorkoutSignals(input.summary.workouts);
  const weekTraining = buildWeekLevelSignals(input.summary);
  const recoverySignals = buildRecoverySignals(input.recoveryContext);

  const dataQuality = [...workoutSignals.dataQuality];
  const training = [...workoutSignals.training, ...weekTraining];
  const watchFlags = [...workoutSignals.watch];
  const followUp = buildFollowUpSuggestions({
    dataQuality,
    training,
    recovery: recoverySignals,
  });
  const planningNotes = buildPlanningNotes(input.summary, training);
  const questions = buildQuestionsForAthlete(training, recoverySignals);
  const confidence = computeConfidence({
    dataQuality,
    training,
    recovery: recoverySignals,
    summary: input.summary,
  });

  const technicalTopicsSuppressed = [
    "if_tss_when_suspicious",
    "segment_interval_details",
    "parser_confidence",
    "data_quality_flags",
  ];

  return {
    schema_version: "coach-notes.v1",
    generated_at: generatedAt,
    generator: {
      mode: "deterministic",
      sources: ["weekly-summary.json", "recovery_context"],
      model: null,
    },
    locale: "ru",
    summary: buildSummary({
      summary: input.summary,
      confidence,
      dataQuality,
      training,
      recovery: recoverySignals,
    }),
    confidence,
    data_quality_flags: dataQuality,
    training_signals: training,
    recovery_signals: recoverySignals,
    workout_notes: workoutSignals.workoutNotes,
    follow_up_suggestions: followUp,
    questions_for_athlete: questions,
    planning_notes: planningNotes,
    watch_flags: watchFlags,
    athlete_report_alignment: {
      recovery_included_in_athlete_report: input.recoveryContext?.include_in_athlete_report === true,
      technical_topics_suppressed: technicalTopicsSuppressed,
    },
  };
}
