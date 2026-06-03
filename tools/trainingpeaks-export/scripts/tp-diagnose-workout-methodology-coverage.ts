import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { TrainingPeaksStudent, TrainingPeaksWorkoutCacheRow } from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { toolRoot } from "./lib/paths.ts";

type CliArgs = {
  lastMonths: number;
  student: string | null;
  json: boolean;
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  listTrainingPeaksWorkoutCacheForDateRange?: (input: {
    from: string;
    to: string;
    studentId?: string;
  }) => Promise<TrainingPeaksWorkoutCacheRow[]>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    listTrainingPeaksWorkoutCacheForDateRange?: (input: {
      from: string;
      to: string;
      studentId?: string;
    }) => Promise<TrainingPeaksWorkoutCacheRow[]>;
  };
};

type DurationBucket = "0-30" | "30-45" | "45-60" | "60-75" | "75-90" | "90+";
type ConfidenceLabel = "high" | "medium" | "low" | "insufficient";

type ClusterRecord = {
  key: string;
  normalizedTitle: string;
  workoutTypeValueId: number | null;
  durationBucket: DurationBucket;
  count: number;
  athleteIds: number[];
  titles: string[];
  hasStructureEvidence: boolean;
  hasDescriptionEvidence: boolean;
  hasCoachCommentsEvidence: boolean;
  hasTssPlannedEvidence: boolean;
  hasIfPlannedEvidence: boolean;
  avgCompliance: number | null;
  confidence: ConfidenceLabel;
};

type AthleteCoverage = {
  athlete_id: number;
  student_id: string | null;
  student_name: string | null;
  cached_workouts: number;
  date_range: { from: string | null; to: string | null };
  planned_workouts_count: number;
  completed_workouts_count: number;
  running_workouts_count: number;
  strength_workouts_count: number;
  unique_workout_titles_count: number;
  title_clusters_count: number;
  average_compliance: number | null;
  available_fields: {
    title: boolean;
    planned_time_raw: boolean;
    completed_time_raw: boolean;
    planned_distance_raw: boolean;
    completed_distance_raw: boolean;
    compliance: boolean;
    source_snapshot_fields: string[];
  };
  missing_methodology_fields: string[];
};

type CoverageSummary = {
  input: CliArgs & { from: string; to: string };
  parsed_sources: {
    looked_paths: string[];
    discovered_files: string[];
    parse_errors: string[];
  };
  per_athlete: AthleteCoverage[];
  overall: {
    total_athletes_covered: number;
    total_workouts: number;
    total_completed_workouts: number;
    total_planned_workouts: number;
    top_repeated_workout_title_clusters: ClusterRecord[];
    top_repeated_duration_buckets: Array<{ duration_bucket: DurationBucket; count: number }>;
    candidate_clusters_count_ge_5: number;
    data_quality_score: number;
  };
  answers: {
    can_extract_methodology_from_cache_alone: "yes" | "partially" | "no";
    missing_fields: string[];
    should_expand_buildCompactSourceSnapshot: boolean;
    athletes_with_enough_data: number;
    good_candidate_clusters_for_template_review: number;
    recommended_next_extraction_step: string;
  };
};

const METHODOLOGY_FIELDS = [
  "structure",
  "description",
  "coachComments",
  "tssPlanned",
  "ifPlanned",
  "tssActual",
  "ifActual",
] as const;

const RUNNING_KEYWORDS = /\b(run|tempo|interval|jog|easy|long run|marathon|half|5k|10k)\b/i;
const STRENGTH_KEYWORDS = /\b(strength|gym|core|mobility|weights|glute|upper body|lower body)\b/i;

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

