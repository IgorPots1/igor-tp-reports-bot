import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type {
  TrainingPeaksHealthMetricCacheRow,
  TrainingPeaksStudentHealthMetricProfile,
  TrainingPeaksStudent,
  ListTrainingPeaksStudentHealthMetricProfilesInput,
} from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { toolRoot } from "./lib/paths.ts";
import { readStudentsConfig } from "./lib/students.ts";
import {
  buildTrainingPeaksRecoverySummary,
  type RecoverySummaryResult,
} from "./lib/trainingpeaks-recovery-summary.ts";

const OUTPUT_DIR = path.join(toolRoot, "debug", "health-metrics-cache-report");
const OUTPUT_JSON = path.join(OUTPUT_DIR, "report.json");
const OUTPUT_MD = path.join(OUTPUT_DIR, "report.md");

type CliArgs = {
  from: string;
  to: string;
  student: string | null;
  allEligible: boolean;
};

type MetricCoverage = {
  metric_key: string;
  rows_count: number;
  distinct_metric_dates: number;
  day_coverage_ratio: number;
  first_date: string | null;
  last_date: string | null;
};

type WeeklyRecoverySummary = {
  avg_sleep_hours: number | null;
  nights_sleep_lt_6h: number;
  nights_sleep_lt_7h: number;
  avg_hrv: number | null;
  avg_pulse: number | null;
  avg_body_battery: number | null;
  avg_stress_level: number | null;
};

type StudentSummary = {
  student_id: string;
  student_name: string;
  status: TrainingPeaksStudentHealthMetricProfile["status"];
  recovery_metrics_enabled: boolean;
  rows_count: number;
  metric_keys_found: string[];
  coverage_per_key: MetricCoverage[];
  first_metric_date: string | null;
  last_metric_date: string | null;
  weekly_recovery_summary: WeeklyRecoverySummary;
  recovery_summary: RecoverySummaryResult;
};

type ReportArtifact = {
  run_at: string;
  range: {
    from: string;
    to: string;
    days: number;
  };
  filters: {
    student: string | null;
    all_eligible: boolean;
  };
  selected_students_count: number;
  selected_students: Array<{
    student_id: string;
    student_name: string;
    status: TrainingPeaksStudentHealthMetricProfile["status"];
    recovery_metrics_enabled: boolean;
  }>;
  students: StudentSummary[];
  output_paths: {
    report_json: string;
    report_md: string;
  };
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  listTrainingPeaksStudentHealthMetricProfiles?: (
    input?: ListTrainingPeaksStudentHealthMetricProfilesInput
  ) => Promise<TrainingPeaksStudentHealthMetricProfile[]>;
  listTrainingPeaksHealthMetricsForStudentDateRange?: (input: {
    studentId: string;
    from: string;
    to: string;
    metricKey?: string;
  }) => Promise<TrainingPeaksHealthMetricCacheRow[]>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    listTrainingPeaksStudentHealthMetricProfiles?: (
      input?: ListTrainingPeaksStudentHealthMetricProfilesInput
    ) => Promise<TrainingPeaksStudentHealthMetricProfile[]>;
    listTrainingPeaksHealthMetricsForStudentDateRange?: (input: {
      studentId: string;
      from: string;
      to: string;
      metricKey?: string;
    }) => Promise<TrainingPeaksHealthMetricCacheRow[]>;
  };
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function diffDaysInclusive(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay) + 1;
}

function normalizeMatchValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function addLookupToken(tokens: Set<string>, value: string | null | undefined): void {
  if (!value) {
    return;
  }
  const normalized = normalizeMatchValue(value);
  if (!normalized) {
    return;
  }
  tokens.add(normalized);
}

function parseArgs(argv: string[]): CliArgs {
  let from: string | null = null;
  let to: string | null = null;
  let student: string | null = null;
  let allEligible = false;

  for (const arg of argv) {
    if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg.startsWith("--student=")) {
      const raw = arg.slice("--student=".length).trim();
      student = raw || null;
      continue;
    }
    if (arg === "--all-eligible") {
      allEligible = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!from || !to) {
    throw new Error("Provide --from=YYYY-MM-DD and --to=YYYY-MM-DD.");
  }
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new Error(`Invalid date range (${from}..${to}). Expected YYYY-MM-DD.`);
  }
  if (from > to) {
    throw new Error(`Invalid date range: --from (${from}) is after --to (${to}).`);
  }
  if (student && allEligible) {
    throw new Error("Do not combine --student with --all-eligible.");
  }

  return { from, to, student, allEligible };
}

