import {
  classifyPendingReviewMutations,
  resolvePendingMutationTargetStatus,
  TP_SIGNAL_REVIEW_PENDING_MUTATIONS_CONFIRM,
} from "@/features/trainingpeaks/tp-signals-review-pending-mutations";
import type {
  TrainingPeaksOperationalSignalReviewDecision,
  TrainingPeaksOperationalSignalReviewDecisionName,
  TrainingPeaksOperationalSignalReviewDecisionSource,
  TrainingPeaksOperationalSignalStatus,
  TrainingPeaksOperationalSignalType,
  TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check:tp-signals-review-pending-mutations]";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`OK ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function makeSignal(input: {
  id: string;
  signalType: TrainingPeaksOperationalSignalType;
  status?: TrainingPeaksOperationalSignalStatus;
  lifecycleState?: string | null;
  metadata?: Record<string, unknown>;
}): TrainingPeaksStudentOperationalSignal {
  return {
    id: input.id,
    studentId: `student-${input.id}`,
    signalType: input.signalType,
    status: input.status ?? "active",
    lifecycleState: (input.lifecycleState ?? null) as TrainingPeaksStudentOperationalSignal["lifecycleState"],
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: false,
    sourceType: "business_dm",
    sourceObservationId: null,
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
    dedupeKey: `dedupe-${input.id}`,
    consumedAt: null,
    metadata: input.metadata ?? {},
    createdAt: "2026-06-13T08:00:00.000Z",
    updatedAt: "2026-06-13T08:00:00.000Z",
  };
}

function makeDecision(input: {
  signalId: string;
  decision: TrainingPeaksOperationalSignalReviewDecisionName;
  decisionSource?: TrainingPeaksOperationalSignalReviewDecisionSource;
  createdAt?: string;
}): TrainingPeaksOperationalSignalReviewDecision {
  return {
    id: `decision-${input.signalId}`,
    signalId: input.signalId,
    studentId: `student-${input.signalId}`,
    bucket: "review_required",
    decision: input.decision,
    decisionSource: input.decisionSource ?? "telegram_button",
    coachTelegramUserId: "507447935",
    callbackShortId: input.signalId.slice(0, 8),
    metadata: {},
    createdAt: input.createdAt ?? "2026-06-13T15:23:54.000Z",
  };
}

