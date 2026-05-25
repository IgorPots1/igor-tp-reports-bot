import {
  INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON,
  STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
  extractMoveSourceExecutionContextFromDryRunLog,
  hasExplicitMoveSourceInParsedPayload,
  isMoveSourceExplicitEnough,
  isTrustedMoveSourcePolicy,
  validateDryRunLogReadiness,
  validateMoveSourceForExecution,
  validateStrongFutureDescriptorMoveSourceForExecution,
} from "@/features/trainingpeaks/move-source-policy";
import { formatTrainingPeaksExecuteQueuedMessage } from "@/features/trainingpeaks/action-execute-telegram-copy";
import {
  buildMoveSourceInferencePreviewFromCacheCandidates,
  formatMoveSourceInferencePreviewRu,
  hasUntrustedMoveSourceInferencePreview,
} from "@/features/trainingpeaks/move-source-inference-preview";
import {
  resolveStrongFutureIntervalMoveSource,
  type StrongFutureDescriptorMoveSourceCandidate,
} from "@/features/trainingpeaks/strong-future-descriptor-move-source";

type InferredSourceCase = {
  name: string;
  selectedSourceDatePolicy: string;
  parsedPayload: unknown;
};

const viktoriaLikePayload = {
  actionType: "move_workout",
  target: { kind: "date", value: "2026-05-26" },
  workoutDescriptor: { raw: "интервалы", type: "interval", confidence: 0.9 },
  confidence: 0.84,
  needsClarification: false,
  clarificationReason: null,
  parser: "ai_fallback",
};

const inferredSourceCases: InferredSourceCase[] = [
  {
    name: "nearest_prior_within_3_days without sourceDate",
    selectedSourceDatePolicy: "nearest_prior_within_3_days",
    parsedPayload: viktoriaLikePayload,
  },
  {
    name: "target_tomorrow_prefers_today without sourceDate",
    selectedSourceDatePolicy: "target_tomorrow_prefers_today",
    parsedPayload: viktoriaLikePayload,
  },
  {
    name: "target_today_prefers_yesterday without sourceDate",
    selectedSourceDatePolicy: "target_today_prefers_yesterday",
    parsedPayload: viktoriaLikePayload,
  },
  {
    name: "weak_descriptor_match without sourceDate",
    selectedSourceDatePolicy: "weak_descriptor_match",
    parsedPayload: viktoriaLikePayload,
  },
  {
    name: "missing policy without sourceDate",
    selectedSourceDatePolicy: "unresolved",
    parsedPayload: viktoriaLikePayload,
  },
];

const explicitSourcePayload = {
  actionType: "move_workout",
  source: { kind: "relative_day", value: "today", sourceText: "сегодняшнюю" },
  target: { kind: "date", value: "2026-05-26" },
  sourceDate: "2026-05-25",
  source_date: "2026-05-25",
  workoutDescriptor: null,
  confidence: 0.92,
  needsClarification: false,
  clarificationReason: null,
  parser: "deterministic",
};

const cachePreviewPayload = {
  actionType: "move_workout",
  source: null,
  target: { kind: "date", value: "2026-05-26" },
  workoutDescriptor: { raw: "интервалы", type: "interval", confidence: 0.9 },
  confidence: 0.84,
  needsClarification: false,
  clarificationReason: null,
  parser: "ai_fallback",
  sourceInferencePreview: buildMoveSourceInferencePreviewFromCacheCandidates({
    candidates: [
      {
        workoutId: 12345,
        workoutDate: "2026-05-28",
        title: "6 × 6 мин",
        score: 1.1,
      },
    ],
  }),
  sourceInference: {
    strategy: "future_workout_cache_preview",
    trusted: false as const,
    source: "trainingpeaks_workout_cache" as const,
    candidateCount: 1,
    selectedWorkoutId: 12345,
    candidates: [
      {
        workoutId: 12345,
        workoutDate: "2026-05-28",
        title: "6 × 6 мин",
        score: 1.1,
      },
    ],
  },
};

