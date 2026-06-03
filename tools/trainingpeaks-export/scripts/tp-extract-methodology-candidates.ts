import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { TrainingPeaksStudent, TrainingPeaksWorkoutCacheRow } from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { toolRoot } from "./lib/paths.ts";
import {
  buildCandidatesMarkdown,
  buildDataGapsMarkdown,
  buildFamilySummaryMarkdown,
  buildMismatchReportMarkdown,
  buildTemplateLibraryV0Markdown,
  extractMethodologyClusters,
  type DataGapSummary,
} from "./lib/methodology-candidate-extraction.ts";

type CliArgs = {
  from: string | null;
  to: string | null;
  lastMonths: number;
  student: string | null;
  json: boolean;
  help: boolean;
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

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildDateRangeFromLastMonths(months: number): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
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

function printHelp(): void {
  console.log("Methodology candidates extractor (read-only)");
  console.log("");
  console.log("Usage:");
  console.log("  npm run tp-extract-methodology-candidates -- --last-months 12");
  console.log("  npm run tp-extract-methodology-candidates -- --from 2025-06-03 --to 2026-06-03");
  console.log('  npm run tp-extract-methodology-candidates -- --student "Name"');
  console.log("  npm run tp-extract-methodology-candidates -- --json");
  console.log("");
  console.log("Safety:");
  console.log("  - read-only");
  console.log("  - no TrainingPeaks mutations");
  console.log("  - no DB writes");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    from: null,
    to: null,
    lastMonths: 12,
    student: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
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
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg === "--from") {
      parsed.from = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg === "--to") {
      parsed.to = (argv[index + 1] ?? "").trim();
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

  if (parsed.help) return parsed;
  if (!Number.isFinite(parsed.lastMonths) || parsed.lastMonths <= 0 || parsed.lastMonths > 120) {
    throw new Error("Invalid --last-months. Expected 1..120.");
  }
  const hasExplicitRange = Boolean(parsed.from || parsed.to);
  if (hasExplicitRange) {
    if (!parsed.from || !parsed.to) {
      throw new Error("Provide both --from and --to when explicit range is used.");
    }
    if (!isIsoDate(parsed.from) || !isIsoDate(parsed.to)) {
      throw new Error(`Invalid date range (${parsed.from}..${parsed.to}). Expected YYYY-MM-DD.`);
    }
    if (parsed.from > parsed.to) {
      throw new Error(`Invalid date range: --from (${parsed.from}) is after --to (${parsed.to}).`);
    }
  }
  return parsed;
}

function detectDataGaps(rows: TrainingPeaksWorkoutCacheRow[]): DataGapSummary {
  const dbFields = [
    "title",
    "sport_or_type_code",
    "workout_type_value_id",
    "workout_sub_type_id",
    "planned_time_raw",
    "completed_time_raw",
    "planned_distance_raw",
    "completed_distance_raw",
    "compliance_duration_percent",
    "compliance_distance_percent",
    "source_snapshot",
  ];
  const requiredSnapshotFields = [
    "description",
    "coachComments",
    "structure",
    "tssActual",
    "tssPlanned",
    "ifActual",
    "ifPlanned",
    "totalTimePlanned",
    "workoutTypeValueId",
    "isHidden",
  ];

  const availableSnapshot = new Set<string>();
  for (const row of rows) {
    if (!row.sourceSnapshot || typeof row.sourceSnapshot !== "object" || Array.isArray(row.sourceSnapshot)) {
      continue;
    }
    for (const key of Object.keys(row.sourceSnapshot as Record<string, unknown>)) {
      availableSnapshot.add(key);
    }
  }

  const availableInParsed = ["reports/tp-network-truth-capture/structured-running-workouts/cases/*.json"];
  const missingEverywhere = requiredSnapshotFields.filter((field) => !availableSnapshot.has(field));
  const descriptionsLikelyViaPeriodScan = rows.some((row) => {
    if (!row.sourceSnapshot || typeof row.sourceSnapshot !== "object" || Array.isArray(row.sourceSnapshot)) return false;
    const value = (row.sourceSnapshot as Record<string, unknown>).rawTitle;
    return typeof value === "string" || value === null;
  });

  return {
    dbFields,
    availableInSnapshot: [...availableSnapshot].sort(),
    availableInParsed,
    missingEverywhere,
    descriptionsLikelyViaPeriodScan,
    shouldExpandCompactSnapshot: missingEverywhere.length > 0,
  };
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn = repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const listRangeFn =
    repoCompat.listTrainingPeaksWorkoutCacheForDateRange ?? repoCompat.default?.listTrainingPeaksWorkoutCacheForDateRange;
  if (!listStudentsFn || !listRangeFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const students = await listStudentsFn();
  const { from, to } = args.from && args.to ? { from: args.from, to: args.to } : buildDateRangeFromLastMonths(args.lastMonths);

  let studentId: string | undefined;
  if (args.student) {
    const matched = students.filter((student) => {
      const needle = normalizeName(args.student!);
      return (
        normalizeName(student.studentName) === needle ||
        student.studentId.trim().toLowerCase() === needle ||
        student.id.trim().toLowerCase() === needle
      );
    });
    if (matched.length === 0) {
      throw new Error(`No active student matched --student="${args.student}"`);
    }
    if (matched.length > 1) {
      throw new Error(`Multiple active students matched --student="${args.student}"`);
    }
    studentId = matched[0]!.id;
  }

  const rows = await listRangeFn({ from, to, studentId });
  const clusters = extractMethodologyClusters(rows).filter((cluster) => cluster.count >= 3);
  const dataGapSummary = detectDataGaps(rows);

  const reportsRoot = path.resolve(toolRoot, "..", "..", "reports", "methodology-extraction", timestampForPath(new Date()));
  await mkdir(reportsRoot, { recursive: true });

  const candidatesJsonPath = path.join(reportsRoot, "methodology-candidates.json");
  const candidatesMdPath = path.join(reportsRoot, "methodology-candidates.md");
  const familySummaryPath = path.join(reportsRoot, "family-summary.md");
  const mismatchPath = path.join(reportsRoot, "description-mismatch-report.md");
  const dataGapsPath = path.join(reportsRoot, "data-gaps.md");
  const templateLibraryPath = path.join(reportsRoot, "recommended-template-library-v0.md");

  await writeFile(
    candidatesJsonPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        from,
        to,
        studentFilter: args.student,
        totalRows: rows.length,
        totalClusters: clusters.length,
        highConfidence: clusters.filter((item) => item.confidence === "high").length,
        mediumConfidence: clusters.filter((item) => item.confidence === "medium").length,
        lowConfidence: clusters.filter((item) => item.confidence === "low").length,
        insufficientConfidence: clusters.filter((item) => item.confidence === "insufficient").length,
        mismatchClusters: clusters.filter((item) => item.consistencyStatus !== "consistent").length,
        dataGapSummary,
        clusters,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(candidatesMdPath, buildCandidatesMarkdown(clusters), "utf8");
  await writeFile(familySummaryPath, buildFamilySummaryMarkdown(clusters), "utf8");
  await writeFile(mismatchPath, buildMismatchReportMarkdown(clusters), "utf8");
  await writeFile(dataGapsPath, buildDataGapsMarkdown({ clusters, dataGapSummary }), "utf8");
  await writeFile(templateLibraryPath, buildTemplateLibraryV0Markdown(clusters), "utf8");

  const high = clusters.filter((item) => item.confidence === "high").length;
  const medium = clusters.filter((item) => item.confidence === "medium").length;
  const low = clusters.filter((item) => item.confidence === "low").length;
  const insufficient = clusters.filter((item) => item.confidence === "insufficient").length;
  const mismatchCount = clusters.filter((item) => item.consistencyStatus !== "consistent").length;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          from,
          to,
          rows: rows.length,
          clusters: clusters.length,
          high,
          medium,
          low,
          insufficient,
          mismatchCount,
          reportPath: reportsRoot,
          dataGapSummary,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("[tp-extract-methodology-candidates] read_only=true");
  console.log(`from: ${from}`);
  console.log(`to: ${to}`);
  console.log(`workout_rows: ${rows.length}`);
  console.log(`candidate_clusters: ${clusters.length}`);
  console.log(`confidence_high: ${high}`);
  console.log(`confidence_medium: ${medium}`);
  console.log(`confidence_low: ${low}`);
  console.log(`confidence_insufficient: ${insufficient}`);
  console.log(`mismatch_clusters: ${mismatchCount}`);
  console.log(`methodology_candidates_json: ${candidatesJsonPath}`);
  console.log(`methodology_candidates_md: ${candidatesMdPath}`);
  console.log(`family_summary_md: ${familySummaryPath}`);
  console.log(`description_mismatch_report_md: ${mismatchPath}`);
  console.log(`data_gaps_md: ${dataGapsPath}`);
  console.log(`recommended_template_library_md: ${templateLibraryPath}`);
}

main().catch((error: unknown) => {
  console.error("tp-extract-methodology-candidates failed.");
  console.error(error);
  process.exit(1);
});
