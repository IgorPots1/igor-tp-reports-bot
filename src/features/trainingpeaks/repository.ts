import { createSupabaseServerClient } from "@/features/supabase/server";

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

  return (data as TrainingPeaksWeeklyReportRow[]).map(mapTrainingPeaksWeeklyReportRow);
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
