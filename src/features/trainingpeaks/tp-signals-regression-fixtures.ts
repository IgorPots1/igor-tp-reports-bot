import { classifyCoachOperationalSignal, classifyCoachOperationalSignals } from "@/features/trainingpeaks/coach-operational-signals";
import { formatScheduleOperationalSignalText } from "@/features/trainingpeaks/operational-schedule-display";
import { evaluateOperationalSignalLifecycle } from "@/features/trainingpeaks/operational-signal-lifecycle";
import type { TrainingPeaksStudentOperationalSignal, TrainingPeaksTelegramContextObservation } from "@/features/trainingpeaks/repository";
import {
  buildMonitoringLifetimeDisplayLines,
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  collectOperationalSignalDiagnosticItems,
  findOperationalSignalNegativeAfterCompletion,
  isExpiredScheduleOperationalSignal,
  isOperationalNegativeObservationText,
  isOperationalPositiveObservationText,
  isStaleGenericScheduleUnavailabilitySignal,
  type TrainingPeaksOperationalSignalDisplayEvidence,
} from "@/features/trainingpeaks/service";

export type TpSignalsRegressionCaseId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type TpSignalsRegressionCaseResult = {
  caseId: TpSignalsRegressionCaseId;
  name: string;
  studentHint: string;
  bugClass: string;
  pass: boolean;
  current: Record<string, unknown>;
  expected: Record<string, unknown>;
  notes: string[];
};

const AS_OF_2026_06_12 = "2026-06-12";

function makeRunningCompletionFixture(input: { workoutId: string; workoutDate: string; title?: string }) {
  return {
    workoutId: input.workoutId,
    workoutDate: input.workoutDate,
    title: input.title ?? "Run",
    sportClass: "running_like" as const,
    runningCompletionClass: "normal_planned_run" as const,
    classificationConfidence: "high" as const,
    classificationReasonCodes: ["fixture"],
    classificationInspectedFields: {},
    plannedVsCompletedDelta: "normal" as const,
    evidenceFreshness: "ok" as const,
    completionObservedAt: `${input.workoutDate}T18:00:00.000Z`,
  };
}

function makeFixtureSignal(input: {
  id: string;
  studentId: string;
  signalType: string;
  structuredPayload?: Record<string, unknown>;
  validFrom?: string | null;
  validUntil?: string | null;
  lifecycleState?: TrainingPeaksStudentOperationalSignal["lifecycleState"];
  requiresCoachClose?: boolean;
  createdAt?: string;
  sourceObservationId?: string | null;
  episodeKey?: string | null;
}): TrainingPeaksStudentOperationalSignal {
  const metadata: Record<string, unknown> = {};
  if (input.episodeKey) {
    metadata.episode_key = input.episodeKey;
  }
  return {
    id: input.id,
    studentId: input.studentId,
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    lifecycleState: input.lifecycleState ?? null,
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: input.requiresCoachClose ?? false,
    sourceType: "fixture",
    sourceObservationId: input.sourceObservationId ?? null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: input.structuredPayload ?? {},
    confidence: null,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    sourceDate: null,
    targetDate: null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: null,
    dedupeKey: `fixture:${input.id}`,
    consumedAt: null,
    metadata,
    createdAt: input.createdAt ?? "2026-06-08T08:00:00.000Z",
    updatedAt: input.createdAt ?? "2026-06-08T08:00:00.000Z",
  };
}

function makeObservation(input: {
  id: string;
  text: string;
  observedAt: string;
}): TrainingPeaksTelegramContextObservation {
  return {
    id: input.id,
    studentId: "fixture-student",
    sourceType: "business_dm",
    observedAt: input.observedAt,
    textPreview: input.text,
    textSha256: `fixture-${input.id}`,
    labels: [],
    metadata: {},
    chatId: "fixture-chat",
    messageId: null,
    messageThreadId: null,
    createdAt: input.observedAt,
  };
}

function visibleSnapshotText(
  signals: TrainingPeaksStudentOperationalSignal[],
  asOfDate: string,
  displayEvidenceBySignalId?: ReadonlyMap<string, TrainingPeaksOperationalSignalDisplayEvidence>
): string {
  const snapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals,
    studentNameById: new Map([[signals[0]?.studentId ?? "fixture-student", "Fixture Athlete"]]),
    asOfDate,
    displayEvidenceBySignalId,
    activeMoveActions: [],
    limit: 20,
  });
  return snapshot.sections.flatMap((section) => section.items.map((item) => item.text)).join("\n");
}

