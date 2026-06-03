import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type {
  TrainingPeaksStudent,
  TrainingPeaksStudentMemoryItem,
  TrainingPeaksStudentOperationalSignal,
  TrainingPeaksWorkoutCacheRow,
} from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { toolRoot } from "./lib/paths.ts";

type CliArgs = {
  from: string;
  to: string;
  json: boolean;
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  listTrainingPeaksStudentsIncludingArchived?: () => Promise<TrainingPeaksStudent[]>;
  listTrainingPeaksWorkoutCacheForDateRange?: (input: {
    from: string;
    to: string;
    studentId?: string;
  }) => Promise<TrainingPeaksWorkoutCacheRow[]>;
  listTrainingPeaksStudentMemoryItemsForStudents?: (
    studentIds: readonly string[],
    options?: { activeOnly?: boolean; includeExpired?: boolean; limit?: number },
  ) => Promise<TrainingPeaksStudentMemoryItem[]>;
  listTrainingPeaksOperationalSignals?: (input?: {
    limit?: number;
    offset?: number;
    status?: string;
    studentQuery?: string | null;
    signalType?: string;
  }) => Promise<{ items: TrainingPeaksStudentOperationalSignal[]; total: number }>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    listTrainingPeaksStudentsIncludingArchived?: () => Promise<TrainingPeaksStudent[]>;
    listTrainingPeaksWorkoutCacheForDateRange?: (input: {
      from: string;
      to: string;
      studentId?: string;
    }) => Promise<TrainingPeaksWorkoutCacheRow[]>;
    listTrainingPeaksStudentMemoryItemsForStudents?: (
      studentIds: readonly string[],
      options?: { activeOnly?: boolean; includeExpired?: boolean; limit?: number },
    ) => Promise<TrainingPeaksStudentMemoryItem[]>;
    listTrainingPeaksOperationalSignals?: (input?: {
      limit?: number;
      offset?: number;
      status?: string;
      studentQuery?: string | null;
      signalType?: string;
    }) => Promise<{ items: TrainingPeaksStudentOperationalSignal[]; total: number }>;
  };
};

type PriorityHeuristic = {
  suggested_priority: "A_or_B_candidate" | "B_or_C_candidate" | "unknown";
  priority_source: "missing" | "provided";
  reason: string;
};

type Candidate = {
  student_id: string;
  student_name: string;
  athlete_id: number | null;
  score: number;
  reasons: string[];
  data_gaps: string[];
  metrics: {
    workouts_in_window: number;
    recent_4w_compliance: number | null;
    workout_categories_count: number;
    has_structured_history_signal: boolean;
    has_injury_or_constraint_signal: boolean;
    compliance_variability: number | null;
    future_event_detected: boolean;
    future_event_title: string | null;
    future_event_date: string | null;
    future_event_distance_meters: number | null;
    event_priority: PriorityHeuristic;
  };
};

type CandidateSelectionReport = {
  input: CliArgs;
  top_5_advanced: Candidate[];
  top_5_intermediate: Candidate[];
  top_5_constrained: Candidate[];
  recommended_3_pilots: Array<{
    category: "advanced" | "intermediate" | "constrained";
    candidate: Candidate | null;
    rationale: string;
  }>;
  data_gaps: string[];
  warnings: string[];
  manual_igor_approval_required_before_plan_generation: true;
};