const legacyCacheMasqueradePayload = {
  ...cachePreviewPayload,
  source: { kind: "date", value: "2026-05-28", sourceText: "6 × 6 мин" },
  sourceDate: "2026-05-28",
  source_date: "2026-05-28",
};

const viktoriaProductionPayload = {
  ...viktoriaLikePayload,
  sourceInferencePreview: cachePreviewPayload.sourceInferencePreview,
  sourceInference: cachePreviewPayload.sourceInference,
};

function buildViktoriaStrongDryRunLog(input: {
  fingerprint: string;
  canExecute: boolean;
  selectedSourceDatePolicy?: string;
  confidence?: number;
  provenanceScore?: number;
}): Record<string, unknown> {
  const confidence = input.confidence ?? 0.91;
  const provenanceScore = input.provenanceScore ?? confidence;
  return {
    dryRunResult: "candidate_found",
    canExecute: input.canExecute,
    confidence,
    candidate: { fingerprint: input.fingerprint, title: "6 × 6 мин", type: "run" },
    resolvedDates: { sourceDate: "2026-05-28", targetDate: "2026-05-26" },
    selectedSourceDatePolicy: input.selectedSourceDatePolicy ?? STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
    candidateAlternativesCount: 0,
    identityCheck: { matchedBy: "name" },
    sourceInferenceProvenance: {
      descriptorType: "interval",
      sourceInferencePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      selectedSourceDate: "2026-05-28",
      targetDate: "2026-05-26",
      candidate: {
        title: "6 × 6 мин",
        type: "run",
        date: "2026-05-28",
        fingerprint: input.fingerprint,
        workoutId: 4,
      },
      candidateCount: 1,
      candidateAlternativesCount: 0,
      score: provenanceScore,
      margin: null,
      warnings: ["target day already has workout", "hard workout moved earlier", "week may need manual adjustment"],
    },
  };
}

function simulateCanExecute(input: {
  dryRunResult: "candidate_found";
  selectedSourceDatePolicy: string;
  parsedPayload: unknown;
  confidence: number;
  safeCandidateCount: number;
  identityMatchedBy: string;
  dryRunLog?: Record<string, unknown>;
}): boolean {
  const moveSourceValidation = validateMoveSourceForExecution({
    selectedSourceDatePolicy: input.selectedSourceDatePolicy,
    parsedPayload: input.parsedPayload,
    dryRunLog: input.dryRunLog,
  });
  const strongFutureConfirmed =
    input.selectedSourceDatePolicy === STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY && moveSourceValidation.ok;
  const confidenceThreshold = strongFutureConfirmed ? 0.7 : 0.8;
  const safeCandidateCount = strongFutureConfirmed ? 1 : input.safeCandidateCount;

  return (
    input.dryRunResult === "candidate_found" &&
    safeCandidateCount === 1 &&
    input.confidence >= confidenceThreshold &&
    input.identityMatchedBy !== "mismatch" &&
    moveSourceValidation.ok
  );
}

