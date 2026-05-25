import {
  INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON,
  hasExplicitMoveSourceInParsedPayload,
  isMoveSourceExplicitEnough,
  isTrustedMoveSourcePolicy,
  validateMoveSourceForExecution,
} from "@/features/trainingpeaks/move-source-policy";
import {
  buildMoveSourceInferencePreviewFromCacheCandidates,
  formatMoveSourceInferencePreviewRu,
  hasUntrustedMoveSourceInferencePreview,
} from "@/features/trainingpeaks/move-source-inference-preview";

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

function simulateCanExecute(input: {
  dryRunResult: "candidate_found";
  selectedSourceDatePolicy: string;
  parsedPayload: unknown;
  confidence: number;
  safeCandidateCount: number;
  identityMatchedBy: string;
}): boolean {
  const moveSourceExplicitEnough = isMoveSourceExplicitEnough({
    selectedSourceDatePolicy: input.selectedSourceDatePolicy,
    parsedPayload: input.parsedPayload,
  });

  return (
    input.dryRunResult === "candidate_found" &&
    input.safeCandidateCount === 1 &&
    input.confidence >= 0.8 &&
    input.identityMatchedBy !== "mismatch" &&
    moveSourceExplicitEnough
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

  if (failed > 0) {
    console.log(`\n${failed} check(s) failed.`);
    process.exit(1);
  }

  console.log("All TrainingPeaks move intent safety checks passed.");
}

void run();
