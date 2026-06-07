import {
  buildRecoveryEpisodeApplyToken,
  buildRecoveryEpisodeDisplaySummary,
  buildRecoveryEpisodeDryRunFingerprint,
  parseRecoveryEpisodeApplyToken,
  resolveDefaultRecoveryTargetAction,
  resolveRecoveryLifecycleAfterApply,
  validateRecoveryEpisodeApplySafety,
} from "@/features/trainingpeaks/operational-signal-recovery-episode-apply";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-operational-signal-recovery-episode-apply]";

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
    sourceObservationId: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: {
      display_summary: "болеет, горло; пауза / наблюдать",
      latest_summary: "болеет, горло; пауза / наблюдать",
    },
    confidence: null,
    validFrom: "2026-06-03T10:00:00.000Z",
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
    createdAt: "2026-06-03T10:00:00.000Z",
    updatedAt: "2026-06-03T10:00:00.000Z",
    ...partial,
  };
}

function run(): void {
  const displayImproving = buildRecoveryEpisodeDisplaySummary({
    observationText: "Привет! Чувствую себя лучше, завтра попробую побегать",
    classifierResult: "health_issue_improving",
  });
  assert(
    displayImproving === "после болезни: лучше, завтра пробный бег; наблюдать",
    "improving + tomorrow trial run should produce expected display summary"
  );

  const displayTomorrowRun = buildRecoveryEpisodeDisplaySummary({
    observationText: "вроде лучше намного, завтра побегу",
    classifierResult: "health_issue_improving",
  });
  assert(
    displayTomorrowRun === "после болезни: лучше, завтра пробежка; наблюдать",
    "improving + tomorrow run should produce expected display summary"
  );

  const displayResume = buildRecoveryEpisodeDisplaySummary({
    observationText: "с понедельника начинаем тренировки, я в строю",
    classifierResult: "resume_training",
  });
  assert(
    displayResume === "после болезни: в строю, возврат к тренировкам; наблюдать",
    "resume training should produce expected display summary"
  );

  const fpA = buildRecoveryEpisodeDryRunFingerprint({
    signalId: "sig-1",
    observationId: "obs-1",
    studentId: "student-1",
    currentLifecycle: "active_problem",
    currentDisplaySummary: "болеет, горло; пауза / наблюдать",
    observationObservedAt: "2026-06-07T08:52:38.769+00:00",
    observationTextHash: "abc123",
    classifierResult: "resume_training",
    proposedDisplaySummary: displayResume,
    proposedLifecycleTarget: "resolved_candidate",
    asOfDate: "2026-06-07",
  });
  const fpB = buildRecoveryEpisodeDryRunFingerprint({
    signalId: "sig-1",
    observationId: "obs-1",
    studentId: "student-1",
    currentLifecycle: "active_problem",
    currentDisplaySummary: "болеет, горло; пауза / наблюдать",
    observationObservedAt: "2026-06-07T08:52:38.769+00:00",
    observationTextHash: "abc123",
    classifierResult: "resume_training",
    proposedDisplaySummary: displayResume,
    proposedLifecycleTarget: "resolved_candidate",
    asOfDate: "2026-06-07",
  });
  assert(fpA === fpB, "fingerprint should be deterministic");

  const token = buildRecoveryEpisodeApplyToken({
    signalId: "sig-1",
    observationId: "obs-1",
    targetAction: "return_planned",
    dryRunFingerprint: fpA,
  });
  assert(
    token === `RECOVERY_EPISODE_UPDATE:sig-1:obs-1:return_planned:${fpA}`,
    "token format should match RECOVERY_EPISODE_UPDATE:<signal>:<observation>:<action>:<sha256>"
  );
  const parsed = parseRecoveryEpisodeApplyToken(token);
  assert(parsed?.signalId === "sig-1", "parsed signal id should match");
  assert(parsed?.observationId === "obs-1", "parsed observation id should match");
  assert(parsed?.targetAction === "return_planned", "parsed target action should match");
  assert(parsed?.dryRunFingerprint === fpA, "parsed fingerprint should match");
  assert(parseRecoveryEpisodeApplyToken("bad-token") === null, "invalid token should fail parse");

  const defaultTarget = resolveDefaultRecoveryTargetAction({
    classifierResult: "health_issue_improving",
    currentLifecycle: "active_problem",
  });
  assert(defaultTarget === "return_planned", "active illness improving should default to return_planned");

  const monitoringTarget = resolveDefaultRecoveryTargetAction({
    classifierResult: "health_issue_improving",
    currentLifecycle: "monitoring_after_return",
  });
  assert(
    monitoringTarget === "display_refresh_only",
    "monitoring lifecycle should default to display refresh only"
  );

  const resolvedCandidateLifecycle = resolveRecoveryLifecycleAfterApply({
    currentLifecycle: "active_problem",
    targetAction: "resolved_candidate",
    requestedLifecycleOverride: null,
  });
  assert(
    resolvedCandidateLifecycle === "return_planned",
    "resolved_candidate should conservatively move to return_planned"
  );

  const allowed = validateRecoveryEpisodeApplySafety({
    signal: mkSignal(),
    observationStudentId: "student-1",
    observationObservedAt: "2026-06-07T08:52:38.769+00:00",
    signalOpenTime: "2026-06-03T10:00:00.000Z",
    classifierResult: "health_issue_improving",
    signalClass: "confirmed_illness",
    proposedDisplaySummary: displayImproving,
    proposedLifecycleTarget: "return_planned",
    requestedLifecycleOverride: null,
    supersededBySignalId: null,
  });
  assert(allowed.decision === "allowed", "confirmed illness display refresh should be allowed");

  const studentMismatch = validateRecoveryEpisodeApplySafety({
    signal: mkSignal(),
    observationStudentId: "student-2",
    observationObservedAt: "2026-06-07T08:52:38.769+00:00",
    signalOpenTime: "2026-06-03T10:00:00.000Z",
    classifierResult: "health_issue_improving",
    signalClass: "confirmed_illness",
    proposedDisplaySummary: displayImproving,
    proposedLifecycleTarget: "return_planned",
    requestedLifecycleOverride: null,
    supersededBySignalId: null,
  });
  assert(studentMismatch.decision === "refused", "student mismatch should be refused");

  const injuryResolve = validateRecoveryEpisodeApplySafety({
    signal: mkSignal({ signalType: "pain_injury" }),
    observationStudentId: "student-1",
    observationObservedAt: "2026-06-07T08:52:38.769+00:00",
    signalOpenTime: "2026-06-03T10:00:00.000Z",
    classifierResult: "resume_training",
    signalClass: "injury_pain",
    proposedDisplaySummary: displayResume,
    proposedLifecycleTarget: "resolved_candidate",
    requestedLifecycleOverride: "resolved",
    supersededBySignalId: null,
  });
  assert(injuryResolve.decision === "refused", "injury pain terminal resolve should be refused");

  console.log(`${LOG_PREFIX} OK`);
}

run();
