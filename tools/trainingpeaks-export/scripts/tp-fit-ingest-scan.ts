// FIT-ingest pipeline (design doc stages 3+4: /Users/igor/dev-notes/20 Coach OS/
// 2026-07-09 FIT Ingest & Derived Metrics Design.md).
//
// Talks to TrainingPeaks over the shared HTTP client (tp-api-client.ts): bearer
// token from the session snapshot, NO Playwright. The design doc's original
// claim that /details and the files export require a browser session was
// disproved empirically (2026-07-13 probe: both return 200 under bearer), so
// this script no longer launches a browser and no longer contends for the
// persistent Chromium profile that tp-actions-once.ts holds. It is still run
// on demand rather than by cron, but nothing about the HTTP path is local-only.
//
// For each completed workout in trainingpeaks_workout_cache within [from, to]:
//   1. GET /details for workoutDeviceFileInfos[].fileName (mean-max curves are
//      fetched here too but unused this stage — a later stage may use them
//      for the details_only decoupling fallback). Multiple device files ->
//      still use the first that parses, but flag it in the diagnostic
//      warnings rather than silently picking one.
//   2. Download the device files via the BULK range export
//      (/fitness/v1/export/{athleteId}/files/{from}/{to} -> JSON carrying a
//      base64 ZIP), fetched ONCE per student, then match each workout to its
//      file by EXACT ZIP-entry name against workoutDeviceFileInfos[].fileName
//      and parse with fit-file-parser@3. Exact-name matching is what keeps
//      match_confidence at 1.0 — there is no fuzzy date/duration scoring, and
//      an unmatched name degrades honestly to has_fit=false.
//      Do NOT reintroduce /fitness/v{1,6}/files/{fileId}: that endpoint is dead
//      (404, verified live) and TP serves fileId int32-overflowed (observed
//      -1296859130), so the id is unusable anyway. Names are the only reliable
//      key — file timestamps are UTC-shifted off the workout's calendar day.
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

import FitParser from "fit-file-parser";

import type {
  TrainingPeaksStudent,
  TrainingPeaksWorkoutCacheRow,
  TrainingPeaksWorkoutDerivedMetricsUpsertRow,
  TrainingPeaksWorkoutLapUpsertRow,
} from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import * as workoutActivityClassificationModule from "../../../src/features/trainingpeaks/workout-activity-classification.ts";
import {
  getWorkoutDetailsRecord,
  getWorkoutFilesExport,
} from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { toolRoot } from "./lib/paths.ts";
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

// No FIT records at all -> decoupling (and every other FIT-derived scalar)
// can never be computed for this row, period — distinct from the
// interval/too_short/not_steady reasons below, which only apply once we
// actually have cleaned records to gate.
const DECOUPLING_NO_FIT_RECORDS_REASON = "no_fit_records";

