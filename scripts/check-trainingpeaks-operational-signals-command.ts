import process from "node:process";

import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  formatTrainingPeaksOperationalSignalsForTelegram,
  type TrainingPeaksOperationalSignalsScope,
} from "@/features/trainingpeaks/service";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-trainingpeaks-operational-signals-command]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function extractSectionBlock(text: string, sectionTitle: string, nextSectionTitle?: string): string {
  const start = text.indexOf(sectionTitle);
  if (start < 0) {
    return "";
  }
  if (!nextSectionTitle) {
    return text.slice(start);
  }
  const next = text.indexOf(nextSectionTitle, start + sectionTitle.length);
  if (next < 0) {
    return text.slice(start);
  }
  return text.slice(start, next);
}

function makeSignal(input: {
  signalId: string;
  studentId: string;
  signalType: string;
  metadata?: Record<string, unknown>;
  structuredPayload?: Record<string, unknown>;
  validFrom?: string | null;
  validUntil?: string | null;
  sourceDate?: string | null;
  targetDate?: string | null;
  episodeKey?: string | null;
}): TrainingPeaksStudentOperationalSignal {
  const metadata = { ...(input.metadata ?? {}) };
  if (input.episodeKey) {
    metadata.episode_key = input.episodeKey;
  }
  return {
    id: input.signalId,
    studentId: input.studentId,
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    lifecycleState: null,
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: false,
    sourceType: "fixture",
    sourceObservationId: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: input.structuredPayload ?? {},
    confidence: null,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    sourceDate: input.sourceDate ?? null,
    targetDate: input.targetDate ?? null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: null,
    dedupeKey: `fixture:${input.signalId}`,
    consumedAt: null,
    metadata,
    createdAt: "2026-06-03T08:00:00.000Z",
    updatedAt: "2026-06-03T08:00:00.000Z",
  };
}

