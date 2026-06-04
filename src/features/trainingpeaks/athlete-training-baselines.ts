import { createSupabaseServerClient } from "@/features/supabase/server";

export type AthleteTrainingBaselineRow = {
  id: string;
  student_id: string;
  trainingpeaks_athlete_id: string | null;
  source_report_path: string | null;
  source_from: string;
  source_to: string;
  generated_at: string;
  is_current: boolean;
  frequency_cap: number | null;
  weekly_minutes_cap: number | null;
  long_run_cap_min: number | null;
  quality_count_cap: number | null;
  interval_like_count: number | null;
  confidence: "low" | "medium" | "high";
  needs_review: boolean;
  context_flags: string[];
  family_label_advisory: string | null;
  raw_stats_jsonb: Record<string, unknown>;
  is_manually_overridden: boolean;
  override_frequency_cap: number | null;
  override_weekly_minutes_cap: number | null;
  override_long_run_cap_min: number | null;
  override_quality_count_cap: number | null;
  override_reason: string | null;
  override_by: string | null;
  override_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AthleteTrainingBaselineWithStudentNameRow = AthleteTrainingBaselineRow & {
  student_name: string | null;
};

const BASELINE_SELECT =
  "id, student_id, trainingpeaks_athlete_id, source_report_path, source_from, source_to, generated_at, is_current, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, interval_like_count, confidence, needs_review, context_flags, family_label_advisory, raw_stats_jsonb, is_manually_overridden, override_frequency_cap, override_weekly_minutes_cap, override_long_run_cap_min, override_quality_count_cap, override_reason, override_by, override_at, created_at, updated_at";

export async function listCurrentAthleteTrainingBaselines(): Promise<AthleteTrainingBaselineRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_training_baselines")
    .select(BASELINE_SELECT)
    .eq("is_current", true)
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list current athlete training baselines: ${error.message}`);
  }

  return (data ?? []) as AthleteTrainingBaselineRow[];
}

export async function getCurrentAthleteTrainingBaseline(studentId: string): Promise<AthleteTrainingBaselineRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_training_baselines")
    .select(BASELINE_SELECT)
    .eq("student_id", studentId)
    .eq("is_current", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get current athlete training baseline for ${studentId}: ${error.message}`);
  }

  return (data as AthleteTrainingBaselineRow | null) ?? null;
}

export async function listAthletesNeedingBaselineReview(): Promise<AthleteTrainingBaselineRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_training_baselines")
    .select(BASELINE_SELECT)
    .eq("is_current", true)
    .eq("needs_review", true)
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list athletes needing baseline review: ${error.message}`);
  }

  return (data ?? []) as AthleteTrainingBaselineRow[];
}

export async function listCurrentAthleteTrainingBaselinesWithStudentNames(): Promise<
  AthleteTrainingBaselineWithStudentNameRow[]
> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_training_baselines")
    .select(`${BASELINE_SELECT}, trainingpeaks_students(student_name)`)
    .eq("is_current", true)
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list current athlete training baselines with student names: ${error.message}`);
  }

  return (
    (data as Array<
      AthleteTrainingBaselineRow & {
        trainingpeaks_students?: { student_name?: string | null } | Array<{ student_name?: string | null }> | null;
      }
    > | null) ?? []
  ).map((row) => {
    const joinedStudent = Array.isArray(row.trainingpeaks_students)
      ? row.trainingpeaks_students[0]
      : row.trainingpeaks_students;

    return {
      ...row,
      student_name: joinedStudent?.student_name?.trim() || null,
    };
  });
}

export async function listAthletesNeedingBaselineReviewWithStudentNames(): Promise<
  AthleteTrainingBaselineWithStudentNameRow[]
> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_training_baselines")
    .select(`${BASELINE_SELECT}, trainingpeaks_students(student_name)`)
    .eq("is_current", true)
    .eq("needs_review", true)
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list athletes needing baseline review with student names: ${error.message}`);
  }

  return (
    (data as Array<
      AthleteTrainingBaselineRow & {
        trainingpeaks_students?: { student_name?: string | null } | Array<{ student_name?: string | null }> | null;
      }
    > | null) ?? []
  ).map((row) => {
    const joinedStudent = Array.isArray(row.trainingpeaks_students)
      ? row.trainingpeaks_students[0]
      : row.trainingpeaks_students;

    return {
      ...row,
      student_name: joinedStudent?.student_name?.trim() || null,
    };
  });
}