async function loadDotEnvFile(dotEnvPath: string): Promise<void> {
  if (!existsSync(dotEnvPath)) {
    return;
  }
  const content = await readFile(dotEnvPath, "utf8");

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

async function loadLocalEnv(): Promise<void> {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ];
  for (const envPath of envPaths) {
    await loadDotEnvFile(envPath);
  }
}

function pickNumericMetricValue(row: TrainingPeaksHealthMetricCacheRow): number | null {
  if (typeof row.valueAvgNumeric === "number" && Number.isFinite(row.valueAvgNumeric)) {
    return row.valueAvgNumeric;
  }
  if (typeof row.valueNumeric === "number" && Number.isFinite(row.valueNumeric)) {
    return row.valueNumeric;
  }
  return null;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Number((sum / values.length).toFixed(3));
}

function computeMetricCoverage(rows: TrainingPeaksHealthMetricCacheRow[], rangeDays: number): MetricCoverage[] {
  const byKey = new Map<string, { rows: number; dates: Set<string> }>();
  for (const row of rows) {
    const current = byKey.get(row.metricKey) ?? { rows: 0, dates: new Set<string>() };
    current.rows += 1;
    current.dates.add(row.metricDate);
    byKey.set(row.metricKey, current);
  }

  return [...byKey.entries()]
    .map(([metricKey, value]) => {
      const orderedDates = [...value.dates].sort();
      return {
        metric_key: metricKey,
        rows_count: value.rows,
        distinct_metric_dates: orderedDates.length,
        day_coverage_ratio: Number((orderedDates.length / rangeDays).toFixed(4)),
        first_date: orderedDates[0] ?? null,
        last_date: orderedDates.at(-1) ?? null,
      };
    })
    .sort((a, b) => a.metric_key.localeCompare(b.metric_key));
}

function computeWeeklyRecoverySummary(rows: TrainingPeaksHealthMetricCacheRow[]): WeeklyRecoverySummary {
  const sleepValues: number[] = [];
  const sleepByDate = new Map<string, number[]>();
  const hrvValues: number[] = [];
  const pulseValues: number[] = [];
  const bodyBatteryValues: number[] = [];
  const stressLevelValues: number[] = [];

  for (const row of rows) {
    const value = pickNumericMetricValue(row);
    if (value === null) {
      continue;
    }

    if (row.metricKey === "sleep_hours") {
      sleepValues.push(value);
      const perDay = sleepByDate.get(row.metricDate) ?? [];
      perDay.push(value);
      sleepByDate.set(row.metricDate, perDay);
      continue;
    }
    if (row.metricKey === "hrv") {
      hrvValues.push(value);
      continue;
    }
    if (row.metricKey === "pulse") {
      pulseValues.push(value);
      continue;
    }
    if (row.metricKey === "body_battery") {
      bodyBatteryValues.push(value);
      continue;
    }
    if (row.metricKey === "stress_level") {
      stressLevelValues.push(value);
    }
  }

  const nightlySleepAverages = [...sleepByDate.values()].map((values) => average(values) ?? 0);
  const nightsSleepLt6h = nightlySleepAverages.filter((value) => value < 6).length;
  const nightsSleepLt7h = nightlySleepAverages.filter((value) => value < 7).length;

  return {
    avg_sleep_hours: average(sleepValues),
    nights_sleep_lt_6h: nightsSleepLt6h,
    nights_sleep_lt_7h: nightsSleepLt7h,
    avg_hrv: average(hrvValues),
    avg_pulse: average(pulseValues),
    avg_body_battery: average(bodyBatteryValues),
    avg_stress_level: average(stressLevelValues),
  };
}

function summarizeStudent(input: {
  profile: TrainingPeaksStudentHealthMetricProfile;
  rows: TrainingPeaksHealthMetricCacheRow[];
  rangeDays: number;
}): StudentSummary {
  const { profile, rows, rangeDays } = input;
  const metricKeys = [...new Set(rows.map((row) => row.metricKey))].sort((a, b) => a.localeCompare(b));
  const metricDates = [...new Set(rows.map((row) => row.metricDate))].sort();
  const recoverySummary = buildTrainingPeaksRecoverySummary({
    studentName: profile.studentName,
    from: metricDates[0] ?? "",
    to: metricDates.at(-1) ?? "",
    profile: {
      status: profile.status,
      recovery_metrics_enabled: profile.recoveryMetricsEnabled,
    },
    metrics: rows.map((row) => ({
      metric_key: row.metricKey,
      metric_date: row.metricDate,
      value_numeric: row.valueNumeric,
      value_avg_numeric: row.valueAvgNumeric,
    })),
    baseline: null,
  });

  return {
    student_id: profile.studentId,
    student_name: profile.studentName,
    status: profile.status,
    recovery_metrics_enabled: profile.recoveryMetricsEnabled,
    rows_count: rows.length,
    metric_keys_found: metricKeys,
    coverage_per_key: computeMetricCoverage(rows, rangeDays),
    first_metric_date: metricDates[0] ?? null,
    last_metric_date: metricDates.at(-1) ?? null,
    weekly_recovery_summary: computeWeeklyRecoverySummary(rows),
    recovery_summary: recoverySummary,
  };
}