function buildSnapshot(scope: TrainingPeaksOperationalSignalsScope) {
  const signals: TrainingPeaksStudentOperationalSignal[] = [
    makeSignal({
      signalId: "sig-overdue-a",
      studentId: "s-overdue",
      signalType: "health_issue_started",
      episodeKey: "episode-overdue-a",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-01T09:00:00.000+02:00",
        follow_up_reason: "спросить самочувствие",
      },
    }),
    makeSignal({
      signalId: "sig-overdue-b",
      studentId: "s-overdue",
      signalType: "pause_training",
      episodeKey: "episode-overdue-a",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-02T09:00:00.000+02:00",
        follow_up_reason: "второй сигнал эпизода",
      },
    }),
    makeSignal({
      signalId: "sig-due",
      studentId: "s-due",
      signalType: "pause_training",
      episodeKey: "episode-due",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-03T10:00:00.000+02:00",
        follow_up_reason: "вернуться к плану",
      },
    }),
    makeSignal({
      signalId: "sig-future",
      studentId: "s-fut",
      signalType: "health_issue_started",
      episodeKey: "episode-future",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-06T09:00:00.000+02:00",
      },
    }),
    makeSignal({
      signalId: "sig-resolved",
      studentId: "s-res",
      signalType: "health_issue_started",
      metadata: {
        follow_up_status: "resolved",
        follow_up_due_at: "2026-06-03T10:00:00.000+02:00",
      },
    }),
    makeSignal({
      signalId: "sig-health-active",
      studentId: "s-h1",
      signalType: "health_issue_improving",
      validFrom: "2026-06-01",
      validUntil: "2026-06-05",
      structuredPayload: {
        health_state: "improving",
        symptoms: ["cough", "voice"],
        training_recommendation: "easy_if_symptom_free",
        latest_summary:
          "health_context: восстанавливается, кашель ещё есть; голос частично вернулся; хочет пробежку завтра вечером, если кашля не будет; пауза / наблюдать",
      },
      metadata: {
        follow_up_reason: "illness-related pause follow-up",
      },
    }),
    makeSignal({
      signalId: "sig-pain-injury",
      studentId: "s-h3",
      signalType: "health_issue_started",
      structuredPayload: {
        signal_type: "pain_injury",
        latest_summary: "боль / надкостница (уточнить, актуально ли)",
        activity_domain: "injury",
        planning_effect: "safety_review",
        requires_coach_review: true,
      },
    }),
    makeSignal({
      signalId: "sig-strength-hidden",
      studentId: "s-h4",
      signalType: "plan_generation_constraint",
      structuredPayload: {
        signal_type: "external_training_context",
        visible_in_tp_signals: false,
        display_summary: "силовые: вт/чт",
        activity_domain: "strength",
        planning_effect: "strength_schedule_context",
        planned_training_dates: [],
      },
    }),
    makeSignal({
      signalId: "sig-health-ambiguous",
      studentId: "s-h2",
      signalType: "health_issue_started",
      structuredPayload: {
        latest_summary: "health_context: сил нет, голова болит; пауза / наблюдать",
        health_state: "sick",
        symptoms: ["fatigue", "headache"],
      },
      metadata: {
        follow_up_reason: "illness onset follow-up",
      },
    }),
    makeSignal({
      signalId: "sig-stepan-pain-priority",
      studentId: "s-stepan",
      signalType: "health_issue_started",
      episodeKey: "episode-stepan-priority",
      structuredPayload: {
        signal_type: "pain_injury",
        activity_domain: "injury",
        planning_effect: "safety_review",
        requires_coach_review: true,
        display_summary: "боль / надкостница (уточнить, актуально ли)",
      },
    }),
    makeSignal({
      signalId: "sig-stepan-ambiguous-illness-priority",
      studentId: "s-stepan",
      signalType: "health_issue_started",
      episodeKey: "episode-stepan-priority",
      structuredPayload: {
        display_summary: "может заболеваю",
        requires_coach_review: true,
      },
    }),
    makeSignal({
      signalId: "sig-schedule",
      studentId: "s-sch",
      signalType: "schedule_unavailability_window",
      validFrom: "2026-06-04",
      validUntil: "2026-06-06",
      metadata: {
        reason: "командировка",
      },
    }),
    makeSignal({
      signalId: "sig-schedule-availability",
      studentId: "s-sch-2",
      signalType: "plan_generation_constraint",
      validFrom: "2026-06-02",
      validUntil: "2026-06-08",
      episodeKey: "episode-schedule-rich",
      structuredPayload: {
        available_days: ["Tuesday", "Thursday"],
        resolved_available_dates: ["2026-06-02", "2026-06-04"],
        unavailable_dates: ["2026-06-05", "2026-06-08"],
        planned_training_dates: ["2026-06-02", "2026-06-04"],
        planning_status: "athlete_intends_to_train",
      },
    }),
    makeSignal({
      signalId: "sig-schedule-unavailability-rich",
      studentId: "s-sch-2",
      signalType: "schedule_unavailability_window",
      episodeKey: "episode-schedule-rich",
      structuredPayload: {
        duration_days: 4,
      },
    }),
    makeSignal({
      signalId: "sig-elizaveta-expired-planned",
      studentId: "s-elizaveta",
      signalType: "plan_generation_constraint",
      validUntil: "2026-06-07",
      structuredPayload: {
        planned_training_dates: ["2026-06-02"],
        valid_until: "2026-06-07",
      },
    }),
    makeSignal({
      signalId: "sig-schedule-legacy-vague",
      studentId: "s-sch-2",
      signalType: "schedule_unavailability_window",
      structuredPayload: {
      },
    }),
    makeSignal({
      signalId: "sig-move",
      studentId: "s-mov",
      signalType: "move_workout_candidate",
      sourceDate: "2026-06-03",
      targetDate: "2026-06-05",
    }),
    makeSignal({
      signalId: "sig-move-active",
      studentId: "s-mov-2",
      signalType: "move_workout_candidate",
      sourceDate: "2026-06-04",
      targetDate: "2026-06-06",
    }),
    makeSignal({
      signalId: "sig-other",
      studentId: "s-oth",
      signalType: "race_load_context",
      metadata: {
        summary: "нагрузка перед стартом",
      },
    }),
    makeSignal({
      signalId: "sig-extra-1",
      studentId: "s-x1",
      signalType: "race_load_context",
      metadata: { summary: "extra 1" },
    }),
    makeSignal({
      signalId: "sig-extra-2",
      studentId: "s-x2",
      signalType: "race_load_context",
      metadata: { summary: "extra 2" },
    }),
    makeSignal({
      signalId: "sig-extra-3",
      studentId: "s-x3",
      signalType: "race_load_context",
      metadata: { summary: "extra 3" },
    }),
    makeSignal({
      signalId: "sig-extra-4",
      studentId: "s-x4",
      signalType: "race_load_context",
      metadata: { summary: "extra 4" },
    }),
    makeSignal({
      signalId: "sig-extra-5",
      studentId: "s-x5",
      signalType: "race_load_context",
      metadata: { summary: "extra 5" },
    }),
  ];

  const studentNameById = new Map<string, string | null>([
    ["s-overdue", "Overdue Athlete"],
    ["s-due", "Due Athlete"],
    ["s-fut", "Future Athlete"],
    ["s-res", "Resolved Athlete"],
    ["s-h1", "Health Athlete"],
    ["s-h2", "Ambiguous Health Athlete"],
    ["s-h3", "Pain Athlete"],
    ["s-h4", "Strength Hidden Athlete"],
    ["s-stepan", "Stepan Trofimov"],
    ["s-elizaveta", "Elizaveta Kolodkina"],
    ["s-sch", "Schedule Athlete"],
    ["s-sch-2", "Schedule Dates Athlete"],
    ["s-mov", "Move Athlete"],
    ["s-mov-2", "Move Visible Athlete"],
    ["s-oth", "Other Athlete"],
    ["s-x1", "Extra One"],
    ["s-x2", "Extra Two"],
    ["s-x3", "Extra Three"],
    ["s-x4", "Extra Four"],
    ["s-x5", "Extra Five"],
  ]);

  return buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals,
    studentNameById,
    asOfDate: "2026-06-03",
    scope,
    limit: 10,
    activeMoveActions: [
      {
        id: "action-visible-1",
        studentId: "s-mov-2",
        actionType: "move_workout",
        status: "pending_coach",
        sourceChatId: "chat-1",
        sourceMessageId: "msg-1",
        sourceUserId: null,
        rawText: "fixture",
        parsedPayload: {
          sourceDate: "2026-06-04",
          target: { kind: "date", value: "2026-06-06" },
        },
        confidence: null,
        coachChatId: null,
        approvedAt: null,
        rejectedAt: null,
        decidedByChatId: null,
        decidedByUserId: null,
        decisionMessageId: null,
        executionStatus: "not_started",
        executionMode: null,
        claimedBy: null,
        claimedAt: null,
        lastRunId: null,
        executionRequestedAt: null,
        executionRequestedByChatId: null,
        executionRequestedByUserId: null,
        executionRequestMessageId: null,
        cancelledAt: null,
        cancelledByChatId: null,
        cancelledByUserId: null,
        cancelMessageId: null,
        createdAt: "2026-06-03T08:00:00.000Z",
        updatedAt: "2026-06-03T08:00:00.000Z",
      },
    ],
  });
}

