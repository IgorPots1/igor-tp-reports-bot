import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { analyzeGroupWorkoutReport } from "@/features/trainingpeaks/group-workout-report-analyzer";
import {
  matchGroupWorkoutReportWorkoutFromCache,
  type GroupWorkoutReportWorkoutMatchResult,
} from "@/features/trainingpeaks/group-workout-report-matcher";
import {
  listTrainingPeaksStudents,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import {
  readTrainingPeaksCompletedWorkoutSummary,
  type TrainingPeaksCompletedWorkoutSummaryDetails,
  type TrainingPeaksCompletedWorkoutSummaryReaderResult,
} from "@/features/trainingpeaks/trainingpeaks-completed-workout-summary-reader";
import { loadScriptEnv, hasTrainingPeaksApiBearer } from "./lib/load-script-env";

type CliInput = {
  studentId?: string;
  athleteId?: string;
  date: string;
  workoutId?: string;
  message: string;
  help?: boolean;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_ROOT = "reports/group-workout-report-summary-analysis";

function timestampForPath(date = new Date()): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function parseCliArgs(argv: string[]): CliInput {
  const parsed: CliInput = {
    date: "",
    message: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--student-id") {
      parsed.studentId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--student-id=")) {
      parsed.studentId = arg.slice("--student-id=".length).trim();
      continue;
    }
    if (arg === "--athlete-id") {
      parsed.athleteId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      parsed.athleteId = arg.slice("--athlete-id=".length).trim();
      continue;
    }
    if (arg === "--date") {
      parsed.date = argv[index + 1]?.trim() ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      parsed.date = arg.slice("--date=".length).trim();
      continue;
    }
    if (arg === "--workout-id") {
      parsed.workoutId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--workout-id=")) {
      parsed.workoutId = arg.slice("--workout-id=".length).trim();
      continue;
    }
    if (arg === "--message") {
      parsed.message = argv[index + 1]?.trim() ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--message=")) {
      parsed.message = arg.slice("--message=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function parseAthleteIdFromUrl(url: string): number | null {
  const match = url.match(/\/athletes\/(\d+)/i);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function resolveTarget(input: CliInput): Promise<{
  studentId: string;
  athleteId: number;
  studentName: string;
}> {
  if (input.studentId) {
    const students = await listTrainingPeaksStudents();
    const student = students.find((entry) => entry.id === input.studentId);
    if (!student) {
      throw new Error(`No active student found for --student-id ${input.studentId}.`);
    }
    const athleteId = parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
    if (!athleteId) {
      throw new Error(`Student ${student.id} has no parseable athlete id in trainingPeaksAthleteUrl.`);
    }
    return {
      studentId: student.id,
      athleteId,
      studentName: student.studentName,
    };
  }

  const requestedAthleteId = Number(input.athleteId);
  const students = await listTrainingPeaksStudents();
  const matches = students.filter(
    (entry) => parseAthleteIdFromUrl(entry.trainingPeaksAthleteUrl) === requestedAthleteId
  );
  if (matches.length === 0) {
    throw new Error(`No active student found for --athlete-id ${requestedAthleteId}.`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous --athlete-id ${requestedAthleteId}: multiple active students matched.`);
  }
  const student = matches[0];
  return {
    studentId: student.id,
    athleteId: requestedAthleteId,
    studentName: student.studentName,
  };
}

function byWorkoutId(rows: TrainingPeaksWorkoutCacheRow[], id: string | null): TrainingPeaksWorkoutCacheRow | null {
  if (!id) {
    return null;
  }
  return rows.find((row) => String(row.trainingPeaksWorkoutId) === id) ?? null;
}

function buildDraftSafeClaims(analysis: ReturnType<typeof analyzeGroupWorkoutReport>): {
  allowed: string[];
  forbidden: string[];
} {
  const allowed: string[] = [];
  const forbidden: string[] = [
    "laps",
    "splits",
    "interval actuals",
    "per-repeat pace",
    "per-repeat HR",
    "repeat execution quality",
  ];

  if (analysis.dataAvailability.hasCompletedDuration) {
    allowed.push("duration");
  }
  if (analysis.dataAvailability.hasCompletedDistance) {
    allowed.push("distance");
  }
  if (analysis.dataAvailability.hasAveragePace) {
    allowed.push("average pace");
  }
  if (analysis.dataAvailability.hasAverageHeartRate) {
    allowed.push("average HR");
  }
  if (analysis.planActualBullets.some((bullet) => bullet.startsWith("Max HR:"))) {
    allowed.push("max HR");
  }
  if (analysis.planActualBullets.some((bullet) => bullet.includes("Planned structure present"))) {
    allowed.push("planned structure present");
  }
  if (analysis.planActualBullets.some((bullet) => bullet.includes("Target pace/HR present"))) {
    allowed.push("target pace/HR present");
  }
  if (analysis.planActualBullets.some((bullet) => bullet.includes("Coach comments present"))) {
    allowed.push("coach comments present");
  }

  return { allowed, forbidden };
}

function formatSummaryMarkdown(input: {
  target: { studentId: string; athleteId: number; studentName: string; date: string; workoutId?: string };
  message: string;
  match: GroupWorkoutReportWorkoutMatchResult;
  summaryReader: TrainingPeaksCompletedWorkoutSummaryReaderResult;
  liveSummary: TrainingPeaksCompletedWorkoutSummaryDetails | null;
  analysis: ReturnType<typeof analyzeGroupWorkoutReport>;
  draftClaims: { allowed: string[]; forbidden: string[] };
  bearerPresent: boolean;
}): string {
  const lines: string[] = [];
  lines.push("# Group Workout Report Summary Analysis");
  lines.push("");
  lines.push("## Target");
  lines.push(`- student_id: ${input.target.studentId}`);
  lines.push(`- student_name: ${input.target.studentName}`);
  lines.push(`- athlete_id: ${input.target.athleteId}`);
  lines.push(`- date: ${input.target.date}`);
  lines.push(`- workout_id: ${input.target.workoutId ?? "none"}`);
  lines.push(`- message: ${input.message}`);
  lines.push(`- bearer_present: ${input.bearerPresent}`);
  lines.push("");
  lines.push("## Match result");
  lines.push(`- status: ${input.match.status}`);
  lines.push(`- confidence: ${input.match.confidence}`);
  lines.push(`- reference_date: ${input.match.referenceDate}`);
  lines.push(`- selected_completed_workout_id: ${input.match.selectedCompletedWorkoutId ?? "none"}`);
  lines.push(`- selected_planned_workout_id: ${input.match.selectedPlannedWorkoutId ?? "none"}`);
  lines.push("");
  lines.push("## Live summary reader");
  lines.push(`- status: ${input.summaryReader.status}`);
  if (input.summaryReader.status === "success") {
    lines.push(`- source: ${input.liveSummary?.source ?? "n/a"}`);
    lines.push(`- workout_id: ${input.liveSummary?.workoutId ?? "none"}`);
    lines.push(`- title: ${input.liveSummary?.title ?? "none"}`);
  }
  if ("warnings" in input.summaryReader && input.summaryReader.warnings.length > 0) {
    lines.push("- warnings:");
    for (const warning of input.summaryReader.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  if (input.liveSummary) {
    lines.push("");
    lines.push("## Live summary availability");
    lines.push(`- duration: ${input.liveSummary.dataAvailability.hasDuration}`);
    lines.push(`- distance: ${input.liveSummary.dataAvailability.hasDistance}`);
    lines.push(`- avg pace: ${input.liveSummary.dataAvailability.hasAveragePace}`);
    lines.push(`- avg speed: ${input.liveSummary.dataAvailability.hasAverageSpeed}`);
    lines.push(`- avg HR: ${input.liveSummary.dataAvailability.hasAverageHeartRate}`);
    lines.push(`- max HR: ${input.liveSummary.dataAvailability.hasMaxHeartRate}`);
    lines.push(`- planned structure: ${input.liveSummary.dataAvailability.hasPlannedStructure}`);
    lines.push(`- target pace/HR: ${input.liveSummary.dataAvailability.hasTargetPaceOrHr}`);
    lines.push(`- coach comments: ${input.liveSummary.dataAvailability.hasCoachComments}`);
    lines.push(`- laps: ${input.liveSummary.dataAvailability.hasLaps}`);
    lines.push(`- splits: ${input.liveSummary.dataAvailability.hasSplits}`);
    lines.push(`- interval actuals: ${input.liveSummary.dataAvailability.hasIntervalActuals}`);
    lines.push(`- samples: ${input.liveSummary.dataAvailability.hasSamples}`);
  }
  lines.push("");
  lines.push("## Analysis");
  lines.push(`- confidence: ${input.analysis.confidence}`);
  lines.push(`- workout_type: ${input.analysis.workoutType}`);
  lines.push(`- execution_status: ${input.analysis.executionStatus}`);
  lines.push(`- summary_for_coach: ${input.analysis.summaryForCoach}`);
  lines.push(`- recommendation_for_draft: ${input.analysis.recommendationForDraft}`);
  lines.push("- plan_actual_bullets:");
  for (const bullet of input.analysis.planActualBullets) {
    lines.push(`  - ${bullet}`);
  }
  lines.push("- unavailable_data_notes:");
  for (const note of input.analysis.unavailableDataNotes) {
    lines.push(`  - ${note}`);
  }
  lines.push("");
  lines.push("## Draft-safe claims");
  lines.push("- allowed:");
  for (const claim of input.draftClaims.allowed) {
    lines.push(`  - ${claim}`);
  }
  lines.push("- forbidden:");
  for (const claim of input.draftClaims.forbidden) {
    lines.push(`  - ${claim}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- GET-only live reader: yes");
  lines.push("- TP mutations: no");
  lines.push("- Telegram sends: no");
  lines.push("- OpenAI: no");
  lines.push("- DB writes: no");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  loadScriptEnv();
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log("Group workout report summary analysis diagnostic (read-only)");
    console.log("");
    console.log("Usage:");
    console.log(
      "  npm run diagnose:group-workout-report-summary-analysis -- --student-id=<uuid> --date=YYYY-MM-DD [--workout-id=<id>] --message=\"...\""
    );
    console.log(
      "  npm run diagnose:group-workout-report-summary-analysis -- --athlete-id=<id> --date=YYYY-MM-DD [--workout-id=<id>] --message=\"...\""
    );
    return;
  }

  const hasStudent = Boolean(cli.studentId);
  const hasAthlete = Boolean(cli.athleteId);
  if ((hasStudent ? 1 : 0) + (hasAthlete ? 1 : 0) !== 1) {
    throw new Error("Provide exactly one target path: --student-id or --athlete-id.");
  }
  if (!ISO_DATE_PATTERN.test(cli.date)) {
    throw new Error(`Invalid --date value "${cli.date}". Expected YYYY-MM-DD.`);
  }
  if (!cli.message.trim()) {
    throw new Error("--message is required.");
  }

  const target = await resolveTarget(cli);
  const rows = await listTrainingPeaksWorkoutCacheForStudentDateRange({
    studentId: target.studentId,
    from: cli.date,
    to: cli.date,
  });
  const messageDateUnix = Date.parse(`${cli.date}T12:00:00.000Z`) / 1000;
  const match = matchGroupWorkoutReportWorkoutFromCache({
    messageText: cli.message,
    messageDateUnixSeconds: messageDateUnix,
    workouts: rows,
  });

  const bearerPresent = hasTrainingPeaksApiBearer();
  const summaryReader = await readTrainingPeaksCompletedWorkoutSummary({
    athleteId: target.athleteId,
    date: cli.date,
    workoutId: cli.workoutId,
    bearerToken: process.env.TRAININGPEAKS_API_BEARER,
  });
  const liveSummary = summaryReader.status === "success" ? summaryReader.details : null;

  const analysis = analyzeGroupWorkoutReport({
    match,
    plannedWorkout: byWorkoutId(rows, match.selectedPlannedWorkoutId),
    completedWorkout: byWorkoutId(rows, match.selectedCompletedWorkoutId),
    completedWorkoutSummaryDetails: liveSummary,
    reportText: cli.message,
  });
  const draftClaims = buildDraftSafeClaims(analysis);

  const actor = cli.studentId ? `student-${target.studentId}` : `athlete-${target.athleteId}`;
  const reportDir = path.join(process.cwd(), REPORT_ROOT, actor, timestampForPath());
  await mkdir(reportDir, { recursive: true });

  const payload = {
    target: {
      studentId: target.studentId,
      studentName: target.studentName,
      athleteId: target.athleteId,
      date: cli.date,
      workoutId: cli.workoutId ?? null,
      message: cli.message,
      bearerPresent,
    },
    match,
    summaryReader,
    liveSummary,
    analysis,
    draftClaims,
  };

  const summaryPath = path.join(reportDir, "SUMMARY.md");
  const analysisPath = path.join(reportDir, "analysis.json");
  await writeFile(analysisPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(
    summaryPath,
    formatSummaryMarkdown({
      target: {
        studentId: target.studentId,
        athleteId: target.athleteId,
        studentName: target.studentName,
        date: cli.date,
        workoutId: cli.workoutId,
      },
      message: cli.message,
      match,
      summaryReader,
      liveSummary,
      analysis,
      draftClaims,
      bearerPresent,
    }),
    "utf8"
  );

  console.log("[diagnose-group-workout-report-summary-analysis] PASS");
  console.log(`[diagnose-group-workout-report-summary-analysis] report_dir=${reportDir}`);
  console.log(`[diagnose-group-workout-report-summary-analysis] summary=${summaryPath}`);
  console.log(`[diagnose-group-workout-report-summary-analysis] analysis=${analysisPath}`);
  console.log(`[diagnose-group-workout-report-summary-analysis] match_status=${match.status}`);
  console.log(`[diagnose-group-workout-report-summary-analysis] summary_reader_status=${summaryReader.status}`);
  console.log(
    `[diagnose-group-workout-report-summary-analysis] avg_pace=${analysis.dataAvailability.hasAveragePace} avg_hr=${analysis.dataAvailability.hasAverageHeartRate}`
  );
}

main().catch((error) => {
  console.error("[diagnose-group-workout-report-summary-analysis] FAIL");
  console.error(error);
  process.exitCode = 1;
});
