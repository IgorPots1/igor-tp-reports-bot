import { getTrainingPeaksStudentByAthleteId } from "@/features/trainingpeaks/repository";
import { getWorkoutsByDateRange } from "@/features/trainingpeaks/tp-api-client";
import {
  matchMoveWorkoutCandidate,
  type LiveWorkoutCandidate,
  type MoveWorkoutDomCandidate,
  type MoveWorkoutResolution,
} from "@/features/trainingpeaks/move-workout-resolver";

/**
 * M1 -- the impure half of move-workout-resolver.ts: the one function that
 * actually reads the live TrainingPeaks API + resolves athleteId->studentId,
 * to build the inputs matchMoveWorkoutCandidate() needs. Kept in its own file
 * so the matcher stays testable under plain node without a live Supabase/TP
 * connection -- same split as batch-preview.ts vs batch-preview-context.ts.
 *
 * READ-ONLY. No mutation anywhere in this module. Not wired into any
 * execution path in M1 -- callers construct MoveWorkoutDomCandidate
 * themselves (M2's hook will do so directly from tp-actions-once.ts's
 * already-in-memory `candidate` object, no JSON re-parsing needed).
 */

export type ResolveMoveWorkoutIdInput = {
  athleteId: number;
  /** The already-resolved source date ("YYYY-MM-DD"), from the existing
   * move-source-policy resolution -- this module does no date inference of
   * its own, it only resolves a workoutId given a trusted date. */
  sourceDateIso: string;
  domCandidate: MoveWorkoutDomCandidate;
};

export type ResolveMoveWorkoutIdResult =
  | { ok: true; studentId: string; resolution: MoveWorkoutResolution }
  | { ok: false; reason: "student_not_found"; athleteId: number }
  | { ok: false; reason: "live_read_failed"; error: string };

function toLiveWorkoutCandidate(raw: Record<string, unknown>, workoutId: number): LiveWorkoutCandidate {
  return {
    workoutId,
    title: typeof raw.title === "string" ? raw.title : null,
    workoutTypeValueId: typeof raw.workoutTypeValueId === "number" ? raw.workoutTypeValueId : null,
    totalTimePlannedHours: typeof raw.totalTimePlanned === "number" ? raw.totalTimePlanned : null,
    distancePlannedMeters: typeof raw.distancePlanned === "number" ? raw.distancePlanned : null,
    startTimePlanned: typeof raw.startTimePlanned === "string" ? raw.startTimePlanned : null,
  };
}

export async function resolveMoveWorkoutId(input: ResolveMoveWorkoutIdInput): Promise<ResolveMoveWorkoutIdResult> {
  const student = await getTrainingPeaksStudentByAthleteId(input.athleteId);
  if (!student) {
    return { ok: false, reason: "student_not_found", athleteId: input.athleteId };
  }

  let summaries;
  try {
    summaries = await getWorkoutsByDateRange(input.athleteId, input.sourceDateIso, input.sourceDateIso);
  } catch (error) {
    return { ok: false, reason: "live_read_failed", error: error instanceof Error ? error.message : String(error) };
  }

  const liveCandidates = summaries.map((summary) => toLiveWorkoutCandidate(summary.raw, summary.workoutId));
  const resolution = matchMoveWorkoutCandidate(input.domCandidate, student.id, input.sourceDateIso, liveCandidates);
  return { ok: true, studentId: student.id, resolution };
}
