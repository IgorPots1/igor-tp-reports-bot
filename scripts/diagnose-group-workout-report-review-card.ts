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
  buildGroupWorkoutReportReviewCardForDraft,
  notifyCoachGroupWorkoutReportDraft,
} from "@/features/trainingpeaks/group-workout-report-review-flow";
import {
  getTrainingPeaksStudentById,
  insertTrainingPeaksGroupWorkoutReportReplyDraft,
  listTrainingPeaksStudents,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksReplyDraft,
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
  sendReviewCard?: boolean;
  help?: boolean;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_ROOT = "reports/group-workout-report-review-card";

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
    if (arg === "--send-review-card") {
      parsed.sendReviewCard = true;
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

function buildPreviewDraft(input: {
  draftId: string;
  studentId: string;
  sourceChatId: string;
  sourceMessageId: string;
  message: string;
  draftText: string;
  match: GroupWorkoutReportWorkoutMatchResult;
  analysis: ReturnType<typeof analyzeGroupWorkoutReport>;
  context: ReturnType<typeof buildGroupWorkoutReportReplyDraftContext>;
  generationWarnings?: string[];
  blockedReason?: string | null;
}): TrainingPeaksReplyDraft {
  return {
    id: input.draftId,
    studentId: input.studentId,
    caseId: null,
    source: "group_workout_report",
    actorTelegramChatId: input.sourceChatId,
    aiModel: getTrainingPeaksReplyDraftModel(),
    promptContextSha256: "diagnostic",
    studentMessageSha256: "diagnostic",
    studentMessagePreview: input.message.slice(0, 80),
    draftSha256: "diagnostic",
    draftText: input.draftText,
    draftPreview: input.draftText.slice(0, 120),
    draftCharCount: input.draftText.length,
    outcome: "generated",
    outcomeRecordedAt: null,
    coachNotePreview: null,
    coachNoteSha256: null,
    metadata: {
      allowed_claims: input.context.analysis.allowedClaims,
      forbidden_claims: input.context.analysis.forbiddenClaims,
      workout_title: input.context.workout.title ?? null,
      workout_date: input.context.workout.date,
      prompt_context: input.context.promptContext,
      student_message: input.message,
      generation_warnings: input.generationWarnings ?? [],
      generation_blocked_reason: input.blockedReason ?? null,
      diagnostic: true,
    },
    createdAt: new Date().toISOString(),
    sourceChatId: input.sourceChatId,
    sourceMessageId: input.sourceMessageId,
    sourceMessageTimestamp: `${input.context.workout.date}T12:00:00.000Z`,
    sourceTelegramUserId: null,
    groupWorkoutReportIntakeId: null,
    workoutMatchStatus: input.match.status,
    workoutMatchConfidence: input.match.confidence,
    plannedWorkoutCacheId: null,
    completedWorkoutCacheId: null,
    workoutAnalysisJson: input.analysis as unknown as Record<string, unknown>,
  };
}

function formatSummaryMarkdown(input: {
  target: { studentId: string; athleteId: number; studentName: string; date: string; workoutId?: string };
  message: string;
  match: GroupWorkoutReportWorkoutMatchResult;
  summaryReader: TrainingPeaksCompletedWorkoutSummaryReaderResult;
  reviewCardText: string;
  reviewCardButtons: string[];
  generationStatus: string;
  storedDraftId: string | null;
  reviewNotifyStatus: string | null;
  flags: {
    reviewEnabled: boolean;
    generateEnabled: boolean;
    sendEnabled: boolean;
    generateRequested: boolean;
    storeDraftRequested: boolean;
    sendReviewCardRequested: boolean;
  };
}): string {
  const lines: string[] = [];
  lines.push("# Group Workout Report Review Card Diagnostic");
  lines.push("");
  lines.push("## Target");
  lines.push(`- student_id: ${input.target.studentId}`);
  lines.push(`- student_name: ${input.target.studentName}`);
  lines.push(`- athlete_id: ${input.target.athleteId}`);
  lines.push(`- date: ${input.target.date}`);
  lines.push(`- workout_id: ${input.target.workoutId ?? "none"}`);
  lines.push(`- message: ${input.message}`);
  lines.push("");
  lines.push("## Flags");
  lines.push(`- review_enabled: ${input.flags.reviewEnabled}`);
  lines.push(`- generate_enabled: ${input.flags.generateEnabled}`);
  lines.push(`- send_enabled: ${input.flags.sendEnabled}`);
  lines.push(`- generate_requested: ${input.flags.generateRequested}`);
  lines.push(`- store_draft_requested: ${input.flags.storeDraftRequested}`);
  lines.push(`- send_review_card_requested: ${input.flags.sendReviewCardRequested}`);
  lines.push("");
  lines.push("## Match");
  lines.push(`- status: ${input.match.status}`);
  lines.push(`- confidence: ${input.match.confidence}`);
  lines.push("");
  lines.push("## Summary reader");
  lines.push(`- status: ${input.summaryReader.status}`);
  lines.push("");
  lines.push("## Generation");
  lines.push(`- status: ${input.generationStatus}`);
  lines.push("");
  lines.push("## Review card preview");
  lines.push("```text");
  lines.push(input.reviewCardText);
  lines.push("```");
  lines.push("");
  lines.push("## Review card buttons");
  for (const button of input.reviewCardButtons) {
    lines.push(`- ${button}`);
  }
  lines.push("");
  lines.push("## Storage / notify");
  lines.push(`- stored_draft_id: ${input.storedDraftId ?? "none"}`);
  lines.push(`- review_notify_status: ${input.reviewNotifyStatus ?? "not_requested"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- group send: no");
  lines.push("- OpenAI: only with --generate");
  lines.push("- DB writes: only with --store-draft");
  lines.push("- coach Telegram send: only with --send-review-card and REVIEW_ENABLED=true");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  loadScriptEnv();
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log("Group workout report review card diagnostic (dry-run by default)");
    console.log("");
    console.log("Usage:");
    console.log(
      "  npm run diagnose:group-workout-report-review-card -- --student-id=<uuid> --date=YYYY-MM-DD [--workout-id=<id>] --message=\"...\" [--source-chat-id=<id> --source-message-id=<id>] [--generate] [--store-draft] [--send-review-card]"
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
  if (cli.sendReviewCard && process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_REVIEW_ENABLED?.trim() !== "true") {
    throw new Error("--send-review-card requires TRAININGPEAKS_GROUP_WORKOUT_REPORT_REVIEW_ENABLED=true.");
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
  const summaryReader = bearerPresent
    ? await readTrainingPeaksCompletedWorkoutSummary({
        athleteId: target.athleteId,
        date: cli.date,
        workoutId: cli.workoutId ?? match.selectedCompletedWorkoutId ?? match.selectedPlannedWorkoutId ?? undefined,
        bearerToken: process.env.TRAININGPEAKS_API_BEARER,
      })
    : { status: "missing_bearer" as const, warnings: ["TRAININGPEAKS_API_BEARER missing"] };
  const liveSummary: TrainingPeaksCompletedWorkoutSummaryDetails | null =
    summaryReader.status === "success" ? summaryReader.details : null;

  const analysis = analyzeGroupWorkoutReport({
    match,
    plannedWorkout: byWorkoutId(rows, match.selectedPlannedWorkoutId),
    completedWorkout: byWorkoutId(rows, match.selectedCompletedWorkoutId),
    completedWorkoutSummaryDetails: liveSummary,
    reportText: cli.message,
  });

  const sourceChatId = cli.sourceChatId ?? "-1001234567890";
  const sourceMessageId = cli.sourceMessageId ?? "12345";
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

  let generationStatus = "not_requested";
  let draftText = "— dry-run preview: generation not requested —";
  let generationWarnings: string[] = [];
  let blockedReason: string | null = null;

  if (cli.generate) {
    const generation = await generateGroupWorkoutReportReplyDraft({ context: draftContext });
    generationStatus = generation.status;
    if (generation.status === "generated") {
      draftText = generation.draftText;
      generationWarnings = generation.warnings;
    } else {
      draftText = "— автогенерация заблокирована —";
      blockedReason = generation.reason;
      generationWarnings = generation.warnings;
    }
  }

  const previewDraft = buildPreviewDraft({
    draftId: "00000000-0000-4000-8000-000000000001",
    studentId: student.id,
    sourceChatId,
    sourceMessageId,
    message: cli.message,
    draftText,
    match,
    analysis,
    context: draftContext,
    generationWarnings,
    blockedReason,
  });
  const reviewCard = buildGroupWorkoutReportReviewCardForDraft(previewDraft, student.studentName);
  const reviewCardButtons = reviewCard.markup.inline_keyboard
    .flat()
    .map((button) => `${button.text} -> ${button.callback_data}`);

  let storedDraftId: string | null = null;
  if (cli.storeDraft && draftText && draftText !== "— dry-run preview: generation not requested —") {
    const stored = await insertTrainingPeaksGroupWorkoutReportReplyDraft({
      studentId: student.id,
      sourceChatId,
      sourceMessageId,
      sourceMessageTimestamp: `${cli.date}T12:00:00.000Z`,
      studentMessageText: cli.message,
      promptContext: draftContext.promptContext,
      draftText,
      aiModel: getTrainingPeaksReplyDraftModel(),
      workoutMatchStatus: match.status,
      workoutMatchConfidence: match.confidence,
      plannedWorkoutCacheId: byWorkoutId(rows, match.selectedPlannedWorkoutId)?.id ?? null,
      completedWorkoutCacheId: byWorkoutId(rows, match.selectedCompletedWorkoutId)?.id ?? null,
      workoutAnalysisJson: analysis as unknown as Record<string, unknown>,
      metadata: {
        diagnostic: true,
        allowed_claims: draftContext.analysis.allowedClaims,
        forbidden_claims: draftContext.analysis.forbiddenClaims,
        workout_title: draftContext.workout.title ?? null,
        workout_date: draftContext.workout.date,
        prompt_context: draftContext.promptContext,
        student_message: cli.message,
        generation_warnings: generationWarnings,
        generation_blocked_reason: blockedReason,
      },
    });
    storedDraftId = stored?.id ?? null;
  }

  let reviewNotifyStatus: string | null = null;
  if (cli.sendReviewCard) {
    const notifyDraft =
      storedDraftId !== null
        ? ({
            ...previewDraft,
            id: storedDraftId,
          } as TrainingPeaksReplyDraft)
        : previewDraft;
    const notifyResult = await notifyCoachGroupWorkoutReportDraft({
      draft: notifyDraft,
      studentName: student.studentName,
    });
    reviewNotifyStatus = notifyResult.status;
  }

  const actor = cli.studentId ? `student-${target.studentId}` : `athlete-${target.athleteId}`;
  const reportDir = path.join(process.cwd(), REPORT_ROOT, actor, timestampForPath());
  await mkdir(reportDir, { recursive: true });

  const reviewCardPath = path.join(reportDir, "review-card.txt");
  const reviewCardJsonPath = path.join(reportDir, "review-card.json");
  const summaryPath = path.join(reportDir, "SUMMARY.md");

  await writeFile(reviewCardPath, `${reviewCard.text}\n`, "utf8");
  await writeFile(
    reviewCardJsonPath,
    `${JSON.stringify({ text: reviewCard.text, buttons: reviewCardButtons, markup: reviewCard.markup }, null, 2)}\n`,
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
      reviewCardText: reviewCard.text,
      reviewCardButtons,
      generationStatus,
      storedDraftId,
      reviewNotifyStatus,
      flags: {
        reviewEnabled: process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_REVIEW_ENABLED?.trim() === "true",
        generateEnabled:
          process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_GENERATE_ENABLED?.trim() === "true",
        sendEnabled: process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_SEND_ENABLED?.trim() === "true",
        generateRequested: Boolean(cli.generate),
        storeDraftRequested: Boolean(cli.storeDraft),
        sendReviewCardRequested: Boolean(cli.sendReviewCard),
      },
    }),
    "utf8"
  );

  console.log(`[diagnose-group-workout-report-review-card] report=${reportDir}`);
  console.log(`[diagnose-group-workout-report-review-card] generation=${generationStatus}`);
  console.log(`[diagnose-group-workout-report-review-card] stored_draft_id=${storedDraftId ?? "none"}`);
  console.log(`[diagnose-group-workout-report-review-card] review_notify=${reviewNotifyStatus ?? "not_requested"}`);
}

main().catch((error) => {
  console.error("[diagnose-group-workout-report-review-card] FAIL", error);
  process.exitCode = 1;
});
