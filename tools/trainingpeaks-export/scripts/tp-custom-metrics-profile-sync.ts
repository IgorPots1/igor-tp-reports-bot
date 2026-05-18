import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";

import type { TrainingPeaksStudent } from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { profileDir, toolRoot } from "./lib/paths.ts";
import { captureSessionAuth } from "./lib/trainingpeaks-api-move.ts";
import { normalizeTrainingPeaksCustomMetricsPayload } from "./lib/trainingpeaks-custom-metrics-normalization.ts";

const APP_HOST = "https://app.trainingpeaks.com";
const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const PRIMARY_KEYS = ["hrv", "sleep_hours", "pulse", "body_battery", "stress_level", "weight_kg"] as const;
const RECOVERY_KEYS = ["sleep_hours", "hrv", "pulse"] as const;

type StudentStatus = "ok_with_metrics" | "ok_no_metrics" | "partial_metrics" | "failed" | "skipped_no_athlete_id";
type RecoveryReadiness = "ready_for_recovery_report" | "partial" | "not_ready";
type PersistedStatus = "ready" | "partial" | "no_metrics" | "failed" | "skipped_no_athlete_id" | "unknown";

type CliArgs = {
  from: string;
  to: string;
  studentFilter: string | null;
  days: number | null;
  allActive: boolean;
  headless: boolean;
};

type MetricCoverage = {
  metric_key: string;
  rows_count: number;
  distinct_metric_dates: number;
  first_date: string | null;
  last_date: string | null;
  day_coverage_ratio: number;
};

type StudentAvailability = {
  student: TrainingPeaksStudent;
  trainingpeaks_athlete_id: number | null;
  status: StudentStatus;
  failure_message: string | null;
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

type SyncSummary = {
  selected: number;
  upserted: number;
  ready: number;
  partial: number;
  no_metrics: number;
  failed: number;
  skipped: number;
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  upsertTrainingPeaksStudentHealthMetricProfiles?: (
    rows: import("../../../src/features/trainingpeaks/repository.ts").TrainingPeaksStudentHealthMetricProfileUpsertRow[]
  ) => Promise<void>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    upsertTrainingPeaksStudentHealthMetricProfiles?: (
      rows: import("../../../src/features/trainingpeaks/repository.ts").TrainingPeaksStudentHealthMetricProfileUpsertRow[]
    ) => Promise<void>;
  };
};

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) return;
  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) return;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
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
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")];
  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toIsoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function diffDaysInclusive(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay) + 1;
}

