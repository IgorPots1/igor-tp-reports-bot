import process from "node:process";

import {
  buildOperationalSignalSupersedeApplyToken,
  buildOperationalSignalSupersedeDryRunFingerprint,
  getSupersededBySignalIdFromSignal,
  parseOperationalSignalSupersedeApplyToken,
  validateOperationalSignalSupersedeSafety,
} from "@/features/trainingpeaks/operational-signal-supersede-apply";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-operational-signal-supersede-apply]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mkSignal(partial: Partial<TrainingPeaksStudentOperationalSignal> = {}): TrainingPeaksStudentOperationalSignal {
  return {
    id: "source-1",
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
    sourceObservationId: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: {
      display_summary: "old duplicate illness",
    },
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
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    ...partial,
  };
}

function run(): void {
  const source = mkSignal({ id: "source-1" });
  const target = mkSignal({
    id: "target-1",
    lifecycleState: "monitoring_after_return",
    structuredPayload: { display_summary: "canonical monitoring row" },
  });

  const fpA = buildOperationalSignalSupersedeDryRunFingerprint({
    sourceSignalId: source.id,
    targetSignalId: target.id,
    sourceStudentId: source.studentId,
    targetStudentId: target.studentId,
    sourceLifecycle: source.lifecycleState,
    targetLifecycle: target.lifecycleState,
    sourceDisplaySummary: "old duplicate illness",
    targetDisplaySummary: "canonical monitoring row",
    reason: "duplicate illness episode",
    asOfDate: "2026-06-06",
  });
  const fpB = buildOperationalSignalSupersedeDryRunFingerprint({
    sourceSignalId: source.id,
    targetSignalId: target.id,
    sourceStudentId: source.studentId,
    targetStudentId: target.studentId,
    sourceLifecycle: source.lifecycleState,
    targetLifecycle: target.lifecycleState,
    sourceDisplaySummary: "old duplicate illness",
    targetDisplaySummary: "canonical monitoring row",
    reason: "duplicate   illness episode",
    asOfDate: "2026-06-06",
  });
  assert(fpA === fpB, "fingerprint should normalize reason whitespace");

  const token = buildOperationalSignalSupersedeApplyToken({
    sourceSignalId: source.id,
    targetSignalId: target.id,
    dryRunFingerprint: fpA,
  });
  assert(
    token === `SUPERSEDE_SIGNAL:source-1:target-1:${fpA}`,
    "token format should match SUPERSEDE_SIGNAL:<source>:<target>:<sha256>"
  );
  const parsed = parseOperationalSignalSupersedeApplyToken(token);
  assert(parsed?.sourceSignalId === source.id, "parsed source id should match");
  assert(parsed?.targetSignalId === target.id, "parsed target id should match");
  assert(parsed?.dryRunFingerprint === fpA, "parsed fingerprint should match");

  const allowed = validateOperationalSignalSupersedeSafety({
    source,
    target,
    reason: "duplicate illness episode",
  });
  assert(allowed.decision === "allowed", "same-student duplicate supersede should be allowed");

  const studentMismatch = validateOperationalSignalSupersedeSafety({
    source,
    target: mkSignal({ id: "target-2", studentId: "student-2" }),
    reason: "duplicate illness episode",
  });
  assert(studentMismatch.decision === "refused", "student mismatch should be refused");

  const sameId = validateOperationalSignalSupersedeSafety({
    source,
    target: mkSignal({ id: source.id }),
    reason: "duplicate illness episode",
  });
  assert(sameId.decision === "refused", "same id should be refused");

  const resolvedSource = validateOperationalSignalSupersedeSafety({
    source: mkSignal({ lifecycleState: "resolved", resolvedAt: "2026-06-05T00:00:00.000Z" }),
    target,
    reason: "duplicate illness episode",
  });
  assert(resolvedSource.decision === "refused", "resolved source should be refused");

  const alreadySuperseded = validateOperationalSignalSupersedeSafety({
    source: mkSignal({
      lifecycleMeta: { superseded_by_signal_id: "other-target" },
    }),
    target,
    reason: "duplicate illness episode",
  });
  assert(alreadySuperseded.decision === "refused", "already superseded by other target should be refused");

  const idempotentHint = validateOperationalSignalSupersedeSafety({
    source: mkSignal({
      lifecycleMeta: { superseded_by_signal_id: target.id },
    }),
    target,
    reason: "duplicate illness episode",
  });
  assert(idempotentHint.decision === "allowed", "already superseded by same target should remain allowed");

  const lifecycleMetaRead = getSupersededBySignalIdFromSignal(
    mkSignal({ lifecycleMeta: { superseded_by_signal_id: "target-abc" } })
  );
  assert(lifecycleMetaRead === "target-abc", "lifecycle_meta superseded_by_signal_id should be readable");

  console.log(`${LOG_PREFIX} PASS`);
}

if (process.argv[1] && process.argv[1].endsWith("check-operational-signal-supersede-apply.ts")) {
  try {
    run();
  } catch (error) {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