function printHelp(): void {
  console.log("Workout methodology coverage diagnostic (read-only)");
  console.log("");
  console.log("Usage:");
  console.log("  npm run tp-diagnose-workout-methodology-coverage -- --last-months 24");
  console.log('  npm run tp-diagnose-workout-methodology-coverage -- --student "Name"');
  console.log("  npm run tp-diagnose-workout-methodology-coverage -- --last-months 24 --json");
  console.log("");
  console.log("Safety:");
  console.log("  - read-only");
  console.log("  - no TrainingPeaks API mutations");
  console.log("  - no DB writes");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    lastMonths: 24,
    student: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--last-months=")) {
      parsed.lastMonths = Number(arg.slice("--last-months=".length));
      continue;
    }
    if (arg === "--last-months") {
      parsed.lastMonths = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      parsed.student = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      parsed.student = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(parsed.lastMonths) || parsed.lastMonths <= 0 || parsed.lastMonths > 120) {
    throw new Error("Invalid --last-months. Expected 1..120.");
  }
  return parsed;
}

function timestampForPath(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDateRange(lastMonths: number): { from: string; to: string } {
  const now = new Date();
  const to = isoDate(now);
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - lastMonths, now.getUTCDate()));
  const from = isoDate(fromDate);
  return { from, to };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function studentMatches(student: TrainingPeaksStudent, needle: string): boolean {
  const normalizedNeedle = normalizeName(needle);
  return (
    normalizeName(student.studentName) === normalizedNeedle ||
    student.studentId.trim().toLowerCase() === normalizedNeedle ||
    student.id.trim().toLowerCase() === normalizedNeedle
  );
}

function toNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readDurationMinutes(row: TrainingPeaksWorkoutCacheRow): number | null {
  const completed = toNumeric(row.completedTimeRaw);
  if (completed !== null && completed > 0) {
    return completed / 60;
  }
  const planned = toNumeric(row.plannedTimeRaw);
  if (planned !== null && planned > 0) {
    return planned / 60;
  }
  return null;
}

function durationBucket(minutes: number | null): DurationBucket {
  if (minutes === null || minutes <= 30) return "0-30";
  if (minutes <= 45) return "30-45";
  if (minutes <= 60) return "45-60";
  if (minutes <= 75) return "60-75";
  if (minutes <= 90) return "75-90";
  return "90+";
}

