import process from "node:process";

import type {
  TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import {
  resolveOperationalSignalDisplayLifecycleState,
  type OperationalSignalDisplayLifecycleState,
  type TrainingPeaksOperationalSignalDisplayEvidence,
  type TrainingPeaksOperationalSignalsItem,
} from "@/features/trainingpeaks/service";
import { assignActiveSignalReviewBucket } from "@/features/trainingpeaks/tp-signals-review-buckets-helpers";

const LOG_PREFIX = "[check:tp-signals-recovery-close-candidates]";
const AS_OF = "2026-06-15";
const OPENED_AT = "2026-06-10T08:00:00.000Z";

function makeSignal(input: {
  id: string;
  signalType: string;
  lifecycleState?: TrainingPeaksStudentOperationalSignal["lifecycleState"];
  createdAt?: string;
}): TrainingPeaksStudentOperationalSignal {
  return {
    id: input.id,
    studentId: "fixture-student",
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    lifecycleState: input.lifecycleState ?? null,
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: false,
    sourceType: "fixture",
    sourceObservationId: `${input.id}-src`,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: {},
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
    dedupeKey: `fixture:${input.id}`,
    consumedAt: null,
    metadata: {},
    createdAt: input.createdAt ?? OPENED_AT,
    updatedAt: input.createdAt ?? OPENED_AT,
  };
}

function makeEvidence(input: {
  positiveText?: string;
  positiveAt?: string;
  negativeText?: string;
  negativeAt?: string;
}): TrainingPeaksOperationalSignalDisplayEvidence {
  return {
    source: { observationId: "src", observedAt: OPENED_AT, sourceType: "business_dm", textPreview: "source" },
    latestPositive: input.positiveText
      ? { observationId: "pos", observedAt: input.positiveAt ?? "2026-06-14T09:00:00.000Z", sourceType: "business_dm", textPreview: input.positiveText }
      : null,
    latestNegative: input.negativeText
      ? { observationId: "neg", observedAt: input.negativeAt ?? "2026-06-14T09:00:00.000Z", sourceType: "business_dm", textPreview: input.negativeText }
      : null,
    completion: null,
  };
}

function makeItem(
  signal: TrainingPeaksStudentOperationalSignal,
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState,
  text: string
): TrainingPeaksOperationalSignalsItem {
  return {
    signalId: signal.id,
    studentId: signal.studentId,
    studentName: "Fixture Athlete",
    section: signal.signalType === "pain_injury" ? "pain_injury" : "health_pause",
    priority: 1,
    sortBucket: 1,
    dueDate: null,
    episodeKey: null,
    signalType: signal.signalType,
    isEpisodeSummary: false,
    followUpState: "none",
    lifecycleDisplayState,
    text,
    requiresCoachReview: null,
    hiddenReason: null,
  };
}

type Case = {
  name: string;
  signal: TrainingPeaksStudentOperationalSignal;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence;
  expectDisplayState: OperationalSignalDisplayLifecycleState;
  expectCloseCandidate: boolean;
};

const cases: Case[] = [
  {
    name: "1-pain-clean-recovery-close-candidate",
    signal: makeSignal({ id: "pain-clean", signalType: "pain_injury" }),
    evidence: makeEvidence({ positiveText: "сегодня всё ок, не болит, бегал нормально" }),
    expectDisplayState: "ready_for_coach_close",
    expectCloseCandidate: true,
  },
  {
    name: "2-pain-negative-evidence-blocks",
    signal: makeSignal({ id: "pain-neg", signalType: "pain_injury" }),
    evidence: makeEvidence({ negativeText: "сегодня снова болит и мешает бегу" }),
    expectDisplayState: "active_problem",
    expectCloseCandidate: false,
  },
  {
    name: "3-illness-clean-telegram-run-close-candidate",
    signal: makeSignal({ id: "ill-clean", signalType: "health_issue_started", lifecycleState: "monitoring_after_return" }),
    evidence: makeEvidence({ positiveText: "врач разрешил, лёгкая пробежка прошла нормально, самочувствие ок" }),
    expectDisplayState: "ready_for_coach_close",
    expectCloseCandidate: true,
  },
  {
    name: "4-illness-negative-run-feedback-blocks",
    signal: makeSignal({ id: "ill-neg", signalType: "health_issue_started", lifecycleState: "monitoring_after_return" }),
    evidence: makeEvidence({ negativeText: "побежала, но хватило на 20 минут, плохо, слабость" }),
    expectDisplayState: "monitoring_after_return",
    expectCloseCandidate: false,
  },
  {
    name: "5a-ambiguous-recovery-stays-cautious-pain",
    signal: makeSignal({ id: "amb-pain", signalType: "pain_injury" }),
    evidence: makeEvidence({ positiveText: "вроде лучше, но ещё не понятно" }),
    expectDisplayState: "active_problem",
    expectCloseCandidate: false,
  },
  {
    name: "5b-ambiguous-recovery-stays-cautious-illness",
    signal: makeSignal({ id: "amb-ill", signalType: "health_issue_started", lifecycleState: "monitoring_after_return" }),
    evidence: makeEvidence({ positiveText: "вроде лучше, но ещё не понятно" }),
    expectDisplayState: "monitoring_after_return",
    expectCloseCandidate: false,
  },
  {
    name: "6-pain-positive-but-later-negative-blocks",
    signal: makeSignal({ id: "pain-mixed", signalType: "pain_injury" }),
    evidence: makeEvidence({
      positiveText: "всё ок, не болит",
      positiveAt: "2026-06-13T09:00:00.000Z",
      negativeText: "опять заболело",
      negativeAt: "2026-06-14T09:00:00.000Z",
    }),
    expectDisplayState: "active_problem",
    expectCloseCandidate: false,
  },
];

function run(): void {
  const failures: string[] = [];

  for (const testCase of cases) {
    const displayState = resolveOperationalSignalDisplayLifecycleState(testCase.signal, testCase.evidence);
    if (displayState !== testCase.expectDisplayState) {
      failures.push(`${testCase.name}: display_state expected ${testCase.expectDisplayState} got ${displayState}`);
    }

    // Pain/illness signals must never auto-resolve via display layer.
    if ((displayState as string) === "resolved") {
      failures.push(`${testCase.name}: display layer must never auto-resolve`);
    }
    // The underlying signal status must remain active (no mutation).
    if (testCase.signal.status !== "active") {
      failures.push(`${testCase.name}: signal status mutated to ${testCase.signal.status}`);
    }

    const bucketResult = assignActiveSignalReviewBucket({
      studentName: "Fixture Athlete",
      signal: testCase.signal,
      item: makeItem(testCase.signal, displayState, "fixture row"),
      evidence: testCase.evidence,
      asOfDate: AS_OF,
    });
    const isCloseCandidate = bucketResult.bucket === "close_candidate_review";
    if (isCloseCandidate !== testCase.expectCloseCandidate) {
      failures.push(
        `${testCase.name}: close_candidate expected ${String(testCase.expectCloseCandidate)} got ${String(isCloseCandidate)} (bucket=${bucketResult.bucket})`
      );
    }
  }

  console.log(`${LOG_PREFIX} cases=${cases.length}`);
  for (const testCase of cases) {
    const displayState = resolveOperationalSignalDisplayLifecycleState(testCase.signal, testCase.evidence);
    const bucketResult = assignActiveSignalReviewBucket({
      studentName: "Fixture Athlete",
      signal: testCase.signal,
      item: makeItem(testCase.signal, displayState, "fixture row"),
      evidence: testCase.evidence,
      asOfDate: AS_OF,
    });
    console.log(`- ${testCase.name}: display=${displayState} bucket=${bucketResult.bucket}`);
  }

  if (failures.length > 0) {
    console.error(`${LOG_PREFIX} FAIL`);
    for (const failure of failures) {
      console.error(`  • ${failure}`);
    }
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} PASS (${cases.length}/${cases.length})`);
}

run();