function run(): void {
  // --- Target status policy -------------------------------------------------
  const closeHealth = resolvePendingMutationTargetStatus({ decision: "close_signal", signalType: "health_issue_improving" });
  assert(
    "close_signal on illness → dismissed + resolved",
    closeHealth.status === "dismissed" && closeHealth.lifecycleState === "resolved",
    JSON.stringify(closeHealth)
  );
  const closePain = resolvePendingMutationTargetStatus({ decision: "close_signal", signalType: "pain_injury" });
  assert(
    "close_signal on pain → dismissed + resolved",
    closePain.status === "dismissed" && closePain.lifecycleState === "resolved",
    JSON.stringify(closePain)
  );
  const closeSchedule = resolvePendingMutationTargetStatus({ decision: "close_signal", signalType: "plan_generation_constraint" });
  assert(
    "close_signal on schedule → expired",
    closeSchedule.status === "expired" && closeSchedule.lifecycleState === null,
    JSON.stringify(closeSchedule)
  );
  const hideSchedule = resolvePendingMutationTargetStatus({ decision: "hide_from_queue", signalType: "plan_generation_constraint" });
  assert(
    "hide_from_queue → dismissed (status only)",
    hideSchedule.status === "dismissed" && hideSchedule.lifecycleState === null,
    JSON.stringify(hideSchedule)
  );

  // --- Classification cases -------------------------------------------------
  const signals: TrainingPeaksStudentOperationalSignal[] = [
    makeSignal({ id: "s-close-illness", signalType: "health_issue_improving" }), // eligible (Ivanov-like)
    makeSignal({ id: "s-hide-illness", signalType: "health_issue_improving" }), // eligible dismiss
    makeSignal({ id: "s-ack", signalType: "pain_injury" }), // not eligible: acknowledged
    makeSignal({ id: "s-keep", signalType: "plan_generation_constraint" }), // not eligible: keep_visible latest
    makeSignal({ id: "s-inactive", signalType: "health_issue_improving", status: "dismissed" }), // not eligible: not active
    makeSignal({
      id: "s-applied",
      signalType: "health_issue_improving",
      metadata: { review_queue_resolved_by: "coach_review_queue" },
    }), // not eligible: already applied
    makeSignal({ id: "s-diag-source", signalType: "health_issue_improving" }), // not eligible: source diagnostic
    makeSignal({ id: "s-no-decision", signalType: "pain_injury" }), // skipped (not a candidate)
  ];

  const latestDecisionBySignalId = new Map<string, TrainingPeaksOperationalSignalReviewDecision>([
    ["s-close-illness", makeDecision({ signalId: "s-close-illness", decision: "close_signal" })],
    ["s-hide-illness", makeDecision({ signalId: "s-hide-illness", decision: "hide_from_queue" })],
    ["s-ack", makeDecision({ signalId: "s-ack", decision: "acknowledged" })],
    ["s-keep", makeDecision({ signalId: "s-keep", decision: "keep_visible", createdAt: "2026-06-13T16:00:00.000Z" })],
    ["s-inactive", makeDecision({ signalId: "s-inactive", decision: "close_signal" })],
    ["s-applied", makeDecision({ signalId: "s-applied", decision: "close_signal" })],
    ["s-diag-source", makeDecision({ signalId: "s-diag-source", decision: "close_signal", decisionSource: "diagnostic" })],
    // s-no-decision intentionally absent
  ]);

  const result = classifyPendingReviewMutations({ signals, latestDecisionBySignalId });
  const byId = new Map(result.candidates.map((c) => [c.signalId, c]));

  assert("close_signal-while-off illness is eligible", byId.get("s-close-illness")?.eligible === true);
  assert(
    "eligible illness close → proposed dismissed + resolved",
    byId.get("s-close-illness")?.proposedStatus === "dismissed" &&
      byId.get("s-close-illness")?.proposedLifecycleState === "resolved"
  );
  assert("hide_from_queue-while-off is eligible dismiss", byId.get("s-hide-illness")?.eligible === true && byId.get("s-hide-illness")?.proposedStatus === "dismissed");
  assert("acknowledged is not eligible", byId.get("s-ack")?.eligible === false && byId.get("s-ack")?.skipReason === "decision_not_replayable");
  assert("keep_visible latest is not eligible", byId.get("s-keep")?.eligible === false && byId.get("s-keep")?.skipReason === "decision_not_replayable");
  assert("inactive signal is not eligible", byId.get("s-inactive")?.eligible === false && byId.get("s-inactive")?.skipReason === "signal_not_active");
  assert("already-applied is not eligible", byId.get("s-applied")?.eligible === false && byId.get("s-applied")?.skipReason === "mutation_already_applied");
  assert("diagnostic source is not eligible", byId.get("s-diag-source")?.eligible === false && byId.get("s-diag-source")?.skipReason === "decision_source_not_replayable");
  assert("signal with no decision is not a candidate", !byId.has("s-no-decision"));

  // Targeted dry-run should resolve to exactly one eligible candidate.
  const targeted = classifyPendingReviewMutations({
    signals: signals.filter((s) => s.id === "s-close-illness"),
    latestDecisionBySignalId,
  });
  assert("targeted single-signal yields exactly one eligible", targeted.eligible.length === 1);

  // Confirm string is the exact phrase the replay requires.
  assert(
    "confirm phrase constant is exact",
    TP_SIGNAL_REVIEW_PENDING_MUTATIONS_CONFIRM === "APPLY TP SIGNAL REVIEW PENDING MUTATIONS"
  );

  // No delete / no terminal status other than dismissed|expired is ever proposed.
  assert(
    "no proposed status outside dismissed|expired",
    result.eligible.every((c) => c.proposedStatus === "dismissed" || c.proposedStatus === "expired")
  );

  console.log(`${LOG_PREFIX} pass=${passed} fail=${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log(`${LOG_PREFIX} PASS (${passed}/${passed})`);
}

run();
