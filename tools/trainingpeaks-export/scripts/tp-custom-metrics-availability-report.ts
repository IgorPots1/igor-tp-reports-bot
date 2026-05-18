import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium, type BrowserContext, type Page } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { readStudentsConfig, type StudentConfig } from "./lib/students.ts";
import { normalizeTrainingPeaksCustomMetricsPayload } from "./lib/trainingpeaks-custom-metrics-normalization.ts";
import { captureSessionAuth } from "./lib/trainingpeaks-api-move.ts";

const APP_HOST = "https://app.trainingpeaks.com";
const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const OUTPUT_DIR = path.join(toolRoot, "debug", "custom-metrics-availability");
const OUTPUT_JSON = path.join(OUTPUT_DIR, "report.json");
const OUTPUT_MD = path.join(OUTPUT_DIR, "report.md");

const PRIMARY_KEYS = ["hrv", "sleep_hours", "pulse", "body_battery", "stress_level", "weight_kg"] as const;
const RECOVERY_KEYS = ["sleep_hours", "hrv", "pulse"] as const;

type CliArgs = {
  from: string;
  to: string;
  studentFilter: string | null;
  days: number | null;
  headless: boolean;
};

type StudentStatus = "ok_with_metrics" | "ok_no_metrics" | "partial_metrics" | "failed" | "skipped_no_athlete_id";
type RecoveryReadiness = "ready_for_recovery_report" | "partial" | "not_ready";

type MetricCoverage = {
  metric_key: string;
  rows_count: number;
  distinct_metric_dates: number;
  first_date: string | null;
  last_date: string | null;
  day_coverage_ratio: number;
};

type StudentReport = {
  student_id: string;
  student_name: string | null;
  trainingpeaks_athlete_id: number | null;
  status: StudentStatus;
  failure_message: string | null;
  http_status: number | null;
  normalized_rows_count: number;
  metric_coverage: MetricCoverage[];
  has_hrv: boolean;
  has_sleep_hours: boolean;
  has_pulse: boolean;
  has_body_battery: boolean;
  has_stress_level: boolean;
  has_weight: boolean;
  recovery_min_days_required: number;
  recovery_metric_days: Record<string, number>;
  recovery_readiness: RecoveryReadiness;
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
    days: number | null;
  };
  selected_students_count: number;
  selected_students: Array<{ student_id: string; name: string | null; athlete_id: number | null }>;
  summary: Record<StudentStatus, number>;
  students: StudentReport[];
  output_paths: {
    report_json: string;
    report_md: string;
  };
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toIsoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseAthleteIdFromUrl(athleteUrl: string): number | null {
  const match = athleteUrl.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeStudentFilter(value: string): string {
  return value.trim().toLowerCase();
}

function diffDaysInclusive(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay) + 1;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: Partial<CliArgs> = {
    studentFilter: null,
    days: null,
    headless: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg.startsWith("--student=")) {
      const value = arg.slice("--student=".length).trim();
      parsed.studentFilter = value || null;
      continue;
    }
    if (arg.startsWith("--days=")) {
      const value = Number(arg.slice("--days=".length).trim());
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid --days value "${arg}".`);
      }
      parsed.days = value;
      continue;
    }
    if (arg === "--headless") {
      parsed.headless = true;
      continue;
    }
    if (arg === "--headed") {
      parsed.headless = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.from || !parsed.to) {
    if (!parsed.days) {
      throw new Error("Provide --from=YYYY-MM-DD and --to=YYYY-MM-DD, or use --days=<N>.");
    }
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime());
    fromDate.setUTCDate(fromDate.getUTCDate() - parsed.days + 1);
    parsed.to = toIsoDateUtc(toDate);
    parsed.from = toIsoDateUtc(fromDate);
  }

  if (!parsed.from || !isIsoDate(parsed.from)) {
    throw new Error(`Invalid --from date "${parsed.from}". Expected YYYY-MM-DD.`);
  }
  if (!parsed.to || !isIsoDate(parsed.to)) {
    throw new Error(`Invalid --to date "${parsed.to}". Expected YYYY-MM-DD.`);
  }
  if (parsed.from > parsed.to) {
    throw new Error(`Invalid range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }

  return parsed as CliArgs;
}