function evaluateCase1(): TpSignalsRegressionCaseResult {
  const message =
    "сегодня решила побегать, но меня хватило минут на 20, потом голова кружилась, в сон клонит, а так норм";
  const openedAt = "2026-06-12T08:00:00.000Z";
  const observations = [makeObservation({ id: "obs-1", text: message, observedAt: "2026-06-12T10:00:00.000Z" })];
  const hasNegativeText = isOperationalNegativeObservationText(message);
  const hasPositiveText = isOperationalPositiveObservationText(message);
  const gatedNegative = findOperationalSignalNegativeAfterCompletion({
    observations,
    completionDate: null,
    completionObservedAt: null,
    openedAt,
  });
  const displayLines = buildMonitoringLifetimeDisplayLines({
    lifecycleDisplayState: "monitoring_after_return",
    completion: {
      latestCacheScannedAt: "2026-06-12T12:00:00.000Z",
      latestCompletionAfterOpen: makeRunningCompletionFixture({ workoutId: "w1", workoutDate: "2026-06-12", title: "Easy Run" }),
      recommendedAction: "monitor",
      recommendationReason: "fixture",
      applyDryRunCommand: null,
      cleanRunningCompletionCount: 1,
    },
    sourceText: message,
    latestPositiveText: hasPositiveText ? message : null,
    latestNegativeText: gatedNegative ? message : null,
    isPain: false,
  });
  const displayText = displayLines.join("\n");
  const saysNoNewComplaints = /новых жалоб нет|закрыть после проверки/iu.test(displayText);
  const isCloseCandidate = /закрыть после проверки/iu.test(displayText);
  const current = {
    hasNegativeText,
    hasPositiveText,
    completionGatedNegative: gatedNegative,
    lifecycleDisplayState: "monitoring_after_return",
    displayLines,
    saysNoNewComplaints,
    isCloseCandidate,
  };
  const expected = {
    notCloseCandidate: true,
    notSaysNoNewComplaints: true,
    lifecycleStateOneOf: ["needs_review", "monitoring_after_return"],
    negativeEvidenceContains: ["головокруж", "сон"],
  };
  const pass =
    hasNegativeText &&
    !isCloseCandidate &&
    !saysNoNewComplaints &&
    gatedNegative === null &&
    /головокруж/iu.test(message);
  return {
    caseId: 1,
    name: "Rizatdinova Elvira — negative after illness run",
    studentHint: "Rizatdinova Elvira",
    bugClass: "F4",
    pass,
    current,
    expected,
    notes: [
      "Negative pattern matches text, but completion-gated negative path returns null without TP completion anchor.",
      "Display branch treats positive fragment as clean report when gated negative is missing.",
    ],
  };
}

function evaluateCase2(): TpSignalsRegressionCaseResult {
  const signal = makeFixtureSignal({
    id: "case2-illness",
    studentId: "ivanov-student",
    signalType: "health_issue_started",
    lifecycleState: "monitoring_after_return",
    structuredPayload: {
      health_issue_kind: "confirmed_illness",
      latest_summary: "После болезни",
      health_state: "improving",
    },
    createdAt: "2026-06-05T08:00:00.000Z",
  });
  const displayLines = buildMonitoringLifetimeDisplayLines({
    lifecycleDisplayState: "monitoring_after_return",
    completion: {
      latestCacheScannedAt: "2026-06-12T12:00:00.000Z",
      latestCompletionAfterOpen: makeRunningCompletionFixture({ workoutId: "w2", workoutDate: "2026-06-11" }),
      recommendedAction: "monitor",
      recommendationReason: "fixture",
      applyDryRunCommand: null,
      cleanRunningCompletionCount: 1,
    },
    sourceText: "после болезни",
    latestPositiveText: null,
    latestNegativeText: null,
    isPain: false,
  });
  const lifecycleProposal = evaluateOperationalSignalLifecycle({
    studentId: signal.studentId,
    signalClass: "confirmed_illness",
    currentLifecycle: "monitoring_after_return",
    openedAt: signal.createdAt,
    latestTpCompletionAfterOpen: makeRunningCompletionFixture({ workoutId: "w2", workoutDate: "2026-06-11" }),
    negativeMessageAfterCompletion: null,
    explicitRecoveryMessage: null,
    missedOrSkippedReturnWorkout: false,
    returnWorkoutBlocker: null,
  });
  const displayText = displayLines.join("\n");
  const current = {
    lifecycleProposal: lifecycleProposal.proposedLifecycle,
    lifecycleDisplayState: "monitoring_after_return",
    displayText,
    asksCheckAfterRun: /проверить самочувствие после пробежки/iu.test(displayText),
  };
  const expected = {
    targetLifecycleDisplayState: "close_candidate",
    targetNotInfiniteCheck: true,
  };
  const pass =
    !current.asksCheckAfterRun &&
    (current.lifecycleProposal === "resolved" || /ready_for_coach_close|close_candidate|закрыть после проверки/iu.test(displayText));
  return {
    caseId: 2,
    name: "Alexander Ivanov — clean run without new complaints",
    studentHint: "Alexander Ivanov",
    bugClass: "F2/F13",
    pass,
    current,
    expected,
    notes: ["Phase 3 target: close_candidate after clean run + silence; current keeps monitoring/check copy."],
  };
}

