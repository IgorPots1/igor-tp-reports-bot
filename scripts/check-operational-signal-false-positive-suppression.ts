import process from "node:process";

import { classifyCoachOperationalSignal } from "@/features/trainingpeaks/coach-operational-signals";
import {
  buildFalsePositiveSuppressionApplyToken,
  buildFalsePositiveSuppressionDryRunFingerprint,
  inferFalsePositiveSuppressionReason,
  parseFalsePositiveSuppressionApplyToken,
  validateFalsePositiveSuppressionSafety,
  type FalsePositiveSuppressionReason,
} from "@/features/trainingpeaks/operational-signal-false-positive-suppression";
import type {
  TrainingPeaksStudentOperationalSignal,
  TrainingPeaksTelegramContextObservation,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-operational-signal-false-positive-suppression]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mkSignal(partial: Partial<TrainingPeaksStudentOperationalSignal> = {}): TrainingPeaksStudentOperationalSignal {
  return {
    id: "signal-1",
    studentId: "student-1",
    signalType: "health_issue_started",
    status: "active",
    lifecycleState: "active_problem",
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: false,
    sourceType: "telegram",
    sourceObservationId: "obs-1",
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: { display_summary: "болеет" },
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
    dedupeKey: "dedupe-1",
    consumedAt: null,
    metadata: {},
    createdAt: "2026-06-07T10:00:00.000Z",
    updatedAt: "2026-06-07T10:00:00.000Z",
    ...partial,
  };
}

function mkObservation(
  partial: Partial<TrainingPeaksTelegramContextObservation> = {}
): TrainingPeaksTelegramContextObservation {
  return {
    id: "obs-1",
    studentId: "student-1",
    sourceType: "business_dm",
    chatId: "10001",
    messageThreadId: null,
    messageId: "20001",
    observedAt: "2026-06-07T09:00:00.000Z",
    labels: ["pain_or_health"],
    textSha256: null,
    textPreview: "Все четко, нога не болела",
    metadata: {},
    createdAt: "2026-06-07T09:00:00.000Z",
    ...partial,
  };
}

function evaluateCase(input: {
  name: string;
  signal: TrainingPeaksStudentOperationalSignal;
  observation: TrainingPeaksTelegramContextObservation;
  reason: FalsePositiveSuppressionReason;
  expectedDecision: "allowed" | "refused";
}): void {
  const classification = classifyCoachOperationalSignal({
    studentId: input.observation.studentId,
    sourceType: input.observation.sourceType,
    textPreview: input.observation.textPreview,
    labels: input.observation.labels,
    metadata: input.observation.metadata,
  });
  const dryRunFingerprint = buildFalsePositiveSuppressionDryRunFingerprint({
    signalId: input.signal.id,
    sourceObservationId: input.observation.id,
    studentId: input.signal.studentId,
    signalType: input.signal.signalType,
    lifecycleState: input.signal.lifecycleState,
    displaySummary: "болеет",
    sourceTextHash: "placeholder",
    reason: input.reason,
    classifierPrimaryBucket: classification.primary_bucket,
    asOfDate: "2026-06-08",
  });
  const validation = validateFalsePositiveSuppressionSafety({
    signal: input.signal,
    observation: input.observation,
    sourceObservationId: input.observation.id,
    reason: input.reason,
    classification,
    dryRunFingerprint,
  });
  assert(
    validation.decision === input.expectedDecision,
    `${input.name} failed: expected ${input.expectedDecision}, got ${validation.decision} (${validation.reason})`
  );
}

