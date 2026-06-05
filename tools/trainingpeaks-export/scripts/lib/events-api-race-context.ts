import type { TrainingPeaksWorkoutCacheRow } from "../../../../src/features/trainingpeaks/repository.ts";
import { classifyTrainingPeaksWorkoutActivity } from "../../../../src/features/trainingpeaks/workout-activity-classification.ts";

export type EventsApiEntry = {
  athleteId: number;
  eventDate: string;
  eventName: string | null;
  distanceKm: number | null;
  sportType: string | null;
  source?: string;
  raw?: unknown;
};

export type EventsApiEstimatedDistance = "unknown" | "5k" | "10k" | "half" | "marathon" | "ultra";

export type EventsApiRaceCandidate = {
  athleteId: number;
  raceDate: string;
  weekStart: string;
  eventName: string | null;
  distanceKm: number | null;
  estimatedDistance: EventsApiEstimatedDistance;
  matchedWorkoutId: number | null;
  matchedWorkoutDate: string | null;
  matchedWorkoutTitle: string | null;
  matchedWorkoutDistanceKm: number | null;
  confirmedByWorkout: boolean;
  confidence: "high" | "medium";
  exclusionEligible: boolean;
  sourceType: "events_api";
  reasons: string[];
  source?: string;
  raw?: unknown;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
    const embedded = normalized.match(/(\d+(?:\.\d+)?)/);
    if (embedded) {
      const embeddedParsed = Number(embedded[1]);
      if (Number.isFinite(embeddedParsed)) return embeddedParsed;
    }
  }
  return null;
}

function toDistanceKm(raw: unknown): number | null {
  const parsed = toNumberOrNull(raw);
  if (parsed === null || parsed <= 0) return null;
  if (parsed > 200) return Number((parsed / 1000).toFixed(3));
  return Number(parsed.toFixed(3));
}

function toPositiveInt(value: unknown): number | null {
  const parsed = toNumberOrNull(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function estimateDistance(distanceKm: number | null): EventsApiEstimatedDistance {
  if (distanceKm === null) return "unknown";
  if (distanceKm > 43.5) return "ultra";
  if (distanceKm >= 41 && distanceKm <= 43.5) return "marathon";
  if (distanceKm >= 20.5 && distanceKm <= 22.5) return "half";
  if (distanceKm >= 9.4 && distanceKm <= 10.8) return "10k";
  if (distanceKm >= 4.6 && distanceKm <= 5.6) return "5k";
  return "unknown";
}

function eventNameHasStrongRaceWording(eventName: string | null): boolean {
  if (!eventName) return false;
  return /\b(race|run|marathon|half|trail|league|start|zabeg|забег|старт|соревн|марафон|полумарафон|верст)\b/i.test(
    eventName,
  );
}

function completedDistanceKmForRow(row: TrainingPeaksWorkoutCacheRow): number | null {
  const raw = row.completedDistanceRaw;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Number(raw.toFixed(3));
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw.trim().replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) return Number(parsed.toFixed(3));
  }
  return null;
}

function weekStartIso(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = day.getUTCDay();
  const offset = (weekday + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  const a = new Date(`${left}T00:00:00Z`).getTime();
  const b = new Date(`${right}T00:00:00Z`).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function inferEventArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  const directRows = payload.rows;
  if (Array.isArray(directRows)) return directRows;
  const directEvents = payload.events;
  if (Array.isArray(directEvents)) return directEvents;
  return [];
}

export function normalizeEventsApiEntries(payload: unknown, source = "events_json"): EventsApiEntry[] {
  const rows = inferEventArray(payload);
  const entries: EventsApiEntry[] = [];

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const athleteId =
      toPositiveInt(row.athlete_id) ??
      toPositiveInt(row.athleteId) ??
      toPositiveInt(row.trainingpeaks_athlete_id) ??
      toPositiveInt(row.trainingPeaksAthleteId);
    const eventDate = toIsoDate(row.event_date) ?? toIsoDate(row.eventDate) ?? toIsoDate(row.date);
    if (!athleteId || !eventDate) continue;
    const eventName =
      toStringOrNull(row.event_title) ??
      toStringOrNull(row.eventTitle) ??
      toStringOrNull(row.event_name) ??
      toStringOrNull(row.eventName) ??
      toStringOrNull(row.name) ??
      toStringOrNull(row.title);
    const sportType =
      toStringOrNull(row.sport_type) ?? toStringOrNull(row.sportType) ?? toStringOrNull(row.event_type) ?? toStringOrNull(row.eventType);
    const distanceKm = toDistanceKm(row.distance_km ?? row.distanceKm ?? row.distance);
    entries.push({
      athleteId,
      eventDate,
      eventName,
      distanceKm,
      sportType,
      source,
      raw: row,
    });
  }

  return entries;
}