function evaluateCase3(): TpSignalsRegressionCaseResult {
  const signal = makeFixtureSignal({
    id: "case3-pain",
    studentId: "lavrentyev-student",
    signalType: "pain_injury",
    structuredPayload: {
      latest_summary: "Лёгкий дискомфорт стопы",
      display_summary: "Лёгкий дискомфорт стопы",
    },
  });
  const evidence: TrainingPeaksOperationalSignalDisplayEvidence = {
    source: {
      observationId: "src-pain",
      observedAt: "2026-06-10T08:00:00.000Z",
      sourceType: "business_dm",
      textPreview: "лёгкий дискомфорт стопы",
    },
    latestPositive: {
      observationId: "ok-1",
      observedAt: "2026-06-12T09:00:00.000Z",
      sourceType: "business_dm",
      textPreview: "всё ок",
    },
    latestNegative: null,
  };
  const visibleText = visibleSnapshotText([signal], AS_OF_2026_06_12, new Map([[signal.id, evidence]]));
  const items = collectOperationalSignalDiagnosticItems({
    signals: [signal],
    studentNameById: new Map([[signal.studentId, "Alexander Lavrentyev"]]),
    asOfDate: AS_OF_2026_06_12,
    displayEvidenceBySignalId: new Map([[signal.id, evidence]]),
    visibleOnly: true,
  });
  const current = {
    visible: items.length > 0,
    lifecycleDisplayState: items[0]?.lifecycleDisplayState ?? null,
    visibleText,
    stillActivePainCopy: /дискомфорт|наблюдать|уточнить/iu.test(visibleText),
  };
  const expected = {
    targetLifecycleDisplayState: "close_candidate",
    targetNotActiveProblem: true,
    noAutoResolve: true,
  };
  const pass = items[0]?.lifecycleDisplayState === "ready_for_coach_close";
  return {
    caseId: 3,
    name: "Alexander Lavrentyev — pain with fresh ok feedback",
    studentHint: "Alexander Lavrentyev",
    bugClass: "F2/F3/F13",
    pass,
    current,
    expected,
    notes: ["Fresh positive ok does not supersede pain_injury signal in current model."],
  };
}

function evaluateCase4(): TpSignalsRegressionCaseResult {
  const signal = makeFixtureSignal({
    id: "case4-nail",
    studentId: "chernysheva-student",
    signalType: "pain_injury",
    structuredPayload: {
      latest_summary: "Ноготь после удара/отрыва",
      display_summary: "Ноготь после удара/отрыва",
    },
  });
  const evidence: TrainingPeaksOperationalSignalDisplayEvidence = {
    source: {
      observationId: "src-nail",
      observedAt: "2026-06-10T08:00:00.000Z",
      sourceType: "business_dm",
      textPreview: "ноготь после удара",
    },
    latestPositive: {
      observationId: "ok-2",
      observedAt: "2026-06-12T09:00:00.000Z",
      sourceType: "business_dm",
      textPreview: "всё ок",
    },
  };
  const visibleText = visibleSnapshotText([signal], AS_OF_2026_06_12, new Map([[signal.id, evidence]]));
  const clarifyCount = (visibleText.match(/уточнить/giu) ?? []).length;
  const current = {
    visibleText,
    lifecycleDisplayState:
      collectOperationalSignalDiagnosticItems({
        signals: [signal],
        studentNameById: new Map([[signal.studentId, "Anna Chernysheva"]]),
        asOfDate: AS_OF_2026_06_12,
        displayEvidenceBySignalId: new Map([[signal.id, evidence]]),
        visibleOnly: true,
      })[0]?.lifecycleDisplayState ?? null,
    clarifyCount,
  };
  const expected = {
    targetLifecycleDisplayState: "close_candidate",
    maxClarifyLines: 1,
  };
  const pass = current.lifecycleDisplayState === "ready_for_coach_close" && clarifyCount <= 1;
  return {
    caseId: 4,
    name: "Anna Chernysheva — nail pain with ok feedback",
    studentHint: "Anna Chernysheva",
    bugClass: "F2/F3/F7",
    pass,
    current,
    expected,
    notes: ["Duplicate action-copy from summary + monitoring overlay is a known presentation bug."],
  };
}

