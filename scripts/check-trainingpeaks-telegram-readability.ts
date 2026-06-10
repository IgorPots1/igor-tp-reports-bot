import process from "node:process";

import {
  buildCoachActionsListText,
  type CoachActionListItem,
} from "@/features/trainingpeaks/action-list-telegram-copy";
import {
  buildTrainingPeaksAttentionDigestMessages,
  formatTrainingPeaksAttentionSnapshotMessage,
  TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT,
} from "@/features/trainingpeaks/attention-telegram";
import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  formatTrainingPeaksOperationalSignalsForTelegram,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/service";
import {
  expandCoachRunSummaryForDetail,
  formatTelegramLabeledBlock,
} from "@/features/trainingpeaks/telegram-visual-ux";

const LOG_PREFIX = "[check-trainingpeaks-telegram-readability]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeAction(input: Partial<CoachActionListItem> & Pick<CoachActionListItem, "id">): CoachActionListItem {
  return {
    studentName: "Aleksandra Kasianenko",
    status: "approved",
    executionStatus: "dry_run_completed",
    executionMode: "dry_run",
    actionType: "move_workout",
    parsedPayload: {
      sourceDate: null,
      target: { kind: "date", value: "2026-06-01" },
    },
    createdAt: "2026-05-31T10:29:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    latestRunContext: {
      latestDryRun: {
        status: "completed",
        dryRunResult: "not_found",
        canExecute: false,
        blockedReason: "confidence below threshold 0.8",
      },
    },
    ...input,
  };
}

function makeSignal(
  input: Partial<TrainingPeaksStudentOperationalSignal> & Pick<TrainingPeaksStudentOperationalSignal, "id" | "studentId" | "signalType">
): TrainingPeaksStudentOperationalSignal {
  return {
    status: "active",
    sourceDate: null,
    targetDate: null,
    validFrom: null,
    validUntil: null,
    metadata: {},
    structuredPayload: {},
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-02T12:00:00.000Z",
    ...input,
  };
}

function run(): void {
  const listText = buildCoachActionsListText([makeAction({ id: "a-review" })]);
  assert(listText.includes("📋 Заявки на перенос"), "actions list title missing");
  assert(listText.includes("⚠️ Нужно проверить\n\n"), "review section needs blank line after header");
  assert(listText.includes("1. Aleksandra Kasianenko\n"), "action name should be on its own line");
  assert(listText.includes("   перенос: ? → 01.06"), "move route should be on a separate indented line");
  assert(listText.includes("   причина: тренировка не найдена"), "review reason should be on its own line");
  assert(!/\d+\. [^\n]+ — /.test(listText), "list items must not glue name and route with em dash");
  assert(!listText.includes("confidence below threshold"), "raw confidence text leaked");
  assert(!listText.includes("dry_run_completed"), "raw execution status leaked");

  const dryRunDetail = expandCoachRunSummaryForDetail("тренировка не найдена — недостаточно уверенности, нужна проверка");
  assert(dryRunDetail.length >= 2, "dry-run detail should split into multiple lines");
  assert(!dryRunDetail.some((line) => line.includes(" — ")), "dry-run detail lines should not keep em dash glue");

  const labeled = formatTelegramLabeledBlock("Ученик:", "Test Athlete").join("\n");
  assert(labeled.includes("Ученик:\nTest Athlete"), "labeled block should put value on the next line");

  const signals = [
    makeSignal({
      id: "sig-sofia-avail",
      studentId: "student-sofia",
      signalType: "schedule_availability_window",
      metadata: { episode_key: "ep-sofia" },
      structuredPayload: { resolved_available_dates: ["2026-06-02", "2026-06-04"] },
    }),
    makeSignal({
      id: "sig-sofia-unavail",
      studentId: "student-sofia",
      signalType: "schedule_unavailability_window",
      metadata: { episode_key: "ep-sofia" },
      validFrom: "2026-06-05",
      validUntil: "2026-06-08",
      structuredPayload: {},
    }),
    makeSignal({
      id: "sig-move",
      studentId: "student-move",
      signalType: "move_workout_candidate",
      sourceDate: "2026-06-05",
      targetDate: "2026-06-04",
      metadata: { episode_key: "ep-move" },
    }),
  ];
  const signalsText = formatTrainingPeaksOperationalSignalsForTelegram(
    buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
      signals,
      studentNameById: new Map([
        ["student-sofia", "Sofia Vlasova"],
        ["student-move", "ILYA BOGDANOV"],
      ]),
      asOfDate: "2026-06-03",
      scope: "all",
      limit: 10,
    })
  );
  assert(signalsText.includes("📍 Сигналы"), "signals title should be coach-facing");
  assert(signalsText.includes("📅 Учесть в плане\n\n"), "plan section needs blank line after header");
  assert(signalsText.includes("• Sofia Vlasova\n"), "schedule card should put name on its own line");
  assert(signalsText.includes("  доступна:"), "availability should be on a separate indented line");
  assert(signalsText.includes("  недоступна:"), "unavailability should be on a separate indented line");
  assert(!signalsText.includes("2026-06-05"), "ISO dates should not appear in coach signals output");
  assert(signalsText.includes("• ILYA BOGDANOV\n"), "move card should put athlete name on its own line");
  assert(signalsText.includes("  05.06 → 04.06"), "move dates should be compact on their own line");

  const attentionMessage = formatTrainingPeaksAttentionSnapshotMessage(
    {
      urgent: [],
      today: [],
      observe: [],
      fyi: [],
      checkTodaySignals: [],
      painDiscomfort: [],
      missedWorkouts: [],
      noContact5Days: [
        {
          level: "observe",
          studentName: "Student Name",
          reason: "7 дней",
        },
      ],
      followUpToday: [],
      followUpOverflowCount: 0,
      planConstraintsToday: [
        {
          level: "today",
          studentName: "Sofia Vlasova",
          studentId: "student-sofia",
          reason: "доступна: вт 02.06, чт 04.06; недоступна: 05.06—08.06",
          signalKind: "operational_schedule",
        },
      ],
      planConstraintsOverflowCount: 0,
      movesToday: [],
      movesOverflowCount: 0,
    },
    "Утренний обзор"
  );
  assert(attentionMessage.includes("📭 Нет контакта\n\n"), "contact section needs blank line after header");
  assert(attentionMessage.includes("• Student Name\n  7 дней"), "contact card should split name and days");
  assert(attentionMessage.includes("• Sofia Vlasova\n  доступна:"), "plan card should split name and availability");

  const chunks = buildTrainingPeaksAttentionDigestMessages(
    {
      urgent: [],
      today: [],
      observe: [],
      fyi: [],
      checkTodaySignals: [],
      painDiscomfort: [],
      missedWorkouts: Array.from({ length: 40 }, (_, index) => ({
        level: "today" as const,
        studentName: `Athlete ${index + 1}`,
        reason: "вчера была беговая тренировка, выполнения не найдено",
        signalKind: "missed_workout" as const,
      })),
      noContact5Days: [],
      followUpToday: [],
      followUpOverflowCount: 0,
      planConstraintsToday: [],
      planConstraintsOverflowCount: 0,
      movesToday: [],
      movesOverflowCount: 0,
    },
    "Утренний обзор TrainingPeaks"
  );
  assert(
    chunks.every((chunk) => chunk.length <= TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT),
    "attention chunks must stay within safe limit"
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
