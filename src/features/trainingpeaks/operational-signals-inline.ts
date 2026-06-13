import { createHash } from "node:crypto";

import {
  classifyCoachOperationalSignals,
  type ObservationLike,
  type OperationalConfidence,
  type OperationalPrimaryBucket,
  type OperationalSignalCandidate,
} from "@/features/trainingpeaks/coach-operational-signals";
import {
  consumeActiveTrainingPeaksOperationalSignals,
  upsertTrainingPeaksOperationalSignalFromCandidate,
  type TrainingPeaksOperationalSignalType,
  type UpsertTrainingPeaksOperationalSignalFromCandidateResult,
} from "@/features/trainingpeaks/repository";

const CLASSIFIER_VERSION = "coach-operational-signals-v1";

const ACTIONABLE_BUCKETS = new Set<OperationalPrimaryBucket>([
  "operational_signal",
  "coach_case",
  "trainingpeaks_action",
  "health_lifecycle_signal",
]);

const PERSISTABLE_SIGNAL_TYPES = new Set<TrainingPeaksOperationalSignalType>([
  "schedule_availability_window",
  "schedule_unavailability_window",
  "resume_training",
  "pause_training",
  "health_issue_started",
  "health_issue_resolved",
  "health_issue_improving",
  "pain_injury",
  "external_training_context",
  "move_workout_candidate",
  "plan_generation_constraint",
  "race_load_context",
]);

type PersistableCandidate = {
  classification: OperationalSignalCandidate;
  signalType: TrainingPeaksOperationalSignalType;
};

export type PersistOperationalSignalsForObservationInput = {
  observationId: string;
  studentId: string | null;
  sourceType: string | null;
  textPreview: string | null;
  labels: string[];
  metadata: Record<string, unknown>;
  observedAt: string;
  telegramChatId?: string | null;
  telegramMessageId?: string | null;
  telegramMessageThreadId?: number | null;
};

export type PersistOperationalSignalsForObservationResult = {
  status: "processed" | "skipped";
  reason?: string;
  considered: number;
  persisted: number;
  inserted: number;
  updated: number;
  existing: number;
  consumed: number;
};

type InlinePersistenceDependencies = {
  upsert: typeof upsertTrainingPeaksOperationalSignalFromCandidate;
  consume: typeof consumeActiveTrainingPeaksOperationalSignals;
};

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/u.test(normalized) ? normalized : null;
}

function confidenceToNumeric(value: OperationalConfidence): number {
  if (value === "high") {
    return 0.9;
  }
  if (value === "medium") {
    return 0.65;
  }
  return 0.35;
}

