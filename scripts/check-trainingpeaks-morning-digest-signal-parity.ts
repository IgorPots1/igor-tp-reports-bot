import process from "node:process";

import { formatTrainingPeaksAttentionSnapshotMessage } from "@/features/trainingpeaks/attention-telegram";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";
import {
  TRAININGPEAKS_OPERATIONAL_SIGNALS_TELEGRAM_LIMIT,
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  extractOperationalPainInjuryItemsFromSnapshot,
  mapOperationalPainInjuryItemToAttentionSignal,
  type TrainingPeaksAttentionSnapshot,
} from "@/features/trainingpeaks/service";

const LOG_PREFIX = "[check-trainingpeaks-morning-digest-signal-parity]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeSignal(input: {
  signalId: string;
  studentId: string;
  signalType: string;
  lifecycleState?: TrainingPeaksStudentOperationalSignal["lifecycleState"];
  structuredPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): TrainingPeaksStudentOperationalSignal {
  return {
    id: input.signalId,
    studentId: input.studentId,
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    lifecycleState: input.lifecycleState ?? "active_problem",
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
    validFrom: null,
    validUntil: null,
    sourceDate: null,
    targetDate: null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: null,
    dedupeKey: `fixture:${input.signalId}`,
    consumedAt: null,
    metadata: input.metadata ?? {},
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
  };
}

function buildSnapshotFromOperationalPainSignals(): {
  attentionSnapshot: TrainingPeaksAttentionSnapshot;
  tpSignalsPainReasons: string[];
} {
  const studentNameById = new Map<string, string | null>([
    ["s-alex", "Alexander Lavrentyev"],
    ["s-anna", "Anna Chernysheva"],
    ["s-generic", "Generic Pain Case"],
  ]);

  const signals = [
    makeSignal({
      signalId: "sig-alex-foot",
      studentId: "s-alex",
      signalType: "pain_injury",
      structuredPayload: {
        display_summary: "Лёгкий дискомфорт стопы",
        activity_domain: "injury",
        planning_effect: "safety_review",
        requires_coach_review: true,
      },
      metadata: {
        follow_up_reason: "наблюдать, уточнить если усилится",
      },
    }),
    makeSignal({
      signalId: "sig-anna-nail",
      studentId: "s-anna",
      signalType: "pain_injury",
      structuredPayload: {
        display_summary: "Ноготь после удара/отрыва",
        activity_domain: "injury",
        planning_effect: "safety_review",
        requires_coach_review: true,
      },
      metadata: {
        follow_up_reason: "уточнить, мешает ли бегу",
      },
    }),
    makeSignal({
      signalId: "sig-generic-hidden",
      studentId: "s-generic",
      signalType: "health_issue_started",
      structuredPayload: {
        latest_summary: "боль / дискомфорт",
        signal_type: "pain_injury",
        activity_domain: "injury",
        visible_in_tp_signals: false,
      },
    }),
  ];

  const operationalSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals,
    studentNameById,
    asOfDate: "2026-06-10",
    scope: "all",
    limit: TRAININGPEAKS_OPERATIONAL_SIGNALS_TELEGRAM_LIMIT,
  });
  const painItems = extractOperationalPainInjuryItemsFromSnapshot(operationalSnapshot);
  const painDiscomfort = painItems.map((item) =>
    mapOperationalPainInjuryItemToAttentionSignal({
      studentId: item.studentId,
      studentName: item.studentName,
      reason: item.text,
      signalId: item.signalId,
      signalType: item.signalType,
      lifecycleDisplayState: item.lifecycleDisplayState,
      followUpState: item.followUpState,
    })
  );

  return {
    attentionSnapshot: {
      urgent: [],
      today: [],
      observe: [],
      fyi: [],
      checkTodaySignals: [],
      painDiscomfort,
      missedWorkouts: [],
      noContact5Days: [],
      followUpToday: [],
      followUpOverflowCount: 0,
      planConstraintsToday: [],
      planConstraintsOverflowCount: 0,
      movesToday: [],
      movesOverflowCount: 0,
    },
    tpSignalsPainReasons: painItems.map((item) => item.text),
  };
}

function run(): void {
  const { attentionSnapshot, tpSignalsPainReasons } = buildSnapshotFromOperationalPainSignals();
  const message = formatTrainingPeaksAttentionSnapshotMessage(attentionSnapshot, "Утренний обзор TrainingPeaks");

  assert(attentionSnapshot.painDiscomfort.length === tpSignalsPainReasons.length, "Morning digest pain rows must match tp_signals pain count.");
  assert(
    attentionSnapshot.painDiscomfort.every((signal) => signal.signalKind === "operational_pain_injury"),
    "Morning digest pain rows must use operational_pain_injury source."
  );
  assert(!attentionSnapshot.painDiscomfort.some((signal) => signal.signalKind === "pain_case"), "Legacy pain_case rows must not appear.");
  assert(message.includes("Alexander Lavrentyev"), "Concrete operational pain athlete should render.");
  assert(message.includes("Лёгкий дискомфорт стопы"), "Operational pain summary should render.");
  assert(message.includes("наблюдать, уточнить если усилится"), "Operational pain action should render.");
  assert(!message.includes("Generic Pain Case"), "Hidden/generic pain rows must not leak into morning digest.");
  assert(!message.includes("• Generic Pain Case"), "Generic coach-case style pain must stay out.");
  assert(
    attentionSnapshot.painDiscomfort.every((signal) => tpSignalsPainReasons.includes(signal.reason)),
    "Every morning digest pain reason must exist in tp_signals pain section."
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