function selectStudents(students: StudentConfig[], args: CliArgs): StudentConfig[] {
  const activeOnly = students.filter((student) => student.is_active !== false);
  if (!args.studentFilter) {
    return activeOnly;
  }
  const wanted = normalizeStudentFilter(args.studentFilter);
  return activeOnly.filter((student) => {
    const idMatch = normalizeStudentFilter(student.student_id) === wanted;
    const nameMatch = student.name ? normalizeStudentFilter(student.name) === wanted : false;
    return idMatch || nameMatch;
  });
}

function computeCoverage(rows: ReturnType<typeof normalizeTrainingPeaksCustomMetricsPayload>, rangeDays: number): MetricCoverage[] {
  const byKey = new Map<string, { rows: number; days: Set<string> }>();
  for (const row of rows) {
    const existing = byKey.get(row.metricKey) ?? { rows: 0, days: new Set<string>() };
    existing.rows += 1;
    existing.days.add(row.metricDate);
    byKey.set(row.metricKey, existing);
  }

  return [...byKey.entries()]
    .map(([metricKey, value]) => {
      const dates = [...value.days].sort();
      return {
        metric_key: metricKey,
        rows_count: value.rows,
        distinct_metric_dates: dates.length,
        first_date: dates[0] ?? null,
        last_date: dates.at(-1) ?? null,
        day_coverage_ratio: Number((dates.length / rangeDays).toFixed(4)),
      };
    })
    .sort((a, b) => a.metric_key.localeCompare(b.metric_key));
}

function createMarkdown(report: ReportArtifact): string {
  const lines: string[] = [];
  lines.push("# TrainingPeaks custom metrics availability");
  lines.push("");
  lines.push(`- run_at: \`${report.run_at}\``);
  lines.push(`- range: \`${report.range.from}\` -> \`${report.range.to}\` (${report.range.days} days)`);
  lines.push(`- selected_students: **${report.selected_students_count}**`);
  lines.push(
    `- status_counts: ok_with_metrics=${report.summary.ok_with_metrics}, ok_no_metrics=${report.summary.ok_no_metrics}, partial_metrics=${report.summary.partial_metrics}, failed=${report.summary.failed}, skipped_no_athlete_id=${report.summary.skipped_no_athlete_id}`,
  );
  lines.push("");
  lines.push("## Per-student");

  for (const student of report.students) {
    lines.push(
      `- ${student.student_id} (${student.trainingpeaks_athlete_id ?? "no-athlete-id"}): status=${student.status}, readiness=${student.recovery_readiness}, rows=${student.normalized_rows_count}, sleep_days=${student.recovery_metric_days.sleep_hours}, hrv_days=${student.recovery_metric_days.hrv}, pulse_days=${student.recovery_metric_days.pulse}`,
    );
  }

  lines.push("");
  lines.push("## Artifacts");
  lines.push(`- report_json: \`${report.output_paths.report_json}\``);
  lines.push(`- report_md: \`${report.output_paths.report_md}\``);
  return `${lines.join("\n")}\n`;
}