function run(): void {
  const snapshot = buildSnapshot("all");
  const text = formatTrainingPeaksOperationalSignalsForTelegram(snapshot);

  // B: all key sections are present
  assert(!text.includes("🩺 Проверить"), "B failed: check section should be hidden in normal /tp_signals.");
  assert(!text.includes("follow-up"), "B failed: internal follow-up language should not be shown.");
  assert(text.includes("🟡 Болезнь / пауза"), "B failed: health section missing.");
  assert(text.includes("🦵 Боль / травмы"), "B failed: pain/injury section missing.");
  assert(text.includes("📅 Учесть в плане"), "B failed: planning section missing.");
  assert(text.includes("🔁 Переносы"), "B failed: move section missing.");

  // C: schedule and move signals are represented
  assert(text.includes("Schedule Athlete"), "C failed: schedule signal not shown.");
  assert(!text.includes("Move Athlete"), "C failed: stale move signal without active action should be hidden.");
  assert(text.includes("Move Visible Athlete"), "C failed: move with active action should be shown.");
  const scheduleScopeText = formatTrainingPeaksOperationalSignalsForTelegram(buildSnapshot("schedule"));
  assert(
    scheduleScopeText.includes("05.06") || scheduleScopeText.includes("недоступна"),
    "C failed: schedule scope should show concrete unavailability dates."
  );
  assert(
    scheduleScopeText.includes("вт 02.06") || scheduleScopeText.includes("доступна"),
    "C failed: schedule scope should show concrete availability dates."
  );
  assert(
    scheduleScopeText.includes("Schedule Dates Athlete"),
    "C failed: rich schedule episode line missing."
  );
  const planSection = extractSectionBlock(scheduleScopeText, "📅 Учесть в плане", "🔁 Переносы");
  const scheduleDatesCard = planSection.split("• Schedule Dates Athlete")[1]?.split("\n\n")[0] ?? "";
  assert(
    scheduleDatesCard.includes("планирует:") &&
      scheduleDatesCard.includes("недоступна:") &&
      scheduleDatesCard.indexOf("недоступна:") < scheduleDatesCard.indexOf("планирует:"),
    "C failed: schedule scope should show unavailability then planned dates."
  );
  assert(
    planSection.includes("• Schedule Dates Athlete\n"),
    "C failed: schedule card should put athlete name on its own line."
  );
  assert(
    planSection.includes("  планирует:") && planSection.includes("  недоступна:"),
    "C failed: schedule planning lines should be indented under the athlete name."
  );
  assert(
    !scheduleScopeText.includes("недоступность"),
    "C failed: legacy vague schedule line should be suppressed when rich episode exists."
  );

  // D: overflow line appears
  assert(snapshot.overflowCount > 0, "D failed: expected overflow count.");
  assert(text.includes(`+${snapshot.overflowCount} ещё сигналов`), "D failed: overflow line missing.");

  // E: human-readable, no raw JSON/object dump keys
  assert(!text.includes("{\""), "E failed: raw JSON leaked to output.");
  assert(!text.includes("follow_up_status"), "E failed: raw metadata key leaked.");

  // F: no raw scope label line for non-default scope
  const healthText = formatTrainingPeaksOperationalSignalsForTelegram(buildSnapshot("health"));
  assert(!healthText.includes("Фильтр:"), "F failed: raw scope label should not be shown.");
  assert(
    healthText.includes("кашель ещё есть") && healthText.includes("хочет пробежку завтра вечером"),
    "F failed: health scope should show rich coaching summary instead of vague label."
  );
  assert(healthText.includes("Pain Athlete"), "F failed: pain/injury signal should be visible in health section.");
  assert(healthText.includes("надкостница"), "F failed: pain/injury summary should preserve body area.");
  assert(!text.includes("Strength Hidden Athlete"), "F failed: hidden strength context should not be visible.");
  assert(!text.includes("силовые: вт/чт"), "F failed: hidden strength context text leaked.");
  assert(!text.includes("Pain Athlete\n  болеет"), "F failed: pain/injury row must not use illness wording.");
  assert(
    text.includes("Stepan Trofimov") && text.includes("боль / надкостница (уточнить, актуально ли)"),
    "F failed: Stepan pain/injury should stay visible."
  );
  assert(!text.includes("Stepan Trofimov\n  болеет"), "F failed: Stepan ambiguous illness must not overclaim 'болеет'.");
  assert(!text.includes("Elizaveta Kolodkina"), "F failed: expired planned-only Elizaveta signal should be hidden.");
  const ambiguousVisible = text.includes("Ambiguous Health Athlete");
  if (ambiguousVisible) {
    assert(
      text.includes("сил нет") || text.includes("голова болит") || text.includes("плохое самочувствие"),
      "F failed: ambiguous health case should show cautious wording."
    );
    assert(!text.includes("Ambiguous Health Athlete\n  болеет"), "F failed: ambiguous symptom-only case must not say 'болеет'.");
  }
  assert(!healthText.includes("health_context:"), "F failed: technical health_context prefix should not leak.");
  assert(!healthText.includes("пауза / наблюдать"), "F failed: pause/observe label should not leak.");
  assert(!healthText.includes("illness-related pause follow-up"), "F failed: internal follow-up labels should not leak.");

  // H: future pending and resolved follow-up are not visible in normal output
  assert(
    text.includes("Future Athlete"),
    "H failed: future pending active illness should remain visible in normal output."
  );
  assert(
    !text.includes("Resolved Athlete"),
    "H failed: resolved follow-up should not appear in normal output."
  );
  assert(
    scheduleScopeText.includes("недоступна: 05.06, 08.06") && scheduleScopeText.includes("планирует: 02.06, 04.06"),
    "H failed: schedule output should include explicit unavailable and planned date lists."
  );

  // G: empty snapshot handled
  const emptyText = formatTrainingPeaksOperationalSignalsForTelegram({
    scope: "all",
    sections: [
      { key: "health_pause", title: "🟡 Болезнь / пауза", items: [] },
      { key: "pain_injury", title: "🦵 Боль / травмы", items: [] },
      { key: "plan_constraints", title: "📅 Учесть в плане", items: [] },
      { key: "moves", title: "🔁 Переносы", items: [] },
      { key: "other", title: "ℹ️ Остальное", items: [] },
    ],
    totalBeforeLimit: 0,
    overflowCount: 0,
  });
  assert(
    emptyText.includes("Активных сигналов не найдено."),
    "G failed: empty-state text missing."
  );

  const expiredScheduleSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: [
      makeSignal({
        signalId: "sig-expired-schedule",
        studentId: "s-expired",
        signalType: "schedule_unavailability_window",
        validFrom: "2026-06-04",
        validUntil: "2026-06-04",
        structuredPayload: {
          unavailable_dates: ["2026-06-04"],
        },
      }),
      makeSignal({
        signalId: "sig-active-schedule",
        studentId: "s-active",
        signalType: "schedule_unavailability_window",
        validFrom: "2026-06-05",
        validUntil: "2026-06-05",
      }),
    ],
    studentNameById: new Map<string, string | null>([
      ["s-expired", "Expired Schedule Athlete"],
      ["s-active", "Active Schedule Athlete"],
    ]),
    asOfDate: "2026-06-05",
    scope: "schedule",
    limit: 10,
    activeMoveActions: [],
  });
  const expiredScheduleText = formatTrainingPeaksOperationalSignalsForTelegram(expiredScheduleSnapshot);
  assert(!expiredScheduleText.includes("Expired Schedule Athlete"), "I failed: expired schedule signal must be hidden.");
  assert(expiredScheduleText.includes("Active Schedule Athlete"), "I failed: same-day schedule signal must stay visible.");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
