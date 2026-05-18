import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import type {
  TrainingPeaksHealthMetricCacheUpsertRow,
  TrainingPeaksHealthMetricsScanStatusUpsertRow,
  TrainingPeaksStudent,
  TrainingPeaksStudentHealthMetricProfile,
} from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { profileDir, toolRoot } from "./lib/paths.ts";
import { captureSessionAuth, performApiJsonRequest } from "./lib/trainingpeaks-api-move.ts";
import {
  normalizeTrainingPeaksCustomMetricsPayload,
  type NormalizedTrainingPeaksCustomMetric,
} from "./lib/trainingpeaks-custom-metrics-normalization.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";

type CliArgs = {
  from: string;
  to: string;
  eligibleOnly: boolean;
  student: string | null;
  allActiveFullRescan: boolean;
  headed: boolean;
};

type ResolvedTarget = {
  student: TrainingPeaksStudent;
  athleteId: number | null;
};

type StudentSummary = {
  studentId: string;
  studentName: string;
  athleteId: number | null;
  status: "ok" | "failed" | "skipped";
  rawItems: number;
  normalizedRows: number;
  upsertedRows: number;
  metricKeys: string[];
  warnings: number;
  reason: string | null;
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  listTrainingPeaksStudentsEligibleForHealthMetrics?: (input?: {
    dueForFullCheckBeforeOrAt?: string;
    limit?: number;
  }) => Promise<TrainingPeaksStudentHealthMetricProfile[]>;
  upsertTrainingPeaksHealthMetricsCacheRows?: (
    rows: TrainingPeaksHealthMetricCacheUpsertRow[]
  ) => Promise<void>;
  upsertTrainingPeaksHealthMetricsScanStatuses?: (
    rows: TrainingPeaksHealthMetricsScanStatusUpsertRow[]
  ) => Promise<void>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    listTrainingPeaksStudentsEligibleForHealthMetrics?: (input?: {
      dueForFullCheckBeforeOrAt?: string;
      limit?: number;
    }) => Promise<TrainingPeaksStudentHealthMetricProfile[]>;
    upsertTrainingPeaksHealthMetricsCacheRows?: (
      rows: TrainingPeaksHealthMetricCacheUpsertRow[]
    ) => Promise<void>;
    upsertTrainingPeaksHealthMetricsScanStatuses?: (
      rows: TrainingPeaksHealthMetricsScanStatusUpsertRow[]
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
    path.join(toolRoot, ".env"),
  ];
  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    from: "",
    to: "",
    eligibleOnly: false,
    student: null,
    allActiveFullRescan: false,
    headed: false,
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
    if (arg === "--eligible-only") {
      parsed.eligibleOnly = true;
      continue;
    }
    if (arg.startsWith("--student=")) {
      const student = arg.slice("--student=".length).trim();
      parsed.student = student || null;
      continue;
    }
    if (arg === "--all-active-full-rescan") {
      parsed.allActiveFullRescan = true;
      continue;
    }
    if (arg === "--headed") {
      parsed.headed = true;
      continue;
    }
    if (arg === "--headless") {
      parsed.headed = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!isIsoDate(parsed.from)) {
    throw new Error(`Missing or invalid --from date: "${parsed.from}". Expected YYYY-MM-DD.`);
  }
  if (!isIsoDate(parsed.to)) {
    throw new Error(`Missing or invalid --to date: "${parsed.to}". Expected YYYY-MM-DD.`);
  }
  if (parsed.from > parsed.to) {
    throw new Error(`Invalid date range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }
  if (!parsed.eligibleOnly && !parsed.allActiveFullRescan) {
    throw new Error("Choose one mode: --eligible-only or --all-active-full-rescan.");
  }
  if (parsed.eligibleOnly && parsed.allActiveFullRescan) {
    throw new Error("Do not combine --eligible-only and --all-active-full-rescan.");
  }

  return parsed;
}

function toCompactErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
  return raw.replace(/\s+/g, " ").trim().slice(0, 240);
}

function buildCacheRows(input: {
  normalizedRows: NormalizedTrainingPeaksCustomMetric[];
  student: TrainingPeaksStudent;
  athleteId: number;
  scannedAt: string;
}): TrainingPeaksHealthMetricCacheUpsertRow[] {
  return input.normalizedRows.map((row) => ({
      student_id: input.student.id,
      student_name: input.student.studentName,
      trainingpeaks_athlete_id: row.trainingPeaksAthleteId || input.athleteId,
      metric_timestamp: row.metricTimestamp,
      metric_date: row.metricDate,
      metric_type_id: row.metricTypeId,
      metric_key: row.metricKey,
      metric_label: row.metricLabel,
      raw_value_text: row.rawValueText,
      value_numeric: row.valueNumeric,
      value_min_numeric: row.valueMinNumeric,
      value_max_numeric: row.valueMaxNumeric,
      value_avg_numeric: row.valueAvgNumeric,
      unit: row.unit,
      upload_client: row.uploadClient,
      source_snapshot: row.sourceSnapshot ?? {},
      normalization_warnings: row.normalizationWarnings,
      scanned_at: input.scannedAt,
    }));
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn =
    repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const listEligibleFn =
    repoCompat.listTrainingPeaksStudentsEligibleForHealthMetrics ??
    repoCompat.default?.listTrainingPeaksStudentsEligibleForHealthMetrics;
  const upsertCacheFn =
    repoCompat.upsertTrainingPeaksHealthMetricsCacheRows ??
    repoCompat.default?.upsertTrainingPeaksHealthMetricsCacheRows;
  const upsertStatusesFn =
    repoCompat.upsertTrainingPeaksHealthMetricsScanStatuses ??
    repoCompat.default?.upsertTrainingPeaksHealthMetricsScanStatuses;

  if (!listStudentsFn || !listEligibleFn || !upsertCacheFn || !upsertStatusesFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const allStudents = await listStudentsFn();
  const selected: ResolvedTarget[] = [];
  const summaries: StudentSummary[] = [];

  if (args.eligibleOnly) {
    const eligibleProfiles = await listEligibleFn();
    const eligibleIds = new Set(eligibleProfiles.map((profile) => profile.studentId));
    for (const student of allStudents) {
      if (!eligibleIds.has(student.id)) {
        continue;
      }
      selected.push({
        student,
        athleteId: parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl),
      });
    }
  } else {
    throw new Error(
      "Flag --all-active-full-rescan is reserved for future use. Use --eligible-only (and optionally --student=...) for safe mode."
    );
  }

  if (args.student) {
    const needle = normalizeToken(args.student);
    const filtered = selected.filter((entry) => {
      return (
        normalizeToken(entry.student.id) === needle ||
        normalizeToken(entry.student.studentId) === needle ||
        normalizeToken(entry.student.studentName) === needle
      );
    });
    if (filtered.length === 0) {
      throw new Error(`No selected student matched --student="${args.student}".`);
    }
    selected.length = 0;
    selected.push(...filtered);
  }

  if (selected.length === 0) {
    throw new Error("No students selected for health metrics scan.");
  }

  const scannedAt = new Date().toISOString();
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !args.headed,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const firstWithAthlete = selected.find((entry) => entry.athleteId !== null);
    if (!firstWithAthlete) {
      throw new Error("No selected student has a valid TrainingPeaks athlete id.");
    }

    const auth = await captureSessionAuth({
      context,
      page,
      athleteId: firstWithAthlete.athleteId,
    });
    if (!auth.sampleRequestUrl && !auth.authorizationHeader) {
      throw new Error("Failed to capture TrainingPeaks auth/session (no API session context observed).");
    }

    const headers: Record<string, string> = {
      accept: "application/json, text/csv, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
      referer:
        typeof auth.sampleHeaders.referer === "string" && auth.sampleHeaders.referer.trim()
          ? auth.sampleHeaders.referer
          : `${APP_HOST}/#calendar/athletes/${firstWithAthlete.athleteId}`,
      origin:
        typeof auth.sampleHeaders.origin === "string" && auth.sampleHeaders.origin.trim()
          ? auth.sampleHeaders.origin
          : APP_HOST,
    };
    if (auth.authorizationHeader) {
      headers.authorization = auth.authorizationHeader;
    }

    for (const target of selected) {
      if (!target.athleteId) {
        summaries.push({
          studentId: target.student.id,
          studentName: target.student.studentName,
          athleteId: null,
          status: "skipped",
          rawItems: 0,
          normalizedRows: 0,
          upsertedRows: 0,
          metricKeys: [],
          warnings: 0,
          reason: "missing valid TrainingPeaks athlete URL/id",
        });
        continue;
      }

      const endpoint = `${TP_API_HOST}/metrics/v3/athletes/${target.athleteId}/consolidatedtimedmetrics/${args.from}/${args.to}`;
      try {
        const response = await performApiJsonRequest({
          page,
          method: "GET",
          endpoint,
          headers,
        });

        if (response.status !== 200) {
          throw new Error(`TrainingPeaks custom metrics GET failed: status=${response.status}, ok=${response.ok}`);
        }
        if (!Array.isArray(response.body)) {
          throw new Error("TrainingPeaks custom metrics GET returned non-array JSON body.");
        }

        const normalizedRows = normalizeTrainingPeaksCustomMetricsPayload(response.body).filter(
          (row) => row.metricDate >= args.from && row.metricDate <= args.to
        );
        const rows = buildCacheRows({
          normalizedRows,
          student: target.student,
          athleteId: target.athleteId,
          scannedAt,
        });
        await upsertCacheFn(rows);

        const metricKeys = Array.from(new Set(normalizedRows.map((row) => row.metricKey))).sort((a, b) =>
          a.localeCompare(b)
        );
        const warnings = normalizedRows.reduce((acc, row) => acc + row.normalizationWarnings.length, 0);

        summaries.push({
          studentId: target.student.id,
          studentName: target.student.studentName,
          athleteId: target.athleteId,
          status: "ok",
          rawItems: response.body.length,
          normalizedRows: normalizedRows.length,
          upsertedRows: rows.length,
          metricKeys,
          warnings,
          reason: null,
        });
      } catch (error) {
        summaries.push({
          studentId: target.student.id,
          studentName: target.student.studentName,
          athleteId: target.athleteId,
          status: "failed",
          rawItems: 0,
          normalizedRows: 0,
          upsertedRows: 0,
          metricKeys: [],
          warnings: 1,
          reason: toCompactErrorMessage(error),
        });
      }
    }

    const statusRows: TrainingPeaksHealthMetricsScanStatusUpsertRow[] = summaries.map((item) => ({
      student_id: item.studentId,
      student_name: item.studentName,
      trainingpeaks_athlete_id: item.athleteId,
      scan_from: args.from,
      scan_to: args.to,
      status: item.status,
      raw_items_count: item.rawItems,
      normalized_items_count: item.normalizedRows,
      upserted_rows_count: item.upsertedRows,
      metric_types_found: item.metricKeys,
      warnings_count: item.warnings,
      error_message: item.status === "ok" ? null : item.reason,
      scanned_at: scannedAt,
    }));
    await upsertStatusesFn(statusRows);

    const selectedCount = selected.length;
    const scannedSuccessfully = summaries.filter((item) => item.status === "ok").length;
    const failed = summaries.filter((item) => item.status === "failed").length;
    const skipped = summaries.filter((item) => item.status === "skipped").length;
    const totalNormalizedRows = summaries.reduce((sum, item) => sum + item.normalizedRows, 0);
    const totalUpsertedRows = summaries.reduce((sum, item) => sum + item.upsertedRows, 0);
    const metricKeysFound = Array.from(new Set(summaries.flatMap((item) => item.metricKeys))).sort((a, b) =>
      a.localeCompare(b)
    );

    console.log("[tp-health-metrics-scan] Summary");
    console.log(`mode: ${args.eligibleOnly ? "eligible-only" : "all-active-full-rescan"}`);
    console.log(`date_range: ${args.from} -> ${args.to}`);
    console.log(`selected: ${selectedCount}`);
    console.log(`scanned_successfully: ${scannedSuccessfully}`);
    console.log(`failed: ${failed}`);
    console.log(`skipped: ${skipped}`);
    console.log(`total_normalized_rows: ${totalNormalizedRows}`);
    console.log(`total_upserted_rows: ${totalUpsertedRows}`);
    console.log(`metric_keys_found: ${metricKeysFound.length > 0 ? metricKeysFound.join(", ") : "none"}`);
    console.log("");
    console.log("per_student:");
    for (const item of summaries.sort((a, b) => a.studentName.localeCompare(b.studentName))) {
      console.log(
        `- ${item.studentName}: status=${item.status}, raw=${item.rawItems}, normalized=${item.normalizedRows}, upserted=${item.upsertedRows}, warnings=${item.warnings}${item.reason ? `, reason=${item.reason}` : ""}`
      );
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-health-metrics-scan failed.");
  console.error(error);
  process.exit(1);
});