const ADVANCED_EVENT_KEYWORDS = /\b(marathon|half|hm|21k|42k|race|main)\b/i;
const INTERMEDIATE_EVENT_KEYWORDS = /\b(10k|race|event|goal)\b/i;
const TUNE_UP_KEYWORDS = /\b(tune-up|local|5k|control|test)\b/i;

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
  console.log("Pilot candidate selection diagnostic (read-only)");
  console.log("");
  console.log("Usage:");
  console.log("  npm run tp-diagnose-pilot-candidate-selection -- --from 2026-06-01 --to 2026-11-30");
  console.log("  npm run tp-diagnose-pilot-candidate-selection -- --from 2026-06-01 --to 2026-11-30 --json");
  console.log("");
  console.log("Safety:");
  console.log("  - read-only");
  console.log("  - no DB writes");
  console.log("  - no TrainingPeaks mutations");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    from: "",
    to: "",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
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
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.from) || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.to)) {
    throw new Error("Invalid --from/--to. Expected YYYY-MM-DD.");
  }
  if (parsed.from > parsed.to) {
    throw new Error("--from must be <= --to.");
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

function toNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function inferCategoryKey(row: TrainingPeaksWorkoutCacheRow): string {
  const title = (row.title ?? "").toLowerCase();
  if (/\b(run|tempo|interval|long run|easy)\b/.test(title) || row.workoutTypeValueId === 3) return "running";
  if (/\b(strength|gym|mobility|core|weights)\b/.test(title) || row.workoutTypeValueId === 20) return "strength";
  if (/\b(bike|ride)\b/.test(title)) return "bike";
  if (/\b(swim)\b/.test(title)) return "swim";
  return "other";
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Number(Math.sqrt(variance).toFixed(2));
}

function readEventFromMemories(memories: TrainingPeaksStudentMemoryItem[]): {
  date: string | null;
  title: string | null;
  distanceMeters: number | null;
} {
  const eventMemory = memories.find((item) => item.memoryType === "race_or_goal");
  if (!eventMemory) return { date: null, title: null, distanceMeters: null };
  const structured = eventMemory.structured ?? {};
  const title = typeof structured.title === "string" ? structured.title : eventMemory.summaryText;
  const date =
    typeof structured.event_date === "string"
      ? structured.event_date
      : typeof structured.date === "string"
        ? structured.date
        : null;
  const distanceMeters =
    toNumeric(structured.distance_meters) ??
    (() => {
      const summary = eventMemory.summaryText.toLowerCase();
      if (summary.includes("marathon")) return 42195;
      if (summary.includes("half")) return 21097;
      if (summary.includes("10k")) return 10000;
      if (summary.includes("5k")) return 5000;
      return null;
    })();
  return { date, title: title ?? null, distanceMeters };
}

function classifyPriority(eventTitle: string | null): PriorityHeuristic {
  if (!eventTitle) {
    return {
      suggested_priority: "unknown",
      priority_source: "missing",
      reason: "No explicit event title; atpPriority unavailable.",
    };
  }
  const normalized = eventTitle.toLowerCase();
  if (ADVANCED_EVENT_KEYWORDS.test(normalized)) {
    return {
      suggested_priority: "A_or_B_candidate",
      priority_source: "missing",
      reason: "Main race keywords detected; atpPriority missing.",
    };
  }
  if (TUNE_UP_KEYWORDS.test(normalized)) {
    return {
      suggested_priority: "B_or_C_candidate",
      priority_source: "missing",
      reason: "Tune-up/local/control keywords detected; atpPriority missing.",
    };
  }
  return {
    suggested_priority: "unknown",
    priority_source: "missing",
    reason: "No clear priority keyword; coach review required.",
  };
}

function daysBetween(startIso: string, endIso: string): number | null {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / (24 * 3600 * 1000));
}

function buildAdvancedScore(input: Candidate): number {
  let score = 0;
  const daysToEvent =
    input.metrics.future_event_date && input.metrics.future_event_date >= "1900-01-01"
      ? daysBetween(new Date().toISOString().slice(0, 10), input.metrics.future_event_date)
      : null;
  if (input.metrics.future_event_detected) score += 20;
  if (daysToEvent !== null && daysToEvent >= 42 && daysToEvent <= 112) score += 25;
  if ((input.metrics.future_event_distance_meters ?? 0) >= 10000) score += 20;
  if ((input.metrics.recent_4w_compliance ?? 0) >= 80) score += 15;
  if (input.metrics.workouts_in_window >= 24) score += 10;
  if (input.metrics.workout_categories_count >= 3) score += 5;
  if (input.metrics.has_structured_history_signal) score += 5;
  return score;
}

function buildIntermediateScore(input: Candidate): number {
  let score = 0;
  const daysToEvent =
    input.metrics.future_event_date && input.metrics.future_event_date >= "1900-01-01"
      ? daysBetween(new Date().toISOString().slice(0, 10), input.metrics.future_event_date)
      : null;
  if (input.metrics.future_event_detected) score += 20;
  if (daysToEvent !== null && daysToEvent >= 14 && daysToEvent <= 112) score += 20;
  if ((input.metrics.recent_4w_compliance ?? 0) >= 65) score += 20;
  if (input.metrics.workouts_in_window >= 12) score += 15;
  if (!input.metrics.has_injury_or_constraint_signal) score += 10;
  if (INTERMEDIATE_EVENT_KEYWORDS.test(input.metrics.future_event_title ?? "")) score += 15;
  return score;
}