function parseAthleteIdFromUrl(athleteUrl: string): number | null {
  const match = athleteUrl.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeStudentFilter(value: string): string {
  return value.trim().toLowerCase();
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: Partial<CliArgs> = {
    studentFilter: null,
    days: null,
    allActive: false,
    headless: true,
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
    if (arg === "--all-active") {
      parsed.allActive = true;
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
  if (parsed.studentFilter && parsed.allActive) {
    throw new Error("Do not combine --student with --all-active.");
  }

  return parsed as CliArgs;
}

function selectStudents(students: TrainingPeaksStudent[], args: CliArgs): TrainingPeaksStudent[] {
  const activeOnly = students.filter((student) => student.isActive);
  if (args.allActive) {
    return activeOnly;
  }
  if (!args.studentFilter) {
    return activeOnly;
  }

  const wanted = normalizeStudentFilter(args.studentFilter);
  const matched = activeOnly.filter((student) => {
    const byId = normalizeStudentFilter(student.id) === wanted;
    const byStudentId = normalizeStudentFilter(student.studentId) === wanted;
    const byName = normalizeStudentFilter(student.studentName) === wanted;
    return byId || byStudentId || byName;
  });

  if (matched.length === 0) {
    throw new Error(`No active student matched --student="${args.studentFilter}".`);
  }
  return matched;
}

function computeCoverage(
  rows: ReturnType<typeof normalizeTrainingPeaksCustomMetricsPayload>,
  rangeDays: number
): MetricCoverage[] {
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

function addDaysIso(date: Date, days: number): string {
  const value = new Date(date.getTime());
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function mapPersistedStatus(input: {
  status: StudentStatus;
  recoveryReadiness: RecoveryReadiness;
}): PersistedStatus {
  if (input.status === "failed") return "failed";
  if (input.status === "skipped_no_athlete_id") return "skipped_no_athlete_id";
  if (input.status === "ok_no_metrics") return "no_metrics";
  if (input.status === "partial_metrics") {
    return input.recoveryReadiness === "ready_for_recovery_report" ? "ready" : "partial";
  }
  if (input.status === "ok_with_metrics") {
    return input.recoveryReadiness === "ready_for_recovery_report" ? "ready" : "partial";
  }
  return "unknown";
}

function computeNextFullCheckAt(status: PersistedStatus, now: Date): string | null {
  if (status === "no_metrics") return addDaysIso(now, 30);
  if (status === "failed") return addDaysIso(now, 1);
  if (status === "ready" || status === "partial") return addDaysIso(now, 7);
  if (status === "skipped_no_athlete_id") return addDaysIso(now, 30);
  return addDaysIso(now, 30);
}

async function buildAvailability(
  selectedStudents: TrainingPeaksStudent[],
  args: CliArgs
): Promise<StudentAvailability[]> {
  const rangeDays = diffDaysInclusive(args.from, args.to);
  const recoveryThreshold = Math.max(1, Math.ceil((rangeDays * 4) / 7));
  const context: BrowserContext = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });
  const studentsReport: StudentAvailability[] = [];

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const authAthlete = selectedStudents
      .map((student) => parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl))
      .find((value): value is number => value !== null);

    let authHeader: string | null = null;
    let sampleHeaders: Record<string, string> = {};
    if (authAthlete) {
      const auth = await captureSessionAuth({ context, page, athleteId: authAthlete });
      authHeader = auth.authorizationHeader;
      sampleHeaders = auth.sampleHeaders;
    }

    for (const student of selectedStudents) {
      const athleteId = parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
      if (!athleteId) {
        studentsReport.push({
          student,
          trainingpeaks_athlete_id: null,
          status: "skipped_no_athlete_id",
          failure_message: "missing trainingpeaks athlete id in URL",
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
          student,
          trainingpeaks_athlete_id: athleteId,
          status: "failed",
          failure_message: (error as Error).message,
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
        continue;
      }

      if (!response.ok) {
        studentsReport.push({
          student,
          trainingpeaks_athlete_id: athleteId,
          status: "failed",
          failure_message: `HTTP ${response.status}`,
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
        student,
        trainingpeaks_athlete_id: athleteId,
        status,
        failure_message: null,
        normalized_rows_count: normalizedRows.length,
        metric_coverage: metricCoverage,
        ...hasFlags,
        recovery_min_days_required: recoveryThreshold,
        recovery_metric_days: recoveryMetricDays,
        recovery_readiness: recoveryReadiness,
      });
    }
  } finally {
    await context.close().catch(() => {});
  }

  return studentsReport;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));

  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn =
    repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const upsertProfilesFn =
    repoCompat.upsertTrainingPeaksStudentHealthMetricProfiles ??
    repoCompat.default?.upsertTrainingPeaksStudentHealthMetricProfiles;
  if (!listStudentsFn || !upsertProfilesFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const students = await listStudentsFn();
  const selectedStudents = selectStudents(students, args);
  const availability = await buildAvailability(selectedStudents, args);
  const now = new Date();
  const nowIso = now.toISOString();

  const rows: import("../../../src/features/trainingpeaks/repository.ts").TrainingPeaksStudentHealthMetricProfileUpsertRow[] =
    availability.map((entry) => {
      const persistedStatus = mapPersistedStatus({
        status: entry.status,
        recoveryReadiness: entry.recovery_readiness,
      });
      const recoveryMetricsEnabled =
        persistedStatus === "ready" ||
        (persistedStatus === "partial" && entry.recovery_readiness === "ready_for_recovery_report");

      return {
        student_id: entry.student.id,
        student_name: entry.student.studentName,
        trainingpeaks_athlete_id: entry.trainingpeaks_athlete_id,
        status: persistedStatus,
        recovery_metrics_enabled: recoveryMetricsEnabled,
        has_hrv: entry.has_hrv,
        has_sleep_hours: entry.has_sleep_hours,
        has_pulse: entry.has_pulse,
        has_body_battery: entry.has_body_battery,
        has_stress_level: entry.has_stress_level,
        has_weight: entry.has_weight,
        coverage_7d: {},
        coverage_30d: {
          range: { from: args.from, to: args.to, days: diffDaysInclusive(args.from, args.to) },
          metric_coverage: entry.metric_coverage,
          recovery_readiness: entry.recovery_readiness,
          recovery_metric_days: entry.recovery_metric_days,
          recovery_min_days_required: entry.recovery_min_days_required,
          normalized_rows_count: entry.normalized_rows_count,
        },
        last_checked_at: nowIso,
        next_full_check_at: computeNextFullCheckAt(persistedStatus, now),
        warnings: entry.failure_message ? [entry.failure_message] : [],
        source_snapshot: {
          source: "tp-custom-metrics-profile-sync",
          source_status: entry.status,
          from: args.from,
          to: args.to,
        },
      };
    });

  await upsertProfilesFn(rows);

  const summary: SyncSummary = {
    selected: selectedStudents.length,
    upserted: rows.length,
    ready: rows.filter((row) => row.status === "ready").length,
    partial: rows.filter((row) => row.status === "partial").length,
    no_metrics: rows.filter((row) => row.status === "no_metrics").length,
    failed: rows.filter((row) => row.status === "failed").length,
    skipped: rows.filter((row) => row.status === "skipped_no_athlete_id").length,
  };

  console.log("[tp-custom-metrics-profile-sync] Summary");
  console.log(`selected: ${summary.selected}`);
  console.log(`upserted: ${summary.upserted}`);
  console.log(`ready: ${summary.ready}`);
  console.log(`partial: ${summary.partial}`);
  console.log(`no_metrics: ${summary.no_metrics}`);
  console.log(`failed: ${summary.failed}`);
  console.log(`skipped: ${summary.skipped}`);
}

main().catch((error: unknown) => {
  console.error("tp-custom-metrics-profile-sync failed.");
  console.error(error);
  process.exit(1);
});
