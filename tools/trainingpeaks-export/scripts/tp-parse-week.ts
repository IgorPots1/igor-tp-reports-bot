import { createReadStream, existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse/sync";
import * as unzipper from "unzipper";

type CliArgs = {
  student: string;
  from: string;
  to: string;
};

type RawRow = Record<string, string>;

type ParsedWorkout = {
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
  description: string | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_pace_min_per_km: number | null;
  avg_pace_text: string | null;
  duration_text: string | null;
  planned_duration_text: string | null;
  distance_text: string | null;
  intensity_flags: string[];
  data_warnings: string[];
  athlete_comments: string | null;
  coach_comments: string | null;
  source_file: string;
  raw: RawRow;
};

type WeeklySummary = {
  student_id: string;
  week: {
    from: string;
    to: string;
  };
  source_files: string[];
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
  workouts: ParsedWorkout[];
};

type CsvCandidate = {
  csvPath: string;
  sourceFile: string;
};

type FieldMatch = {
  key: string;
  normalizedKey: string;
  value: string;
};

type ParsedCsv = {
  workouts: ParsedWorkout[];
  sourceFiles: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const exportsRoot = path.join(toolRoot, "exports");
const parsedRoot = path.join(toolRoot, "parsed");
const DEBUG = process.env.TP_DEBUG === "1";

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}

const FIELD_ALIASES = {
  date: [
    "date",
    "workoutdate",
    "workoutday",
    "calendardate",
    "completeddate",
    "activitydate",
    "scheduleddate"
  ],
  title: [
    "title",
    "name",
    "workouttitle",
    "workoutname",
    "workout",
    "sessionname",
    "activityname"
  ],
  sport: [
    "sport",
    "workouttype",
    "sporttype",
    "type",
    "activitytype",
    "discipline"
  ],
  planned_duration: [
    "plannedduration",
    "planneddurationinhours",
    "plannedtime",
    "durationplanned",
    "scheduledduration",
    "totalplannedtime"
  ],
  completed_duration: [
    "duration",
    "completedduration",
    "actualduration",
    "movingtime",
    "elapsedtime",
    "totaltime",
    "completedtime",
    "timetotalinhours"
  ],
  distance: [
    "distance",
    "distanceinmeters",
    "actualdistance",
    "completeddistance",
    "totaldistance"
  ],
  planned_distance: [
    "planneddistance",
    "planneddistanceinmeters",
    "distanceplanned",
    "scheduleddistance"
  ],
  tss: [
    "tss",
    "actualtss",
    "completedtss",
    "trainingstressscore",
    "workouttss",
    "plannedtss"
  ],
  if: [
    "if",
    "intensityfactor",
    "actualif",
    "completedif",
    "plannedif"
  ],
  rpe: [
    "rpe",
    "sessionrpe",
    "perceivedexertion"
  ],
  description: [
    "workoutdescription",
    "description",
    "details",
    "workoutdetails",
    "sessiondescription"
  ],
  avg_hr: [
    "heartrateaverage",
    "averageheartrate",
    "avghr",
    "hraverage"
  ],
  max_hr: [
    "heartratemax",
    "maxheartrate",
    "maxhr",
    "hrmax"
  ],
  athlete_comments: [
    "athletecomments",
    "postactivitycomments",
    "postworkoutcomments",
    "comments",
    "athletenotes",
    "notes"
  ],
  coach_comments: [
    "coachcomments",
    "coachnote",
    "coachnotes",
    "plannedcomments",
    "plannednotes",
    "instructions"
  ],
  completion_status: [
    "completed",
    "completionstatus",
    "status",
    "compliance"
  ]
} as const;

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-parse-week -- --student=Olga --from=2026-04-27 --to=2026-05-03"
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<CliArgs> = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (!value) {
      continue;
    }

    if (rawKey === "student" || rawKey === "from" || rawKey === "to") {
      values[rawKey] = value;
    }
  }

  if (!values.student || !values.from || !values.to) {
    throw new Error(`Missing required CLI args.\n\n${usage()}`);
  }

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDatePattern.test(values.from) || !isoDatePattern.test(values.to)) {
    throw new Error("`--from` and `--to` must use YYYY-MM-DD format.");
  }

  return values as CliArgs;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function relativeToToolRoot(filePath: string): string {
  return toPosixPath(path.relative(toolRoot, filePath));
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function sanitizeForFileName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "file";
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function detectDelimiter(content: string): string {
  const firstDataLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstDataLine) {
    return ",";
  }

  const candidates = [",", ";", "\t"];
  let bestDelimiter = ",";
  let bestScore = -1;

  for (const delimiter of candidates) {
    const score = firstDataLine.split(delimiter).length - 1;
    if (score > bestScore) {
      bestDelimiter = delimiter;
      bestScore = score;
    }
  }

  return bestDelimiter;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/\r/g, "").trim();
  return normalized ? normalized : null;
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  const slashMatch = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseFlexibleNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/,/g, ".")
    .replace(/[^0-9.+-]/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationMinutes(field: FieldMatch | null): number | null {
  if (!field) {
    return null;
  }

  const compact = field.value.trim();
  const hhmmss = compact.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (hhmmss) {
    const hours = Number.parseInt(hhmmss[1], 10);
    const minutes = Number.parseInt(hhmmss[2], 10);
    const seconds = Number.parseInt(hhmmss[3] ?? "0", 10);
    return Math.round((hours * 3600 + minutes * 60 + seconds) / 60);
  }

  const unitMatches = [...compact.matchAll(/(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)/g)];
  if (unitMatches.length > 0) {
    let totalMinutes = 0;

    for (const [, rawAmount, rawUnit] of unitMatches) {
      const amount = Number.parseFloat(rawAmount.replace(",", "."));
      const unit = rawUnit.toLowerCase();

      if (!Number.isFinite(amount)) {
        continue;
      }

      if (unit.startsWith("h")) {
        totalMinutes += amount * 60;
        continue;
      }

      if (unit.startsWith("m")) {
        totalMinutes += amount;
        continue;
      }

      if (unit.startsWith("s")) {
        totalMinutes += amount / 60;
      }
    }

    if (totalMinutes > 0) {
      return Math.round(totalMinutes);
    }
  }

  const numeric = parseFlexibleNumber(compact);
  if (numeric === null) {
    return null;
  }

  if (
    field.normalizedKey === "plannedduration" ||
    field.normalizedKey.endsWith("inhours") ||
    /(^|[^a-z])hour|(^|[^a-z])hr/i.test(field.key)
  ) {
    return Math.round(numeric * 60);
  }

  if (/sec|second/i.test(compact)) {
    return Math.round(numeric / 60);
  }

  if (/hour|hr/i.test(compact)) {
    return Math.round(numeric * 60);
  }

  return Math.round(numeric);
}

function parseDistanceKm(field: FieldMatch | null): number | null {
  if (!field) {
    return null;
  }

  const numeric = parseFlexibleNumber(field.value);
  if (numeric === null) {
    return null;
  }

  if (field.normalizedKey.includes("meter")) {
    return roundNumber(numeric / 1000, 2);
  }

  const lower = field.value.toLowerCase();
  if (/\bmi\b|mile/.test(lower)) {
    return roundNumber(numeric * 1.60934, 2);
  }

  if (/\bm\b|meter/.test(lower) && !/\bkm\b/.test(lower)) {
    return roundNumber(numeric / 1000, 2);
  }

  return roundNumber(numeric, 2);
}

function parseIfValue(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const numeric = parseFlexibleNumber(value);
  if (numeric === null) {
    return null;
  }

  if (value.includes("%") || numeric > 5) {
    return roundNumber(numeric / 100, 3);
  }

  return roundNumber(numeric, 3);
}

function roundNumber(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatDurationMinutes(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) {
    return null;
  }

  const roundedMinutes = Math.round(minutes);
  if (roundedMinutes >= 60) {
    const hours = Math.floor(roundedMinutes / 60);
    const remainderMinutes = roundedMinutes % 60;
    return `${hours}:${String(remainderMinutes).padStart(2, "0")}`;
  }

  return `${roundedMinutes} min`;
}

function formatDistanceKm(distanceKm: number | null): string | null {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return null;
  }

  return `${distanceKm.toFixed(2)} km`;
}