type CliArgs = {
  from: string;
  to: string;
  student: string | null;
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
  const parsed: CliArgs = { from: "", to: "", student: null };

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
    // --headed/--headless are accepted as no-ops: this script no longer drives
    // a browser (it talks to the TP HTTP API), but the flags were in the
    // documented invocation, so silently tolerate them instead of hard-failing.
    if (arg === "--headed" || arg === "--headless") {
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

/**
 * Every device file for a student across the scanned range, keyed by EXACT
 * ZIP-entry name. Fetched ONCE per student (the export endpoint is bulk, by
 * date range), then matched per workout against
 * workoutDeviceFileInfos[].fileName from /details.
 *
 * Exact-name matching is the whole point: it is what keeps match_confidence at
 * 1.0 with no fuzzy date/duration guessing. Do not match on fileId (TP serves
 * it int32-overflowed -- observed -1296859130) nor on the file's timestamp
 * (it is UTC-shifted and can land on a different calendar day than the
 * workout).
 */
type StudentFitArchive = Map<string, Buffer>;

// unzipper ships no types; declare only the surface we actually use.
type UnzipperEntry = { path: string; type: string; buffer: () => Promise<Buffer> };
type UnzipperModule = { Open: { buffer: (zip: Buffer) => Promise<{ files: UnzipperEntry[] }> } };

async function loadStudentFitArchive(input: {
  athleteId: number;
  from: string;
  to: string;
}): Promise<StudentFitArchive> {
  const archive: StudentFitArchive = new Map();
  const exports = await getWorkoutFilesExport(input.athleteId, input.from, input.to);

  const unzipper = (await import("unzipper")) as unknown as UnzipperModule;
  for (const one of exports) {
    const directory = await unzipper.Open.buffer(one.zip);
    for (const entry of directory.files) {
      if (entry.type !== "File") continue;
      archive.set(entry.path, await entry.buffer());
    }
  }
  return archive;
}

/**
 * Resolve ONE workout's FIT file out of the pre-fetched archive by exact name.
 * Returns null when the name is absent (caller degrades to has_fit=false with
 * an explicit reason) -- never falls back to guessing another file.
 */
async function parseFitFromArchive(input: {
  archive: StudentFitArchive;
  fileName: string;
}): Promise<DownloadedFit | null> {
  const raw = input.archive.get(input.fileName);
  if (!raw || raw.length < 100) return null;

  const isGz = input.fileName.toLowerCase().endsWith(".gz");
  try {
    const fitBuffer = isGz ? gunzipSync(raw) : raw;
    const parsed = (await createFitParser().parseAsync(fitBuffer)) as {
      records?: unknown[];
      laps?: unknown[];
    };
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    if (records.length === 0) return null;
    return {
      records,
      laps: Array.isArray(parsed.laps) ? parsed.laps : [],
      sourceFitFileId: input.fileName,
    };
  } catch {
    return null;
  }
}

type IngestOneWorkoutResult = {
  lapRows: TrainingPeaksWorkoutLapUpsertRow[];
  derivedRow: TrainingPeaksWorkoutDerivedMetricsUpsertRow;
  warnings: string[];
};

async function ingestOneWorkoutFit(input: {
  archive: StudentFitArchive;
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

  let detailsBody: Record<string, unknown> | null = null;
  try {
    detailsBody = await getWorkoutDetailsRecord(input.athleteId, input.cacheRow.trainingPeaksWorkoutId);
  } catch (error) {
    warnings.push(`details request failed: ${toCompactErrorMessage(error)}`);
  }

  if (!detailsBody) {
    return degraded({ kind: "no_details" });
  }

  const fileInfos = Array.isArray(detailsBody.workoutDeviceFileInfos)
    ? (detailsBody.workoutDeviceFileInfos as Array<{ fileName?: unknown }>)
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

  // Match a device file to its FIT by EXACT name against the range export.
  // fileId is deliberately ignored: TP serves it int32-overflowed (observed
  // -1296859130), and the per-file endpoint it addressed (/fitness/v{1,6}/
  // files/{id}) is dead (404). No fuzzy date/duration fallback -- an unmatched
  // name degrades honestly to has_fit=false.
  for (const info of fileInfos) {
    const fileName = typeof info.fileName === "string" ? info.fileName : null;
    if (!fileName) {
      warnings.push("workoutDeviceFileInfos entry has no fileName");
      continue;
    }
    if (!input.archive.has(fileName)) {
      warnings.push(`device file ${fileName} not present in range export`);
      continue;
    }

    const downloaded = await parseFitFromArchive({ archive: input.archive, fileName });
    if (!downloaded) {
      warnings.push(`device file ${fileName} found in export but failed to gunzip/parse`);
      continue;
    }

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

  const summaries: StudentSummary[] = [];

  {
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

        // The device-file export is BULK (whole date range in one call), so it
        // is fetched ONCE per student and reused across every workout below --
        // not once per workout.
        const archive = await loadStudentFitArchive({
          athleteId: target.athleteId,
          from: args.from,
          to: args.to,
        });

        let fitMatched = 0;
        let detailsOnly = 0;
        let summaryOnly = 0;
        const perWorkoutWarnings: string[] = [];

        for (const cacheRow of cacheRows) {
          const result = await ingestOneWorkoutFit({
            archive,
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