function buildConstrainedScore(input: Candidate): number {
  let score = 0;
  if (input.metrics.has_injury_or_constraint_signal) score += 35;
  if ((input.metrics.compliance_variability ?? 0) >= 15) score += 20;
  if ((input.metrics.recent_4w_compliance ?? 0) <= 70) score += 20;
  if (input.metrics.future_event_detected) score += 15;
  if (input.metrics.workouts_in_window >= 8) score += 10;
  return score;
}

function markdown(report: CandidateSelectionReport): string {
  const lines: string[] = [];
  lines.push("# Pilot Candidate Selection");
  lines.push("");
  lines.push(`- from: \`${report.input.from}\``);
  lines.push(`- to: \`${report.input.to}\``);
  lines.push("- read_only: true");
  lines.push("");
  lines.push("## Top 5 advanced candidates");
  for (const candidate of report.top_5_advanced) {
    lines.push(`- ${candidate.student_name} (score=${candidate.score}) — ${candidate.reasons.join("; ")}`);
  }
  lines.push("");
  lines.push("## Top 5 intermediate candidates");
  for (const candidate of report.top_5_intermediate) {
    lines.push(`- ${candidate.student_name} (score=${candidate.score}) — ${candidate.reasons.join("; ")}`);
  }
  lines.push("");
  lines.push("## Top 5 constrained candidates");
  for (const candidate of report.top_5_constrained) {
    lines.push(`- ${candidate.student_name} (score=${candidate.score}) — ${candidate.reasons.join("; ")}`);
  }
  lines.push("");
  lines.push("## Recommended 3 pilots");
  for (const recommendation of report.recommended_3_pilots) {
    if (!recommendation.candidate) {
      lines.push(`- ${recommendation.category}: no suitable candidate`);
      continue;
    }
    lines.push(
      `- ${recommendation.category}: ${recommendation.candidate.student_name} — ${recommendation.rationale}`,
    );
  }
  lines.push("");
  lines.push("## Data gaps");
  for (const gap of report.data_gaps) lines.push(`- ${gap}`);
  lines.push("");
  lines.push("## Warnings");
  for (const warning of report.warnings) lines.push(`- ${warning}`);
  lines.push("");
  lines.push(
    `- Manual Igor approval required before any plan generation: **${report.manual_igor_approval_required_before_plan_generation ? "yes" : "no"}**`,
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const reportsDir = path.join(repoRoot, "reports", "pilot-candidate-selection", timestampForPath(new Date()));
  await mkdir(reportsDir, { recursive: true });

  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn =
    repoCompat.listTrainingPeaksStudentsIncludingArchived ??
    repoCompat.listTrainingPeaksStudents ??
    repoCompat.default?.listTrainingPeaksStudentsIncludingArchived ??
    repoCompat.default?.listTrainingPeaksStudents;
  const listWorkoutsFn =
    repoCompat.listTrainingPeaksWorkoutCacheForDateRange ??
    repoCompat.default?.listTrainingPeaksWorkoutCacheForDateRange;
  const listMemoriesFn =
    repoCompat.listTrainingPeaksStudentMemoryItemsForStudents ??
    repoCompat.default?.listTrainingPeaksStudentMemoryItemsForStudents;
  const listSignalsFn =
    repoCompat.listTrainingPeaksOperationalSignals ?? repoCompat.default?.listTrainingPeaksOperationalSignals;
  if (!listStudentsFn || !listWorkoutsFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const students = await listStudentsFn();
  const workouts = await listWorkoutsFn({ from: args.from, to: args.to });
  const studentIds = [...new Set(workouts.map((row) => row.studentId))];
  const memories = listMemoriesFn
    ? await listMemoriesFn(studentIds, { activeOnly: true, includeExpired: false, limit: 3000 })
    : [];
  const signals = listSignalsFn ? (await listSignalsFn({ limit: 200 })).items : [];

  const memoriesByStudent = new Map<string, TrainingPeaksStudentMemoryItem[]>();
  for (const memory of memories) {
    const current = memoriesByStudent.get(memory.studentId) ?? [];
    current.push(memory);
    memoriesByStudent.set(memory.studentId, current);
  }

  const signalByStudent = new Map<string, TrainingPeaksStudentOperationalSignal[]>();
  for (const signal of signals) {
    const current = signalByStudent.get(signal.studentId) ?? [];
    current.push(signal);
    signalByStudent.set(signal.studentId, current);
  }

  const workoutsByStudent = new Map<string, TrainingPeaksWorkoutCacheRow[]>();
  for (const workout of workouts) {
    const current = workoutsByStudent.get(workout.studentId) ?? [];
    current.push(workout);
    workoutsByStudent.set(workout.studentId, current);
  }

  const allCandidates: Candidate[] = [];
  for (const [studentId, rows] of workoutsByStudent.entries()) {
    const student = students.find((item) => item.id === studentId);
    if (!student) continue;
    const athleteId = rows[0]?.trainingPeaksAthleteId ?? null;
    const categorySet = new Set<string>();
    const complianceValuesRecent4w: number[] = [];
    const complianceValuesWindow: number[] = [];
    const nowIso = new Date().toISOString().slice(0, 10);
    const monthAgoIso = new Date(Date.now() - 28 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    for (const row of rows) {
      categorySet.add(inferCategoryKey(row));
      const compliance = toNumeric(row.complianceDurationPercent) ?? toNumeric(row.complianceDistancePercent);
      if (compliance !== null) {
        complianceValuesWindow.push(compliance);
        if (row.workoutDate >= monthAgoIso && row.workoutDate <= nowIso) {
          complianceValuesRecent4w.push(compliance);
        }
      }
    }

    const studentMemories = memoriesByStudent.get(studentId) ?? [];
    const studentSignals = signalByStudent.get(studentId) ?? [];
    const event = readEventFromMemories(studentMemories);
    const eventPriority = classifyPriority(event.title);
    const hasInjuryOrConstraint =
      studentMemories.some((item) => item.memoryType === "pain_or_injury" || item.memoryType === "schedule_constraint") ||
      studentSignals.some((item) => item.signalType === "pain_or_injury" || item.signalType === "schedule_constraint");
    const hasStructuredHistory = rows.some(
      (row) => (row.title ?? "").toLowerCase().includes("interval") || (row.title ?? "").toLowerCase().includes("tempo"),
    );

    const candidate: Candidate = {
      student_id: student.studentId,
      student_name: student.studentName,
      athlete_id: athleteId,
      score: 0,
      reasons: [],
      data_gaps: [],
      metrics: {
        workouts_in_window: rows.length,
        recent_4w_compliance: complianceValuesRecent4w.length
          ? Number((complianceValuesRecent4w.reduce((acc, value) => acc + value, 0) / complianceValuesRecent4w.length).toFixed(2))
          : null,
        workout_categories_count: categorySet.size,
        has_structured_history_signal: hasStructuredHistory,
        has_injury_or_constraint_signal: hasInjuryOrConstraint,
        compliance_variability: stddev(complianceValuesWindow),
        future_event_detected: Boolean(event.date && event.date >= args.from && event.date <= args.to),
        future_event_title: event.title,
        future_event_date: event.date,
        future_event_distance_meters: event.distanceMeters,
        event_priority: eventPriority,
      },
    };

    if (!candidate.metrics.future_event_detected) candidate.data_gaps.push("No future event found in memory for range.");
    if (candidate.metrics.recent_4w_compliance === null) candidate.data_gaps.push("Recent 4-week compliance missing.");
    if (candidate.metrics.workout_categories_count < 2) candidate.data_gaps.push("Low workout category diversity.");
    if (eventPriority.priority_source === "missing") candidate.data_gaps.push("TrainingPeaks atpPriority missing; heuristic only.");

    allCandidates.push(candidate);
  }

  const advanced = allCandidates
    .map((candidate) => {
      const score = buildAdvancedScore(candidate);
      return {
        ...candidate,
        score,
        reasons: [
          candidate.metrics.future_event_detected ? "future event detected" : "future event missing",
          `recent_4w_compliance=${candidate.metrics.recent_4w_compliance ?? "n/a"}`,
          `categories=${candidate.metrics.workout_categories_count}`,
          `event_priority=${candidate.metrics.event_priority.suggested_priority}`,
        ],
      };
    })
    .sort((a, b) => b.score - a.score || b.metrics.workouts_in_window - a.metrics.workouts_in_window)
    .slice(0, 5);

  const intermediate = allCandidates
    .map((candidate) => {
      const score = buildIntermediateScore(candidate);
      return {
        ...candidate,
        score,
        reasons: [
          candidate.metrics.future_event_detected ? "future event detected" : "future event missing",
          `recent_4w_compliance=${candidate.metrics.recent_4w_compliance ?? "n/a"}`,
          candidate.metrics.has_injury_or_constraint_signal ? "constraint signal present" : "no active constraint signal",
          `window_workouts=${candidate.metrics.workouts_in_window}`,
        ],
      };
    })
    .sort((a, b) => b.score - a.score || b.metrics.workouts_in_window - a.metrics.workouts_in_window)
    .slice(0, 5);

  const constrained = allCandidates
    .map((candidate) => {
      const score = buildConstrainedScore(candidate);
      return {
        ...candidate,
        score,
        reasons: [
          candidate.metrics.has_injury_or_constraint_signal ? "injury/constraint signal present" : "no explicit constraint signal",
          `compliance_variability=${candidate.metrics.compliance_variability ?? "n/a"}`,
          `recent_4w_compliance=${candidate.metrics.recent_4w_compliance ?? "n/a"}`,
          candidate.metrics.future_event_detected ? "future event still present" : "future event missing",
        ],
      };
    })
    .sort((a, b) => b.score - a.score || b.metrics.workouts_in_window - a.metrics.workouts_in_window)
    .slice(0, 5);

  const report: CandidateSelectionReport = {
    input: args,
    top_5_advanced: advanced,
    top_5_intermediate: intermediate,
    top_5_constrained: constrained,
    recommended_3_pilots: [
      {
        category: "advanced",
        candidate: advanced[0] ?? null,
        rationale:
          advanced[0]
            ? "Best available score for advanced serious-race profile; requires coach review of event priority heuristic."
            : "No candidate met minimum data requirements.",
      },
      {
        category: "intermediate",
        candidate: intermediate[0] ?? null,
        rationale:
          intermediate[0]
            ? "Best available score for intermediate clear-goal profile; verify event intent manually."
            : "No candidate met minimum data requirements.",
      },
      {
        category: "constrained",
        candidate: constrained[0] ?? null,
        rationale:
          constrained[0]
            ? "Best available constrained profile with active instability signals and future goal context."
            : "No candidate met minimum data requirements.",
      },
    ],
    data_gaps: [
      "Event priority does not rely on TrainingPeaks atpPriority because it is typically null in observed data.",
      "Event detection currently relies on memory/signal context and should be cross-checked by coach.",
      "Some athletes have missing recent compliance values in cache.",
    ],
    warnings: [
      "This script is read-only and proposes pilots only.",
      "Final event priority assignment must be coach-reviewed.",
      "Manual Igor approval is required before generating any plan artifacts.",
    ],
    manual_igor_approval_required_before_plan_generation: true,
  };

  const jsonPath = path.join(reportsDir, "candidate-selection.json");
  const mdPath = path.join(reportsDir, "candidate-selection.md");
  const gapsPath = path.join(reportsDir, "candidate-data-gaps.md");

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown(report), "utf8");
  await writeFile(
    gapsPath,
    `${report.data_gaps.map((gap) => `- ${gap}`).join("\n")}\n\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}\n`,
    "utf8",
  );

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("[tp-diagnose-pilot-candidate-selection] read_only=true");
    console.log(`from: ${args.from}`);
    console.log(`to: ${args.to}`);
    console.log(`top_advanced_count: ${report.top_5_advanced.length}`);
    console.log(`top_intermediate_count: ${report.top_5_intermediate.length}`);
    console.log(`top_constrained_count: ${report.top_5_constrained.length}`);
    console.log(`candidate_selection_json: ${jsonPath}`);
    console.log(`candidate_selection_md: ${mdPath}`);
    console.log(`candidate_data_gaps_md: ${gapsPath}`);
    console.log("manual_igor_approval_required_before_plan_generation: true");
  }
}

main().catch((error: unknown) => {
  console.error("tp-diagnose-pilot-candidate-selection failed.");
  console.error(error);
  process.exit(1);
});