function deriveAveragePaceMinPerKm(
  distanceKm: number | null,
  durationMinutes: number | null
): number | null {
  if (
    distanceKm === null ||
    durationMinutes === null ||
    !Number.isFinite(distanceKm) ||
    !Number.isFinite(durationMinutes) ||
    distanceKm <= 0 ||
    durationMinutes <= 0
  ) {
    return null;
  }

  return roundNumber(durationMinutes / distanceKm, 2);
}

function formatPaceMinPerKm(paceMinPerKm: number | null): string | null {
  if (paceMinPerKm === null || !Number.isFinite(paceMinPerKm) || paceMinPerKm <= 0) {
    return null;
  }

  const totalSeconds = Math.round(paceMinPerKm * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

function buildIntensityFlags(workout: {
  avg_hr: number | null;
  max_hr: number | null;
  rpe: number | null;
  distance_km: number | null;
  completed_duration_minutes: number | null;
}): string[] {
  const flags: string[] = [];

  if (workout.avg_hr !== null && workout.avg_hr >= 170) {
    flags.push("high_average_hr");
  }

  if (workout.max_hr !== null && workout.max_hr >= 190) {
    flags.push("high_max_hr");
  }

  if (workout.rpe !== null && workout.rpe >= 7) {
    flags.push("hard_rpe");
  }

  if (
    (workout.distance_km !== null && workout.distance_km >= 12) ||
    (workout.completed_duration_minutes !== null && workout.completed_duration_minutes >= 80)
  ) {
    flags.push("long_run");
  }

  return flags;
}

function buildDataWarnings(workout: {
  sport: string | null;
  if: number | null;
  tss: number | null;
  distance_km: number | null;
  completed_duration_minutes: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  description: string | null;
}): string[] {
  const warnings: string[] = [];
  const sportNormalized = normalizeHeader(workout.sport ?? "");

  if (workout.if !== null && workout.if > 1.15) {
    warnings.push("suspicious_if");
  }

  if (
    workout.tss !== null &&
    workout.tss > 150 &&
    (sportNormalized === "run" || sportNormalized === "")
  ) {
    warnings.push("suspicious_tss");
  }

  if (workout.completed_duration_minutes !== null && workout.distance_km === null) {
    warnings.push("missing_distance");
  }

  if (workout.avg_hr === null && workout.max_hr === null) {
    warnings.push("missing_hr");
  }

  if (workout.description === null) {
    warnings.push("missing_description");
  }

  return warnings;
}

function buildHeaderIndex(row: RawRow): Map<string, string> {
  const index = new Map<string, string>();

  for (const key of Object.keys(row)) {
    const normalized = normalizeHeader(key);
    if (!normalized || index.has(normalized)) {
      continue;
    }

    index.set(normalized, key);
  }

  return index;
}

function pickField(row: RawRow, aliases: readonly string[]): FieldMatch | null {
  const headerIndex = buildHeaderIndex(row);

  for (const alias of aliases) {
    const originalKey = headerIndex.get(alias);
    if (!originalKey) {
      continue;
    }

    const value = cleanString(row[originalKey]);
    if (value !== null) {
      return {
        key: originalKey,
        normalizedKey: alias,
        value
      };
    }
  }

  return null;
}

function pickValue(row: RawRow, aliases: readonly string[]): string | null {
  return pickField(row, aliases)?.value ?? null;
}

function normalizeRawRow(record: Record<string, unknown>): RawRow {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, cleanString(value) ?? ""])
  );
}