function evaluateCase5(): TpSignalsRegressionCaseResult {
  const observedAt = "2026-06-09T10:00:00.000Z";
  const classified = classifyCoachOperationalSignal({
    sourceType: "business_dm",
    textPreview: "среда не может тренироваться",
    labels: [],
    metadata: {},
    observedAt,
    studentId: "lavrentyev-student",
  });
  const signal = makeFixtureSignal({
    id: "case5-wed",
    studentId: "lavrentyev-student",
    signalType: classified.signal_type ?? "schedule_unavailability_window",
    structuredPayload: classified.structured_payload as Record<string, unknown>,
    validFrom: classified.structured_payload.valid_from,
    validUntil: classified.structured_payload.valid_until,
    createdAt: observedAt,
  });
  const diagnosticItems = collectOperationalSignalDiagnosticItems({
    signals: [signal],
    studentNameById: new Map([[signal.studentId, "Alexander Lavrentyev"]]),
    asOfDate: AS_OF_2026_06_12,
  });
  const item = diagnosticItems[0];
  const expired = isExpiredScheduleOperationalSignal(
    {
      signalType: signal.signalType,
      validUntil: signal.validUntil,
      structuredPayload: signal.structuredPayload,
    },
    AS_OF_2026_06_12,
    { referenceObservedAt: observedAt }
  );
  const staleGeneric = isStaleGenericScheduleUnavailabilitySignal({ signal, asOfDate: AS_OF_2026_06_12 });
  const current = {
    classifiedType: classified.signal_type,
    unavailableDays: classified.structured_payload.unavailable_days,
    validUntil: classified.structured_payload.valid_until,
    hiddenReason: item?.hiddenReason ?? null,
    visibleInTpSignals: item ? !item.hiddenReason && Boolean(item.text) : false,
    expired,
    staleGeneric,
  };
  const expected = {
    hiddenOrResolved: true,
    notVisibleOn2026_06_12: true,
  };
  const pass = Boolean(item?.hiddenReason) || !item?.text;
  return {
    caseId: 5,
    name: "Alexander Lavrentyev — stale weekday schedule",
    studentHint: "Alexander Lavrentyev",
    bugClass: "F1/F12",
    pass,
    current,
    expected,
    notes: ["Habitual weekday unavailability lacks concrete valid_until; Wednesday 2026-06-10 is past as-of 2026-06-12."],
  };
}

function evaluateCase6(): TpSignalsRegressionCaseResult {
  const text =
    "завтра тоже 34😂 но я утром свободна, выходной. побегу, попробую. следующая неделя вроде чуть...";
  const single = classifyCoachOperationalSignal({
    sourceType: "business_dm",
    textPreview: text,
    labels: [],
    metadata: {},
    observedAt: "2026-06-12T10:00:00.000Z",
    studentId: "tararova-student",
  });
  const multi = classifyCoachOperationalSignals({
    sourceType: "business_dm",
    textPreview: text,
    labels: [],
    metadata: {},
    observedAt: "2026-06-12T10:00:00.000Z",
    studentId: "tararova-student",
  });
  const current = {
    primaryBucket: single.primary_bucket,
    signalType: single.signal_type,
    shouldCreateMemory: single.should_create_memory,
    multiCandidateTypes: multi.map((item) => item.signal_type).filter(Boolean),
    reason: single.reason,
  };
  const expected = {
    notPlanGenerationConstraint: true,
    notHardRestriction: true,
    skipOrSoftContext: true,
  };
  const pass =
    single.primary_bucket === "skip" ||
    (single.signal_type !== "plan_generation_constraint" &&
      !multi.some((item) => item.signal_type === "plan_generation_constraint"));
  return {
    caseId: 6,
    name: "Aleksandra Tararova — weather/free-time not restriction",
    studentHint: "Aleksandra Tararova",
    bugClass: "F6",
    pass,
    current,
    expected,
    notes: ["Weather/availability soft context should not become hard plan_generation_constraint."],
  };
}

