import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { parsedRoot, reportsRoot, toolRoot } from "./lib/paths.ts";

type CliArgs = {
  from?: string;
  to?: string;
};

type RawWeeklySummary = {
  student_id: string;
  week: {
    from: string;
    to: string;
  };
  totals: {
    workouts_count: number;
    completed_workouts_count: number;
    total_distance_km: number | null;
    planned_duration_minutes: number | null;
    completed_duration_minutes: number | null;
    total_completed_duration_text: string | null;
    total_planned_duration_text: string | null;
    total_distance_text: string | null;
    data_warnings_count: number;
    intensity_flags_count: number;
  };
  workouts: RawWeeklyWorkout[];
};

type RawWeeklyWorkout = {
  date: string | null;
  title: string | null;
  sport: string | null;
  planned_duration_minutes: number | null;
  completed_duration_minutes: number | null;
  distance_km: number | null;
  planned_distance_km: number | null;
  tss: number | null;
  if: number | null;
  rpe: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_pace_min_per_km: number | null;
  avg_pace_text: string | null;
  duration_text: string | null;
  planned_duration_text: string | null;
  distance_text: string | null;
  intensity_flags: string[];
  data_warnings: string[];
};

type SafeWeeklySummary = {
  student_id: string;
  week: {
    from: string;
    to: string;
  };
  totals: RawWeeklySummary["totals"];
  workouts: SafeWeeklyWorkout[];
};

type SafeWeeklyWorkout = {
  date: string | null;
  title: string | null;
  sport: string | null;
  planned_duration_minutes: number | null;
  completed_duration_minutes: number | null;
  distance_km: number | null;
  planned_distance_km: number | null;
  tss: number | null;
  if: number | null;
  rpe: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_pace_min_per_km: number | null;
  avg_pace_text: string | null;
  duration_text: string | null;
  planned_duration_text: string | null;
  distance_text: string | null;
  intensity_flags: string[];
  data_warnings: string[];
};

type SyncWarnings = {
  data_warnings: string[];
  intensity_flags: string[];
  totals: {
    data_warnings_count: number;
    intensity_flags_count: number;
    workouts_with_data_warnings_count: number;
    workouts_with_intensity_flags_count: number;
  };
};

type CandidateWeek = {
  studentId: string;
  weekKey: string;
  summaryPath: string;
};

type RuntimeStudentRow = {
  student_id: string;
  student_name: string;
  is_active: boolean;
  weekly_report_enabled: boolean;
};

type SyncRow = {
  student_id: string;
  student_name: string;
  week_from: string;
  week_to: string;
  status: string;
  report_markdown: string | null;
  coach_notes_json: unknown | null;
  summary_json: SafeWeeklySummary;
  warnings: SyncWarnings | null;
  synced_at: string;
};

type ExistingWeeklyReportRow = {
  id: string;
  student_id: string;
  week_from: string;
  week_to: string;
  report_markdown: string | null;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-sync-reports",
    "  npm run tp-sync-reports -- --from=2026-04-27 --to=2026-05-03"
  ].join("\n");
}

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readCoachNotesJson(filePath: string): Promise<unknown | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) {
    return;
  }

  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env")
  ];

  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  }

  return value;
}