async function resolveProfiles(
  profiles: TrainingPeaksStudentHealthMetricProfile[],
  args: CliArgs,
  students: TrainingPeaksStudent[]
): Promise<TrainingPeaksStudentHealthMetricProfile[]> {
  if (args.student) {
    const lookupTokens = new Set<string>();
    addLookupToken(lookupTokens, args.student);

    const studentsConfig = await readStudentsConfig().catch(() => []);
    for (const student of studentsConfig) {
      const matchesInput =
        normalizeMatchValue(student.student_id) === normalizeMatchValue(args.student) ||
        normalizeMatchValue(student.name ?? "") === normalizeMatchValue(args.student);
      if (!matchesInput) {
        continue;
      }
      addLookupToken(lookupTokens, student.student_id);
      addLookupToken(lookupTokens, student.name);
    }

    for (const student of students) {
      const studentTokens = [
        normalizeMatchValue(student.id),
        normalizeMatchValue(student.studentId),
        normalizeMatchValue(student.studentName),
      ];
      if (studentTokens.some((token) => lookupTokens.has(token))) {
        addLookupToken(lookupTokens, student.studentId);
        addLookupToken(lookupTokens, student.studentName);
        addLookupToken(lookupTokens, student.id);
      }
    }

    const matched = profiles.filter((profile) => {
      const profileIdToken = normalizeMatchValue(profile.studentId);
      const profileNameToken = normalizeMatchValue(profile.studentName);
      return lookupTokens.has(profileIdToken) || lookupTokens.has(profileNameToken);
    });
    if (matched.length === 0) {
      throw new Error(`No eligible profile matched --student="${args.student}".`);
    }
    if (matched.length > 1) {
      const sample = matched.slice(0, 5).map((profile) => `${profile.studentName} (${profile.studentId})`);
      throw new Error(`Multiple eligible profiles matched --student="${args.student}": ${sample.join(", ")}`);
    }
    return matched;
  }

  if (args.allEligible) {
    return profiles;
  }

  return profiles;
}

function formatCompactValue(value: number | null): string {
  return value === null ? "n/a" : `${value}`;
}

function printCompactReport(input: {
  from: string;
  to: string;
  selectedStudents: TrainingPeaksStudentHealthMetricProfile[];
  summaries: StudentSummary[];
}): void {
  console.log("Health metrics cache report");
  console.log(`Range: ${input.from}..${input.to}`);
  console.log(`Selected students: ${input.selectedStudents.length}`);
  console.log("");

  if (input.summaries.length === 0) {
    console.log("No eligible students found for this filter.");
    return;
  }

  for (const summary of input.summaries) {
    console.log(
      `- ${summary.student_name} (${summary.student_id}): status=${summary.status}, recovery_metrics_enabled=${summary.recovery_metrics_enabled}, rows=${summary.rows_count}, dates=${summary.first_metric_date ?? "n/a"}..${summary.last_metric_date ?? "n/a"}`
    );
    console.log(
      `  keys=${summary.metric_keys_found.length > 0 ? summary.metric_keys_found.join(", ") : "(none)"}`
    );
    console.log(
      `  weekly: avg_sleep_hours=${formatCompactValue(summary.weekly_recovery_summary.avg_sleep_hours)}, nights_lt_6h=${summary.weekly_recovery_summary.nights_sleep_lt_6h}, nights_lt_7h=${summary.weekly_recovery_summary.nights_sleep_lt_7h}, avg_hrv=${formatCompactValue(summary.weekly_recovery_summary.avg_hrv)}, avg_pulse=${formatCompactValue(summary.weekly_recovery_summary.avg_pulse)}, avg_body_battery=${formatCompactValue(summary.weekly_recovery_summary.avg_body_battery)}, avg_stress_level=${formatCompactValue(summary.weekly_recovery_summary.avg_stress_level)}`
    );
    console.log(
      `  recovery_summary: status=${summary.recovery_summary.status}, signals=${Object.entries(
        summary.recovery_summary.signals
      )
        .filter(([, value]) => value)
        .map(([key]) => key)
        .join(", ") || "(none)"}`
    );
    console.log(`  recovery_text: ${summary.recovery_summary.text.replace(/\n/g, " | ")}`);
  }
}

