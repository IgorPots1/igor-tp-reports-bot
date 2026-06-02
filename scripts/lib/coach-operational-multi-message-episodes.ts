import {
  classifyCoachOperationalSignals,
  buildPromotedBareWeekdayScheduleCandidate,
  hasScheduleContextCue,
  isBareWeekdayObservationText,
  isScheduleSignalType,
  type ObservationLike,
  type OperationalSignalCandidate,
  type OperationalSignalType,
} from "./coach-operational-signals";
import { inferUnavailabilityAfterAvailableDates } from "@/features/trainingpeaks/operational-schedule-display";

type EpisodeObservationInput = {
  id: string;
  student_id: string | null;
  source_type: string | null;
  chat_id: string | null;
  message_thread_id: number | null;
  text_preview: string | null;
  labels: unknown;
  metadata: unknown;
  observed_at: string | null;
  created_at: string;
};

type EpisodeMeta = {
  episodeKey: string;
  episodeType: "schedule_unavailability" | "schedule_constraint";
  relatedSignalTypes: OperationalSignalType[];
  roleBySignalType: Partial<Record<OperationalSignalType, "schedule_availability" | "schedule_unavailability">>;
};

export type MultiMessageObservationPlan = {
  additionalCandidates: OperationalSignalCandidate[];
  scheduleEpisodeMeta: EpisodeMeta | null;
};

type EpisodeDraftObservation = EpisodeObservationInput & {
  observedAtIso: string;
  observedAtMs: number;
  labelsNormalized: string[];
  metadataObject: Record<string, unknown>;
  baseCandidates: OperationalSignalCandidate[];
  baseScheduleCandidates: OperationalSignalCandidate[];
  textLower: string;
  isBareWeekday: boolean;
  hasScheduleCue: boolean;
  hasStrongNonScheduleSignal: boolean;
};

const MAX_EPISODE_MESSAGES = 5;
const MAX_EPISODE_WINDOW_MS = 3 * 60 * 1000;

function coerceStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase());
}

function coerceObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function getObservedAtIso(input: EpisodeObservationInput): string {
  return input.observed_at ?? input.created_at;
}