function looksLikeWorkout(row: ParsedWorkout): boolean {
  return [
    row.date,
    row.title,
    row.sport,
    row.planned_duration_minutes,
    row.completed_duration_minutes,
    row.distance_km,
    row.planned_distance_km,
    row.tss,
    row.if,
    row.rpe,
    row.description,
    row.avg_hr,
    row.max_hr,
    row.athlete_comments,
    row.coach_comments
  ].some((value) => value !== null);
}

function isCompletedWorkout(row: ParsedWorkout): boolean {
  if (
    row.completed_duration_minutes !== null ||
    row.distance_km !== null ||
    row.if !== null ||
    row.rpe !== null ||
    row.athlete_comments !== null
  ) {
    return true;
  }

  return false;
}

async function extractZip(zipPath: string, tempRoot: string): Promise<string> {
  const targetDir = path.join(
    tempRoot,
    path.basename(zipPath, path.extname(zipPath)),
    sanitizeForFileName(path.basename(zipPath))
  );
  await mkdir(targetDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: targetDir }))
      .on("close", resolve)
      .on("error", reject);
  });

  return targetDir;
}

async function discoverCsvCandidates(exportDir: string, tempRoot: string): Promise<CsvCandidate[]> {
  const files = (await listFilesRecursively(exportDir)).sort((a, b) => a.localeCompare(b));

  debugLog(`Files found (${files.length}):`);
  if (files.length === 0) {
    debugLog("- none");
  } else {
    for (const filePath of files) {
      debugLog(`- ${relativeToToolRoot(filePath)}`);
    }
  }

  const zipFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".zip");
  const directCsvFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".csv");
  const csvCandidates: CsvCandidate[] = directCsvFiles.map((csvPath) => ({
    csvPath,
    sourceFile: relativeToToolRoot(csvPath)
  }));

  for (const zipFile of zipFiles) {
    debugLog(`Unzipping: ${relativeToToolRoot(zipFile)}`);
    const extractedDir = await extractZip(zipFile, tempRoot);
    const extractedFiles = await listFilesRecursively(extractedDir);

    for (const extractedFile of extractedFiles) {
      if (path.extname(extractedFile).toLowerCase() !== ".csv") {
        continue;
      }

      const zipRelativePath = toPosixPath(path.relative(extractedDir, extractedFile));
      csvCandidates.push({
        csvPath: extractedFile,
        sourceFile: `${relativeToToolRoot(zipFile)}::${zipRelativePath}`
      });
    }
  }

  csvCandidates.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));

  debugLog(`CSV files parsed (${csvCandidates.length}):`);
  if (csvCandidates.length === 0) {
    debugLog("- none");
  } else {
    for (const candidate of csvCandidates) {
      debugLog(`- ${candidate.sourceFile}`);
    }
  }

  return csvCandidates;
}