function assertIsoDate(value: string, flagName: "--from" | "--to"): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flagName} must use YYYY-MM-DD format.`);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<Pick<CliArgs, "from" | "to">> = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (!value) {
      continue;
    }

    if (rawKey === "from" || rawKey === "to") {
      values[rawKey] = value;
    }
  }

  if ((values.from && !values.to) || (!values.from && values.to)) {
    throw new Error(`Provide both --from and --to together.\n\n${usage()}`);
  }

  if (values.from && values.to) {
    assertIsoDate(values.from, "--from");
    assertIsoDate(values.to, "--to");
  }

  return {
    from: values.from,
    to: values.to
  };
}

async function discoverCandidateWeeks(filter?: { from: string; to: string }): Promise<CandidateWeek[]> {
  if (!existsSync(parsedRoot)) {
    return [];
  }

  const studentEntries = await readdir(parsedRoot, { withFileTypes: true });
  const candidates: CandidateWeek[] = [];

  for (const studentEntry of studentEntries) {
    if (!studentEntry.isDirectory()) {
      continue;
    }

    const studentId = studentEntry.name;
    const studentParsedDir = path.join(parsedRoot, studentId);
    const weekEntries = await readdir(studentParsedDir, { withFileTypes: true });

    for (const weekEntry of weekEntries) {
      if (!weekEntry.isDirectory()) {
        continue;
      }

      const weekKey = weekEntry.name;
      if (filter && weekKey !== `${filter.from}_${filter.to}`) {
        continue;
      }

      const summaryPath = path.join(studentParsedDir, weekKey, "weekly-summary.json");
      if (!existsSync(summaryPath)) {
        continue;
      }

      candidates.push({
        studentId,
        weekKey,
        summaryPath
      });
    }
  }

  return candidates.sort((left, right) => {
    const byWeek = left.weekKey.localeCompare(right.weekKey);
    if (byWeek !== 0) {
      return byWeek;
    }

    return left.studentId.localeCompare(right.studentId);
  });
}

function parseSummary(raw: string, summaryPath: string): RawWeeklySummary {
  const parsed = JSON.parse(raw) as Partial<RawWeeklySummary>;

  if (
    typeof parsed.student_id !== "string" ||
    typeof parsed.week?.from !== "string" ||
    typeof parsed.week?.to !== "string" ||
    !parsed.totals ||
    !Array.isArray(parsed.workouts)
  ) {
    throw new Error(`Invalid weekly summary shape: ${summaryPath}`);
  }

  return parsed as RawWeeklySummary;
}

function sanitizeSummary(summary: RawWeeklySummary): SafeWeeklySummary {
  return {
    student_id: summary.student_id,
    week: {
      from: summary.week.from,
      to: summary.week.to
    },
    totals: summary.totals,
    workouts: summary.workouts.map((workout) => ({
      date: workout.date,
      title: workout.title,
      sport: workout.sport,
      planned_duration_minutes: workout.planned_duration_minutes,
      completed_duration_minutes: workout.completed_duration_minutes,
      distance_km: workout.distance_km,
      planned_distance_km: workout.planned_distance_km,
      tss: workout.tss,
      if: workout.if,
      rpe: workout.rpe,
      avg_hr: workout.avg_hr,
      max_hr: workout.max_hr,
      avg_pace_min_per_km: workout.avg_pace_min_per_km,
      avg_pace_text: workout.avg_pace_text,
      duration_text: workout.duration_text,
      planned_duration_text: workout.planned_duration_text,
      distance_text: workout.distance_text,
      intensity_flags: workout.intensity_flags,
      data_warnings: workout.data_warnings
    }))
  };
}

function buildWarnings(summary: RawWeeklySummary): SyncWarnings | null {
  const dataWarnings = new Set<string>();
  const intensityFlags = new Set<string>();
  let workoutsWithDataWarningsCount = 0;
  let workoutsWithIntensityFlagsCount = 0;

  for (const workout of summary.workouts) {
    if (workout.data_warnings.length > 0) {
      workoutsWithDataWarningsCount += 1;
      for (const warning of workout.data_warnings) {
        dataWarnings.add(warning);
      }
    }

    if (workout.intensity_flags.length > 0) {
      workoutsWithIntensityFlagsCount += 1;
      for (const flag of workout.intensity_flags) {
        intensityFlags.add(flag);
      }
    }
  }

  if (dataWarnings.size === 0 && intensityFlags.size === 0) {
    return null;
  }

  return {
    data_warnings: [...dataWarnings].sort(),
    intensity_flags: [...intensityFlags].sort(),
    totals: {
      data_warnings_count: summary.totals.data_warnings_count,
      intensity_flags_count: summary.totals.intensity_flags_count,
      workouts_with_data_warnings_count: workoutsWithDataWarningsCount,
      workouts_with_intensity_flags_count: workoutsWithIntensityFlagsCount
    }
  };
}

function buildWeeklyReportKey(studentId: string, weekFrom: string, weekTo: string): string {
  return `${studentId}::${weekFrom}::${weekTo}`;
}

async function main(): Promise<void> {
  loadLocalEnv();

  const args = parseArgs(process.argv.slice(2));
  const candidates = await discoverCandidateWeeks(
    args.from && args.to ? { from: args.from, to: args.to } : undefined
  );

  if (candidates.length === 0) {
    console.log("[sync] no parsed weekly summaries found");
    return;
  }

  const supabase = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
  const syncedAt = new Date().toISOString();
  const { data: runtimeStudentsData, error: runtimeStudentsError } = await supabase
    .from("trainingpeaks_students")
    .select("student_id, student_name, is_active, weekly_report_enabled");

  if (runtimeStudentsError) {
    throw new Error(`Failed to load TrainingPeaks students from Supabase: ${runtimeStudentsError.message}`);
  }

  const runtimeStudents = new Map<string, RuntimeStudentRow>(
    ((runtimeStudentsData as RuntimeStudentRow[]) ?? []).map((student) => [student.student_id, student] as const)
  );

  const rows: SyncRow[] = [];
  const skippedCandidates: { studentId: string; weekKey: string; reason: string }[] = [];

  for (const { studentId, weekKey, summaryPath } of candidates) {
    const summary = parseSummary(await readFile(summaryPath, "utf8"), summaryPath);
    const runtimeStudent = runtimeStudents.get(summary.student_id);

    if (!runtimeStudent) {
      skippedCandidates.push({
        studentId: summary.student_id,
        weekKey,
        reason: "student missing in Supabase",
      });
      continue;
    }

    if (!runtimeStudent.is_active) {
      skippedCandidates.push({
        studentId: summary.student_id,
        weekKey,
        reason: "student inactive in Supabase",
      });
      continue;
    }

    if (!runtimeStudent.weekly_report_enabled) {
      skippedCandidates.push({
        studentId: summary.student_id,
        weekKey,
        reason: "weekly reports disabled in Supabase",
      });
      continue;
    }

    const reportPath = path.join(reportsRoot, studentId, weekKey, "report-draft.md");
    const coachNotesPath = path.join(reportsRoot, studentId, weekKey, "coach-notes.json");
    const reportMarkdown = existsSync(reportPath) ? await readFile(reportPath, "utf8") : null;
    const coachNotesJson = await readCoachNotesJson(coachNotesPath);

    rows.push({
      student_id: summary.student_id,
      student_name: runtimeStudent.student_name?.trim() || summary.student_id,
      week_from: summary.week.from,
      week_to: summary.week.to,
      status: reportMarkdown ? "ready" : "parsed_only",
      report_markdown: reportMarkdown,
      coach_notes_json: coachNotesJson,
      summary_json: sanitizeSummary(summary),
      warnings: buildWarnings(summary),
      synced_at: syncedAt,
    });
  }

  if (rows.length === 0) {
    console.log("[sync] no reportable students matched Supabase runtime filters");
    for (const skippedCandidate of skippedCandidates) {
      console.log(
        `[sync] skipped student=${skippedCandidate.studentId} week=${skippedCandidate.weekKey} reason=${skippedCandidate.reason}`
      );
    }
    return;
  }

  const studentIds = [...new Set(rows.map((row) => row.student_id))];
  const { data: existingRowsData, error: existingRowsError } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("id, student_id, week_from, week_to, report_markdown")
    .in("student_id", studentIds);

  if (existingRowsError) {
    throw new Error(`Failed to load existing trainingpeaks_weekly_reports: ${existingRowsError.message}`);
  }

  const existingRowsByKey = new Map<string, ExistingWeeklyReportRow>(
    ((existingRowsData as ExistingWeeklyReportRow[]) ?? []).map((row) => [
      buildWeeklyReportKey(row.student_id, row.week_from, row.week_to),
      row
    ] as const)
  );

  const insertRows = rows.filter(
    (row) => !existingRowsByKey.has(buildWeeklyReportKey(row.student_id, row.week_from, row.week_to))
  );

  if (insertRows.length > 0) {
    const { error: insertError } = await supabase.from("trainingpeaks_weekly_reports").insert(insertRows);

    if (insertError) {
      throw new Error(`Failed to insert trainingpeaks_weekly_reports: ${insertError.message}`);
    }
  }

  for (const row of rows) {
    const key = buildWeeklyReportKey(row.student_id, row.week_from, row.week_to);
    const existingRow = existingRowsByKey.get(key);

    if (!existingRow) {
      console.log(
        `[sync] student=${row.student_id} week=${row.week_from}..${row.week_to} inserted new report row`
      );
      continue;
    }

    const reportChanged = existingRow.report_markdown !== row.report_markdown;
    const updatePayload = reportChanged
      ? {
          student_name: row.student_name,
          status: row.status,
          report_markdown: row.report_markdown,
          coach_notes_json: row.coach_notes_json,
          summary_json: row.summary_json,
          warnings: row.warnings,
          synced_at: row.synced_at,
          edited_report_markdown: null,
          edited_at: null,
          review_status: "draft",
          approved_at: null,
          sent_at: null,
          sent_to_chat_id: null,
          delivery_error: null
        }
      : {
          student_name: row.student_name,
          status: row.status,
          report_markdown: row.report_markdown,
          coach_notes_json: row.coach_notes_json,
          summary_json: row.summary_json,
          warnings: row.warnings,
          synced_at: row.synced_at
        };

    const { error: updateError } = await supabase
      .from("trainingpeaks_weekly_reports")
      .update(updatePayload)
      .eq("id", existingRow.id);

    if (updateError) {
      throw new Error(
        `Failed to update trainingpeaks_weekly_reports for ${row.student_id} ${row.week_from}..${row.week_to}: ${updateError.message}`
      );
    }

    if (reportChanged) {
      console.log(
        `[sync] student=${row.student_id} week=${row.week_from}..${row.week_to} report changed, reset review/delivery state`
      );
    } else {
      console.log(
        `[sync] student=${row.student_id} week=${row.week_from}..${row.week_to} report unchanged, preserved review/delivery state`
      );
    }
  }

  console.log(`[sync] synced count=${rows.length}`);
  for (const row of rows) {
    console.log(
      `[sync] student=${row.student_id} week=${row.week_from}..${row.week_to} status=${row.status} report=${row.report_markdown ? "yes" : "no"}`
    );
  }

  for (const skippedCandidate of skippedCandidates) {
    console.log(
      `[sync] skipped student=${skippedCandidate.studentId} week=${skippedCandidate.weekKey} reason=${skippedCandidate.reason}`
    );
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
    console.error("");
    console.error(usage());
  } else {
    console.error(error);
  }

  process.exit(1);
});
