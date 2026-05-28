import {
  evaluateSelectedSourceDateMoveRanking,
} from "./tp-actions-once.ts";

type RawWorkoutCandidateFixture = {
  rawTextSnippet: string;
  selectorHint: string | null;
  classHint: string | null;
  title: string | null;
  type: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
  startTimeLocal: string | null;
  dateIso: string | null;
  workoutId: number | null;
  reasons: string[];
  fromFallback: boolean;
  rawScore: number;
};

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildCandidate(input: Partial<RawWorkoutCandidateFixture> & Pick<RawWorkoutCandidateFixture, "title" | "rawTextSnippet">): RawWorkoutCandidateFixture {
  return {
    rawTextSnippet: input.rawTextSnippet,
    selectorHint: input.selectorHint ?? null,
    classHint: input.classHint ?? null,
    title: input.title,
    type: input.type ?? null,
    plannedDurationSec: input.plannedDurationSec ?? null,
    plannedDistance: input.plannedDistance ?? null,
    startTimeLocal: input.startTimeLocal ?? null,
    dateIso: input.dateIso ?? "2026-05-27",
    workoutId: input.workoutId ?? null,
    reasons: input.reasons ?? [],
    fromFallback: input.fromFallback ?? false,
    rawScore: input.rawScore ?? 0.8,
  };
}

const tempoPayload = {
  actionType: "move_workout",
  sourceDate: "2026-05-27",
  target: { kind: "date", value: "2026-05-28" },
  workoutDescriptor: { raw: "утром хочу эту темповую сделать", type: "tempo", confidence: 0.92 },
};

const explicitNonRunPayload = {
  actionType: "move_workout",
  sourceDate: "2026-05-27",
  target: { kind: "date", value: "2026-05-28" },
  workoutDescriptor: { raw: "перенеси Pilates", type: "pilates", confidence: 0.91 },
};

const runTempoAndPilates = evaluateSelectedSourceDateMoveRanking({
  parsedPayload: tempoPayload,
  selectedSourceDate: "2026-05-27",
  selectedSourceDatePolicy: "explicit_source_date",
  candidates: [
    buildCandidate({
      title: "2 х 24 мин (восстановление бегом)",
      rawTextSnippet: "2 х 24 мин (восстановление бегом) 5:10-5:20/км",
      type: "run",
      classHint: "Run WorkoutCard",
      plannedDurationSec: 4020,
      plannedDistance: 12.4,
      workoutId: 3753280075,
      rawScore: 0.95,
    }),
    buildCandidate({
      title: "Pilates",
      rawTextSnippet: "Pilates mobility",
      type: null,
      classHint: "Other WorkoutCard",
      plannedDurationSec: 2878,
      plannedDistance: 0,
      workoutId: 3759623856,
      rawScore: 0.85,
    }),
  ],
});

assert(runTempoAndPilates.topCandidate?.candidate.workoutId === 3753280075, "tempo+Pilates case must keep the run card selected");
assert(runTempoAndPilates.plausibleCandidateCount === 1, "Pilates must not count as a plausible same-date competitor");
assert(runTempoAndPilates.safeCandidateCount === 1, "tempo+Pilates case must still have exactly one safe candidate");
assert(runTempoAndPilates.ignoredSameDateCompetitorCount === 1, "Pilates must be marked as ignored same-date competitor");
assert((runTempoAndPilates.confidence ?? 0) >= 0.8, "tempo+Pilates case must clear execution confidence threshold");

const similarRunCompetitors = evaluateSelectedSourceDateMoveRanking({
  parsedPayload: tempoPayload,
  selectedSourceDate: "2026-05-27",
  selectedSourceDatePolicy: "explicit_source_date",
  candidates: [
    buildCandidate({
      title: "2 х 24 мин (восстановление бегом)",
      rawTextSnippet: "2 х 24 мин (восстановление бегом) 5:10-5:20/км",
      type: "run",
      classHint: "Run WorkoutCard",
      plannedDurationSec: 4020,
      plannedDistance: 12.4,
      workoutId: 101,
      rawScore: 0.95,
    }),
    buildCandidate({
      title: "Tempo 3 x 10 min",
      rawTextSnippet: "Tempo 3 x 10 min threshold",
      type: "run",
      classHint: "Run WorkoutCard",
      plannedDurationSec: 3600,
      plannedDistance: 10.8,
      workoutId: 102,
      rawScore: 0.93,
    }),
  ],
});

assert(similarRunCompetitors.plausibleCandidateCount === 2, "two same-date run workouts must remain plausible competitors");
assert(similarRunCompetitors.helpfulAmbiguityReason?.includes("несколько похожих беговых тренировок") === true, "run-vs-run ambiguity should use helpful running-specific wording");
assert(similarRunCompetitors.margin !== null && similarRunCompetitors.margin < 0.12, "similar run competitors must preserve small-margin ambiguity");

const inferredSourceStillBlocked = evaluateSelectedSourceDateMoveRanking({
  parsedPayload: {
    actionType: "move_workout",
    target: { kind: "date", value: "2026-05-28" },
    workoutDescriptor: { raw: "утром хочу эту темповую сделать", type: "tempo", confidence: 0.92 },
  },
  selectedSourceDate: "2026-05-27",
  selectedSourceDatePolicy: "nearest_prior_within_3_days",
  candidates: [
    buildCandidate({
      title: "2 х 24 мин (восстановление бегом)",
      rawTextSnippet: "2 х 24 мин (восстановление бегом) 5:10-5:20/км",
      type: "run",
      classHint: "Run WorkoutCard",
      plannedDurationSec: 4020,
      plannedDistance: 12.4,
      workoutId: 201,
      rawScore: 0.95,
    }),
    buildCandidate({
      title: "Pilates",
      rawTextSnippet: "Pilates mobility",
      type: null,
      classHint: "Other WorkoutCard",
      plannedDurationSec: 2878,
      plannedDistance: 0,
      workoutId: 202,
      rawScore: 0.85,
    }),
  ],
});

assert(inferredSourceStillBlocked.confidence < 0.8, "inferred source case must not get the explicit-source confidence boost");

const nonRunRequestMustNotPreferRun = evaluateSelectedSourceDateMoveRanking({
  parsedPayload: explicitNonRunPayload,
  selectedSourceDate: "2026-05-27",
  selectedSourceDatePolicy: "explicit_source_date",
  candidates: [
    buildCandidate({
      title: "Pilates",
      rawTextSnippet: "Pilates mobility",
      type: null,
      classHint: "Other WorkoutCard",
      plannedDurationSec: 2878,
      plannedDistance: 0,
      workoutId: 301,
      rawScore: 0.86,
    }),
    buildCandidate({
      title: "Easy run",
      rawTextSnippet: "easy run 40 min",
      type: "run",
      classHint: "Run WorkoutCard",
      plannedDurationSec: 2400,
      plannedDistance: 8.0,
      workoutId: 302,
      rawScore: 0.84,
    }),
  ],
});

assert(nonRunRequestMustNotPreferRun.topCandidate?.candidate.workoutId === 301, "non-run request must not blindly prefer the run card");

console.log("check-trainingpeaks-move-ranking: ok");
