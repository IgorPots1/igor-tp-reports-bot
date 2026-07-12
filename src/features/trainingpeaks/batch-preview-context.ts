import {
  createSupabaseServerClient,
  withSupabaseNetworkRetry,
} from "@/features/supabase/server";
import { getCurrentAthleteTrainingBaseline } from "@/features/trainingpeaks/athlete-training-baselines";
import {
  RACE_PROXIMITY_MAX_DAYS,
  readChildAthleteId,
  readChildWorkoutDay,
  type BatchAnomalyContext,
} from "@/features/trainingpeaks/batch-preview";
import {
  getTrainingPeaksStudentByAthleteId,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  listUpcomingTrainingPeaksRaceEvents,
} from "@/features/trainingpeaks/repository";
import type { BatchChildSpec } from "@/features/trainingpeaks/tp-write-action-types";

/**
 * PR4 step 4 -- the impure half of batch-preview.ts: the ONE function that
 * calls the 4 existing data sources (race events, workout cache, training
 * baselines, operational signals) to build the context
 * detectBatchAnomalies() needs. Kept in its own file so batch-preview.ts's
 * pure logic stays testable under plain node without a live Supabase
 * connection (see batch-preview.ts's docstring).
 */

const HEALTH_SIGNAL_TYPES = ["health_issue_started", "health_issue_resolved", "health_issue_improving", "pain_injury"];

async function hasActiveHealthSignal(studentId: string): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("trainingpeaks_student_operational_signals")
      .select("id")
      .eq("student_id", studentId)
      .eq("status", "active")
      .in("signal_type", HEALTH_SIGNAL_TYPES)
      .limit(1),
  );
  if (error) throw new Error(`Failed to check active health signals for student ${studentId}: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function gatherBatchAnomalyContext(children: BatchChildSpec[]): Promise<BatchAnomalyContext> {
  const athleteIds = Array.from(
    new Set(children.map((child) => readChildAthleteId(child.payload)).filter((value): value is number => value !== null)),
  );
  const workoutDays = children.map(readChildWorkoutDay).filter((value): value is string => Boolean(value)).sort();

  const studentNameByAthleteId = new Map<number, string | null>();
  const studentIdByAthleteId = new Map<number, string>();
  for (const athleteId of athleteIds) {
    const student = await getTrainingPeaksStudentByAthleteId(athleteId);
    studentNameByAthleteId.set(athleteId, student?.studentName ?? null);
    if (student) studentIdByAthleteId.set(athleteId, student.id);
  }

  const raceDatesByAthleteId = new Map<number, string[]>();
  const existingWorkoutDatesByAthleteId = new Map<number, Set<string>>();
  const weeklyMinutesCapByAthleteId = new Map<number, number | null>();
  const hasActiveHealthSignalByAthleteId = new Map<number, boolean>();

  if (workoutDays.length > 0) {
    const fromDate = workoutDays[0];
    const toDateObj = new Date(`${workoutDays[workoutDays.length - 1]}T00:00:00Z`);
    toDateObj.setUTCDate(toDateObj.getUTCDate() + RACE_PROXIMITY_MAX_DAYS);
    const toDate = toDateObj.toISOString().slice(0, 10);
    const races = await listUpcomingTrainingPeaksRaceEvents({ fromDate, toDate });
    for (const [athleteId, studentId] of studentIdByAthleteId) {
      const dates = races.filter((race) => race.studentId === studentId).map((race) => race.eventDate);
      if (dates.length > 0) raceDatesByAthleteId.set(athleteId, dates);
    }
  }

  for (const [athleteId, studentId] of studentIdByAthleteId) {
    if (workoutDays.length > 0) {
      const cache = await listTrainingPeaksWorkoutCacheForStudentDateRange({
        studentId,
        from: workoutDays[0],
        to: workoutDays[workoutDays.length - 1],
      });
      existingWorkoutDatesByAthleteId.set(athleteId, new Set(cache.map((row) => row.workoutDate)));
    }

    const baseline = await getCurrentAthleteTrainingBaseline(studentId);
    const cap = baseline
      ? (baseline.is_manually_overridden ? baseline.override_weekly_minutes_cap : baseline.weekly_minutes_cap)
      : null;
    weeklyMinutesCapByAthleteId.set(athleteId, cap);

    hasActiveHealthSignalByAthleteId.set(athleteId, await hasActiveHealthSignal(studentId));
  }

  return {
    studentNameByAthleteId,
    raceDatesByAthleteId,
    existingWorkoutDatesByAthleteId,
    weeklyMinutesCapByAthleteId,
    hasActiveHealthSignalByAthleteId,
  };
}