async function fetchCustomMetrics(input: {
  page: Page;
  athleteId: number;
  from: string;
  to: string;
  authHeader: string | null;
  sampleHeaders: Record<string, string>;
}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const endpoint = `${TP_API_HOST}/metrics/v3/athletes/${input.athleteId}/consolidatedtimedmetrics/${input.from}/${input.to}`;
  const headers: Record<string, string> = {
    accept: "application/json, text/csv, text/plain, */*",
    "x-requested-with": "XMLHttpRequest",
  };
  if (input.authHeader) {
    headers.authorization = input.authHeader;
  }
  const referer = input.sampleHeaders.referer;
  headers.referer =
    typeof referer === "string" && referer.trim()
      ? referer
      : `${APP_HOST}/#calendar/athletes/${input.athleteId}`;
  const origin = input.sampleHeaders.origin;
  headers.origin = typeof origin === "string" && origin.trim() ? origin : APP_HOST;

  const response = await input.page.request.fetch(endpoint, {
    method: "GET",
    headers,
    failOnStatusCode: false,
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  return { ok: response.ok(), status: response.status(), body };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rangeDays = diffDaysInclusive(args.from, args.to);
  const recoveryThreshold = Math.max(1, Math.ceil((rangeDays * 4) / 7));

  const students = await readStudentsConfig();
  const selectedStudents = selectStudents(students, args);

  await mkdir(profileDir, { recursive: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`[tp-custom-metrics-availability-report] from=${args.from} to=${args.to} (${rangeDays} days)`);
  console.log(`[tp-custom-metrics-availability-report] selected_students=${selectedStudents.length}`);

  const context: BrowserContext = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  const studentsReport: StudentReport[] = [];

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    const authAthlete = selectedStudents
      .map((student) => parseAthleteIdFromUrl(student.trainingpeaks_athlete_url))
      .find((value): value is number => value !== null);

    let authHeader: string | null = null;
    let sampleHeaders: Record<string, string> = {};
    if (authAthlete) {
      const auth = await captureSessionAuth({ context, page, athleteId: authAthlete });
      authHeader = auth.authorizationHeader;
      sampleHeaders = auth.sampleHeaders;
    }

    for (const student of selectedStudents) {
      const athleteId = parseAthleteIdFromUrl(student.trainingpeaks_athlete_url);
      const studentLabel = student.name ? `${student.student_id} (${student.name})` : student.student_id;

      if (!athleteId) {
        studentsReport.push({
          student_id: student.student_id,
          student_name: student.name ?? null,
          trainingpeaks_athlete_id: null,
          status: "skipped_no_athlete_id",
          failure_message: "missing trainingpeaks athlete id in URL",
          http_status: null,
          normalized_rows_count: 0,
          metric_coverage: [],
          has_hrv: false,
          has_sleep_hours: false,
          has_pulse: false,
          has_body_battery: false,
          has_stress_level: false,
          has_weight: false,
          recovery_min_days_required: recoveryThreshold,
          recovery_metric_days: { sleep_hours: 0, hrv: 0, pulse: 0 },
          recovery_readiness: "not_ready",
        });
        console.log(`[student] ${studentLabel}: skipped_no_athlete_id`);
        continue;
      }

      let response: { ok: boolean; status: number; body: unknown };
      try {
        response = await fetchCustomMetrics({
          page,
          athleteId,
          from: args.from,
          to: args.to,
          authHeader,
          sampleHeaders,
        });
        if (!response.ok && (response.status === 401 || response.status === 403)) {
          const refreshed = await captureSessionAuth({ context, page, athleteId });
          authHeader = refreshed.authorizationHeader;
          sampleHeaders = refreshed.sampleHeaders;
          response = await fetchCustomMetrics({
            page,
            athleteId,
            from: args.from,
            to: args.to,
            authHeader,
            sampleHeaders,
          });
        }
      } catch (error) {
        studentsReport.push({
          student_id: student.student_id,
          student_name: student.name ?? null,
          trainingpeaks_athlete_id: athleteId,
          status: "failed",
          failure_message: (error as Error).message,
          http_status: null,
          normalized_rows_count: 0,
          metric_coverage: [],
          has_hrv: false,
          has_sleep_hours: false,
          has_pulse: false,
          has_body_battery: false,
          has_stress_level: false,
          has_weight: false,
          recovery_min_days_required: recoveryThreshold,
          recovery_metric_days: { sleep_hours: 0, hrv: 0, pulse: 0 },
          recovery_readiness: "not_ready",
        });
        console.log(`[student] ${studentLabel}: failed (request error)`);
        continue;
      }

      if (!response.ok) {
        studentsReport.push({
          student_id: student.student_id,
          student_name: student.name ?? null,
          trainingpeaks_athlete_id: athleteId,
          status: "failed",
          failure_message: `HTTP ${response.status}`,
          http_status: response.status,
          normalized_rows_count: 0,
          metric_coverage: [],
          has_hrv: false,
          has_sleep_hours: false,
          has_pulse: false,
          has_body_battery: false,
          has_stress_level: false,
          has_weight: false,
          recovery_min_days_required: recoveryThreshold,
          recovery_metric_days: { sleep_hours: 0, hrv: 0, pulse: 0 },
          recovery_readiness: "not_ready",
        });
        console.log(`[student] ${studentLabel}: failed (HTTP ${response.status})`);
        continue;
      }

      const normalizedRows = normalizeTrainingPeaksCustomMetricsPayload(response.body);
      const metricCoverage = computeCoverage(normalizedRows, rangeDays);
      const metricDates = new Map<string, number>();
      for (const entry of metricCoverage) {
        metricDates.set(entry.metric_key, entry.distinct_metric_dates);
      }

      const hasFlags = {
        has_hrv: metricDates.has("hrv"),
        has_sleep_hours: metricDates.has("sleep_hours"),
        has_pulse: metricDates.has("pulse"),
        has_body_battery: metricDates.has("body_battery"),
        has_stress_level: metricDates.has("stress_level"),
        has_weight: metricDates.has("weight_kg"),
      };

      const recoveryMetricDays = {
        sleep_hours: metricDates.get("sleep_hours") ?? 0,
        hrv: metricDates.get("hrv") ?? 0,
        pulse: metricDates.get("pulse") ?? 0,
      };

      const meetsRecovery =
        recoveryMetricDays.sleep_hours >= recoveryThreshold &&
        recoveryMetricDays.hrv >= recoveryThreshold &&
        recoveryMetricDays.pulse >= recoveryThreshold;

      const anyRecoverySignal = RECOVERY_KEYS.some((key) => (metricDates.get(key) ?? 0) > 0);

      let status: StudentStatus;
      if (normalizedRows.length === 0) {
        status = "ok_no_metrics";
      } else {
        const hasAllPrimary = PRIMARY_KEYS.every((key) => metricDates.has(key));
        status = hasAllPrimary ? "ok_with_metrics" : "partial_metrics";
      }

      let recoveryReadiness: RecoveryReadiness;
      if (status === "ok_no_metrics") {
        recoveryReadiness = "not_ready";
      } else if (meetsRecovery) {
        recoveryReadiness = "ready_for_recovery_report";
      } else if (anyRecoverySignal) {
        recoveryReadiness = "partial";
      } else {
        recoveryReadiness = "not_ready";
      }

      studentsReport.push({
        student_id: student.student_id,
        student_name: student.name ?? null,
        trainingpeaks_athlete_id: athleteId,
        status,
        failure_message: null,
        http_status: response.status,
        normalized_rows_count: normalizedRows.length,
        metric_coverage: metricCoverage,
        ...hasFlags,
        recovery_min_days_required: recoveryThreshold,
        recovery_metric_days: recoveryMetricDays,
        recovery_readiness: recoveryReadiness,
      });

      console.log(
        `[student] ${studentLabel}: ${status}, readiness=${recoveryReadiness}, sleep=${recoveryMetricDays.sleep_hours}, hrv=${recoveryMetricDays.hrv}, pulse=${recoveryMetricDays.pulse}`,
      );
    }
  } finally {
    await context.close().catch(() => {});
  }

  const summary: Record<StudentStatus, number> = {
    ok_with_metrics: 0,
    ok_no_metrics: 0,
    partial_metrics: 0,
    failed: 0,
    skipped_no_athlete_id: 0,
  };
  for (const entry of studentsReport) {
    summary[entry.status] += 1;
  }

  const artifact: ReportArtifact = {
    run_at: new Date().toISOString(),
    range: {
      from: args.from,
      to: args.to,
      days: rangeDays,
    },
    filters: {
      student: args.studentFilter,
      days: args.days,
    },
    selected_students_count: selectedStudents.length,
    selected_students: selectedStudents.map((student) => ({
      student_id: student.student_id,
      name: student.name ?? null,
      athlete_id: parseAthleteIdFromUrl(student.trainingpeaks_athlete_url),
    })),
    summary,
    students: studentsReport,
    output_paths: {
      report_json: OUTPUT_JSON,
      report_md: OUTPUT_MD,
    },
  };

  await writeFile(OUTPUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_MD, createMarkdown(artifact), "utf8");

  console.log("");
  console.log("[tp-custom-metrics-availability-report] Summary");
  console.log(
    `status_counts: ok_with_metrics=${summary.ok_with_metrics}, ok_no_metrics=${summary.ok_no_metrics}, partial_metrics=${summary.partial_metrics}, failed=${summary.failed}, skipped_no_athlete_id=${summary.skipped_no_athlete_id}`,
  );
  console.log(`recovery_threshold_days: ${recoveryThreshold}`);
  console.log(`report_json: ${OUTPUT_JSON}`);
  console.log(`report_md: ${OUTPUT_MD}`);
}

main().catch((error: unknown) => {
  console.error("tp-custom-metrics-availability-report failed.");
  console.error(error);
  process.exit(1);
});
