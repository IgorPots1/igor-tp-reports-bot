import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { classifyTpWorkoutEvidence, type TpWorkoutEvidenceInput } from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  listTrainingPeaksStudents,
  listTrainingPeaksWorkoutCacheForDateRange,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[diagnose-tp-workout-type-mapping]";
const DEFAULT_LIMIT = 300;
const DEFAULT_DAYS = 90;
const MAX_LIMIT = 2000;
const MAX_DAYS = 365;
const RUN_HINTS = ["run", "running", "бег", "пробеж", "jog", "tempo", "interval", "длитель"];
const STRENGTH_HINTS = ["strength", "силов", "офп", "gym", "mobility", "core", "weights", "зал"];
const CROSS_HINTS = ["bike", "cycling", "вел", "swim", "плав", "row", "ski", "лыж", "ellipt", "hike", "walk", "yoga"];

type CliOptions = {
  asOfDate: string;
  days: number;
  json: boolean;
  limit: number;
  studentQuery: string | null;
};

type DiagnosticSampleRow = {
  student: string;
  studentId: string;
  workoutDate: string;
  workoutId: number;
  isCompleted: boolean;
  isPlanned: boolean;
  title: string | null;
  sportOrTypeCode: string | null;
  workoutTypeValueId: number | null;
  workoutSubTypeId: number | null;
  snapshotWorkoutTypeValueId: number | null;
  snapshotWorkoutSubTypeId: number | null;
  snapshotRawWorkoutTypeValueId: number | null;
  snapshotRawWorkoutSubTypeId: number | null;
  snapshotRawCode: string | null;
  snapshotDescription: string | null;
  snapshotCoachComments: string | null;
  snapshotStructure: string | null;
  classifier: ReturnType<typeof classifyTpWorkoutEvidence>;
};

type IdBucket = {
  id: number;
  total: number;
  completed: number;
  planned: number;
  runningLike: number;
  strengthOnly: number;
  crossOther: number;
  unknown: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  reasonCodeCounts: Record<string, number>;
  rawCodeCounts: Record<string, number>;
  titleExamples: string[];
  runningEvidenceRows: number;
  strengthEvidenceRows: number;
};

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function hasAnyHint(value: string, hints: string[]): boolean {
  return hints.some((hint) => value.includes(hint));
}

function parsePositiveInt(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL invalid ${flag}: ${raw}`);
  }
  return Math.floor(parsed);
}

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseDate(raw: string, flag: string): string {
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${LOG_PREFIX} FAIL invalid ${flag}: ${raw}`);
  }
  return value;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateMinusDays(isoDate: string, days: number): string {
  const start = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(start)) {
    throw new Error(`${LOG_PREFIX} FAIL unable to parse date ${isoDate}`);
  }
  const result = new Date(start - days * 24 * 60 * 60 * 1000);
  return result.toISOString().slice(0, 10);
}

function parseNumberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    asOfDate: todayIsoDate(),
    days: DEFAULT_DAYS,
    json: false,
    limit: DEFAULT_LIMIT,
    studentQuery: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Math.min(parsePositiveInt(arg.slice("--limit=".length), "--limit"), MAX_LIMIT);
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL missing value for --limit`);
      }
      options.limit = Math.min(parsePositiveInt(next, "--limit"), MAX_LIMIT);
      index += 1;
      continue;
    }
    if (arg.startsWith("--days=")) {
      options.days = Math.min(parsePositiveInt(arg.slice("--days=".length), "--days"), MAX_DAYS);
      continue;
    }
    if (arg === "--days") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL missing value for --days`);
      }
      options.days = Math.min(parsePositiveInt(next, "--days"), MAX_DAYS);
      index += 1;
      continue;
    }
    if (arg.startsWith("--as-of=")) {
      options.asOfDate = parseDate(arg.slice("--as-of=".length), "--as-of");
      continue;
    }
    if (arg === "--as-of") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL missing value for --as-of`);
      }
      options.asOfDate = parseDate(next, "--as-of");
      index += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      options.studentQuery = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL missing value for --student`);
      }
      options.studentQuery = next.trim() || null;
      index += 1;
      continue;
    }
  }
  return options;
}

