import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { analyzeGroupWorkoutReport } from "@/features/trainingpeaks/group-workout-report-analyzer";
import {
  matchGroupWorkoutReportWorkoutFromCache,
  type GroupWorkoutReportWorkoutMatchResult,
} from "@/features/trainingpeaks/group-workout-report-matcher";
import { buildGroupWorkoutReportReplyDraftContext } from "@/features/trainingpeaks/group-workout-report-reply-draft-context";
import { generateGroupWorkoutReportReplyDraft } from "@/features/trainingpeaks/group-workout-report-reply-draft-generator";
import {
  getTrainingPeaksStudentById,
  insertTrainingPeaksGroupWorkoutReportReplyDraft,
  listTrainingPeaksStudents,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import { getTrainingPeaksReplyDraftModel } from "@/features/trainingpeaks/reply-draft-generator";
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
  sourceChatId?: string;
  sourceMessageId?: string;
  generate?: boolean;
  storeDraft?: boolean;
  help?: boolean;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_ROOT = "reports/group-workout-report-reply-draft";

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
    if (arg === "--generate") {
      parsed.generate = true;
      continue;
    }
    if (arg === "--store-draft") {
      parsed.storeDraft = true;
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
    if (arg === "--source-chat-id") {
      parsed.sourceChatId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--source-chat-id=")) {
      parsed.sourceChatId = arg.slice("--source-chat-id=".length).trim();
      continue;
    }
    if (arg === "--source-message-id") {
      parsed.sourceMessageId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--source-message-id=")) {
      parsed.sourceMessageId = arg.slice("--source-message-id=".length).trim();
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
    const student = await getTrainingPeaksStudentById(input.studentId);
    if (!student) {
      throw new Error(`No student found for --student-id ${input.studentId}.`);
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

function formatSummaryMarkdown(input: {
  target: { studentId: string; athleteId: number; studentName: string; date: string; workoutId?: string };
  message: string;
  match: GroupWorkoutReportWorkoutMatchResult;
  summaryReader: TrainingPeaksCompletedWorkoutSummaryReaderResult;
  liveSummary: TrainingPeaksCompletedWorkoutSummaryDetails | null;
  analysis: ReturnType<typeof analyzeGroupWorkoutReport>;
  draftContext: ReturnType<typeof buildGroupWorkoutReportReplyDraftContext>;
  generation: Awaited<ReturnType<typeof generateGroupWorkoutReportReplyDraft>> | null;
  storedDraftId: string | null;
  bearerPresent: boolean;
  generateRequested: boolean;
  storeDraftRequested: boolean;
}): string {
  const lines: string[] = [];
  lines.push("# Group Workout Report Reply Draft Diagnostic");
  lines.push("");
  lines.push("## Target");
  lines.push(`- student_id: ${input.target.studentId}`);
  lines.push(`- student_name: ${input.target.studentName}`);
  lines.push(`- athlete_id: ${input.target.athleteId}`);
  lines.push(`- date: ${input.target.date}`);
  lines.push(`- workout_id: ${input.target.workoutId ?? "none"}`);
  lines.push(`- message: ${input.message}`);
  lines.push(`- bearer_present: ${input.bearerPresent}`);
  lines.push(`- generate_requested: ${input.generateRequested}`);
  lines.push(`- store_draft_requested: ${input.storeDraftRequested}`);
  lines.push("");
  lines.push("## Match result");
  lines.push(`- status: ${input.match.status}`);
  lines.push(`- confidence: ${input.match.confidence}`);
  lines.push(`- reference_date: ${input.match.referenceDate}`);
  lines.push("");
  lines.push("## Summary reader");
  lines.push(`- status: ${input.summaryReader.status}`);
  lines.push("");
  lines.push("## Draft context");
  lines.push(`- formality: ${input.draftContext.communication.formality}`);
  lines.push(`- formality_source: ${input.draftContext.communication.formalitySource}`);
  lines.push(`- match_status: ${input.draftContext.workout.matchStatus}`);
  lines.push(`- match_confidence: ${input.draftContext.workout.matchConfidence}`);
  lines.push(`- analysis_confidence: ${input.draftContext.analysis.confidence}`);
  lines.push(`- execution_status: ${input.draftContext.analysis.executionStatus}`);
  lines.push("- allowed_claims:");
  for (const claim of input.draftContext.analysis.allowedClaims) {
    lines.push(`  - ${claim}`);
  }
  lines.push("- forbidden_claims:");
  for (const claim of input.draftContext.analysis.forbiddenClaims) {
    lines.push(`  - ${claim}`);
  }
  lines.push("");
  lines.push("## Generation");
  if (!input.generation) {
    lines.push("- not requested (--generate absent)");
  } else {
    lines.push(`- status: ${input.generation.status}`);
    if (input.generation.status === "blocked") {
      lines.push(`- reason: ${input.generation.reason}`);
    }
    if (input.generation.status === "generated") {
      lines.push(`- model: ${input.generation.model ?? "unknown"}`);
      lines.push(`- draft_preview: ${input.generation.draftText.slice(0, 120)}`);
    }
    if (input.generation.warnings.length > 0) {
      lines.push("- warnings:");
      for (const warning of input.generation.warnings) {
        lines.push(`  - ${warning}`);
      }
    }
  }
  lines.push("");
  lines.push("## Storage");
  lines.push(`- stored_draft_id: ${input.storedDraftId ?? "none"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- Telegram sends: no");
  lines.push("- TP mutations: no");
  lines.push("- OpenAI: only with --generate");
  lines.push("- DB writes: only with --store-draft and source metadata");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  loadScriptEnv();
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log("Group workout report reply draft diagnostic (read-only by default)");
    console.log("");
    console.log("Usage:");
    console.log(
      "  npm run diagnose:group-workout-report-reply-draft -- --student-id=<uuid> --date=YYYY-MM-DD [--workout-id=<id>] --message=\"...\" [--generate] [--store-draft --source-chat-id=<id> --source-message-id=<id>]"
    );
    console.log(
      "  npm run diagnose:group-workout-report-reply-draft -- --athlete-id=<id> --date=YYYY-MM-DD [--workout-id=<id>] --message=\"...\""
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
  if (cli.storeDraft && (!cli.sourceChatId || !cli.sourceMessageId)) {
    throw new Error("--store-draft requires --source-chat-id and --source-message-id.");
  }

  const target = await resolveTarget(cli);
  const student = await getTrainingPeaksStudentById(target.studentId);
  if (!student) {
    throw new Error(`Student ${target.studentId} not found.`);
  }

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
    workoutId: cli.workoutId ?? match.selectedCompletedWorkoutId ?? match.selectedPlannedWorkoutId ?? undefined,
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

  const sourceChatId = cli.sourceChatId ?? "-1000000000000";
  const sourceMessageId = cli.sourceMessageId ?? "diagnostic-message";
  const draftContext = buildGroupWorkoutReportReplyDraftContext({
    student: {
      id: student.id,
      studentName: student.studentName,
      telegramFormality: student.telegramFormality,
      telegramContextNotes: student.telegramContextNotes,
    },
    sourceMessage: {
      chatId: sourceChatId,
      messageId: sourceMessageId,
      messageText: cli.message,
      messageTimestamp: `${cli.date}T12:00:00.000Z`,
    },
    match,
    plannedWorkout: byWorkoutId(rows, match.selectedPlannedWorkoutId),
    completedWorkout: byWorkoutId(rows, match.selectedCompletedWorkoutId),
    completedWorkoutSummaryDetails: liveSummary,
    analysis,
  });

  let generation: Awaited<ReturnType<typeof generateGroupWorkoutReportReplyDraft>> | null = null;
  if (cli.generate) {
    generation = await generateGroupWorkoutReportReplyDraft({ context: draftContext });
  }

  let storedDraftId: string | null = null;
  if (
    cli.storeDraft &&
    generation?.status === "generated" &&
    cli.sourceChatId &&
    cli.sourceMessageId
  ) {
    const stored = await insertTrainingPeaksGroupWorkoutReportReplyDraft({
      studentId: student.id,
      sourceChatId: cli.sourceChatId,
      sourceMessageId: cli.sourceMessageId,
      sourceMessageTimestamp: `${cli.date}T12:00:00.000Z`,
      studentMessageText: cli.message,
      promptContext: draftContext.promptContext,
      draftText: generation.draftText,
      aiModel: getTrainingPeaksReplyDraftModel(),
      workoutMatchStatus: match.status,
      workoutMatchConfidence: match.confidence,
      plannedWorkoutCacheId: byWorkoutId(rows, match.selectedPlannedWorkoutId)?.id ?? null,
      completedWorkoutCacheId: byWorkoutId(rows, match.selectedCompletedWorkoutId)?.id ?? null,
      workoutAnalysisJson: analysis as unknown as Record<string, unknown>,
      metadata: {
        diagnostic: true,
      },
    });
    storedDraftId = stored?.id ?? null;
  }

  const actor = cli.studentId ? `student-${target.studentId}` : `athlete-${target.athleteId}`;
  const reportDir = path.join(process.cwd(), REPORT_ROOT, actor, timestampForPath());
  await mkdir(reportDir, { recursive: true });

  const draftContextPath = path.join(reportDir, "draft-context.json");
  const analysisPath = path.join(reportDir, "analysis.json");
  const summaryPath = path.join(reportDir, "SUMMARY.md");

  await writeFile(draftContextPath, `${JSON.stringify(draftContext, null, 2)}\n`, "utf8");
  await writeFile(
    analysisPath,
    `${JSON.stringify({ match, summaryReader, liveSummary, analysis, generation }, null, 2)}\n`,
    "utf8"
  );
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
      draftContext,
      generation,
      storedDraftId,
      bearerPresent,
      generateRequested: Boolean(cli.generate),
      storeDraftRequested: Boolean(cli.storeDraft),
    }),
    "utf8"
  );

  if (generation?.status === "generated") {
    await writeFile(
      path.join(reportDir, "generated-draft.txt"),
      `${generation.draftText.trim()}\n`,
      "utf8"
    );
  }

  console.log("[diagnose-group-workout-report-reply-draft] PASS");
  console.log(`[diagnose-group-workout-report-reply-draft] report_dir=${reportDir}`);
  console.log(`[diagnose-group-workout-report-reply-draft] match_status=${match.status}`);
  console.log(`[diagnose-group-workout-report-reply-draft] formality=${draftContext.communication.formality}`);
  console.log(
    `[diagnose-group-workout-report-reply-draft] generation_status=${generation?.status ?? "not_requested"}`
  );
  if (generation?.status === "generated") {
    console.log(
      `[diagnose-group-workout-report-reply-draft] draft_preview=${generation.draftText.slice(0, 80)}`
    );
  }
}

main().catch((error) => {
  console.error("[diagnose-group-workout-report-reply-draft] FAIL");
  console.error(error);
  process.exitCode = 1;
});