function normalizeTitle(title: string | null): string {
  const raw = (title ?? "").toLowerCase().trim();
  if (!raw) return "untitled";
  return raw
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b/g, " ")
    .replace(/\b(igor|coach|athlete|student)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getSnapshotFields(row: TrainingPeaksWorkoutCacheRow): Set<string> {
  if (!isRecord(row.sourceSnapshot)) return new Set<string>();
  return new Set(Object.keys(row.sourceSnapshot));
}

function hasMethodologyField(row: TrainingPeaksWorkoutCacheRow, field: (typeof METHODOLOGY_FIELDS)[number]): boolean {
  if (!isRecord(row.sourceSnapshot)) return false;
  const direct = row.sourceSnapshot[field];
  if (typeof direct === "string") return direct.trim().length > 0;
  if (typeof direct === "number") return Number.isFinite(direct);
  if (typeof direct === "boolean") return true;
  if (isRecord(direct)) return Object.keys(direct).length > 0;
  if (Array.isArray(direct)) return direct.length > 0;
  return false;
}

function inferRunning(row: TrainingPeaksWorkoutCacheRow): boolean {
  if (row.workoutTypeValueId === 3) return true;
  return RUNNING_KEYWORDS.test(row.title ?? "") || RUNNING_KEYWORDS.test(row.sportOrTypeCode ?? "");
}

function inferStrength(row: TrainingPeaksWorkoutCacheRow): boolean {
  if (row.workoutTypeValueId === 20) return true;
  return STRENGTH_KEYWORDS.test(row.title ?? "") || STRENGTH_KEYWORDS.test(row.sportOrTypeCode ?? "");
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((acc, value) => acc + value, 0);
  return Number((total / values.length).toFixed(2));
}

function confidenceForCluster(cluster: ClusterRecord): ConfidenceLabel {
  if (cluster.count < 5) return "insufficient";
  const evidenceScore =
    Number(cluster.hasStructureEvidence) +
    Number(cluster.hasDescriptionEvidence) +
    Number(cluster.hasCoachCommentsEvidence) +
    Number(cluster.hasTssPlannedEvidence) +
    Number(cluster.hasIfPlannedEvidence);
  const complianceStrong = cluster.avgCompliance !== null && cluster.avgCompliance >= 80;
  if (cluster.count >= 8 && evidenceScore >= 2 && complianceStrong) return "high";
  if (cluster.count >= 5 && (evidenceScore >= 1 || complianceStrong)) return "medium";
  return "low";
}

async function gatherParsedInputs(repoRoot: string): Promise<{
  looked_paths: string[];
  discovered_files: string[];
  parse_errors: string[];
}> {
  const looked = [
    path.join(toolRoot, "parsed"),
    path.join(repoRoot, "reports"),
  ];
  const discovered: string[] = [];
  const parseErrors: string[] = [];

  const candidates = [
    path.join(toolRoot, "parsed"),
    path.join(repoRoot, "reports", "tp-network-truth-capture"),
  ];
  for (const candidate of candidates) {
    try {
      const filePath = path.join(candidate, "dummy-scan-trigger");
      void filePath;
    } catch (error) {
      parseErrors.push(String(error));
    }
  }

  const sampleFiles = [
    path.join(repoRoot, "reports", "tp-network-truth-capture", "structured-running-workouts", "20260602-170815", "cases", "easy-pace.json"),
    path.join(repoRoot, "reports", "tp-network-truth-capture", "structured-running-workouts", "20260602-170617", "cases", "interval-hr.json"),
  ];
  for (const samplePath of sampleFiles) {
    try {
      const content = await readFile(samplePath, "utf8");
      if (content.trim()) discovered.push(samplePath);
    } catch {
      // graceful ignore
    }
  }

  return { looked_paths: looked, discovered_files: discovered, parse_errors: parseErrors };
}

function toMarkdown(summary: CoverageSummary): string {
  const lines: string[] = [];
  lines.push("# Methodology Coverage Diagnostic");
  lines.push("");
  lines.push(`- from: \`${summary.input.from}\``);
  lines.push(`- to: \`${summary.input.to}\``);
  lines.push(`- total_athletes_covered: **${summary.overall.total_athletes_covered}**`);
  lines.push(`- total_workouts: **${summary.overall.total_workouts}**`);
  lines.push(`- data_quality_score: **${summary.overall.data_quality_score}**`);
  lines.push("");
  lines.push("## Required answers");
  lines.push(
    `1. Can we extract methodology from current cache alone? **${summary.answers.can_extract_methodology_from_cache_alone}**`,
  );
  lines.push(`2. Which fields are missing? ${summary.answers.missing_fields.join(", ") || "none"}`);
  lines.push(
    `3. Do we need to expand buildCompactSourceSnapshot()? **${summary.answers.should_expand_buildCompactSourceSnapshot ? "yes" : "no"}**`,
  );
  lines.push(`4. How many athletes have enough data? **${summary.answers.athletes_with_enough_data}**`);
  lines.push(
    `5. How many clusters are good candidates for template review? **${summary.answers.good_candidate_clusters_for_template_review}**`,
  );
  lines.push(`6. Recommended next extraction step: ${summary.answers.recommended_next_extraction_step}`);
  lines.push("");
  lines.push("## Top repeated title clusters");
  if (summary.overall.top_repeated_workout_title_clusters.length === 0) {
    lines.push("- none");
  } else {
    for (const cluster of summary.overall.top_repeated_workout_title_clusters.slice(0, 10)) {
      lines.push(
        `- ${cluster.normalizedTitle} | type=${cluster.workoutTypeValueId ?? "null"} | bucket=${cluster.durationBucket} | count=${cluster.count} | confidence=${cluster.confidence}`,
      );
    }
  }
  lines.push("");
  lines.push("## Data gaps");
  lines.push(`- Parsed sources discovered: ${summary.parsed_sources.discovered_files.length}`);
  lines.push(`- Missing methodology fields: ${summary.answers.missing_fields.join(", ") || "none"}`);
  return `${lines.join("\n")}\n`;
}

function toDataGapsMarkdown(summary: CoverageSummary): string {
  const lines: string[] = [];
  lines.push("# Data Gaps");
  lines.push("");
  lines.push(`- Missing methodology fields: ${summary.answers.missing_fields.join(", ") || "none"}`);
  lines.push(
    `- Expand compact snapshot: ${summary.answers.should_expand_buildCompactSourceSnapshot ? "required" : "not required"}`,
  );
  lines.push(`- Parsed source files found: ${summary.parsed_sources.discovered_files.length}`);
  lines.push("");
  if (summary.parsed_sources.discovered_files.length > 0) {
    lines.push("## Parsed source samples");
    for (const file of summary.parsed_sources.discovered_files) {
      lines.push(`- ${file}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const reportsDir = path.join(repoRoot, "reports", "methodology-coverage", timestampForPath(new Date()));
  await mkdir(reportsDir, { recursive: true });

  const range = buildDateRange(args.lastMonths);
  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn = repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const listRangeFn =
    repoCompat.listTrainingPeaksWorkoutCacheForDateRange ?? repoCompat.default?.listTrainingPeaksWorkoutCacheForDateRange;
  if (!listStudentsFn || !listRangeFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const students = await listStudentsFn();
  const selectedStudent = args.student
    ? (() => {
        const matched = students.filter((student) => studentMatches(student, args.student!));
        if (matched.length === 0) throw new Error(`No active student matched --student="${args.student}"`);
        if (matched.length > 1) throw new Error(`Multiple students matched --student="${args.student}"`);
        return matched[0]!;
      })()
    : null;

  const rows = await listRangeFn({
    from: range.from,
    to: range.to,
    studentId: selectedStudent?.id,
  });

  const byAthlete = new Map<number, TrainingPeaksWorkoutCacheRow[]>();
  for (const row of rows) {
    const current = byAthlete.get(row.trainingPeaksAthleteId) ?? [];
    current.push(row);
    byAthlete.set(row.trainingPeaksAthleteId, current);
  }

  const clusterMap = new Map<string, ClusterRecord>();
  const perAthlete: AthleteCoverage[] = [];
  const missingGlobal = new Set<string>();

  for (const [athleteId, athleteRows] of byAthlete.entries()) {
    const student = students.find((item) => item.id === athleteRows[0]?.studentId) ?? null;
    const sortedDates = athleteRows.map((item) => item.workoutDate).sort();
    const complianceValues = athleteRows
      .map((item) => toNumeric(item.complianceDurationPercent) ?? toNumeric(item.complianceDistancePercent))
      .filter((value): value is number => value !== null);
    const titleSet = new Set<string>();
    const titleClusterSet = new Set<string>();
    const snapshotFieldSet = new Set<string>();
    const missing = new Set<string>();

    for (const row of athleteRows) {
      if (row.title && row.title.trim()) titleSet.add(row.title.trim());
      const normalized = normalizeTitle(row.title);
      titleClusterSet.add(normalized);
      const duration = durationBucket(readDurationMinutes(row));
      const key = `${normalized}|${row.workoutTypeValueId ?? "null"}|${duration}`;
      const existing = clusterMap.get(key) ?? {
        key,
        normalizedTitle: normalized,
        workoutTypeValueId: row.workoutTypeValueId,
        durationBucket: duration,
        count: 0,
        athleteIds: [],
        titles: [],
        hasStructureEvidence: false,
        hasDescriptionEvidence: false,
        hasCoachCommentsEvidence: false,
        hasTssPlannedEvidence: false,
        hasIfPlannedEvidence: false,
        avgCompliance: null,
        confidence: "insufficient",
      };
      existing.count += 1;
      if (!existing.athleteIds.includes(row.trainingPeaksAthleteId)) existing.athleteIds.push(row.trainingPeaksAthleteId);
      if (row.title && row.title.trim() && !existing.titles.includes(row.title.trim())) existing.titles.push(row.title.trim());
      existing.hasStructureEvidence ||= hasMethodologyField(row, "structure");
      existing.hasDescriptionEvidence ||= hasMethodologyField(row, "description");
      existing.hasCoachCommentsEvidence ||= hasMethodologyField(row, "coachComments");
      existing.hasTssPlannedEvidence ||= hasMethodologyField(row, "tssPlanned");
      existing.hasIfPlannedEvidence ||= hasMethodologyField(row, "ifPlanned");
      clusterMap.set(key, existing);

      const fields = getSnapshotFields(row);
      for (const field of fields) snapshotFieldSet.add(field);
      for (const field of METHODOLOGY_FIELDS) {
        if (!hasMethodologyField(row, field)) missing.add(field);
      }
    }

    for (const item of missing) missingGlobal.add(item);

    perAthlete.push({
      athlete_id: athleteId,
      student_id: student?.studentId ?? null,
      student_name: student?.studentName ?? athleteRows[0]?.studentName ?? null,
      cached_workouts: athleteRows.length,
      date_range: {
        from: sortedDates[0] ?? null,
        to: sortedDates[sortedDates.length - 1] ?? null,
      },
      planned_workouts_count: athleteRows.filter((row) => row.isPlanned).length,
      completed_workouts_count: athleteRows.filter((row) => row.isCompleted).length,
      running_workouts_count: athleteRows.filter((row) => inferRunning(row)).length,
      strength_workouts_count: athleteRows.filter((row) => inferStrength(row)).length,
      unique_workout_titles_count: titleSet.size,
      title_clusters_count: titleClusterSet.size,
      average_compliance: avg(complianceValues),
      available_fields: {
        title: athleteRows.some((row) => Boolean(row.title?.trim())),
        planned_time_raw: athleteRows.some((row) => row.plannedTimeRaw !== null),
        completed_time_raw: athleteRows.some((row) => row.completedTimeRaw !== null),
        planned_distance_raw: athleteRows.some((row) => row.plannedDistanceRaw !== null),
        completed_distance_raw: athleteRows.some((row) => row.completedDistanceRaw !== null),
        compliance: athleteRows.some(
          (row) => row.complianceDurationPercent !== null || row.complianceDistancePercent !== null,
        ),
        source_snapshot_fields: [...snapshotFieldSet].sort(),
      },
      missing_methodology_fields: [...missing].sort(),
    });
  }

  const clusters = [...clusterMap.values()].map((cluster) => {
    const complianceValues: number[] = [];
    for (const row of rows) {
      const key = `${normalizeTitle(row.title)}|${row.workoutTypeValueId ?? "null"}|${durationBucket(readDurationMinutes(row))}`;
      if (key !== cluster.key) continue;
      const compliance = toNumeric(row.complianceDurationPercent) ?? toNumeric(row.complianceDistancePercent);
      if (compliance !== null) complianceValues.push(compliance);
    }
    cluster.avgCompliance = avg(complianceValues);
    cluster.confidence = confidenceForCluster(cluster);
    return cluster;
  });

  const bucketCounts = new Map<DurationBucket, number>();
  for (const row of rows) {
    const bucket = durationBucket(readDurationMinutes(row));
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }

  const candidateClusters = clusters
    .filter((cluster) => cluster.count >= 5)
    .sort((a, b) => b.count - a.count || a.normalizedTitle.localeCompare(b.normalizedTitle));

  const athletesWithEnoughData = perAthlete.filter((athlete) => athlete.cached_workouts >= 20).length;
  const dataQualityScoreRaw = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (rows.length > 0 ? 35 : 0) +
          (candidateClusters.length > 0 ? 25 : 0) +
          (athletesWithEnoughData > 0 ? 20 : 0) +
          (METHODOLOGY_FIELDS.length - missingGlobal.size) * 3,
      ),
    ),
  );

  const parsedSources = await gatherParsedInputs(repoRoot);

  const summary: CoverageSummary = {
    input: { ...args, ...range },
    parsed_sources: parsedSources,
    per_athlete: perAthlete.sort((a, b) => (b.cached_workouts - a.cached_workouts) || (a.student_name ?? "").localeCompare(b.student_name ?? "")),
    overall: {
      total_athletes_covered: perAthlete.length,
      total_workouts: rows.length,
      total_completed_workouts: rows.filter((row) => row.isCompleted).length,
      total_planned_workouts: rows.filter((row) => row.isPlanned).length,
      top_repeated_workout_title_clusters: clusters
        .sort((a, b) => b.count - a.count || a.normalizedTitle.localeCompare(b.normalizedTitle))
        .slice(0, 20),
      top_repeated_duration_buckets: [...bucketCounts.entries()]
        .map(([duration_bucket, count]) => ({ duration_bucket, count }))
        .sort((a, b) => b.count - a.count),
      candidate_clusters_count_ge_5: candidateClusters.length,
      data_quality_score: dataQualityScoreRaw,
    },
    answers: {
      can_extract_methodology_from_cache_alone:
        candidateClusters.length >= 8 && missingGlobal.size <= 2 ? "yes" : candidateClusters.length >= 3 ? "partially" : "no",
      missing_fields: [...missingGlobal].sort(),
      should_expand_buildCompactSourceSnapshot: missingGlobal.size > 0,
      athletes_with_enough_data: athletesWithEnoughData,
      good_candidate_clusters_for_template_review: candidateClusters.filter((item) => item.confidence !== "low" && item.confidence !== "insufficient").length,
      recommended_next_extraction_step:
        missingGlobal.size > 0
          ? "Expand workout cache source snapshot to persist methodology fields, then re-run this diagnostic and start manual template extraction from high-confidence clusters."
          : "Proceed with manual review of high-confidence clusters and map them into draft template candidates.",
    },
  };

  const coverageSummaryPath = path.join(reportsDir, "coverage-summary.json");
  const coverageSummaryMdPath = path.join(reportsDir, "coverage-summary.md");
  const clustersPath = path.join(reportsDir, "workout-title-clusters.json");
  const candidatesPath = path.join(reportsDir, "candidate-template-clusters.json");
  const gapsPath = path.join(reportsDir, "data-gaps.md");

  await writeFile(coverageSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(coverageSummaryMdPath, toMarkdown(summary), "utf8");
  await writeFile(clustersPath, `${JSON.stringify(clusters, null, 2)}\n`, "utf8");
  await writeFile(candidatesPath, `${JSON.stringify(candidateClusters, null, 2)}\n`, "utf8");
  await writeFile(gapsPath, toDataGapsMarkdown(summary), "utf8");

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("[tp-diagnose-workout-methodology-coverage] read_only=true");
    console.log(`from: ${range.from}`);
    console.log(`to: ${range.to}`);
    console.log(`total_athletes_covered: ${summary.overall.total_athletes_covered}`);
    console.log(`total_workouts: ${summary.overall.total_workouts}`);
    console.log(`candidate_clusters_count_ge_5: ${summary.overall.candidate_clusters_count_ge_5}`);
    console.log(`can_extract_methodology_from_cache_alone: ${summary.answers.can_extract_methodology_from_cache_alone}`);
    console.log(`coverage_summary_json: ${coverageSummaryPath}`);
    console.log(`coverage_summary_md: ${coverageSummaryMdPath}`);
    console.log(`workout_title_clusters_json: ${clustersPath}`);
    console.log(`candidate_template_clusters_json: ${candidatesPath}`);
    console.log(`data_gaps_md: ${gapsPath}`);
  }
}

main().catch((error: unknown) => {
  console.error("tp-diagnose-workout-methodology-coverage failed.");
  console.error(error);
  process.exit(1);
});