function createMarkdown(report: ReportArtifact): string {
  const lines: string[] = [];
  lines.push("# TrainingPeaks health metrics cache report");
  lines.push("");
  lines.push(`- run_at: \`${report.run_at}\``);
  lines.push(`- range: \`${report.range.from}\` -> \`${report.range.to}\` (${report.range.days} days)`);
  lines.push(`- selected_students: **${report.selected_students_count}**`);
  lines.push(`- filter_student: \`${report.filters.student ?? ""}\``);
  lines.push(`- all_eligible: \`${report.filters.all_eligible}\``);
  lines.push("");
  lines.push("## Per-student");
  for (const student of report.students) {
    lines.push(
      `- ${student.student_name} (${student.student_id}): status=${student.status}, recovery_metrics_enabled=${student.recovery_metrics_enabled}, rows=${student.rows_count}, keys=${student.metric_keys_found.join(", ") || "(none)"}, date_range=${student.first_metric_date ?? "n/a"}..${student.last_metric_date ?? "n/a"}`
    );
    lines.push(
      `  - weekly: avg_sleep_hours=${formatCompactValue(student.weekly_recovery_summary.avg_sleep_hours)}, nights_sleep_lt_6h=${student.weekly_recovery_summary.nights_sleep_lt_6h}, nights_sleep_lt_7h=${student.weekly_recovery_summary.nights_sleep_lt_7h}, avg_hrv=${formatCompactValue(student.weekly_recovery_summary.avg_hrv)}, avg_pulse=${formatCompactValue(student.weekly_recovery_summary.avg_pulse)}, avg_body_battery=${formatCompactValue(student.weekly_recovery_summary.avg_body_battery)}, avg_stress_level=${formatCompactValue(student.weekly_recovery_summary.avg_stress_level)}`
    );
    lines.push(
      `  - recovery_summary: status=${student.recovery_summary.status}, signals=${Object.entries(
        student.recovery_summary.signals
      )
        .filter(([, value]) => value)
        .map(([key]) => key)
        .join(", ") || "(none)"}`
    );
    lines.push(`  - recovery_text: ${student.recovery_summary.text.replace(/\n/g, " | ")}`);
  }
  lines.push("");
  lines.push("## Artifacts");
  lines.push(`- report_json: \`${report.output_paths.report_json}\``);
  lines.push(`- report_md: \`${report.output_paths.report_md}\``);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  await loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const rangeDays = diffDaysInclusive(args.from, args.to);

  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn = repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const listProfilesFn =
    repoCompat.listTrainingPeaksStudentHealthMetricProfiles ??
    repoCompat.default?.listTrainingPeaksStudentHealthMetricProfiles;
  const listCacheFn =
    repoCompat.listTrainingPeaksHealthMetricsForStudentDateRange ??
    repoCompat.default?.listTrainingPeaksHealthMetricsForStudentDateRange;

  if (!listStudentsFn || !listProfilesFn || !listCacheFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const students = await listStudentsFn();
  const eligibleProfiles = await listProfilesFn({ recoveryMetricsEnabled: true });
  const selectedProfiles = (await resolveProfiles(eligibleProfiles, args, students)).sort((a, b) =>
    a.studentName.localeCompare(b.studentName)
  );

  const summaries: StudentSummary[] = [];
  for (const profile of selectedProfiles) {
    const rows = await listCacheFn({
      studentId: profile.studentId,
      from: args.from,
      to: args.to,
    });
    summaries.push(summarizeStudent({ profile, rows, rangeDays }));
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const artifact: ReportArtifact = {
    run_at: new Date().toISOString(),
    range: {
      from: args.from,
      to: args.to,
      days: rangeDays,
    },
    filters: {
      student: args.student,
      all_eligible: args.allEligible,
    },
    selected_students_count: selectedProfiles.length,
    selected_students: selectedProfiles.map((profile) => ({
      student_id: profile.studentId,
      student_name: profile.studentName,
      status: profile.status,
      recovery_metrics_enabled: profile.recoveryMetricsEnabled,
    })),
    students: summaries,
    output_paths: {
      report_json: OUTPUT_JSON,
      report_md: OUTPUT_MD,
    },
  };

  await writeFile(OUTPUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_MD, createMarkdown(artifact), "utf8");

  printCompactReport({
    from: args.from,
    to: args.to,
    selectedStudents: selectedProfiles,
    summaries,
  });
  console.log("");
  console.log(`report_json: ${OUTPUT_JSON}`);
  console.log(`report_md: ${OUTPUT_MD}`);
}

main().catch((error: unknown) => {
  console.error("tp-health-metrics-cache-report failed.");
  console.error(error);
  process.exit(1);
});