async function run(): Promise<void> {
  let failed = 0;

  if (hasExplicitMoveSourceInParsedPayload(viktoriaLikePayload)) {
    failed += 1;
    console.log("FAIL: Viktoria-like payload must not look like explicit move source");
  }

  if (hasExplicitMoveSourceInParsedPayload(explicitSourcePayload) !== true) {
    failed += 1;
    console.log("FAIL: explicit source payload must be recognized");
  }

  if (!hasUntrustedMoveSourceInferencePreview(cachePreviewPayload)) {
    failed += 1;
    console.log("FAIL: cache preview payload must be marked untrusted");
  }

  if (hasExplicitMoveSourceInParsedPayload(cachePreviewPayload)) {
    failed += 1;
    console.log("FAIL: cache preview payload must not look like explicit move source");
  }

  if (hasExplicitMoveSourceInParsedPayload(legacyCacheMasqueradePayload)) {
    failed += 1;
    console.log("FAIL: legacy cache masquerade payload must not look like explicit move source");
  }

  const previewLabel = formatMoveSourceInferencePreviewRu(cachePreviewPayload.sourceInferencePreview);
  if (previewLabel !== "Вероятный источник: 28.05 — 6 × 6 мин") {
    failed += 1;
    console.log(`FAIL: cache preview label expected advisory text, got ${JSON.stringify(previewLabel)}`);
  }

  const cachePreviewExplicitEnough = isMoveSourceExplicitEnough({
    selectedSourceDatePolicy: "explicit_source_date",
    parsedPayload: cachePreviewPayload,
  });
  if (cachePreviewExplicitEnough) {
    failed += 1;
    console.log("FAIL: cache preview must not become explicit_source_date via policy + payload");
  }

  const cachePreviewValidation = validateMoveSourceForExecution({
    selectedSourceDatePolicy: "explicit_source_date",
    parsedPayload: cachePreviewPayload,
  });
  if (cachePreviewValidation.ok) {
    failed += 1;
    console.log("FAIL: cache preview must stay blocked even if dry-run policy is explicit_source_date");
  }

  for (const policy of [
    "explicit_source_date",
    "explicit_source_ref",
    STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
    "nearest_prior_within_3_days",
    "target_tomorrow_prefers_today",
    "unresolved",
  ]) {
    const trusted = isTrustedMoveSourcePolicy(policy);
    const expectedTrusted = policy === "explicit_source_date" || policy === "explicit_source_ref";
    if (trusted !== expectedTrusted) {
      failed += 1;
      console.log(`FAIL: isTrustedMoveSourcePolicy(${policy}) expected ${String(expectedTrusted)}`);
    }
  }

  for (const testCase of inferredSourceCases) {
    const explicitEnough = isMoveSourceExplicitEnough({
      selectedSourceDatePolicy: testCase.selectedSourceDatePolicy,
      parsedPayload: testCase.parsedPayload,
    });
    if (explicitEnough) {
      failed += 1;
      console.log(`FAIL (${testCase.name}): inferred source must stay unsafe`);
    }

    const canExecute = simulateCanExecute({
      dryRunResult: "candidate_found",
      selectedSourceDatePolicy: testCase.selectedSourceDatePolicy,
      parsedPayload: testCase.parsedPayload,
      confidence: 0.91,
      safeCandidateCount: 1,
      identityMatchedBy: "name",
    });
    if (canExecute) {
      failed += 1;
      console.log(`FAIL (${testCase.name}): canExecute must be false`);
    }

    const dryRunLog = {
      dryRunResult: "candidate_found",
      canExecute: true,
      confidence: 0.91,
      candidate: { fingerprint: "student:2026-05-25:run" },
      resolvedDates: { sourceDate: "2026-05-25", targetDate: "2026-05-26" },
      selectedSourceDatePolicy: testCase.selectedSourceDatePolicy,
    };
    const validation = validateMoveSourceForExecution({
      selectedSourceDatePolicy: testCase.selectedSourceDatePolicy,
      parsedPayload: testCase.parsedPayload,
      dryRunLog,
    });
    if (validation.ok) {
      failed += 1;
      console.log(`FAIL (${testCase.name}): execute request must be rejected`);
    }

    if (dryRunLog.canExecute === true && canExecute) {
      failed += 1;
      console.log(`FAIL (${testCase.name}): stale canExecute=true must not allow execution`);
    }
  }

  const explicitValidation = validateMoveSourceForExecution({
    selectedSourceDatePolicy: "explicit_source_ref",
    parsedPayload: explicitSourcePayload,
  });
  if (!explicitValidation.ok) {
    failed += 1;
    console.log(`FAIL: explicit source payload must pass execution validation (${explicitValidation.reason})`);
  }

  const explicitCanExecute = simulateCanExecute({
    dryRunResult: "candidate_found",
    selectedSourceDatePolicy: "explicit_source_ref",
    parsedPayload: explicitSourcePayload,
    confidence: 0.92,
    safeCandidateCount: 1,
    identityMatchedBy: "name",
  });
  if (!explicitCanExecute) {
    failed += 1;
    console.log("FAIL: explicit source move must remain executable");
  }

  if (INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON.length === 0) {
    failed += 1;
    console.log("FAIL: inferred source block reason must be non-empty");
  }

  const viktoriaTargetDate = "2026-05-26";
  const fingerprint = "student:test:interval";
  const viktoriaCalendarCandidates: StrongFutureDescriptorMoveSourceCandidate[] = [
    {
      dateIso: "2026-05-25",
      title: "Темп / легко",
      type: "run",
      rawTextSnippet: "Темп / легко",
      workoutId: 1,
      fingerprint,
    },
    {
      dateIso: "2026-05-26",
      title: "Силовая",
      type: "strength",
      rawTextSnippet: "Силовая",
      workoutId: 2,
      fingerprint,
    },
    {
      dateIso: "2026-05-27",
      title: "Темп / легко",
      type: "run",
      rawTextSnippet: "Темп / легко",
      workoutId: 3,
      fingerprint,
    },
    {
      dateIso: "2026-05-28",
      title: "6 × 6 мин",
      type: "run",
      rawTextSnippet: "6 × 6 мин",
      workoutId: 4,
      fingerprint,
      rawScore: 0.91,
    },
    {
      dateIso: "2026-05-30",
      title: "Длительный / легко",
      type: "run",
      rawTextSnippet: "Длительный / легко",
      workoutId: 5,
      fingerprint,
    },
  ];

  const viktoriaStrong = resolveStrongFutureIntervalMoveSource({
    targetDate: viktoriaTargetDate,
    parsedPayload: viktoriaLikePayload,
    candidates: viktoriaCalendarCandidates,
    targetDayHasWorkout: true,
  });
  if (!viktoriaStrong) {
    failed += 1;
    console.log("FAIL: Viktoria-like interval request must run strong future resolver");
  } else {
    if (viktoriaStrong.selectedSourceDatePolicy !== STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY) {
      failed += 1;
      console.log(
        `FAIL: Viktoria-like policy expected strong_future_descriptor_match, got ${viktoriaStrong.selectedSourceDatePolicy}`
      );
    }
    if (viktoriaStrong.selectedSourceDate !== "2026-05-28") {
      failed += 1;
      console.log(`FAIL: Viktoria-like source expected 2026-05-28, got ${viktoriaStrong.selectedSourceDate}`);
    }
    if (viktoriaStrong.selectedCandidate?.title !== "6 × 6 мин") {
      failed += 1;
      console.log("FAIL: Viktoria-like candidate title must be 6 × 6 мин");
    }
    if (!viktoriaStrong.warnings.includes("target day already has workout")) {
      failed += 1;
      console.log("FAIL: Viktoria-like warnings must include target day already has workout");
    }

    const viktoriaDryRunLog = buildViktoriaStrongDryRunLog({ fingerprint, canExecute: true });
    const viktoriaStrongValidation = validateStrongFutureDescriptorMoveSourceForExecution({
      selectedSourceDatePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      parsedPayload: viktoriaLikePayload,
      ...extractMoveSourceExecutionContextFromDryRunLog(viktoriaDryRunLog)!,
    });
    if (!viktoriaStrongValidation.ok) {
      failed += 1;
      console.log(`FAIL: Viktoria-like strong provenance must pass (${viktoriaStrongValidation.reason})`);
    }

    const viktoriaCanExecute = simulateCanExecute({
      dryRunResult: "candidate_found",
      selectedSourceDatePolicy: viktoriaStrong.selectedSourceDatePolicy,
      parsedPayload: viktoriaLikePayload,
      confidence: 0.91,
      safeCandidateCount: 1,
      identityMatchedBy: "name",
      dryRunLog: viktoriaDryRunLog,
    });
    if (!viktoriaCanExecute) {
      failed += 1;
      console.log("FAIL: Viktoria-like strong_future_descriptor_match must allow canExecute after provenance");
    }

    const viktoriaExecuteValidation = validateMoveSourceForExecution({
      selectedSourceDatePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      parsedPayload: viktoriaLikePayload,
      dryRunLog: viktoriaDryRunLog,
    });
    if (!viktoriaExecuteValidation.ok) {
      failed += 1;
      console.log(`FAIL: Viktoria-like execute readiness must be accepted (${viktoriaExecuteValidation.reason})`);
    }

    const incompleteStrongLog = buildViktoriaStrongDryRunLog({ fingerprint, canExecute: true });
    delete (incompleteStrongLog.sourceInferenceProvenance as Record<string, unknown>).candidate;
    const incompleteValidation = validateMoveSourceForExecution({
      selectedSourceDatePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      parsedPayload: viktoriaLikePayload,
      dryRunLog: incompleteStrongLog,
    });
    if (incompleteValidation.ok) {
      failed += 1;
      console.log("FAIL: incomplete strong provenance must fail closed");
    }

    const viktoriaProductionDryRunLog = buildViktoriaStrongDryRunLog({
      fingerprint,
      canExecute: true,
      confidence: 0.73,
      provenanceScore: 0.73,
    });
    const viktoriaProductionValidation = validateMoveSourceForExecution({
      selectedSourceDatePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      parsedPayload: viktoriaProductionPayload,
      dryRunLog: viktoriaProductionDryRunLog,
    });
    if (!viktoriaProductionValidation.ok) {
      failed += 1;
      console.log(
        `FAIL: production-shaped Viktoria payload with live provenance must pass (${viktoriaProductionValidation.reason})`
      );
    }

    const viktoriaProductionCanExecute = simulateCanExecute({
      dryRunResult: "candidate_found",
      selectedSourceDatePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      parsedPayload: viktoriaProductionPayload,
      confidence: 0.73,
      safeCandidateCount: 0,
      identityMatchedBy: "name",
      dryRunLog: viktoriaProductionDryRunLog,
    });
    if (!viktoriaProductionCanExecute) {
      failed += 1;
      console.log("FAIL: production-shaped Viktoria payload must allow canExecute with score 0.73");
    }

    const cachePreviewOnlyValidation = validateMoveSourceForExecution({
      selectedSourceDatePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      parsedPayload: viktoriaProductionPayload,
    });
    if (cachePreviewOnlyValidation.ok) {
      failed += 1;
      console.log("FAIL: cache preview alone without live provenance must stay blocked");
    } else if (cachePreviewOnlyValidation.reason !== "Cache preview alone cannot make execution trusted.") {
      failed += 1;
      console.log(
        `FAIL: cache preview alone must fail with cache preview reason, got ${JSON.stringify(cachePreviewOnlyValidation.reason)}`
      );
    }

    const viktoriaProductionReadiness = validateDryRunLogReadiness(
      viktoriaProductionDryRunLog,
      viktoriaProductionPayload
    );
    if (!viktoriaProductionReadiness.ok) {
      failed += 1;
      console.log(
        `FAIL: production-shaped Viktoria dry-run log must pass shared readiness (${viktoriaProductionReadiness.reason})`
      );
    }

    const withoutProvenanceLog = buildViktoriaStrongDryRunLog({
      fingerprint,
      canExecute: true,
      confidence: 0.73,
      provenanceScore: 0.73,
    });
    delete withoutProvenanceLog.sourceInferenceProvenance;
    const viktoriaWithoutProvenanceReadiness = validateDryRunLogReadiness(
      withoutProvenanceLog,
      viktoriaProductionPayload
    );
    if (viktoriaWithoutProvenanceReadiness.ok) {
      failed += 1;
      console.log("FAIL: strong dry-run log without provenance must fail shared readiness");
    }

    const explicitDryRunLog = {
      dryRunResult: "candidate_found",
      canExecute: true,
      confidence: 0.92,
      candidate: { fingerprint: "student:2026-05-25:run", title: "Темп / легко", type: "run" },
      resolvedDates: { sourceDate: "2026-05-25", targetDate: "2026-05-26" },
      selectedSourceDatePolicy: "explicit_source_ref",
      identityCheck: { matchedBy: "name" },
    };
    const explicitReadiness = validateDryRunLogReadiness(explicitDryRunLog, explicitSourcePayload);
    if (!explicitReadiness.ok) {
      failed += 1;
      console.log(`FAIL: explicit source dry-run log must pass shared readiness (${explicitReadiness.reason})`);
    }

    const cachePreviewDryRunLog = {
      dryRunResult: "candidate_found",
      canExecute: true,
      confidence: 0.91,
      candidate: { fingerprint, title: "6 × 6 мин", type: "run" },
      resolvedDates: { sourceDate: "2026-05-28", targetDate: "2026-05-26" },
      selectedSourceDatePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      identityCheck: { matchedBy: "name" },
    };
    const cachePreviewReadiness = validateDryRunLogReadiness(cachePreviewDryRunLog, cachePreviewPayload);
    if (cachePreviewReadiness.ok) {
      failed += 1;
      console.log("FAIL: cache preview dry-run log must fail shared readiness");
    }

    for (const blockedPolicy of [
      "nearest_prior_within_3_days",
      "target_tomorrow_prefers_today",
      "target_today_prefers_yesterday",
    ] as const) {
      const blockedDryRunLog = buildViktoriaStrongDryRunLog({
        fingerprint,
        canExecute: true,
        selectedSourceDatePolicy: blockedPolicy,
        confidence: 0.91,
      });
      const blockedReadiness = validateDryRunLogReadiness(blockedDryRunLog, viktoriaLikePayload);
      if (blockedReadiness.ok) {
        failed += 1;
        console.log(`FAIL: ${blockedPolicy} dry-run log must fail shared readiness`);
      }
    }
  }

  const twoIntervalCandidates: StrongFutureDescriptorMoveSourceCandidate[] = [
    ...viktoriaCalendarCandidates.filter((candidate) => candidate.dateIso !== "2026-05-30"),
    {
      dateIso: "2026-05-29",
      title: "интервалы 5x5",
      type: "run",
      rawTextSnippet: "интервалы 5x5",
      workoutId: 6,
      fingerprint,
      rawScore: 0.9,
    },
  ];
  const twoIntervalStrong = resolveStrongFutureIntervalMoveSource({
    targetDate: viktoriaTargetDate,
    parsedPayload: viktoriaLikePayload,
    candidates: twoIntervalCandidates,
    targetDayHasWorkout: true,
  });
  if (twoIntervalStrong?.selectedSourceDatePolicy !== "multiple_candidates") {
    failed += 1;
    console.log("FAIL: two future interval candidates must block with multiple_candidates");
  }

  const noIntervalStrong = resolveStrongFutureIntervalMoveSource({
    targetDate: viktoriaTargetDate,
    parsedPayload: viktoriaLikePayload,
    candidates: viktoriaCalendarCandidates.filter(
      (candidate) => candidate.dateIso !== "2026-05-28"
    ),
    targetDayHasWorkout: true,
  });
  if (noIntervalStrong?.selectedSourceDatePolicy !== "no_candidate") {
    failed += 1;
    console.log("FAIL: no future interval candidate must use no_candidate policy");
  }

  const tomorrowOnlyPayload = {
    actionType: "move_workout",
    target: { kind: "relative_day", value: "tomorrow" },
    workoutDescriptor: null,
    confidence: 0.8,
    needsClarification: false,
    clarificationReason: null,
    parser: "ai_fallback",
  };
  const tomorrowOnlyStrong = resolveStrongFutureIntervalMoveSource({
    targetDate: viktoriaTargetDate,
    parsedPayload: tomorrowOnlyPayload,
    candidates: viktoriaCalendarCandidates,
    targetDayHasWorkout: true,
  });
  if (tomorrowOnlyStrong !== null) {
    failed += 1;
    console.log('FAIL: "завтра сделаю" without descriptor must not use strong future resolver');
  }

  const revalidationMismatchLogA = buildViktoriaStrongDryRunLog({ fingerprint: "fp-a", canExecute: true });
  const revalidationMismatchLogB = buildViktoriaStrongDryRunLog({ fingerprint: "fp-b", canExecute: true });
  const trustedContextA = extractMoveSourceExecutionContextFromDryRunLog(revalidationMismatchLogA);
  const trustedContextB = extractMoveSourceExecutionContextFromDryRunLog(revalidationMismatchLogB);
  if (
    trustedContextA &&
    trustedContextB &&
    validateStrongFutureDescriptorMoveSourceForExecution({
      selectedSourceDatePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      parsedPayload: viktoriaLikePayload,
      ...trustedContextA,
    }).ok &&
    validateStrongFutureDescriptorMoveSourceForExecution({
      selectedSourceDatePolicy: STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
      parsedPayload: viktoriaLikePayload,
      ...trustedContextB,
    }).ok &&
    trustedContextA.candidateFingerprint !== trustedContextB.candidateFingerprint
  ) {
    // expected mismatch scenario for execute revalidation
  } else {
    failed += 1;
    console.log("FAIL: revalidation mismatch fixture must produce two valid but different fingerprints");
  }

  const viktoriaQueuedMessage = formatTrainingPeaksExecuteQueuedMessage({
    studentName: "Viktoria Sergeeva",
    parsedPayload: viktoriaLikePayload,
    trustedSourceDate: "2026-05-28",
    trustedTargetDate: "2026-05-26",
  });
  if (!viktoriaQueuedMessage.includes("Viktoria Sergeeva")) {
    failed += 1;
    console.log("FAIL: execute queued message must include student display name");
  }
  if (!viktoriaQueuedMessage.includes("28.05 → 26.05")) {
    failed += 1;
    console.log(`FAIL: execute queued message must include trusted dry-run route, got ${JSON.stringify(viktoriaQueuedMessage)}`);
  }
  if (viktoriaQueuedMessage.includes("Ученик: ?")) {
    failed += 1;
    console.log("FAIL: execute queued message must not include placeholder student label");
  }

  const viktoriaDryRunLogForCopy = buildViktoriaStrongDryRunLog({ fingerprint, canExecute: true });
  const viktoriaDryRunContext = extractMoveSourceExecutionContextFromDryRunLog(viktoriaDryRunLogForCopy);
  const viktoriaQueuedFromDryRun = formatTrainingPeaksExecuteQueuedMessage({
    studentName: "Viktoria Sergeeva",
    parsedPayload: viktoriaLikePayload,
    trustedSourceDate: viktoriaDryRunContext?.resolvedSourceDate,
    trustedTargetDate: viktoriaDryRunContext?.resolvedTargetDate,
  });
  if (!viktoriaQueuedFromDryRun.includes("28.05 → 26.05")) {
    failed += 1;
    console.log("FAIL: execute queued message must use trusted dry-run resolved dates over parsed payload");
  }

  if (failed > 0) {
    console.log(`\n${failed} check(s) failed.`);
    process.exit(1);
  }

  console.log("All TrainingPeaks move intent safety checks passed.");
}

void run();