function run(): void {
  evaluateCase({
    name: "negated pain source allowed dry-run",
    signal: mkSignal(),
    observation: mkObservation({ textPreview: "Все четко, нога не болела" }),
    reason: "negated_pain_cue",
    expectedDecision: "allowed",
  });
  assert(
    inferFalsePositiveSuppressionReason("Все четко, нога не болела") === "negated_pain_cue",
    "negated pain inference failed"
  );

  evaluateCase({
    name: "figurative idiom source allowed dry-run",
    signal: mkSignal({
      sourceObservationId: "obs-kruglova",
      structuredPayload: { display_summary: "плохое самочувствие" },
    }),
    observation: mkObservation({
      id: "obs-kruglova",
      textPreview: "мне так не хватает побегать побыстрее, прям душа болит",
    }),
    reason: "figurative_idiom",
    expectedDecision: "allowed",
  });

  evaluateCase({
    name: "quoted weakness idiom allowed dry-run",
    signal: mkSignal({
      sourceObservationId: "obs-denisova",
      structuredPayload: { display_summary: "слабость" },
    }),
    observation: mkObservation({
      id: "obs-denisova",
      textPreview: 'это была "минутка слабости"',
    }),
    reason: "quoted_idiom",
    expectedDecision: "allowed",
  });

  evaluateCase({
    name: "true active symptom refused",
    signal: mkSignal({ sourceObservationId: "obs-active" }),
    observation: mkObservation({
      id: "obs-active",
      textPreview: "нога болела после бега",
    }),
    reason: "negated_pain_cue",
    expectedDecision: "refused",
  });

  evaluateCase({
    name: "wrong student/source mismatch refused",
    signal: mkSignal({ sourceObservationId: "obs-other" }),
    observation: mkObservation({ id: "obs-1" }),
    reason: "negated_pain_cue",
    expectedDecision: "refused",
  });

  const resolvedSignal = mkSignal({
    lifecycleState: "resolved",
    resolvedAt: "2026-06-08T00:00:00.000Z",
    resolvedReason: "explicit_recovery",
  });
  evaluateCase({
    name: "already resolved refused safely",
    signal: resolvedSignal,
    observation: mkObservation(),
    reason: "negated_pain_cue",
    expectedDecision: "refused",
  });

  evaluateCase({
    name: "no source observation refused",
    signal: mkSignal({ sourceObservationId: null }),
    observation: mkObservation(),
    reason: "negated_pain_cue",
    expectedDecision: "refused",
  });

  const fp = buildFalsePositiveSuppressionDryRunFingerprint({
    signalId: "signal-1",
    sourceObservationId: "obs-1",
    studentId: "student-1",
    signalType: "health_issue_started",
    lifecycleState: "active_problem",
    displaySummary: "болеет",
    sourceTextHash: "abc123",
    reason: "negated_pain_cue",
    classifierPrimaryBucket: "skip",
    asOfDate: "2026-06-08",
  });
  const token = buildFalsePositiveSuppressionApplyToken({
    signalId: "signal-1",
    sourceObservationId: "obs-1",
    dryRunFingerprint: fp,
  });
  assert(
    token === `SUPPRESS_FALSE_POSITIVE_SIGNAL:signal-1:obs-1:${fp}`,
    "token format should match SUPPRESS_FALSE_POSITIVE_SIGNAL:<signal>:<observation>:<sha256>"
  );
  const parsed = parseFalsePositiveSuppressionApplyToken(token);
  assert(parsed?.signalId === "signal-1", "parsed signal id should match");
  assert(parsed?.sourceObservationId === "obs-1", "parsed observation id should match");
  assert(parsed?.dryRunFingerprint === fp, "parsed fingerprint should match");

  const driftFp = buildFalsePositiveSuppressionDryRunFingerprint({
    signalId: "signal-1",
    sourceObservationId: "obs-1",
    studentId: "student-1",
    signalType: "health_issue_started",
    lifecycleState: "active_problem",
    displaySummary: "changed summary",
    sourceTextHash: "abc123",
    reason: "negated_pain_cue",
    classifierPrimaryBucket: "skip",
    asOfDate: "2026-06-08",
  });
  assert(fp !== driftFp, "token drift fingerprint should differ when display summary changes");

  const idempotentSignal = mkSignal({
    lifecycleState: "resolved",
    resolvedAt: "2026-06-08T00:00:00.000Z",
    resolvedReason: "false_positive:negated_pain_cue",
    lifecycleMeta: {
      false_positive_suppression: {
        dry_run_fingerprint: fp,
      },
    },
  });
  const idempotentValidation = validateFalsePositiveSuppressionSafety({
    signal: idempotentSignal,
    observation: mkObservation(),
    sourceObservationId: "obs-1",
    reason: "negated_pain_cue",
    classification: classifyCoachOperationalSignal({
      studentId: "student-1",
      sourceType: "business_dm",
      textPreview: "Все четко, нога не болела",
      labels: ["pain_or_health"],
      metadata: {},
    }),
    dryRunFingerprint: fp,
  });
  assert(idempotentValidation.decision === "allowed", "already suppressed with same fingerprint should be allowed/idempotent");

  console.log(`${LOG_PREFIX} OK`);
}

if (process.argv[1] && process.argv[1].endsWith("check-operational-signal-false-positive-suppression.ts")) {
  try {
    run();
  } catch (error) {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