function getObservedAtMs(input: string): number {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

function buildObservationLike(input: EpisodeDraftObservation, textOverride?: string): ObservationLike {
  return {
    sourceType: input.source_type,
    textPreview: textOverride ?? input.text_preview,
    labels: input.labelsNormalized,
    metadata: input.metadataObject,
    observedAt: input.observedAtIso,
    studentId: input.student_id,
  };
}

function hasRunUnavailabilityCue(text: string): boolean {
  return /точно бегать не смогу|не смогу бегать|бегать не смогу|тренироваться не смогу|не получится бегать/iu.test(text);
}

function hasTravelCue(text: string): boolean {
  return /улетаю|поездк|командировк|отпуск|фестиваль|в отъезде|в отезде/iu.test(text);
}

function hasDurationCue(text: string): boolean {
  return /на\s+\d{1,2}\s+дн/iu.test(text);
}

function hasTravelOnlyCue(text: string): boolean {
  return /улетаю|поездк|командировк|отпуск|фестиваль|в отъезде|в отезде/iu.test(text);
}

function buildEpisodeMessageKey(row: EpisodeDraftObservation): string {
  return [
    row.student_id ?? "",
    (row.source_type ?? "").toLowerCase(),
    row.chat_id ?? "null",
    row.message_thread_id === null ? "null" : String(row.message_thread_id),
  ].join("|");
}

function isEpisodeEligibleRow(row: EpisodeDraftObservation): boolean {
  if (
    row.baseCandidates.length === 0 &&
    hasTravelOnlyCue(row.textLower) &&
    !hasDurationCue(row.textLower) &&
    !hasRunUnavailabilityCue(row.textLower)
  ) {
    return true;
  }
  if (row.hasStrongNonScheduleSignal) {
    return false;
  }
  return row.baseScheduleCandidates.length > 0 || row.isBareWeekday || row.hasScheduleCue;
}

function buildRelatedSignalTypes(candidates: OperationalSignalCandidate[]): OperationalSignalType[] {
  const output = new Set<OperationalSignalType>();
  for (const candidate of candidates) {
    output.add(candidate.signal_type);
  }
  return [...output].sort();
}

function mergeWithUniqSignalType(
  base: OperationalSignalCandidate[],
  additions: OperationalSignalCandidate[]
): OperationalSignalCandidate[] {
  const out: OperationalSignalCandidate[] = [...base];
  for (const candidate of additions) {
    if (out.some((item) => item.signal_type === candidate.signal_type)) {
      continue;
    }
    out.push(candidate);
  }
  return out;
}

function inferUnavailabilityRangeFromAvailability(
  candidate: OperationalSignalCandidate,
  availabilityDates: string[]
): OperationalSignalCandidate {
  if (candidate.signal_type !== "schedule_unavailability_window") {
    return candidate;
  }
  const durationDays = candidate.structured_payload.duration_days;
  if (!durationDays || candidate.structured_payload.valid_from || availabilityDates.length === 0) {
    return candidate;
  }
  const inferred = inferUnavailabilityAfterAvailableDates({
    availableDates: availabilityDates,
    durationDays,
  });
  if (!inferred) {
    return candidate;
  }
  return {
    ...candidate,
    structured_payload: {
      ...candidate.structured_payload,
      valid_from: inferred.validFrom,
      valid_until: inferred.validUntil,
    },
  };
}

function buildEpisodeForChain(
  chain: EpisodeDraftObservation[],
  plan: Map<string, MultiMessageObservationPlan>
): void {
  if (chain.length < 2) {
    return;
  }

  const combinedText = chain.map((item) => item.text_preview ?? "").join(" ").trim();
  if (!combinedText) {
    return;
  }

  const hasScheduleAnchor = chain.some((item) => item.baseScheduleCandidates.length > 0 || item.hasScheduleCue);
  if (!hasScheduleAnchor) {
    return;
  }

  const hasUnavailabilityContext =
    chain.some((item) => item.baseScheduleCandidates.some((candidate) => candidate.signal_type === "schedule_unavailability_window")) ||
    (hasRunUnavailabilityCue(combinedText) && (hasTravelCue(combinedText) || hasDurationCue(combinedText))) ||
    (hasTravelCue(combinedText) && hasDurationCue(combinedText));
  const hasAvailabilityContext = chain.some(
    (item) =>
      item.baseScheduleCandidates.some(
        (candidate) =>
          candidate.signal_type === "schedule_availability_window" || candidate.signal_type === "plan_generation_constraint"
      ) || item.isBareWeekday
  );

  if (!hasAvailabilityContext && !hasUnavailabilityContext) {
    return;
  }

  const scheduleCandidatesByObservation = new Map<string, OperationalSignalCandidate[]>();
  for (const row of chain) {
    scheduleCandidatesByObservation.set(row.id, [...row.baseScheduleCandidates]);
  }

  if (hasUnavailabilityContext) {
    for (const row of chain) {
      if (!row.isBareWeekday) {
        continue;
      }
      const promoted = buildPromotedBareWeekdayScheduleCandidate({
        observation: buildObservationLike(row),
        contextText: combinedText,
      });
      if (!promoted) {
        continue;
      }
      const existing = scheduleCandidatesByObservation.get(row.id) ?? [];
      scheduleCandidatesByObservation.set(row.id, mergeWithUniqSignalType(existing, [promoted]));
    }
  }

  const hasUnavailabilitySignal = [...scheduleCandidatesByObservation.values()].some((items) =>
    items.some((candidate) => candidate.signal_type === "schedule_unavailability_window")
  );

  if (hasUnavailabilityContext && !hasUnavailabilitySignal) {
    const tail = chain[chain.length - 1]!;
    const combinedCandidates = classifyCoachOperationalSignals(
      buildObservationLike(
        {
          ...tail,
          observedAtIso: chain[0]!.observedAtIso,
        } as EpisodeDraftObservation,
        combinedText
      )
    );
    const syntheticUnavailability = combinedCandidates.find(
      (candidate) => candidate.signal_type === "schedule_unavailability_window"
    );
    if (syntheticUnavailability) {
      const existing = scheduleCandidatesByObservation.get(tail.id) ?? [];
      scheduleCandidatesByObservation.set(tail.id, mergeWithUniqSignalType(existing, [syntheticUnavailability]));
    }
  }

  const allScheduleCandidates = [...scheduleCandidatesByObservation.values()].flat();
  if (allScheduleCandidates.length < 2) {
    return;
  }

  const availabilityDates = [...new Set(
    allScheduleCandidates
      .filter(
        (candidate) =>
          candidate.signal_type === "plan_generation_constraint" ||
          candidate.signal_type === "schedule_availability_window"
      )
      .flatMap((candidate) => candidate.structured_payload.resolved_available_dates ?? [])
  )].sort();

  for (const [observationId, candidates] of scheduleCandidatesByObservation.entries()) {
    scheduleCandidatesByObservation.set(
      observationId,
      candidates.map((candidate) => inferUnavailabilityRangeFromAvailability(candidate, availabilityDates))
    );
  }

  const relatedSignalTypes = buildRelatedSignalTypes([...scheduleCandidatesByObservation.values()].flat());
  if (relatedSignalTypes.length < 2) {
    return;
  }
  const hasUnavailabilityType = relatedSignalTypes.includes("schedule_unavailability_window");
  const episodeType: EpisodeMeta["episodeType"] = hasUnavailabilityType
    ? "schedule_unavailability"
    : "schedule_constraint";
  const episodeKey = `student:${chain[0]!.student_id}:multi_observation:${chain[0]!.id}:${chain[chain.length - 1]!.id}:episode:${episodeType}`;

  const roleBySignalType: EpisodeMeta["roleBySignalType"] = {
    plan_generation_constraint: "schedule_availability",
    schedule_availability_window: "schedule_availability",
    schedule_unavailability_window: "schedule_unavailability",
  };

  for (const row of chain) {
    const candidates = scheduleCandidatesByObservation.get(row.id) ?? [];
    if (candidates.length === 0) {
      continue;
    }
    const existing = plan.get(row.id);
    const merged = existing
      ? mergeWithUniqSignalType(existing.additionalCandidates, candidates)
      : candidates;
    plan.set(row.id, {
      additionalCandidates: merged,
      scheduleEpisodeMeta: {
        episodeKey,
        episodeType,
        relatedSignalTypes,
        roleBySignalType,
      },
    });
  }
}

export function buildMultiMessageObservationPlan(
  rows: EpisodeObservationInput[]
): Map<string, MultiMessageObservationPlan> {
  const draftRows = rows
    .filter((row) => typeof row.student_id === "string" && row.student_id.length > 0)
    .map((row) => {
      const labelsNormalized = coerceStringArray(row.labels);
      const metadataObject = coerceObject(row.metadata);
      const observedAtIso = getObservedAtIso(row);
      const observation = {
        sourceType: row.source_type,
        textPreview: row.text_preview,
        labels: labelsNormalized,
        metadata: metadataObject,
        observedAt: observedAtIso,
        studentId: row.student_id,
      } satisfies ObservationLike;
      const baseCandidates = classifyCoachOperationalSignals(observation);
      const baseScheduleCandidates = baseCandidates.filter((candidate) =>
        isScheduleSignalType(candidate.signal_type)
      );
      const textLower = (row.text_preview ?? "").toLowerCase();
      return {
        ...row,
        observedAtIso,
        observedAtMs: getObservedAtMs(observedAtIso),
        labelsNormalized,
        metadataObject,
        baseCandidates,
        baseScheduleCandidates,
        textLower,
        isBareWeekday: isBareWeekdayObservationText(row.text_preview),
        hasScheduleCue: hasScheduleContextCue(row.text_preview),
        hasStrongNonScheduleSignal: baseCandidates.some(
          (candidate) => !isScheduleSignalType(candidate.signal_type)
        ),
      } satisfies EpisodeDraftObservation;
    });

  const byKey = new Map<string, EpisodeDraftObservation[]>();
  for (const row of draftRows) {
    const key = buildEpisodeMessageKey(row);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const plan = new Map<string, MultiMessageObservationPlan>();

  for (const list of byKey.values()) {
    list.sort((left, right) => left.observedAtMs - right.observedAtMs);
    let index = 0;
    while (index < list.length) {
      const start = list[index]!;
      if (!isEpisodeEligibleRow(start)) {
        index += 1;
        continue;
      }
      const chain: EpisodeDraftObservation[] = [start];
      let cursor = index + 1;
      while (cursor < list.length && chain.length < MAX_EPISODE_MESSAGES) {
        const next = list[cursor]!;
        const prev = chain[chain.length - 1]!;
        if (next.observedAtMs - prev.observedAtMs > MAX_EPISODE_WINDOW_MS) {
          break;
        }
        if (next.observedAtMs - chain[0]!.observedAtMs > MAX_EPISODE_WINDOW_MS) {
          break;
        }
        if (!isEpisodeEligibleRow(next)) {
          break;
        }
        chain.push(next);
        cursor += 1;
      }
      buildEpisodeForChain(chain, plan);
      index += Math.max(1, chain.length);
    }
  }

  return plan;
}
