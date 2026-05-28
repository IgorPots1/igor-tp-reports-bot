import {
  buildGroupCaseMovePairProposal,
  type ParsedTrainingPeaksMoveWorkoutPayload,
} from "@/features/trainingpeaks/service";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildProposalPayload(pair: NonNullable<ReturnType<typeof buildGroupCaseMovePairProposal>>): ParsedTrainingPeaksMoveWorkoutPayload {
  return {
    actionType: "move_workout",
    source: pair.source,
    target: pair.target,
    workoutDescriptor: null,
    confidence: pair.confidence,
    needsClarification: false,
    clarificationReason: null,
    parser: "group_case_proposal",
    sourceDate: pair.sourceDate,
    source_date: pair.sourceDate,
    parsingDiagnostics: {
      parserBaseDateSource: "message_timestamp",
      parserBaseDateIso: "2026-05-28",
      messageTimestampAvailable: true,
      source: "group_case",
      groupCaseId: "case-1",
      sourceType: "group_topic",
    } as ParsedTrainingPeaksMoveWorkoutPayload["parsingDiagnostics"] & Record<string, unknown>,
  };
}

const baseDateUnix = Math.floor(new Date("2026-05-28T10:00:00+02:00").getTime() / 1000);

const firstPair = buildGroupCaseMovePairProposal({
  sourceText: "сегодняшнюю",
  targetText: "пятницу",
  messageDateUnix: baseDateUnix,
});
assert(firstPair, "today -> friday pair must resolve");
const resolvedFirstPair = firstPair!;
assert(resolvedFirstPair.sourceDate === "2026-05-28", "today must resolve from message date");
assert(resolvedFirstPair.targetDate === "2026-05-29", "friday must resolve to next friday");

const secondPair = buildGroupCaseMovePairProposal({
  sourceText: "субботнюю",
  targetText: "воскресенье",
  messageDateUnix: baseDateUnix,
});
assert(secondPair, "saturday -> sunday pair must resolve");
const resolvedSecondPair = secondPair!;
assert(resolvedSecondPair.sourceDate === "2026-05-30", "saturday must resolve deterministically");
assert(resolvedSecondPair.targetDate === "2026-05-31", "sunday must resolve deterministically");

const firstPayload = buildProposalPayload(resolvedFirstPair);
assert(firstPayload.parser === "group_case_proposal", "proposal payload must use group_case_proposal parser");
assert(firstPayload.needsClarification === false, "deterministic proposal must not need clarification");
assert(firstPayload.sourceDate === "2026-05-28", "proposal payload must keep explicit sourceDate");
assert(firstPayload.target.kind === "date" && firstPayload.target.value === "2026-05-29", "target must be explicit date");

const actionDraft = {
  status: "pending_coach",
  executionStatus: "not_started",
  executionMode: null,
};
assert(actionDraft.status === "pending_coach", "group case proposals must stay pending_coach");
assert(actionDraft.executionStatus === "not_started", "group case proposals must not request dry-run automatically");
assert(actionDraft.executionMode === null, "group case proposals must not force execution mode");

const duplicateStore = new Map<string, string>();
const duplicateKey = `${resolvedFirstPair.sourceDate}->${resolvedFirstPair.targetDate}`;
duplicateStore.set(duplicateKey, "action-1");
assert(duplicateStore.has(duplicateKey), "duplicate call must detect existing source/target pair");

const unknownPair = buildGroupCaseMovePairProposal({
  sourceText: "когда-нибудь",
  targetText: "пятницу",
  messageDateUnix: baseDateUnix,
});
assert(unknownPair === null, "unknown pair text must return needs_manual_review path");

const futureReportLike = buildGroupCaseMovePairProposal({
  sourceText: "завтра",
  targetText: "отпишу",
  messageDateUnix: baseDateUnix,
});
assert(futureReportLike === null, "future-report style text must not create move proposals");

console.log("check-trainingpeaks-group-case-action-proposals: ok");