async function parseCsvFile(candidate: CsvCandidate): Promise<ParsedCsv> {
  const fileStats = await stat(candidate.csvPath);
  if (!fileStats.isFile()) {
    return { workouts: [], sourceFiles: [] };
  }

  const content = await readFile(candidate.csvPath, "utf8");
  if (!content.trim()) {
    return { workouts: [], sourceFiles: [candidate.sourceFile] };
  }

  const delimiter = detectDelimiter(content);
  const records = parse(content, {
    bom: true,
    columns: true,
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, unknown>[];

  const workouts: ParsedWorkout[] = [];

  for (const record of records) {
    const raw = normalizeRawRow(record);
    const dateField = pickField(raw, FIELD_ALIASES.date);
    const plannedDurationField = pickField(raw, FIELD_ALIASES.planned_duration);
    const completedDurationField = pickField(raw, FIELD_ALIASES.completed_duration);
    const distanceField = pickField(raw, FIELD_ALIASES.distance);
    const plannedDistanceField = pickField(raw, FIELD_ALIASES.planned_distance);
    const description = pickValue(raw, FIELD_ALIASES.description);
    const avgHr = parseFlexibleNumber(pickValue(raw, FIELD_ALIASES.avg_hr));
    const maxHr = parseFlexibleNumber(pickValue(raw, FIELD_ALIASES.max_hr));
    const plannedDurationMinutes = parseDurationMinutes(plannedDurationField);
    const completedDurationMinutes = parseDurationMinutes(completedDurationField);
    const distanceKm = parseDistanceKm(distanceField);
    const avgPaceMinPerKm = deriveAveragePaceMinPerKm(distanceKm, completedDurationMinutes);

    const normalized: ParsedWorkout = {
      date: parseDate(dateField?.value ?? null),
      title: pickValue(raw, FIELD_ALIASES.title),
      sport: pickValue(raw, FIELD_ALIASES.sport),
      planned_duration_minutes: plannedDurationMinutes,
      completed_duration_minutes: completedDurationMinutes,
      distance_km: distanceKm,
      planned_distance_km: parseDistanceKm(plannedDistanceField),
      tss: parseFlexibleNumber(pickValue(raw, FIELD_ALIASES.tss)),
      if: parseIfValue(pickValue(raw, FIELD_ALIASES.if)),
      rpe: parseFlexibleNumber(pickValue(raw, FIELD_ALIASES.rpe)),
      description,
      avg_hr: avgHr,
      max_hr: maxHr,
      avg_pace_min_per_km: avgPaceMinPerKm,
      avg_pace_text: formatPaceMinPerKm(avgPaceMinPerKm),
      duration_text: formatDurationMinutes(completedDurationMinutes),
      planned_duration_text: formatDurationMinutes(plannedDurationMinutes),
      distance_text: formatDistanceKm(distanceKm),
      intensity_flags: [],
      data_warnings: [],
      athlete_comments: pickValue(raw, FIELD_ALIASES.athlete_comments),
      coach_comments: pickValue(raw, FIELD_ALIASES.coach_comments),
      source_file: candidate.sourceFile,
      raw
    };

    const completionStatus = pickValue(raw, FIELD_ALIASES.completion_status)?.toLowerCase();
    if (
      completionStatus &&
      ["planned", "scheduled", "notcompleted", "incomplete", "missed", "skipped"].includes(
        normalizeHeader(completionStatus)
      )
    ) {
      normalized.completed_duration_minutes = null;
      normalized.distance_km = null;
      normalized.if = null;
      normalized.rpe = null;
      normalized.athlete_comments = null;
    }

    normalized.avg_pace_min_per_km = deriveAveragePaceMinPerKm(
      normalized.distance_km,
      normalized.completed_duration_minutes
    );
    normalized.avg_pace_text = formatPaceMinPerKm(normalized.avg_pace_min_per_km);
    normalized.duration_text = formatDurationMinutes(normalized.completed_duration_minutes);
    normalized.distance_text = formatDistanceKm(normalized.distance_km);

    normalized.intensity_flags = buildIntensityFlags(normalized);
    normalized.data_warnings = buildDataWarnings(normalized);

    if (looksLikeWorkout(normalized)) {
      workouts.push(normalized);
    }
  }

  return {
    workouts,
    sourceFiles: [candidate.sourceFile]
  };
}

function sumOrNull(values: Array<number | null>, digits: number): number | null {
  const numericValues = values.filter((value): value is number => value !== null);
  if (numericValues.length === 0) {
    return null;
  }

  const total = numericValues.reduce((sum, value) => sum + value, 0);
  return roundNumber(total, digits);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const exportDir = path.join(exportsRoot, args.student, `${args.from}_${args.to}`);
  const outputDir = path.join(parsedRoot, args.student, `${args.from}_${args.to}`);
  const outputPath = path.join(outputDir, "weekly-summary.json");

  if (!existsSync(exportDir)) {
    throw new Error(`Export folder does not exist: ${exportDir}`);
  }

  await mkdir(outputDir, { recursive: true });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tp-parse-week-"));
  console.log(`Export folder used: ${exportDir}`);

  try {
    const csvCandidates = await discoverCsvCandidates(exportDir, tempRoot);
    const parsedFiles = await Promise.all(
      csvCandidates.map(async (candidate) => {
        try {
          return await parseCsvFile(candidate);
        } catch (error: unknown) {
          console.warn(`Skipping CSV due to parse error: ${candidate.sourceFile}`);
          console.warn(error);
          return {
            workouts: [],
            sourceFiles: [candidate.sourceFile]
          } satisfies ParsedCsv;
        }
      })
    );

    const workouts = parsedFiles.flatMap((entry) => entry.workouts);
    const sourceFiles = [...new Set(parsedFiles.flatMap((entry) => entry.sourceFiles))];

    const summary: WeeklySummary = {
      student_id: args.student,
      week: {
        from: args.from,
        to: args.to
      },
      source_files: sourceFiles,
      totals: {
        workouts_count: workouts.length,
        completed_workouts_count: workouts.filter(isCompletedWorkout).length,
        total_distance_km: sumOrNull(workouts.map((workout) => workout.distance_km), 2),
        planned_duration_minutes: sumOrNull(
          workouts.map((workout) => workout.planned_duration_minutes),
          0
        ),
        completed_duration_minutes: sumOrNull(
          workouts.map((workout) => workout.completed_duration_minutes),
          0
        ),
        total_completed_duration_text: formatDurationMinutes(
          sumOrNull(workouts.map((workout) => workout.completed_duration_minutes), 0)
        ),
        total_planned_duration_text: formatDurationMinutes(
          sumOrNull(workouts.map((workout) => workout.planned_duration_minutes), 0)
        ),
        total_distance_text: formatDistanceKm(
          sumOrNull(workouts.map((workout) => workout.distance_km), 2)
        ),
        data_warnings_count: workouts.reduce(
          (count, workout) => count + workout.data_warnings.length,
          0
        ),
        intensity_flags_count: workouts.reduce(
          (count, workout) => count + workout.intensity_flags.length,
          0
        )
      },
      workouts
    };

    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log("Parser success.");
    console.log(`weekly-summary.json path: ${outputPath}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
