// FIT-ingest pipeline (design doc stages 3+4: /Users/igor/dev-notes/20 Coach OS/
// 2026-07-09 FIT Ingest & Derived Metrics Design.md, section 7 — architectural
// boundary). LOCAL MAC RUNNER ONLY: uses a Playwright browser session + cookies
// to call TrainingPeaks endpoints that require browser auth
// (/details, /files/{id}). There is no cloud/cron path for FIT — background
// jobs (signals/health/briefs) read trainingpeaks_workout_derived_metrics,
// they never touch FIT directly. Do not port this script's HTTP calls to a
// server route or cron job.
//
// For each completed workout in trainingpeaks_workout_cache within [from, to]:
//   1. GET /details for workoutDeviceFileInfos[].fileId (mean-max curves are
//      fetched here too but unused this stage — a later stage may use them
//      for the details_only decoupling fallback). Multiple device files ->
//      still use the first that parses, but flag it in the diagnostic
//      warnings rather than silently picking one.
//   2. If a fileId exists, download it directly via /files/{fileId}
//      (v1 then v6) and parse with fit-file-parser@3. Because the fileId
//      comes from THIS workout's own /details response (not a fuzzy
//      date/duration match against a bulk ZIP export), match_confidence is
//      always 1.0 when a file downloads and parses successfully — there is
//      no ambiguity to score.
//   3. Clean records[].heart_rate BEFORE computing anything HR-derived
//      (fit-hr-cleaning.ts) and classify laps as work/rest
//      (fit-lap-work-detection.ts).
//   4. From the SAME cleaned records + classified laps, compute the scalar
//      columns in one pass: goal-vs-actual (fit-goal-vs-actual.ts), interval
//      rep scalars over work laps (fit-interval-scalars.ts), and the
//      steady-effort decoupling gate + aerobic_ef (fit-steady-decoupling.ts).
//   5. Write laps (trainingpeaks_workout_laps, source='fit') and ONE derived
//      row (trainingpeaks_workout_derived_metrics) per workout, now with the
//      full scalar set populated.
//
// No FIT file (manual entry / treadmill) -> the derived row still gets
// written with has_fit=false and an honest fallback_level; every place we
// couldn't compute something is NULL with a warning, never 0 or a guess.

import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { chromium, type Page } from "playwright";
import FitParser from "fit-file-parser";

import type {
  TrainingPeaksStudent,
  TrainingPeaksWorkoutCacheRow,
  TrainingPeaksWorkoutDerivedMetricsUpsertRow,
  TrainingPeaksWorkoutLapUpsertRow,
} from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import * as workoutActivityClassificationModule from "../../../src/features/trainingpeaks/workout-activity-classification.ts";
import { profileDir, toolRoot } from "./lib/paths.ts";
import { captureSessionAuth, performApiJsonRequest } from "./lib/trainingpeaks-api-move.ts";
import {
  findWorkoutStartMs,
  lapPaceSecPerKm,
  normalizeFitLaps,
  normalizeFitRecords,
} from "./lib/fit-workout-normalization.ts";
import { cleanHeartRateSeries, computeCleanedMovingAverageHr } from "./lib/fit-hr-cleaning.ts";
import { detectWorkLaps } from "./lib/fit-lap-work-detection.ts";
import {
  buildDerivedMetricsFitFields,
  buildMultiDeviceFileWarning,
  type FitIngestOutcome,
} from "./lib/fit-ingest-outcome.ts";
import { computeGoalVsActual } from "./lib/fit-goal-vs-actual.ts";
import { computeIntervalScalars } from "./lib/fit-interval-scalars.ts";
import { computeAerobicEf, computeSteadyDecoupling } from "./lib/fit-steady-decoupling.ts";
import { MIN_WORK_REPS_FOR_SCALARS } from "./lib/fit-scalar-constants.ts";

// CJS/ESM boundary workaround (this package is "type":"module", src/ is CJS-default):
// a plain named import of a src/ file intermittently loses named exports across this
// boundary under Node's native TS stripping. Namespace import + .default fallback is
// the established pattern — see tp-actions-once.ts.
type NamespaceWithOptionalDefault<T> = T & { default?: T };

