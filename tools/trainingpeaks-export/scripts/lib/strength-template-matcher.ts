import { normalizeExerciseName } from "./strength-exercise-normalization.ts";
import type { StrengthTemplate, StrengthTemplateExercise } from "./strength-templates.ts";

export type NormalizedStrengthExercise = {
  exerciseLibraryId: string | number;
  exerciseLibraryItemId: string | number;
  itemName: string;
  normalizedName: string;
  description?: string;
  libraryName?: string;
  isDefaultContent?: boolean;
  ownerType?: string | null;
};

export type ExerciseMatchResult = {
  requestedName: string;
  matchedName?: string;
  exerciseLibraryItemId?: string | number;
  exerciseLibraryId?: string | number;
  confidence: number;
  status: "matched" | "ambiguous" | "missing";
  alternatives: Array<{ itemName: string; exerciseLibraryItemId: string | number; confidence: number }>;
};

export type TemplateExerciseReview = {
  targetNames: string[];
  sets: string;
  reps: string;
  notes?: string;
  match: ExerciseMatchResult;
};

export type TemplateReview = {
  templateId: string;
  title: string;
  purpose: string;
  estimatedDurationMinutes: string;
  safetyNotes?: string[];
  blocks: Array<{
    name: string;
    exercises: TemplateExerciseReview[];
  }>;
  summary: {
    matchedCount: number;
    ambiguousCount: number;
    missingCount: number;
    totalExercises: number;
  };
};

const EXACT_CONFIDENCE = 1;
const ALIAS_CONFIDENCE = 0.95;
const STARTS_WITH_CONFIDENCE = 0.85;
const CONTAINS_CONFIDENCE = 0.75;
const AMBIGUITY_DELTA = 0.05;
const MIN_MATCH_CONFIDENCE = 0.7;

const EXERCISE_ALIASES: Record<string, string[]> = {
  rdl: ["romanian deadlift"],
  "romanian deadlift": ["rdl"],
  "banded clam shell": ["clam shell", "clamshell", "banded clamshell"],
  "clam shell": ["banded clam shell", "clamshell"],
  clamshell: ["banded clam shell", "clam shell"],
  "banded glute bridge": ["glute bridge with band"],
  "glute bridge": ["banded glute bridge"],
  "calf raises": ["calf raise"],
  "split squats": ["split squat"],
  "step ups": ["step up"],
  "side planks": ["side plank"],
  "air squats": ["air squat"],
  "wall squats": ["wall squat"],
};

type ScoredCandidate = {
  exercise: NormalizedStrengthExercise;
  confidence: number;
  reason: "exact" | "alias" | "starts_with" | "contains";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function aliasTargetsFor(normalizedRequested: string): string[] {
  const aliases = new Set<string>([normalizedRequested]);
  for (const alias of EXERCISE_ALIASES[normalizedRequested] ?? []) {
    aliases.add(normalizeExerciseName(alias));
  }
  for (const [canonical, aliasList] of Object.entries(EXERCISE_ALIASES)) {
    const normalizedCanonical = normalizeExerciseName(canonical);
    if (aliasList.some((alias) => normalizeExerciseName(alias) === normalizedRequested)) {
      aliases.add(normalizedCanonical);
    }
  }
  return [...aliases];
}

function scoreCandidate(normalizedRequested: string, exercise: NormalizedStrengthExercise): ScoredCandidate | null {
  const normalizedExercise = exercise.normalizedName;
  const aliasTargets = aliasTargetsFor(normalizedRequested);

  if (aliasTargets.includes(normalizedExercise)) {
    return {
      exercise,
      confidence: normalizedExercise === normalizedRequested ? EXACT_CONFIDENCE : ALIAS_CONFIDENCE,
      reason: normalizedExercise === normalizedRequested ? "exact" : "alias",
    };
  }

  if (normalizedExercise.startsWith(normalizedRequested) || normalizedRequested.startsWith(normalizedExercise)) {
    return { exercise, confidence: STARTS_WITH_CONFIDENCE, reason: "starts_with" };
  }

  if (normalizedExercise.includes(normalizedRequested) || normalizedRequested.includes(normalizedExercise)) {
    return { exercise, confidence: CONTAINS_CONFIDENCE, reason: "contains" };
  }

  return null;
}

export function matchExerciseName(requestedName: string, exercises: NormalizedStrengthExercise[]): ExerciseMatchResult {
  const normalizedRequested = normalizeExerciseName(requestedName);
  const scored: ScoredCandidate[] = [];

  for (const exercise of exercises) {
    const candidate = scoreCandidate(normalizedRequested, exercise);
    if (candidate) {
      scored.push(candidate);
    }
  }

  scored.sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    return left.exercise.itemName.localeCompare(right.exercise.itemName);
  });

  const alternatives = scored.slice(0, 5).map((entry) => ({
    itemName: entry.exercise.itemName,
    exerciseLibraryItemId: entry.exercise.exerciseLibraryItemId,
    confidence: entry.confidence,
  }));

  if (scored.length === 0) {
    return {
      requestedName,
      confidence: 0,
      status: "missing",
      alternatives: [],
    };
  }

  const best = scored[0];
  const second = scored[1];
  const isAmbiguous =
    Boolean(second) &&
    best.confidence >= MIN_MATCH_CONFIDENCE &&
    second.confidence >= MIN_MATCH_CONFIDENCE &&
    best.confidence - second.confidence <= AMBIGUITY_DELTA;

  if (isAmbiguous) {
    return {
      requestedName,
      matchedName: best.exercise.itemName,
      exerciseLibraryItemId: best.exercise.exerciseLibraryItemId,
      exerciseLibraryId: best.exercise.exerciseLibraryId,
      confidence: best.confidence,
      status: "ambiguous",
      alternatives,
    };
  }

  if (best.confidence < MIN_MATCH_CONFIDENCE) {
    return {
      requestedName,
      confidence: best.confidence,
      status: "missing",
      alternatives,
    };
  }

  return {
    requestedName,
    matchedName: best.exercise.itemName,
    exerciseLibraryItemId: best.exercise.exerciseLibraryItemId,
    exerciseLibraryId: best.exercise.exerciseLibraryId,
    confidence: best.confidence,
    status: "matched",
    alternatives: alternatives.filter((entry) => entry.itemName !== best.exercise.itemName),
  };
}