export function buildEventsApiRaceCandidates(
  events: EventsApiEntry[],
  workoutRows: TrainingPeaksWorkoutCacheRow[],
): EventsApiRaceCandidate[] {
  const rowsByAthlete = new Map<number, TrainingPeaksWorkoutCacheRow[]>();
  for (const row of workoutRows) {
    const bucket = rowsByAthlete.get(row.trainingPeaksAthleteId) ?? [];
    bucket.push(row);
    rowsByAthlete.set(row.trainingPeaksAthleteId, bucket);
  }

  const out: EventsApiRaceCandidate[] = [];
  for (const event of events) {
    const athleteRows = rowsByAthlete.get(event.athleteId) ?? [];
    const runningMatches = athleteRows
      .filter((row) => row.isCompleted)
      .filter((row) => {
        const activity = classifyTrainingPeaksWorkoutActivity({
          title: row.title,
          sportOrTypeCode: row.sportOrTypeCode,
          workoutTypeValueId: row.workoutTypeValueId,
          workoutSubTypeId: row.workoutSubTypeId,
          sourceSnapshot: row.sourceSnapshot,
        });
        if (!activity.isRunning) return false;
        const diff = Math.abs(daysBetween(row.workoutDate, event.eventDate));
        return diff <= 1;
      })
      .sort((a, b) => {
        const dayDiff = Math.abs(daysBetween(a.workoutDate, event.eventDate)) - Math.abs(daysBetween(b.workoutDate, event.eventDate));
        if (dayDiff !== 0) return dayDiff;
        return a.workoutDate.localeCompare(b.workoutDate);
      });

    const matched = runningMatches[0] ?? null;
    const strongName = eventNameHasStrongRaceWording(event.eventName);
    const confirmedByWorkout = matched !== null;
    const exclusionEligible = confirmedByWorkout && (event.distanceKm !== null || strongName);

    const reasons: string[] = [];
    reasons.push("events_api_event_present");
    if (confirmedByWorkout) {
      reasons.push("completed_running_workout_matched_within_plus_minus_1_day");
      if (event.distanceKm === null && strongName) {
        reasons.push("distance_missing_but_event_name_has_strong_race_wording");
      }
    } else {
      reasons.push("no_completed_running_workout_match_within_plus_minus_1_day");
      reasons.push("advisory_only");
    }

    out.push({
      athleteId: event.athleteId,
      raceDate: event.eventDate,
      weekStart: weekStartIso(event.eventDate),
      eventName: event.eventName,
      distanceKm: event.distanceKm,
      estimatedDistance: estimateDistance(event.distanceKm),
      matchedWorkoutId: matched?.trainingPeaksWorkoutId ?? null,
      matchedWorkoutDate: matched?.workoutDate ?? null,
      matchedWorkoutTitle: matched?.title ?? null,
      matchedWorkoutDistanceKm: matched ? completedDistanceKmForRow(matched) : null,
      confirmedByWorkout,
      confidence: confirmedByWorkout ? "high" : "medium",
      exclusionEligible,
      sourceType: "events_api",
      reasons,
      source: event.source,
      raw: event.raw,
    });
  }

  return out.sort((a, b) => a.raceDate.localeCompare(b.raceDate) || a.athleteId - b.athleteId);
}