const trainingPeaksRepositoryCompat =
  trainingPeaksRepository as NamespaceWithOptionalDefault<typeof trainingPeaksRepository>;
const workoutActivityClassificationModuleCompat =
  workoutActivityClassificationModule as NamespaceWithOptionalDefault<typeof workoutActivityClassificationModule>;

const listTrainingPeaksStudents =
  trainingPeaksRepositoryCompat.listTrainingPeaksStudents ??
  trainingPeaksRepositoryCompat.default?.listTrainingPeaksStudents;
const listTrainingPeaksWorkoutCacheForStudentDateRange =
  trainingPeaksRepositoryCompat.listTrainingPeaksWorkoutCacheForStudentDateRange ??
  trainingPeaksRepositoryCompat.default?.listTrainingPeaksWorkoutCacheForStudentDateRange;
const getTrainingPeaksAthleteObservedMaxHr =
  trainingPeaksRepositoryCompat.getTrainingPeaksAthleteObservedMaxHr ??
  trainingPeaksRepositoryCompat.default?.getTrainingPeaksAthleteObservedMaxHr;
const replaceTrainingPeaksWorkoutLaps =
  trainingPeaksRepositoryCompat.replaceTrainingPeaksWorkoutLaps ??
  trainingPeaksRepositoryCompat.default?.replaceTrainingPeaksWorkoutLaps;
const upsertTrainingPeaksWorkoutDerivedMetricsRows =
  trainingPeaksRepositoryCompat.upsertTrainingPeaksWorkoutDerivedMetricsRows ??
  trainingPeaksRepositoryCompat.default?.upsertTrainingPeaksWorkoutDerivedMetricsRows;
const classifyTrainingPeaksWorkoutActivity =
  workoutActivityClassificationModuleCompat.classifyTrainingPeaksWorkoutActivity ??
  workoutActivityClassificationModuleCompat.default?.classifyTrainingPeaksWorkoutActivity;

if (typeof listTrainingPeaksStudents !== "function") {
  throw new Error("TrainingPeaks repository.listTrainingPeaksStudents is unavailable.");
}
if (typeof listTrainingPeaksWorkoutCacheForStudentDateRange !== "function") {
  throw new Error("TrainingPeaks repository.listTrainingPeaksWorkoutCacheForStudentDateRange is unavailable.");
}
if (typeof getTrainingPeaksAthleteObservedMaxHr !== "function") {
  throw new Error("TrainingPeaks repository.getTrainingPeaksAthleteObservedMaxHr is unavailable.");
}
if (typeof replaceTrainingPeaksWorkoutLaps !== "function") {
  throw new Error("TrainingPeaks repository.replaceTrainingPeaksWorkoutLaps is unavailable.");
}
if (typeof upsertTrainingPeaksWorkoutDerivedMetricsRows !== "function") {
  throw new Error("TrainingPeaks repository.upsertTrainingPeaksWorkoutDerivedMetricsRows is unavailable.");
}
if (typeof classifyTrainingPeaksWorkoutActivity !== "function") {
  throw new Error("workout-activity-classification.classifyTrainingPeaksWorkoutActivity is unavailable.");
}

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";

// No FIT records at all -> decoupling (and every other FIT-derived scalar)
// can never be computed for this row, period — distinct from the
// interval/too_short/not_steady reasons below, which only apply once we
// actually have cleaned records to gate.
const DECOUPLING_NO_FIT_RECORDS_REASON = "no_fit_records";

type CliArgs = {
  from: string;
  to: string;
  student: string | null;
  headed: boolean;
};

type ResolvedTarget = {
  student: TrainingPeaksStudent;
  athleteId: number | null;
};

type StudentSummary = {
  studentName: string;
  status: "ok" | "failed" | "skipped";
  reason: string | null;
  workoutsProcessed: number;
  fitMatched: number;
  detailsOnly: number;
  summaryOnly: number;
  warnings: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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
  const parsed: CliArgs = { from: "", to: "", student: null, headed: false };

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
      const student = arg.slice("--student=".length).trim();
      parsed.student = student || null;
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

  return parsed;
}

function toCompactErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
  return raw.replace(/\s+/g, " ").trim().slice(0, 240);
}

