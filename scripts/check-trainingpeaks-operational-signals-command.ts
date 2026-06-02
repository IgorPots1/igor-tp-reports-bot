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

function extractSectionBlock(text: string, sectionTitle: string, nextSectionTitle: string): string {
  const start = text.indexOf(sectionTitle);
  if (start < 0) {
    return "";
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
      signalType: "pause_training",
      validFrom: "2026-06-01",
      validUntil: "2026-06-05",
      metadata: {
        reason: "острая простуда",
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
    ["s-sch", "Schedule Athlete"],
    ["s-sch-2", "Schedule Dates Athlete"],
    ["s-mov", "Move Athlete"],
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
  });
}

function run(): void {
  const snapshot = buildSnapshot("all");
  const text = formatTrainingPeaksOperationalSignalsForTelegram(snapshot);
  const checkSection = extractSectionBlock(text, "🩺 Проверить", "🟡 Болезнь / пауза");

  // A: overdue before due today in check section
  const overdueIndex = checkSection.indexOf("Overdue Athlete");
  const dueIndex = checkSection.indexOf("Due Athlete");
  assert(overdueIndex >= 0, "A failed: overdue follow-up missing.");
  assert(dueIndex >= 0, "A failed: due-today follow-up missing.");
  assert(overdueIndex < dueIndex, "A failed: overdue must appear before due-today.");

  // B: all key sections are present
  assert(text.includes("🩺 Проверить"), "B failed: check section missing.");
  assert(text.includes("🟡 Болезнь / пауза"), "B failed: health section missing.");
  assert(text.includes("📅 Учесть в плане"), "B failed: planning section missing.");
  assert(text.includes("🔁 Переносы"), "B failed: move section missing.");

  // C: schedule and move signals are represented
  assert(text.includes("Schedule Athlete"), "C failed: schedule signal not shown.");
  assert(text.includes("Move Athlete"), "C failed: move signal not shown.");
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
    scheduleDatesCard.includes("доступна:") &&
      scheduleDatesCard.includes("недоступна:") &&
      scheduleDatesCard.indexOf("доступна:") < scheduleDatesCard.indexOf("недоступна:"),
    "C failed: schedule scope should show availability before unavailability."
  );
  assert(
    planSection.includes("• Schedule Dates Athlete\n"),
    "C failed: schedule card should put athlete name on its own line."
  );
  assert(
    planSection.includes("  доступна:") && planSection.includes("  недоступна:"),
    "C failed: schedule availability lines should be indented under the athlete name."
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

  // H: future pending and resolved follow-up are not in check section
  assert(
    !checkSection.includes("Future Athlete"),
    "H failed: future pending should not be prioritized in check list."
  );
  assert(
    !checkSection.includes("Resolved Athlete"),
    "H failed: resolved follow-up should not appear in check list."
  );

  // G: empty snapshot handled
  const emptyText = formatTrainingPeaksOperationalSignalsForTelegram({
    scope: "all",
    sections: [
      { key: "check_now", title: "🩺 Проверить", items: [] },
      { key: "health_pause", title: "🟡 Болезнь / пауза", items: [] },
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

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