function evaluateCase7(): TpSignalsRegressionCaseResult {
  const text = "привет! прости пожалуйста, совсем забыла можно завтра оплачу, как зп придет🥺";
  const single = classifyCoachOperationalSignal({
    sourceType: "business_dm",
    textPreview: text,
    labels: [],
    metadata: {},
    observedAt: "2026-06-12T10:00:00.000Z",
    studentId: "vasileva-student",
  });
  const multi = classifyCoachOperationalSignals({
    sourceType: "business_dm",
    textPreview: text,
    labels: [],
    metadata: {},
    observedAt: "2026-06-12T10:00:00.000Z",
    studentId: "vasileva-student",
  });
  const current = {
    primaryBucket: single.primary_bucket,
    signalType: single.signal_type,
    candidateCount: multi.filter((item) => item.primary_bucket === "operational_signal").length,
    multiTypes: multi.map((item) => item.signal_type).filter(Boolean),
    reason: single.reason,
  };
  const expected = {
    noOperationalTpSignal: true,
    candidateCount: 0,
    skipReason: "billing/admin negative intent",
  };
  const pass = single.primary_bucket === "skip" && current.candidateCount === 0;
  return {
    caseId: 7,
    name: "Elena Vasileva — billing/admin not TP signal",
    studentHint: "Elena Vasileva",
    bugClass: "F5",
    pass,
    current,
    expected,
    notes: ["No negative-intent gate for billing/admin phrases in classifier today."],
  };
}

function evaluateCase8(): TpSignalsRegressionCaseResult {
  const signal = makeFixtureSignal({
    id: "case8-mixed",
    studentId: "polyakova-student",
    signalType: "schedule_unavailability_window",
    episodeKey: "fixture:polyakova-schedule",
    structuredPayload: {
      unavailable_dates: ["2026-06-10"],
      planned_training_dates: ["2026-06-15"],
      planning_status: "athlete_intends_to_train",
    },
    createdAt: "2026-06-08T08:00:00.000Z",
  });
  const scheduleText = formatScheduleOperationalSignalText({
    signalType: signal.signalType,
    validFrom: signal.validFrom,
    validUntil: signal.validUntil,
    structuredPayload: signal.structuredPayload,
    asOfDate: AS_OF_2026_06_12,
  });
  const visibleText = visibleSnapshotText([signal], AS_OF_2026_06_12);
  const expiredWhole = isExpiredScheduleOperationalSignal(
    {
      signalType: signal.signalType,
      validUntil: signal.validUntil,
      structuredPayload: signal.structuredPayload,
    },
    AS_OF_2026_06_12
  );
  const current = {
    scheduleText,
    visibleText,
    showsPastUnavailable: /10\.06/.test(visibleText || scheduleText),
    showsFuturePlanned: /15\.06|планирует/iu.test(visibleText || scheduleText),
    expiredWhole,
    sourceExplainability: null,
  };
  const expected = {
    hidePastUnavailable: true,
    mayShowPlanned1506: true,
    explainabilityRequired: true,
  };
  const pass = !current.showsPastUnavailable && current.showsFuturePlanned;
  return {
    caseId: 8,
    name: "Polyakova Anastasia — mixed stale/future schedule",
    studentHint: "Polyakova Anastasia",
    bugClass: "F1/F11/F12",
    pass,
    current,
    expected,
    notes: ["Past unavailable date remains in schedule display; source trace missing in /tp_signals output."],
  };
}

export function evaluateTpSignalsRegressionCases(): TpSignalsRegressionCaseResult[] {
  return [
    evaluateCase1(),
    evaluateCase2(),
    evaluateCase3(),
    evaluateCase4(),
    evaluateCase5(),
    evaluateCase6(),
    evaluateCase7(),
    evaluateCase8(),
  ];
}