function createFitParser(): FitParser {
  return new FitParser({ mode: "list", force: true, lengthUnit: "m", speedUnit: "m/s", elapsedRecordField: true });
}

type DownloadedFit = { records: unknown[]; laps: unknown[]; sourceFitFileId: string };

// Tries /fitness/v1/files/{id} then /fitness/v6/files/{id} (mirrors the
// fallback pattern in hr-drift-elevation-audit.ts, which observed both
// endpoints serving files depending on account/file vintage).
async function downloadAndParseFitFile(input: {
  page: Page;
  headers: Record<string, string>;
  fileId: number;
  fileName: string | null;
}): Promise<DownloadedFit | null> {
  for (const suffix of [`/fitness/v1/files/${input.fileId}`, `/fitness/v6/files/${input.fileId}`]) {
    const fileEndpoint = `${TP_API_HOST}${suffix}`;
    let fileBody: Buffer;
    try {
      const fileResponse = await input.page.request.get(fileEndpoint, {
        headers: input.headers,
        failOnStatusCode: false,
      });
      if (!fileResponse.ok()) continue;
      fileBody = Buffer.from(await fileResponse.body());
    } catch {
      continue;
    }
    if (fileBody.length < 100) continue;

    const isGz = input.fileName?.toLowerCase().endsWith(".gz") ?? false;
    try {
      const fitBuffer = isGz ? gunzipSync(fileBody) : fileBody;
      const parsed = (await createFitParser().parseAsync(fitBuffer)) as {
        records?: unknown[];
        laps?: unknown[];
      };
      const records = Array.isArray(parsed.records) ? parsed.records : [];
      if (records.length === 0) continue;
      return {
        records,
        laps: Array.isArray(parsed.laps) ? parsed.laps : [],
        sourceFitFileId: input.fileName ?? String(input.fileId),
      };
    } catch {
      continue;
    }
  }
  return null;
}

type IngestOneWorkoutResult = {
  lapRows: TrainingPeaksWorkoutLapUpsertRow[];
  derivedRow: TrainingPeaksWorkoutDerivedMetricsUpsertRow;
  warnings: string[];
};

