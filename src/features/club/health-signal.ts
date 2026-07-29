// Club — raise a Coach OS operational health signal from a day_off whose reason is a health
// one (Injury / Sick). Gated by CLUB_HEALTH_SIGNALS_ENABLED (OFF). Closing is inherited from
// the existing lifecycle: pain_injury closes by the coach (injuries close by hand), Sick
// (health_issue_started) auto-closes via the recovery-bridge. This module only OPENS.
// See docs/club-health-signal-from-availability.md.

import {
  upsertTrainingPeaksOperationalSignalFromCandidate,
  type TrainingPeaksOperationalSignalType,
} from "@/features/trainingpeaks/repository";

import { isClubHealthSignalsEnabled } from "./constants";

const REASON_SIGNAL: Record<string, { signalType: TrainingPeaksOperationalSignalType; requiresCoachClose: boolean }> = {
  // Injury: a standing injury the coach closes by hand (never auto-cleared by a workout).
  Injury: { signalType: "pain_injury", requiresCoachClose: true },
  // Sick: onset of illness; the recovery-bridge auto-closes it on a recovery confirmation.
  Sick: { signalType: "health_issue_started", requiresCoachClose: false },
};

export type ClubDayoffSignalInput = {
  entryId: string;
  studentId: string;
  /** First day of the day-off (single-day) or the whole range (grouped). */
  startDate: string;
  endDate: string;
  reason: string | null;
};

export type ClubDayoffSignalResult =
  | { raised: false; skipped: "flag_off" | "not_health_reason" | "missing_fields" }
  | { raised: true; signalType: TrainingPeaksOperationalSignalType; writeStatus: string };

/**
 * Idempotent: dedupe_key = `club_calendar:<entryId>`, so re-approving the same entry updates
 * the one signal instead of creating a second. Returns a skip reason when the flag is off or
 * the reason is not a health one — the caller does not need to pre-filter.
 */
export async function raiseClubDayoffHealthSignal(input: ClubDayoffSignalInput): Promise<ClubDayoffSignalResult> {
  if (!isClubHealthSignalsEnabled()) return { raised: false, skipped: "flag_off" };
  const mapping = input.reason ? REASON_SIGNAL[input.reason] : undefined;
  if (!mapping) return { raised: false, skipped: "not_health_reason" };
  if (!input.entryId || !input.studentId || !input.startDate) return { raised: false, skipped: "missing_fields" };

  const result = await upsertTrainingPeaksOperationalSignalFromCandidate({
    studentId: input.studentId,
    signalType: mapping.signalType,
    sourceType: "club_calendar",
    dedupeKey: `club_calendar:${input.entryId}`,
    validFrom: input.startDate,
    validUntil: input.endDate || input.startDate,
    sourceDate: input.startDate,
    requiresCoachClose: mapping.requiresCoachClose,
    structuredPayload: { reason: input.reason, entry_id: input.entryId, kind: "day_off", origin: "club_calendar" },
  });
  return { raised: true, signalType: mapping.signalType, writeStatus: result.writeStatus };
}
