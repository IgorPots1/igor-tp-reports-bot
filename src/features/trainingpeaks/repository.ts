import { createSupabaseServerClient } from "@/features/supabase/server";

export type TrainingPeaksStudent = {
  id: string;
  studentId: string;
  studentName: string;
  trainingPeaksAthleteUrl: string;
  isActive: boolean;
  weeklyReportEnabled: boolean;
  dataQualityStatus: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksStudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  is_active: boolean;
  weekly_report_enabled: boolean;
  data_quality_status: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type InsertTrainingPeaksStudentInput = {
  studentId: string;
  studentName: string;
  trainingPeaksAthleteUrl: string;
  isActive?: boolean;
  weeklyReportEnabled?: boolean;
  dataQualityStatus?: string | null;
  notes?: string | null;
};

export class TrainingPeaksStudentConflictError extends Error {
  readonly reason: "student_id" | "trainingpeaks_athlete_url";

  constructor(reason: "student_id" | "trainingpeaks_athlete_url") {
    super(`TrainingPeaks student already exists for ${reason}`);
    this.name = "TrainingPeaksStudentConflictError";
    this.reason = reason;
  }
}

export type TrainingPeaksWeeklyReport = {
  id: string;
  studentId: string;
  studentName: string;
  weekFrom: string;
  weekTo: string;
  status: string;
  reportMarkdown: string | null;
  summaryJson: unknown | null;
  warnings: unknown | null;
  syncedAt: string;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksWeeklyReportRow = {
  id: string;
  student_id: string;
  student_name: string;
  week_from: string;
  week_to: string;
  status: string;
  report_markdown: string | null;
  summary_json: unknown | null;
  warnings: unknown | null;
  synced_at: string;
  review_status: string;
  created_at: string;
  updated_at: string;
};

export type TrainingPeaksWeek = {
  weekFrom: string;
  weekTo: string;
};

type TrainingPeaksWeekRow = {
  week_from: string;
  week_to: string;
};

export type TrainingPeaksJobType = "weekly_reports";
export type TrainingPeaksJobStatus = "queued" | "running" | "completed" | "failed";

export type TrainingPeaksJob = {
  id: string;
  jobType: TrainingPeaksJobType;
  status: TrainingPeaksJobStatus;
  weekFrom: string;
  weekTo: string;
  requestedByChatId: string | null;
  requestedByUserId: string | null;
  resultJson: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

type TrainingPeaksJobRow = {
  id: string;
  job_type: TrainingPeaksJobType;
  status: TrainingPeaksJobStatus;
  week_from: string;
  week_to: string;
  requested_by_chat_id: string | null;
  requested_by_user_id: string | null;
  result_json: unknown | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

export type CreateTrainingPeaksWeeklyJobInput = {
  weekFrom: string;
  weekTo: string;
  requestedByChatId?: string | null;
  requestedByUserId?: string | null;
};

export class TrainingPeaksJobConflictError extends Error {
  constructor() {
    super("TrainingPeaks weekly job already queued or running for this week");
    this.name = "TrainingPeaksJobConflictError";
  }
}

function mapTrainingPeaksStudentRow(row: TrainingPeaksStudentRow): TrainingPeaksStudent {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    trainingPeaksAthleteUrl: row.trainingpeaks_athlete_url,
    isActive: row.is_active,
    weeklyReportEnabled: row.weekly_report_enabled,
    dataQualityStatus: row.data_quality_status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksWeeklyReportRow(
  row: TrainingPeaksWeeklyReportRow
): TrainingPeaksWeeklyReport {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    weekFrom: row.week_from,
    weekTo: row.week_to,
    status: row.status,
    reportMarkdown: row.report_markdown,
    summaryJson: row.summary_json,
    warnings: row.warnings,
    syncedAt: row.synced_at,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksWeekRow(row: TrainingPeaksWeekRow): TrainingPeaksWeek {
  return {
    weekFrom: row.week_from,
    weekTo: row.week_to,
  };
}

function mapTrainingPeaksJobRow(row: TrainingPeaksJobRow): TrainingPeaksJob {
  return {
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    weekFrom: row.week_from,
    weekTo: row.week_to,
    requestedByChatId: row.requested_by_chat_id,
    requestedByUserId: row.requested_by_user_id,
    resultJson: row.result_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

function getTrainingPeaksStudentConflictReason(error: {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
  details?: string | null;
}): "student_id" | "trainingpeaks_athlete_url" | null {
  if (error.code !== "23505") {
    return null;
  }

  const haystack = `${error.constraint ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (haystack.includes("trainingpeaks_athlete_url")) {
    return "trainingpeaks_athlete_url";
  }

  if (haystack.includes("student_id")) {
    return "student_id";
  }

  return "student_id";
}

function isTrainingPeaksJobConflict(error: {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
  details?: string | null;
}): boolean {
  if (error.code !== "23505") {
    return false;
  }

  const haystack = `${error.constraint ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return haystack.includes("trainingpeaks_jobs_active_week_idx");
}

export async function insertTrainingPeaksStudent(
  input: InsertTrainingPeaksStudentInput
): Promise<TrainingPeaksStudent> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .insert({
      student_id: input.studentId,
      student_name: input.studentName,
      trainingpeaks_athlete_url: input.trainingPeaksAthleteUrl,
      is_active: input.isActive ?? true,
      weekly_report_enabled: input.weeklyReportEnabled ?? true,
      data_quality_status: input.dataQualityStatus ?? null,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();

  if (error) {
    const conflictReason = getTrainingPeaksStudentConflictReason(error);

    if (conflictReason) {
      throw new TrainingPeaksStudentConflictError(conflictReason);
    }

    throw new Error(`Failed to insert TrainingPeaks student: ${error.message}`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function listTrainingPeaksStudents(): Promise<TrainingPeaksStudent[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks students: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentRow[]) ?? []).map(mapTrainingPeaksStudentRow);
}

export async function disableTrainingPeaksStudentById(id: string): Promise<TrainingPeaksStudent> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update({
      is_active: false,
      weekly_report_enabled: false,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to disable TrainingPeaks student ${id}: ${error.message}`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function getLatestTrainingPeaksWeek(): Promise<TrainingPeaksWeek | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("week_from, week_to")
    .order("week_from", { ascending: false })
    .order("week_to", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get latest TrainingPeaks week: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksWeekRow(data as TrainingPeaksWeekRow);
}

export async function listTrainingPeaksReportsForWeek(
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksWeeklyReport[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("*")
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks reports for ${weekFrom}..${weekTo}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksWeeklyReportRow[]) ?? []).map(mapTrainingPeaksWeeklyReportRow);
}

export async function listAllTrainingPeaksReports(): Promise<TrainingPeaksWeeklyReport[]> {
  const supabase = createSupabaseServerClient();
  const pageSize = 1000;
  const reports: TrainingPeaksWeeklyReport[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("trainingpeaks_weekly_reports")
      .select("*")
      .order("week_from", { ascending: false })
      .order("week_to", { ascending: false })
      .order("synced_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to list TrainingPeaks reports: ${error.message}`);
    }

    const rows = (data as TrainingPeaksWeeklyReportRow[]) ?? [];
    reports.push(...rows.map(mapTrainingPeaksWeeklyReportRow));

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return reports;
}

export async function createTrainingPeaksWeeklyJob(
  input: CreateTrainingPeaksWeeklyJobInput
): Promise<TrainingPeaksJob> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .insert({
      job_type: "weekly_reports",
      status: "queued",
      week_from: input.weekFrom,
      week_to: input.weekTo,
      requested_by_chat_id: input.requestedByChatId ?? null,
      requested_by_user_id: input.requestedByUserId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    if (isTrainingPeaksJobConflict(error)) {
      throw new TrainingPeaksJobConflictError();
    }

    throw new Error(`Failed to create TrainingPeaks weekly job: ${error.message}`);
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export async function listRecentTrainingPeaksJobs(limit = 10): Promise<TrainingPeaksJob[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list TrainingPeaks jobs: ${error.message}`);
  }

  return ((data as TrainingPeaksJobRow[]) ?? []).map(mapTrainingPeaksJobRow);
}

export async function claimNextQueuedTrainingPeaksJob(): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: nextJob, error: selectError } = await supabase
      .from("trainingpeaks_jobs")
      .select("*")
      .eq("job_type", "weekly_reports")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to select next TrainingPeaks job: ${selectError.message}`);
    }

    if (!nextJob) {
      return null;
    }

    const { data: claimedJob, error: claimError } = await supabase
      .from("trainingpeaks_jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        error_message: null,
      })
      .eq("id", nextJob.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim TrainingPeaks job ${nextJob.id}: ${claimError.message}`);
    }

    if (claimedJob) {
      return mapTrainingPeaksJobRow(claimedJob as TrainingPeaksJobRow);
    }
  }

  return null;
}

export async function recoverStaleTrainingPeaksRunningJobs(timeoutMinutes: number): Promise<number> {
  const supabase = createSupabaseServerClient();
  const safeTimeoutMinutes = Math.max(1, Math.floor(timeoutMinutes));
  const cutoff = new Date(Date.now() - safeTimeoutMinutes * 60 * 1000).toISOString();
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: "Job marked failed after stale running timeout",
      result_json: null,
      finished_at: finishedAt,
    })
    .eq("job_type", "weekly_reports")
    .eq("status", "running")
    .not("started_at", "is", null)
    .lt("started_at", cutoff)
    .select("id");

  if (error) {
    throw new Error(`Failed to recover stale TrainingPeaks jobs: ${error.message}`);
  }

  return (data ?? []).length;
}

export async function completeTrainingPeaksJob(jobId: string, result: unknown): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "completed",
      result_json: result,
      error_message: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to complete TrainingPeaks job ${jobId}: ${error.message}`);
  }
}

export async function failTrainingPeaksJob(
  jobId: string,
  errorMessage: string,
  result?: unknown
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      result_json: result ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to fail TrainingPeaks job ${jobId}: ${error.message}`);
  }
}