async function ingestOneWorkoutFit(input: {
  page: Page;
  headers: Record<string, string>;
  athleteId: number;
  cacheRow: TrainingPeaksWorkoutCacheRow;
  observedMaxHr: number | null;
  scannedAt: string;
}): Promise<IngestOneWorkoutResult> {
  const warnings: string[] = [];
  const workoutType = classifyTrainingPeaksWorkoutActivity({
    title: input.cacheRow.title,
    sportOrTypeCode: input.cacheRow.sportOrTypeCode,
    workoutTypeValueId: input.cacheRow.workoutTypeValueId,
    workoutSubTypeId: input.cacheRow.workoutSubTypeId,
    sourceSnapshot: input.cacheRow.sourceSnapshot,
  }).family;

  const base = {
    student_id: input.cacheRow.studentId,
    student_name: input.cacheRow.studentName,
    trainingpeaks_athlete_id: input.athleteId,
    trainingpeaks_workout_id: input.cacheRow.trainingPeaksWorkoutId,
    workout_cache_id: input.cacheRow.id,
    workout_date: input.cacheRow.workoutDate,
    workout_type: workoutType,
    scanned_at: input.scannedAt,
    // Default for the no-FIT-data branches (required by the DB check
    // constraint); the fit_parsed branch below overrides these with the
    // real computeSteadyDecoupling() result once records exist to gate.
    decoupling_valid: false,
    decoupling_invalid_reason: DECOUPLING_NO_FIT_RECORDS_REASON,
  };

  const degraded = (outcome: FitIngestOutcome): IngestOneWorkoutResult => ({
    lapRows: [],
    derivedRow: {
      ...base,
      ...buildDerivedMetricsFitFields(outcome),
      normalization_warnings: warnings,
    },
    warnings,
  });

  const detailsEndpoint = `${TP_API_HOST}/fitness/v6/athletes/${input.athleteId}/workouts/${input.cacheRow.trainingPeaksWorkoutId}/details`;
  let detailsBody: Record<string, unknown> | null = null;
  try {
    const detailsResult = await performApiJsonRequest({
      page: input.page,
      method: "GET",
      endpoint: detailsEndpoint,
      headers: input.headers,
    });
    if (detailsResult.status === 200 && isRecord(detailsResult.body)) {
      detailsBody = detailsResult.body;
    } else {
      warnings.push(`details request returned status=${detailsResult.status}`);
    }
  } catch (error) {
    warnings.push(`details request failed: ${toCompactErrorMessage(error)}`);
  }

  if (!detailsBody) {
    return degraded({ kind: "no_details" });
  }

  const fileInfos = Array.isArray(detailsBody.workoutDeviceFileInfos)
    ? (detailsBody.workoutDeviceFileInfos as Array<{ fileId?: unknown; fileName?: unknown }>)
    : [];

  if (fileInfos.length === 0) {
    warnings.push("no workoutDeviceFileInfos in details response");
    return degraded({ kind: "no_fit_file" });
  }

  // Multiple device files: we still take the primary one (first that
  // downloads and parses, same as before), but this isn't silent — it lands
  // in the same per-workout diagnostic summary every other warning does, so
  // Igor sees it and can check which file was actually used.
  const multiFileWarning = buildMultiDeviceFileWarning(fileInfos.length);
  if (multiFileWarning) {
    warnings.push(multiFileWarning);
  }

  for (const info of fileInfos) {
    const fileId = typeof info.fileId === "number" ? info.fileId : null;
    if (!fileId) continue;
    const fileName = typeof info.fileName === "string" ? info.fileName : null;

    const downloaded = await downloadAndParseFitFile({ page: input.page, headers: input.headers, fileId, fileName });
    if (!downloaded) continue;

    const normalizedRecords = normalizeFitRecords(downloaded.records);
    if (normalizedRecords.length === 0) {
      warnings.push(`FIT file ${downloaded.sourceFitFileId} parsed but yielded 0 usable records`);
      continue;
    }
    const workoutStartMs = findWorkoutStartMs(downloaded.records);
    const normalizedLaps = normalizeFitLaps(downloaded.laps, workoutStartMs);

    const cleaning = cleanHeartRateSeries({ records: normalizedRecords, observedMaxHr: input.observedMaxHr });
    const avgHr = computeCleanedMovingAverageHr(cleaning.records);

    const structureSnapshot = isRecord(input.cacheRow.sourceSnapshot)
      ? input.cacheRow.sourceSnapshot.structure
      : null;
    const workDetection = detectWorkLaps({ laps: normalizedLaps, structureSnapshot });
    warnings.push(...workDetection.notes);

    const workLapCount = [...workDetection.isWorkByLapIndex.values()].filter((v) => v === true).length;
    const isIntervalWorkout = workDetection.method !== "none" && workLapCount >= MIN_WORK_REPS_FOR_SCALARS;

    const decoupling = computeSteadyDecoupling({
      cleanedRecords: cleaning.records,
      isIntervalWorkout,
      hrQuality: cleaning.hrQuality,
    });
    const intervalScalars = computeIntervalScalars({
      laps: normalizedLaps,
      isWorkByLapIndex: workDetection.isWorkByLapIndex,
      cleanedRecords: cleaning.records,
    });
    const goalVsActual = computeGoalVsActual({
      structureSnapshot,
      cleanedRecords: cleaning.records,
      hrQuality: cleaning.hrQuality,
      observedMaxHr: input.observedMaxHr,
    });
    const aerobicEf = computeAerobicEf(cleaning.records, avgHr);
    warnings.push(...intervalScalars.warnings, ...goalVsActual.warnings);

    const lapRows: TrainingPeaksWorkoutLapUpsertRow[] = normalizedLaps.map((lap) => ({
      student_id: input.cacheRow.studentId,
      student_name: input.cacheRow.studentName,
      trainingpeaks_athlete_id: input.athleteId,
      trainingpeaks_workout_id: input.cacheRow.trainingPeaksWorkoutId,
      workout_cache_id: input.cacheRow.id,
      lap_index: lap.lapIndex,
      source: "fit",
      start_offset_s: lap.startOffsetS,
      timer_time_s: lap.timerTimeS,
      elapsed_time_s: lap.elapsedTimeS,
      distance_m: lap.distanceM,
      avg_speed_mps: lap.avgSpeedMps,
      max_speed_mps: lap.maxSpeedMps,
      pace_sec_per_km: lapPaceSecPerKm(lap),
      avg_hr: lap.avgHr,
      max_hr: lap.maxHr,
      min_hr: lap.minHr,
      avg_cadence: lap.avgCadenceRpm,
      max_cadence: lap.maxCadenceRpm,
      avg_power: lap.avgPower,
      total_ascent_m: lap.totalAscentM,
      total_descent_m: lap.totalDescentM,
      lap_trigger: lap.lapTrigger,
      intensity: lap.intensity,
      wkt_step_index: lap.wktStepIndex,
      is_work: workDetection.isWorkByLapIndex.get(lap.lapIndex) ?? null,
      planned_target: null,
      source_snapshot: {},
      normalization_warnings: [],
      scanned_at: input.scannedAt,
    }));

    return {
      lapRows,
      derivedRow: {
        ...base,
        ...buildDerivedMetricsFitFields({
          kind: "fit_parsed",
          sourceFitFileId: downloaded.sourceFitFileId,
          hrQuality: cleaning.hrQuality,
          pctHrCleaned: cleaning.pctHrCleaned,
          avgHr,
        }),
        pct_time_hr_target: goalVsActual.pctTimeHrTarget,
        pct_time_pace_target: goalVsActual.pctTimePaceTarget,
        target_source: goalVsActual.targetSource,
        time_in_zones: goalVsActual.timeInZones,
        zone_basis: goalVsActual.zoneBasis,
        reps_detected_count: workLapCount,
        rep_detection_method: workDetection.method,
        rep_paces: intervalScalars.repPaces,
        rep_pace_fade_pct: intervalScalars.repPaceFadePct,
        rep_pace_cv: intervalScalars.repPaceCv,
        rep_peak_hrs: intervalScalars.repPeakHrs,
        rep_recovery_drops: intervalScalars.repRecoveryDrops,
        steady_duration_s: decoupling.steadyDurationS,
        hr_decoupling_pct: decoupling.hrDecouplingPct,
        decoupling_valid: decoupling.decouplingValid,
        decoupling_invalid_reason: decoupling.decouplingInvalidReason,
        aerobic_ef: aerobicEf,
        normalization_warnings: warnings,
      },
      warnings,
    };
  }

  warnings.push(`all ${fileInfos.length} workoutDeviceFileInfos entries failed to download/parse`);
  return degraded({ kind: "no_fit_file" });
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));

  const allStudents = await listTrainingPeaksStudents();
  let targets: ResolvedTarget[] = allStudents.map((student) => ({
    student,
    athleteId: parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl),
  }));

  if (args.student) {
    const needle = normalizeToken(args.student);
    const filtered = targets.filter(
      (t) =>
        normalizeToken(t.student.id) === needle ||
        normalizeToken(t.student.studentId) === needle ||
        normalizeToken(t.student.studentName) === needle
    );
    if (filtered.length === 0) {
      throw new Error(`No student matched --student="${args.student}".`);
    }
    targets = filtered;
  }

  const withAthlete = targets.filter((t) => t.athleteId !== null);
  if (withAthlete.length === 0) {
    throw new Error("No selected student has a valid TrainingPeaks athlete id.");
  }

  const scannedAt = new Date().toISOString();
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !args.headed,
    viewport: null,
  });

  const summaries: StudentSummary[] = [];

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const firstTarget = withAthlete[0]!;
    const auth = await captureSessionAuth({ context, page, athleteId: firstTarget.athleteId! });
    if (!auth.sampleRequestUrl && !auth.authorizationHeader) {
      throw new Error("Failed to capture TrainingPeaks auth/session (no API session context observed).");
    }

    const headers: Record<string, string> = {
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      referer:
        typeof auth.sampleHeaders.referer === "string" && auth.sampleHeaders.referer.trim()
          ? auth.sampleHeaders.referer
          : `${APP_HOST}/#calendar/athletes/${firstTarget.athleteId}`,
      origin:
        typeof auth.sampleHeaders.origin === "string" && auth.sampleHeaders.origin.trim()
          ? auth.sampleHeaders.origin
          : APP_HOST,
    };
    if (auth.authorizationHeader) {
      headers.authorization = auth.authorizationHeader;
    }

    for (const target of targets) {
      if (!target.athleteId) {
        summaries.push({
          studentName: target.student.studentName,
          status: "skipped",
          reason: "missing valid TrainingPeaks athlete URL/id",
          workoutsProcessed: 0,
          fitMatched: 0,
          detailsOnly: 0,
          summaryOnly: 0,
          warnings: 0,
        });
        continue;
      }

      try {
        const cacheRows = (
          await listTrainingPeaksWorkoutCacheForStudentDateRange({
            studentId: target.student.id,
            from: args.from,
            to: args.to,
          })
        ).filter((row) => row.isCompleted);

        const observedMaxHr = await getTrainingPeaksAthleteObservedMaxHr(
          target.athleteId
        );

        let fitMatched = 0;
        let detailsOnly = 0;
        let summaryOnly = 0;
        const perWorkoutWarnings: string[] = [];

        for (const cacheRow of cacheRows) {
          const result = await ingestOneWorkoutFit({
            page,
            headers,
            athleteId: target.athleteId,
            cacheRow,
            observedMaxHr,
            scannedAt,
          });

          // Only overwrite laps when this run actually produced fresh ones —
          // a transient download/parse failure on a re-ingest must never wipe
          // laps a previous successful run wrote.
          if (result.lapRows.length > 0) {
            await replaceTrainingPeaksWorkoutLaps({
              workoutCacheId: cacheRow.id,
              source: "fit",
              rows: result.lapRows,
            });
          }
          await upsertTrainingPeaksWorkoutDerivedMetricsRows([result.derivedRow]);

          if (result.derivedRow.fallback_level === "fit_full") fitMatched += 1;
          else if (result.derivedRow.fallback_level === "details_only") detailsOnly += 1;
          else summaryOnly += 1;

          if (result.warnings.length > 0) {
            perWorkoutWarnings.push(`workout ${cacheRow.trainingPeaksWorkoutId}: ${result.warnings.join("; ")}`);
          }
        }

        summaries.push({
          studentName: target.student.studentName,
          status: "ok",
          reason: null,
          workoutsProcessed: cacheRows.length,
          fitMatched,
          detailsOnly,
          summaryOnly,
          warnings: perWorkoutWarnings.length,
        });
      } catch (error) {
        summaries.push({
          studentName: target.student.studentName,
          status: "failed",
          reason: toCompactErrorMessage(error),
          workoutsProcessed: 0,
          fitMatched: 0,
          detailsOnly: 0,
          summaryOnly: 0,
          warnings: 0,
        });
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  const totalProcessed = summaries.reduce((sum, s) => sum + s.workoutsProcessed, 0);
  const totalFit = summaries.reduce((sum, s) => sum + s.fitMatched, 0);
  const totalDetailsOnly = summaries.reduce((sum, s) => sum + s.detailsOnly, 0);
  const totalSummaryOnly = summaries.reduce((sum, s) => sum + s.summaryOnly, 0);

  console.log("[tp-fit-ingest-scan] Summary");
  console.log(`date_range: ${args.from} -> ${args.to}`);
  console.log(`students_selected: ${targets.length}`);
  console.log(`workouts_processed: ${totalProcessed}`);
  console.log(`fit_full: ${totalFit}, details_only: ${totalDetailsOnly}, summary_only: ${totalSummaryOnly}`);
  console.log("");
  console.log("per_student:");
  for (const item of summaries.sort((a, b) => a.studentName.localeCompare(b.studentName))) {
    console.log(
      `- ${item.studentName}: status=${item.status}, workouts=${item.workoutsProcessed}, fit_full=${item.fitMatched}, details_only=${item.detailsOnly}, summary_only=${item.summaryOnly}, warnings=${item.warnings}${item.reason ? `, reason=${item.reason}` : ""}`
    );
  }

  const failedCount = summaries.filter((s) => s.status === "failed").length;
  if (failedCount > 0) {
    throw new Error(`${failedCount} student(s) failed FIT ingest.`);
  }
}

main().catch((error: unknown) => {
  console.error("tp-fit-ingest-scan failed.");
  console.error(error);
  process.exit(1);
});