function normalizeDay(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeIsoDateTime(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function buildDedupeKey(input: {
  studentId: string;
  sourceObservationId: string;
  signalType: TrainingPeaksOperationalSignalType;
  sourceType: string;
  validFrom: string | null;
  validUntil: string | null;
  sourceDate: string | null;
  targetDate: string | null;
  sourceDay: string | null;
  targetDay: string | null;
  structuredPayload: Record<string, unknown>;
}): string {
  const raw = [
    input.studentId,
    input.sourceObservationId,
    input.signalType,
    input.sourceType,
    input.validFrom ?? "",
    input.validUntil ?? "",
    input.sourceDate ?? "",
    input.targetDate ?? "",
    input.sourceDay ?? "",
    input.targetDay ?? "",
    stableJsonStringify(input.structuredPayload),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

function payloadRichnessScore(payload: Record<string, unknown>): number {
  let score = 0;
  const validFrom = normalizeDate(payload.valid_from);
  const validUntil = normalizeDate(payload.valid_until);
  const sourceDate = normalizeDate(payload.source_date);
  const targetDate = normalizeDate(payload.target_date);
  if (validFrom) {
    score += 4;
  }
  if (validUntil) {
    score += 4;
  }
  if (sourceDate) {
    score += 2;
  }
  if (targetDate) {
    score += 2;
  }
  const duration = payload.duration_days;
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    score += 3;
  }
  const resolvedDates = Array.isArray(payload.resolved_available_dates) ? payload.resolved_available_dates : [];
  if (resolvedDates.length > 0) {
    score += 3;
  }
  const latestSummary = typeof payload.latest_summary === "string" ? payload.latest_summary.trim() : "";
  if (latestSummary) {
    score += 5;
  }
  const symptoms = Array.isArray(payload.symptoms) ? payload.symptoms : [];
  if (symptoms.length > 0) {
    score += 2;
  }
  return score;
}

function isActionableClassification(input: {
  primaryBucket: OperationalPrimaryBucket;
  secondaryBuckets: OperationalPrimaryBucket[];
}): boolean {
  if (ACTIONABLE_BUCKETS.has(input.primaryBucket)) {
    return true;
  }
  return input.secondaryBuckets.some((bucket) => ACTIONABLE_BUCKETS.has(bucket));
}

export type DiscardedOperationalCandidate = {
  classification: OperationalSignalCandidate;
  discardReason: "skip_bucket" | "non_persistable_type" | "non_actionable";
};

export type ObservationPersistenceSimulation = {
  status: "would_persist" | "would_skip";
  skipReason: string | null;
  allCandidates: OperationalSignalCandidate[];
  discardedCandidates: DiscardedOperationalCandidate[];
  persistableCandidates: OperationalSignalCandidate[];
};

export function simulateObservationPersistenceOutcome(
  input: Omit<PersistOperationalSignalsForObservationInput, "observationId">
): ObservationPersistenceSimulation {
  if (!input.studentId) {
    return {
      status: "would_skip",
      skipReason: "missing_student_id",
      allCandidates: [],
      discardedCandidates: [],
      persistableCandidates: [],
    };
  }

  const classificationInput: ObservationLike = {
    sourceType: input.sourceType,
    textPreview: input.textPreview,
    labels: input.labels.map((label) => label.toLowerCase()),
    metadata: input.metadata ?? {},
    observedAt: input.observedAt,
    studentId: input.studentId,
  };

  const allCandidates = classifyCoachOperationalSignals(classificationInput);
  if (!allCandidates.length) {
    return {
      status: "would_skip",
      skipReason: "no_candidates",
      allCandidates: [],
      discardedCandidates: [],
      persistableCandidates: [],
    };
  }

  const discardedCandidates: DiscardedOperationalCandidate[] = [];
  const persistableCandidatesMap = new Map<TrainingPeaksOperationalSignalType, PersistableCandidate>();
  for (const classification of allCandidates) {
    const signalType = classification.signal_type;
    const isActionable = isActionableClassification({
      primaryBucket: classification.primary_bucket,
      secondaryBuckets: classification.secondary_buckets,
    });
    if (!PERSISTABLE_SIGNAL_TYPES.has(signalType as TrainingPeaksOperationalSignalType)) {
      discardedCandidates.push({ classification, discardReason: "non_persistable_type" });
      continue;
    }
    if (classification.primary_bucket === "skip") {
      discardedCandidates.push({ classification, discardReason: "skip_bucket" });
      continue;
    }
    if (!isActionable) {
      discardedCandidates.push({ classification, discardReason: "non_actionable" });
      continue;
    }
    const typedSignal = signalType as TrainingPeaksOperationalSignalType;
    const prev = persistableCandidatesMap.get(typedSignal);
    if (!prev) {
      persistableCandidatesMap.set(typedSignal, {
        classification,
        signalType: typedSignal,
      });
      continue;
    }
    const prevScore = payloadRichnessScore(prev.classification.structured_payload as Record<string, unknown>);
    const nextScore = payloadRichnessScore(classification.structured_payload as Record<string, unknown>);
    if (nextScore >= prevScore) {
      persistableCandidatesMap.set(typedSignal, {
        classification,
        signalType: typedSignal,
      });
    }
  }

  const persistableCandidates = [...persistableCandidatesMap.values()].map((item) => item.classification);
  if (!persistableCandidates.length) {
    return {
      status: "would_skip",
      skipReason: "no_persistable_candidates",
      allCandidates,
      discardedCandidates,
      persistableCandidates: [],
    };
  }

  return {
    status: "would_persist",
    skipReason: null,
    allCandidates,
    discardedCandidates,
    persistableCandidates,
  };
}

function parseTelegramBigInt(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }
  return parsed;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDaysDate(value: Date, days: number): Date {
  const copy = new Date(value.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function endOfWeekIsoDate(date: Date): string {
  const day = date.getUTCDay();
  const toSunday = (7 - day) % 7;
  return toIsoDate(addDaysDate(date, toSunday));
}

function resolveDefaultValidUntil(input: {
  signalType: TrainingPeaksOperationalSignalType;
  structuredPayload: Record<string, unknown>;
  observedAt: string;
}): string | null {
  const observedDate = new Date(input.observedAt);
  const baseDate = Number.isNaN(observedDate.getTime()) ? new Date() : observedDate;
  const payloadValidUntil = normalizeDate(input.structuredPayload.valid_until);
  if (payloadValidUntil) {
    return payloadValidUntil;
  }
  const targetDate = normalizeDate(input.structuredPayload.target_date);

  switch (input.signalType) {
    case "health_issue_started":
      return toIsoDate(addDaysDate(baseDate, 5));
    case "health_issue_improving":
      return toIsoDate(addDaysDate(baseDate, 3));
    case "health_issue_resolved":
      return toIsoDate(addDaysDate(baseDate, 1));
    case "move_workout_candidate":
      return targetDate ? toIsoDate(addDaysDate(new Date(`${targetDate}T00:00:00.000Z`), 1)) : toIsoDate(addDaysDate(baseDate, 7));
    case "pause_training":
      return toIsoDate(addDaysDate(baseDate, 3));
    case "resume_training":
      return toIsoDate(addDaysDate(baseDate, 1));
    case "schedule_unavailability_window":
    case "schedule_availability_window":
      return payloadValidUntil;
    case "plan_generation_constraint":
      return endOfWeekIsoDate(baseDate);
    case "race_load_context":
      return null;
    default:
      return null;
  }
}

function healthSupersessionTargets(signalType: TrainingPeaksOperationalSignalType): TrainingPeaksOperationalSignalType[] {
  if (signalType === "health_issue_improving") {
    return ["health_issue_started"];
  }
  if (signalType === "health_issue_resolved") {
    return ["health_issue_started", "health_issue_improving"];
  }
  return [];
}

export async function persistOperationalSignalsForObservation(
  input: PersistOperationalSignalsForObservationInput,
  deps?: Partial<InlinePersistenceDependencies>
): Promise<PersistOperationalSignalsForObservationResult> {
  const dependencyBag: InlinePersistenceDependencies = {
    upsert: deps?.upsert ?? upsertTrainingPeaksOperationalSignalFromCandidate,
    consume: deps?.consume ?? consumeActiveTrainingPeaksOperationalSignals,
  };
  if (!input.studentId) {
    return {
      status: "skipped",
      reason: "missing_student_id",
      considered: 0,
      persisted: 0,
      inserted: 0,
      updated: 0,
      existing: 0,
      consumed: 0,
    };
  }

  const classificationInput: ObservationLike = {
    sourceType: input.sourceType,
    textPreview: input.textPreview,
    labels: input.labels.map((label) => label.toLowerCase()),
    metadata: input.metadata ?? {},
    observedAt: input.observedAt,
    studentId: input.studentId,
  };

  const allCandidates = classifyCoachOperationalSignals(classificationInput);
  if (!allCandidates.length) {
    return {
      status: "skipped",
      reason: "no_candidates",
      considered: 0,
      persisted: 0,
      inserted: 0,
      updated: 0,
      existing: 0,
      consumed: 0,
    };
  }

  const persistableCandidatesMap = new Map<TrainingPeaksOperationalSignalType, PersistableCandidate>();
  for (const classification of allCandidates) {
    const signalType = classification.signal_type;
    const isActionable = isActionableClassification({
      primaryBucket: classification.primary_bucket,
      secondaryBuckets: classification.secondary_buckets,
    });
    if (
      !PERSISTABLE_SIGNAL_TYPES.has(signalType as TrainingPeaksOperationalSignalType) ||
      classification.primary_bucket === "skip" ||
      !isActionable
    ) {
      continue;
    }
    const typedSignal = signalType as TrainingPeaksOperationalSignalType;
    const prev = persistableCandidatesMap.get(typedSignal);
    if (!prev) {
      persistableCandidatesMap.set(typedSignal, {
        classification,
        signalType: typedSignal,
      });
      continue;
    }
    const prevScore = payloadRichnessScore(prev.classification.structured_payload as Record<string, unknown>);
    const nextScore = payloadRichnessScore(classification.structured_payload as Record<string, unknown>);
    if (nextScore >= prevScore) {
      persistableCandidatesMap.set(typedSignal, {
        classification,
        signalType: typedSignal,
      });
    }
  }
  const persistableCandidates = [...persistableCandidatesMap.values()];
  if (!persistableCandidates.length) {
    return {
      status: "skipped",
      reason: "no_persistable_candidates",
      considered: 0,
      persisted: 0,
      inserted: 0,
      updated: 0,
      existing: 0,
      consumed: 0,
    };
  }

  let inserted = 0;
  let updated = 0;
  let existing = 0;
  let consumed = 0;

  for (const item of persistableCandidates) {
    const classification = item.classification;
    const signalType = item.signalType;
    const structuredPayload = classification.structured_payload as Record<string, unknown>;
    const validFrom = normalizeDate(structuredPayload.valid_from);
    const validUntil = resolveDefaultValidUntil({
      signalType,
      structuredPayload,
      observedAt: input.observedAt,
    });
    const sourceDate = normalizeDate(structuredPayload.source_date);
    const targetDate = normalizeDate(structuredPayload.target_date);
    const sourceDay = normalizeDay(structuredPayload.source_day);
    const targetDay = normalizeDay(structuredPayload.target_day);
    const dedupeKey = buildDedupeKey({
      studentId: input.studentId,
      sourceObservationId: input.observationId,
      signalType,
      sourceType: (input.sourceType ?? "unknown").toLowerCase(),
      validFrom,
      validUntil,
      sourceDate,
      targetDate,
      sourceDay,
      targetDay,
      structuredPayload,
    });

    const result: UpsertTrainingPeaksOperationalSignalFromCandidateResult =
      await dependencyBag.upsert({
        studentId: input.studentId,
        signalType,
        sourceType: (input.sourceType ?? "unknown").toLowerCase(),
        sourceObservationId: input.observationId,
        telegramChatId: parseTelegramBigInt(input.telegramChatId),
        telegramMessageId: parseTelegramBigInt(input.telegramMessageId),
        telegramMessageThreadId: input.telegramMessageThreadId ?? null,
        structuredPayload,
        confidence: confidenceToNumeric(classification.confidence),
        validFrom,
        validUntil,
        sourceDate,
        targetDate,
        sourceDay,
        targetDay,
        dedupeKey,
        metadata: {
          classifier_version: CLASSIFIER_VERSION,
          classifier_reason: classification.reason,
          classifier_confidence: classification.confidence,
          primary_bucket: classification.primary_bucket,
          secondary_buckets: classification.secondary_buckets,
          health_state:
            typeof structuredPayload.health_state === "string" ? structuredPayload.health_state : null,
          training_recommendation:
            typeof structuredPayload.training_recommendation === "string"
              ? structuredPayload.training_recommendation
              : null,
          latest_summary:
            typeof structuredPayload.latest_summary === "string"
              ? structuredPayload.latest_summary
              : null,
          follow_up_status: normalizeIsoDateTime(structuredPayload.follow_up_due_at) ? "pending" : null,
          follow_up_due_at: normalizeIsoDateTime(structuredPayload.follow_up_due_at),
          follow_up_reason:
            typeof structuredPayload.latest_summary === "string"
              ? structuredPayload.latest_summary
              : null,
          source_script: "inline-operational-signal-persistence",
          inline_runtime: true,
        },
      });

    if (result.writeStatus === "inserted") {
      inserted += 1;
    } else if (result.writeStatus === "updated") {
      updated += 1;
    } else {
      existing += 1;
    }

    const supersessionTypes = healthSupersessionTargets(signalType);
    if (supersessionTypes.length) {
      consumed += await dependencyBag.consume({
        studentId: input.studentId,
        signalTypes: supersessionTypes,
        excludeSignalId: result.signal.id,
        metadataPatch: {
          superseded_by_signal_id: result.signal.id,
          superseded_by_signal_type: signalType,
          superseded_by_observation_id: input.observationId,
          supersession_reason:
            signalType === "health_issue_improving"
              ? "health_issue_improving_supersedes_started"
              : "health_issue_resolved_supersedes_health_lifecycle",
          superseded_at: new Date().toISOString(),
        },
      });
    }
  }

  return {
    status: "processed",
    considered: persistableCandidates.length,
    persisted: inserted + updated + existing,
    inserted,
    updated,
    existing,
    consumed,
  };
}