function resolveStudentId(
  query: string | null,
  students: Awaited<ReturnType<typeof listTrainingPeaksStudents>>
): { studentId: string | null; studentName: string | null } {
  if (!query) {
    return { studentId: null, studentName: null };
  }
  const normalizedQuery = normalizeText(query).replace(/\s+/gu, " ").trim();
  const matches = students.filter((student) => {
    const haystack = `${student.studentName} ${student.studentId} ${student.id}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
  if (matches.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL no student matched --student "${query}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `${LOG_PREFIX} FAIL --student "${query}" matched multiple students: ${matches
        .map((student) => `${student.studentName} (${student.studentId})`)
        .join(", ")}`
    );
  }
  return { studentId: matches[0]!.id, studentName: matches[0]!.studentName };
}

function mkEvidenceInput(row: TrainingPeaksWorkoutCacheRow): TpWorkoutEvidenceInput {
  const sourceSnapshot =
    row.sourceSnapshot && typeof row.sourceSnapshot === "object" && !Array.isArray(row.sourceSnapshot)
      ? (row.sourceSnapshot as Record<string, unknown>)
      : {};
  return {
    workoutId: String(row.trainingPeaksWorkoutId),
    workoutDate: row.workoutDate,
    title: row.title,
    description: typeof sourceSnapshot.description === "string" ? sourceSnapshot.description : null,
    coachComments: typeof sourceSnapshot.coachComments === "string" ? sourceSnapshot.coachComments : null,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
    snapshotWorkoutTypeValueId: parseNumberish(sourceSnapshot.workoutTypeValueId),
    snapshotRawWorkoutTypeValueId: parseNumberish(sourceSnapshot.rawWorkoutTypeValueId),
    snapshotRawWorkoutSubTypeId: parseNumberish(sourceSnapshot.rawWorkoutSubTypeId),
    snapshotRawCode: typeof sourceSnapshot.rawCode === "string" ? sourceSnapshot.rawCode : null,
    isPlanned: row.isPlanned,
    isCompleted: row.isCompleted,
    plannedVsCompletedDelta: "unknown",
  };
}

function asDiagnosticRow(row: TrainingPeaksWorkoutCacheRow): DiagnosticSampleRow {
  const sourceSnapshot =
    row.sourceSnapshot && typeof row.sourceSnapshot === "object" && !Array.isArray(row.sourceSnapshot)
      ? (row.sourceSnapshot as Record<string, unknown>)
      : {};
  const classifier = classifyTpWorkoutEvidence(mkEvidenceInput(row));
  return {
    student: row.studentName,
    studentId: row.studentId,
    workoutDate: row.workoutDate,
    workoutId: row.trainingPeaksWorkoutId,
    isCompleted: row.isCompleted,
    isPlanned: row.isPlanned,
    title: row.title,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
    snapshotWorkoutTypeValueId: parseNumberish(sourceSnapshot.workoutTypeValueId),
    snapshotWorkoutSubTypeId: parseNumberish(sourceSnapshot.workoutSubTypeId),
    snapshotRawWorkoutTypeValueId: parseNumberish(sourceSnapshot.rawWorkoutTypeValueId),
    snapshotRawWorkoutSubTypeId: parseNumberish(sourceSnapshot.rawWorkoutSubTypeId),
    snapshotRawCode: typeof sourceSnapshot.rawCode === "string" ? sourceSnapshot.rawCode : null,
    snapshotDescription: typeof sourceSnapshot.description === "string" ? sourceSnapshot.description : null,
    snapshotCoachComments: typeof sourceSnapshot.coachComments === "string" ? sourceSnapshot.coachComments : null,
    snapshotStructure: typeof sourceSnapshot.structure === "string" ? sourceSnapshot.structure : null,
    classifier,
  };
}

function principalTypeId(row: DiagnosticSampleRow): number | null {
  return row.workoutTypeValueId ?? row.snapshotWorkoutTypeValueId ?? row.snapshotRawWorkoutTypeValueId ?? null;
}

function principalRawCode(row: DiagnosticSampleRow): string {
  return normalizeText(row.snapshotRawCode || row.sportOrTypeCode || "").trim() || "<none>";
}

function classifyTitlePattern(row: DiagnosticSampleRow): "running" | "strength" | "cross" | "none" {
  const text = normalizeText(
    [row.title, row.snapshotDescription, row.snapshotCoachComments, row.snapshotStructure].filter(Boolean).join(" ")
  );
  if (hasAnyHint(text, STRENGTH_HINTS)) {
    return "strength";
  }
  if (hasAnyHint(text, RUN_HINTS)) {
    return "running";
  }
  if (hasAnyHint(text, CROSS_HINTS)) {
    return "cross";
  }
  return "none";
}

function summarizeByTypeId(rows: DiagnosticSampleRow[]): IdBucket[] {
  const byId = new Map<number, IdBucket>();
  for (const row of rows) {
    const id = principalTypeId(row);
    if (id === null) {
      continue;
    }
    const current =
      byId.get(id) ??
      ({
        id,
        total: 0,
        completed: 0,
        planned: 0,
        runningLike: 0,
        strengthOnly: 0,
        crossOther: 0,
        unknown: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
        reasonCodeCounts: {},
        rawCodeCounts: {},
        titleExamples: [],
        runningEvidenceRows: 0,
        strengthEvidenceRows: 0,
      } satisfies IdBucket);

    current.total += 1;
    if (row.isCompleted) {
      current.completed += 1;
    }
    if (row.isPlanned) {
      current.planned += 1;
    }
    if (row.classifier.sportClass === "running_like") {
      current.runningLike += 1;
    } else if (row.classifier.sportClass === "strength_only") {
      current.strengthOnly += 1;
    } else if (row.classifier.sportClass === "cross_training_or_other") {
      current.crossOther += 1;
    } else {
      current.unknown += 1;
    }
    if (row.classifier.confidence === "high") {
      current.highConfidence += 1;
    } else if (row.classifier.confidence === "medium") {
      current.mediumConfidence += 1;
    } else {
      current.lowConfidence += 1;
    }
    for (const reasonCode of row.classifier.reasonCodes) {
      current.reasonCodeCounts[reasonCode] = (current.reasonCodeCounts[reasonCode] ?? 0) + 1;
    }
    const rawCode = principalRawCode(row);
    current.rawCodeCounts[rawCode] = (current.rawCodeCounts[rawCode] ?? 0) + 1;
    const pattern = classifyTitlePattern(row);
    if (pattern === "running") {
      current.runningEvidenceRows += 1;
    }
    if (pattern === "strength") {
      current.strengthEvidenceRows += 1;
    }
    const title = row.title?.trim();
    if (title && current.titleExamples.length < 5 && !current.titleExamples.includes(title)) {
      current.titleExamples.push(title);
    }
    byId.set(id, current);
  }
  return Array.from(byId.values()).sort((left, right) => {
    if (right.total !== left.total) {
      return right.total - left.total;
    }
    return left.id - right.id;
  });
}

function topEntries(input: Record<string, number>, limit = 5): Array<{ key: string; count: number }> {
  return Object.entries(input)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCli(process.argv.slice(2));
  const fromDate = dateMinusDays(options.asOfDate, Math.max(options.days - 1, 0));
  const students = await listTrainingPeaksStudents();
  const resolvedStudent = resolveStudentId(options.studentQuery, students);
  const scanned = await listTrainingPeaksWorkoutCacheForDateRange({
    from: fromDate,
    to: options.asOfDate,
    studentId: resolvedStudent.studentId ?? undefined,
  });
  const selected = scanned
    .sort((left, right) => {
      if (left.workoutDate !== right.workoutDate) {
        return right.workoutDate.localeCompare(left.workoutDate);
      }
      return right.trainingPeaksWorkoutId - left.trainingPeaksWorkoutId;
    })
    .slice(0, options.limit);
  const rows = selected.map(asDiagnosticRow);

  const byTypeId = summarizeByTypeId(rows);
  const sportClassCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classifier.sportClass] = (acc[row.classifier.sportClass] ?? 0) + 1;
    return acc;
  }, {});
  const runningCompletionCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classifier.runningCompletionClass] = (acc[row.classifier.runningCompletionClass] ?? 0) + 1;
    return acc;
  }, {});
  const rawCodeCounts = rows.reduce<Record<string, number>>((acc, row) => {
    const key = principalRawCode(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const reasonCodeCounts = rows.reduce<Record<string, number>>((acc, row) => {
    for (const code of row.classifier.reasonCodes) {
      acc[code] = (acc[code] ?? 0) + 1;
    }
    return acc;
  }, {});
  const unknownRows = rows
    .filter((row) => row.classifier.sportClass === "unknown")
    .slice(0, 20)
    .map((row) => ({
      student: row.student,
      date: row.workoutDate,
      workoutId: row.workoutId,
      title: row.title,
      sportOrTypeCode: row.sportOrTypeCode,
      workoutTypeValueId: row.workoutTypeValueId,
      snapshotWorkoutTypeValueId: row.snapshotWorkoutTypeValueId,
      snapshotRawWorkoutTypeValueId: row.snapshotRawWorkoutTypeValueId,
      snapshotRawCode: row.snapshotRawCode,
      reasonCodes: row.classifier.reasonCodes,
    }));

  const strongRunningIds = byTypeId
    .filter((bucket) => {
      if (bucket.id === 3) {
        return false;
      }
      if (bucket.total < 3 || bucket.completed < 2) {
        return false;
      }
      const runningRatio = bucket.runningLike / bucket.total;
      return runningRatio >= 0.85 && bucket.strengthOnly === 0 && bucket.runningEvidenceRows >= 2;
    })
    .map((bucket) => ({
      id: bucket.id,
      total: bucket.total,
      completed: bucket.completed,
      runningLike: bucket.runningLike,
      strengthOnly: bucket.strengthOnly,
      unknown: bucket.unknown,
      topRawCodes: topEntries(bucket.rawCodeCounts, 3),
      reasonCodes: topEntries(bucket.reasonCodeCounts, 5),
      titleExamples: bucket.titleExamples,
    }));

  const strongStrengthIds = byTypeId
    .filter((bucket) => {
      if (bucket.total < 3 || bucket.completed < 2) {
        return false;
      }
      const strengthRatio = bucket.strengthOnly / bucket.total;
      return strengthRatio >= 0.85 && bucket.runningLike === 0 && bucket.strengthEvidenceRows >= 2;
    })
    .map((bucket) => ({
      id: bucket.id,
      total: bucket.total,
      strengthOnly: bucket.strengthOnly,
      runningLike: bucket.runningLike,
      topRawCodes: topEntries(bucket.rawCodeCounts, 3),
      reasonCodes: topEntries(bucket.reasonCodeCounts, 5),
      titleExamples: bucket.titleExamples,
    }));

  const summary = {
    asOfDate: options.asOfDate,
    fromDate,
    days: options.days,
    limit: options.limit,
    studentFilter: resolvedStudent.studentName ?? null,
    sampledRows: rows.length,
    scannedRows: scanned.length,
    sportClassCounts,
    runningCompletionCounts,
    topRawCodes: topEntries(rawCodeCounts, 15),
    topReasonCodes: topEntries(reasonCodeCounts, 20),
    typeIdDistribution: byTypeId.map((bucket) => ({
      id: bucket.id,
      total: bucket.total,
      completed: bucket.completed,
      planned: bucket.planned,
      runningLike: bucket.runningLike,
      strengthOnly: bucket.strengthOnly,
      crossOther: bucket.crossOther,
      unknown: bucket.unknown,
      highConfidence: bucket.highConfidence,
      mediumConfidence: bucket.mediumConfidence,
      lowConfidence: bucket.lowConfidence,
      topRawCodes: topEntries(bucket.rawCodeCounts, 5),
      topReasonCodes: topEntries(bucket.reasonCodeCounts, 8),
      titleExamples: bucket.titleExamples,
    })),
    strongRunningIdCandidates: strongRunningIds,
    strongStrengthIdBuckets: strongStrengthIds,
    unknownRows,
    sampledRowsDetailed: rows,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`${LOG_PREFIX} window=${fromDate}..${options.asOfDate} sampled=${rows.length} scanned=${scanned.length}`);
  console.log(`${LOG_PREFIX} sportClassCounts ${JSON.stringify(sportClassCounts)}`);
  console.log(`${LOG_PREFIX} runningCompletionCounts ${JSON.stringify(runningCompletionCounts)}`);
  console.log(`${LOG_PREFIX} topRawCodes ${JSON.stringify(topEntries(rawCodeCounts, 10))}`);
  console.log(`${LOG_PREFIX} topReasonCodes ${JSON.stringify(topEntries(reasonCodeCounts, 10))}`);
  console.log(`${LOG_PREFIX} strongRunningIdCandidates ${JSON.stringify(strongRunningIds)}`);
  console.log(`${LOG_PREFIX} strongStrengthIdBuckets ${JSON.stringify(strongStrengthIds)}`);
  console.log(`${LOG_PREFIX} unknownRowsPreview ${JSON.stringify(unknownRows, null, 2)}`);
  console.log(`${LOG_PREFIX} typeIdDistributionTop ${JSON.stringify(summary.typeIdDistribution.slice(0, 20), null, 2)}`);
}

if (process.argv[1]?.endsWith("diagnose-trainingpeaks-workout-type-mapping.ts")) {
  run().catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exitCode = 1;
  });
}