function matchTemplateExercise(
  exercise: StrengthTemplateExercise,
  exercises: NormalizedStrengthExercise[],
): ExerciseMatchResult {
  const attempts = exercise.targetNames.map((targetName) => matchExerciseName(targetName, exercises));
  attempts.sort((left, right) => right.confidence - left.confidence);

  const best = attempts[0];
  if (!best || best.status === "missing") {
    return (
      best ?? {
        requestedName: exercise.targetNames.join(" / "),
        confidence: 0,
        status: "missing",
        alternatives: [],
      }
    );
  }

  const ambiguousAttempt = attempts.find((attempt) => attempt.status === "ambiguous");
  if (ambiguousAttempt && ambiguousAttempt.confidence >= best.confidence - AMBIGUITY_DELTA) {
    return {
      ...ambiguousAttempt,
      requestedName: exercise.targetNames.join(" / "),
    };
  }

  return {
    ...best,
    requestedName: exercise.targetNames.join(" / "),
  };
}

export function buildTemplateReview(template: StrengthTemplate, exercises: NormalizedStrengthExercise[]): TemplateReview {
  const blocks = template.blocks.map((block) => ({
    name: block.name,
    exercises: block.exercises.map((exercise) => ({
      targetNames: exercise.targetNames,
      sets: exercise.sets,
      reps: exercise.reps,
      notes: exercise.notes,
      match: matchTemplateExercise(exercise, exercises),
    })),
  }));

  const flatExercises = blocks.flatMap((block) => block.exercises);
  const summary = {
    matchedCount: flatExercises.filter((entry) => entry.match.status === "matched").length,
    ambiguousCount: flatExercises.filter((entry) => entry.match.status === "ambiguous").length,
    missingCount: flatExercises.filter((entry) => entry.match.status === "missing").length,
    totalExercises: flatExercises.length,
  };

  return {
    templateId: template.id,
    title: template.title,
    purpose: template.purpose,
    estimatedDurationMinutes: template.estimatedDurationMinutes,
    safetyNotes: template.safetyNotes,
    blocks,
    summary,
  };
}

export function normalizeStrengthExerciseRecord(input: {
  item: Record<string, unknown>;
  library?: Record<string, unknown>;
}): NormalizedStrengthExercise | null {
  const itemNameRaw = input.item.itemName;
  if (typeof itemNameRaw !== "string" || !itemNameRaw.trim()) {
    return null;
  }

  const exerciseLibraryItemId = input.item.exerciseLibraryItemId;
  const exerciseLibraryId = input.item.exerciseLibraryId ?? input.library?.exerciseLibraryId;
  if (
    (typeof exerciseLibraryItemId !== "string" && typeof exerciseLibraryItemId !== "number") ||
    (typeof exerciseLibraryId !== "string" && typeof exerciseLibraryId !== "number")
  ) {
    return null;
  }

  const description = typeof input.item.description === "string" ? input.item.description : undefined;
  const libraryName = typeof input.library?.libraryName === "string" ? input.library.libraryName : undefined;
  const isDefaultContent =
    typeof input.library?.isDefaultContent === "boolean" ? input.library.isDefaultContent : undefined;
  const ownerType =
    isDefaultContent === true
      ? "default"
      : isDefaultContent === false
        ? "custom"
        : typeof input.library?.ownerName === "string"
          ? input.library.ownerName
          : null;

  return {
    exerciseLibraryId,
    exerciseLibraryItemId,
    itemName: itemNameRaw.trim(),
    normalizedName: normalizeExerciseName(itemNameRaw),
    description,
    libraryName,
    isDefaultContent,
    ownerType,
  };
}

export function parseExerciseCachePayload(payload: unknown): NormalizedStrengthExercise[] {
  if (!isRecord(payload)) {
    throw new Error("Exercise cache payload must be an object.");
  }

  const exercisesRaw = payload.exercises;
  if (!Array.isArray(exercisesRaw)) {
    throw new Error("Exercise cache payload must include an exercises array.");
  }

  const out: NormalizedStrengthExercise[] = [];
  for (const entry of exercisesRaw) {
    if (!isRecord(entry)) continue;
    const normalized = normalizeStrengthExerciseRecord({ item: entry, library: entry });
    if (normalized) {
      out.push(normalized);
    }
  }
  return out;
}
