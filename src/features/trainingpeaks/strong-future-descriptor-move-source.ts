import { hasIntervalDescriptorPattern } from "@/features/trainingpeaks/workout-reference";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type StrongFutureDescriptorMoveSourceCandidate = {
  dateIso: string;
  title: string | null;
  type: string | null;
  rawTextSnippet: string;
  workoutId: number | null;
  fingerprint: string | null;
  rawScore?: number;
};

export type StrongFutureDescriptorMoveSourceResolution = {
  selectedSourceDate: string | null;
  selectedSourceDatePolicy: string;
  selectedCandidate: StrongFutureDescriptorMoveSourceCandidate | null;
  strongCandidates: StrongFutureDescriptorMoveSourceCandidate[];
  descriptorType: "interval";
  descriptorConfidence: number | null;
  sourceInferencePolicy: string;
  candidateCount: number;
  candidateAlternativesCount: number;
  score: number | null;
  margin: number | null;
  warnings: string[];
};

function addIsoDays(isoDate: string, days: number): string {
  const match = isoDate.match(ISO_DATE_PATTERN);
  if (!match) {
    return isoDate;
  }
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function candidateCardText(candidate: StrongFutureDescriptorMoveSourceCandidate): string {
  return [candidate.title, candidate.rawTextSnippet].filter(Boolean).join(" ");
}

function isStrongFutureIntervalCandidate(input: {
  candidate: StrongFutureDescriptorMoveSourceCandidate;
  targetDate: string;
}): boolean {
  const { candidate, targetDate } = input;
  if (!candidate.dateIso || !candidate.fingerprint) {
    return false;
  }
  if (candidate.dateIso <= targetDate) {
    return false;
  }
  const maxDate = addIsoDays(targetDate, 10);
  if (candidate.dateIso > maxDate) {
    return false;
  }
  return hasIntervalDescriptorPattern(candidateCardText(candidate));
}

export function extractWorkoutDescriptorFromParsedPayload(
  parsedPayload: unknown
): { type: string; confidence: number | null; raw: string | null } | null {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return null;
  }
  const descriptor = (parsedPayload as { workoutDescriptor?: unknown }).workoutDescriptor;
  if (!descriptor || typeof descriptor !== "object") {
    return null;
  }
  const record = descriptor as { type?: unknown; confidence?: unknown; raw?: unknown };
  if (typeof record.type !== "string" || !record.type.trim()) {
    return null;
  }
  const confidence =
    typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? record.confidence
      : null;
  const raw = typeof record.raw === "string" ? record.raw : null;
  return { type: record.type.trim(), confidence, raw };
}

export function resolveStrongFutureIntervalMoveSource(input: {
  targetDate: string;
  parsedPayload: unknown;
  candidates: StrongFutureDescriptorMoveSourceCandidate[];
  targetDayHasWorkout?: boolean;
}): StrongFutureDescriptorMoveSourceResolution | null {
  const descriptor = extractWorkoutDescriptorFromParsedPayload(input.parsedPayload);
  if (!descriptor || descriptor.type !== "interval") {
    return null;
  }

  const strongCandidates = input.candidates
    .filter((candidate) => isStrongFutureIntervalCandidate({ candidate, targetDate: input.targetDate }))
    .sort((left, right) => left.dateIso.localeCompare(right.dateIso));

  const warnings: string[] = [];
  if (input.targetDayHasWorkout) {
    warnings.push("target day already has workout");
  }

  let selectedSourceDatePolicy: string;
  let selectedSourceDate: string | null = null;
  let selectedCandidate: StrongFutureDescriptorMoveSourceCandidate | null = null;

  if (strongCandidates.length === 0) {
    selectedSourceDatePolicy = "no_candidate";
  } else if (strongCandidates.length === 1) {
    selectedSourceDatePolicy = "strong_future_descriptor_match";
    selectedCandidate = strongCandidates[0]!;
    selectedSourceDate = selectedCandidate.dateIso;
    if (selectedSourceDate > input.targetDate) {
      warnings.push("hard workout moved earlier");
      warnings.push("week may need manual adjustment");
    }
  } else {
    selectedSourceDatePolicy = "multiple_candidates";
  }

  const scores = strongCandidates
    .map((candidate) => candidate.rawScore)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const sortedScores = [...scores].sort((left, right) => right - left);
  const topScore = sortedScores[0] ?? null;
  const secondScore = sortedScores[1] ?? null;
  const margin = topScore !== null && secondScore !== null ? Number((topScore - secondScore).toFixed(3)) : null;

  return {
    selectedSourceDate,
    selectedSourceDatePolicy,
    selectedCandidate,
    strongCandidates,
    descriptorType: "interval",
    descriptorConfidence: descriptor.confidence,
    sourceInferencePolicy: selectedSourceDatePolicy,
    candidateCount: strongCandidates.length,
    candidateAlternativesCount: Math.max(0, strongCandidates.length - 1),
    score: topScore,
    margin,
    warnings,
  };
}
