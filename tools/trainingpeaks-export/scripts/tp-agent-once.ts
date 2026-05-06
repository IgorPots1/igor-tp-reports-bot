import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { readStudentsConfig } from "./lib/students.ts";

type TrainingPeaksJobStatus = "queued" | "running" | "completed" | "failed";

type TrainingPeaksJobRow = {
  id: string;
  job_type: "weekly_reports";
  status: TrainingPeaksJobStatus;
  week_from: string;
  week_to: string;
  requested_by_chat_id: string | null;
  requested_by_user_id: string | null;
  result_json: unknown | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

type TrainingPeaksWeeklyReportRow = {
  student_id: string;
  student_name: string;
  week_from: string;
  week_to: string;
  report_markdown: string | null;
};

type TrainingPeaksExpectedStudent = {
  student_id: string;
  student_name: string;
};

type TrainingPeaksMissingStudent = {
  student_id: string;
  student_name: string;
};

type TrainingPeaksJobResult = {
  week_from: string;
  week_to: string;
  students_expected: number;
  reports_found: number;
  reports_sent_to_telegram: number;
  missing_students: TrainingPeaksMissingStudent[];
  has_warnings: boolean;
  completed_at: string;
  note: string;
  delivery_warning?: string;
  warning_message?: string;
};

const TELEGRAM_MESSAGE_LIMIT = 4000;
const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const STALE_RUNNING_JOB_TIMEOUT_MINUTES = 6 * 60;
const STALE_RUNNING_JOB_ERROR_MESSAGE = "Job marked failed after stale running timeout";

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

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  }

  return value;
}

function getOptionalEnv(name: "TELEGRAM_BOT_TOKEN"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getSupabase() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function splitTelegramText(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const normalizedText = text.trim();

  if (normalizedText.length <= limit) {
    return [normalizedText];
  }

  const chunks: string[] = [];
  let rest = normalizedText;

  while (rest.length > 0) {
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }

    let boundary = rest.lastIndexOf("\n\n", limit);
    if (boundary < Math.floor(limit * 0.5)) {
      boundary = rest.lastIndexOf("\n", limit);
    }
    if (boundary < Math.floor(limit * 0.5)) {
      boundary = rest.lastIndexOf(" ", limit);
    }
    if (boundary <= 0) {
      boundary = limit;
    }

    chunks.push(rest.slice(0, boundary).trimEnd());
    rest = rest.slice(boundary).trimStart();
  }

  return chunks.filter(Boolean);
}

function buildTelegramReportMessages(report: TrainingPeaksWeeklyReportRow): string[] {
  const reportMarkdown = report.report_markdown?.trim();
  if (!reportMarkdown) {
    return [];
  }

  const header = `✅ Отчет готов: ${report.student_name}\nНеделя: ${report.week_from} — ${report.week_to}\n\n`;
  const continuationPrefix = `Продолжение отчета: ${report.student_name}\n\n`;

  if ((header + reportMarkdown).length <= TELEGRAM_MESSAGE_LIMIT) {
    return [`${header}${reportMarkdown}`];
  }

  const bodyChunks = splitTelegramText(reportMarkdown, TELEGRAM_MESSAGE_LIMIT - header.length);
  if (bodyChunks.length === 0) {
    return [header.trimEnd()];
  }

  const [firstChunk, ...restChunks] = bodyChunks;
  const messages = [`${header}${firstChunk}`];

  for (const chunk of restChunks) {
    messages.push(`${continuationPrefix}${chunk}`);
  }

  return messages;
}

async function sendTelegramText(chatId: string, text: string): Promise<void> {
  const token = getOptionalEnv("TELEGRAM_BOT_TOKEN");
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN for Telegram delivery.");
  }

  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram sendMessage failed (${response.status}): ${errorText}`);
  }
}

function toShortErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= 300) {
    return normalized;
  }

  return `${normalized.slice(0, 297)}...`;
}

async function runNpmScript(scriptName: string, args: string[] = []): Promise<void> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const childArgs = ["run", scriptName];

  if (args.length > 0) {
    childArgs.push("--", ...args);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmCommand, childArgs, {
      cwd: toolRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${scriptName} exited from signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${scriptName} failed with exit code ${code}.`));
        return;
      }

      resolve();
    });
  });
}

function normalizeStudentLabel(student: TrainingPeaksMissingStudent): string {
  if (student.student_name && student.student_name !== student.student_id) {
    return `${student.student_id} (${student.student_name})`;
  }

  return student.student_name || student.student_id;
}

function formatMissingStudentsWarning(missingStudents: TrainingPeaksMissingStudent[]): string {
  const labels = missingStudents.map(normalizeStudentLabel);
  const preview = labels.slice(0, 5).join(", ");
  return labels.length > 5 ? `${preview} and ${labels.length - 5} more` : preview;
}

async function readExpectedStudentsFromLocalConfig(): Promise<TrainingPeaksExpectedStudent[]> {
  const students = await readStudentsConfig();

  return students
    .filter((student) => student.is_active === true && student.weekly_report_enabled === true)
    .map((student) => ({
      student_id: student.student_id,
      student_name: student.name?.trim() || student.student_id,
    }));
}

function getMissingStudents(
  expectedStudents: TrainingPeaksExpectedStudent[],
  reports: TrainingPeaksWeeklyReportRow[]
): TrainingPeaksMissingStudent[] {
  const foundStudentIds = new Set(
    reports.map((report) => report.student_id.trim()).filter((studentId) => studentId.length > 0)
  );

  return expectedStudents
    .filter((student) => !foundStudentIds.has(student.student_id))
    .map((student) => ({
      student_id: student.student_id,
      student_name: student.student_name,
    }));
}

async function recoverStaleTrainingPeaksRunningJobs(timeoutMinutes: number): Promise<number> {
  const supabase = getSupabase();
  const safeTimeoutMinutes = Math.max(1, Math.floor(timeoutMinutes));
  const cutoff = new Date(Date.now() - safeTimeoutMinutes * 60 * 1000).toISOString();
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: STALE_RUNNING_JOB_ERROR_MESSAGE,
      result_json: null,
      finished_at: finishedAt,
    })
    .eq("job_type", "weekly_reports")
    .eq("status", "running")
    .not("started_at", "is", null)
    .lt("started_at", cutoff)
    .select("id");

  if (error) {
    throw new Error(`Failed to recover stale TrainingPeaks jobs: ${error.message}`);
  }

  return (data ?? []).length;
}

async function claimNextQueuedTrainingPeaksJob(): Promise<TrainingPeaksJobRow | null> {
  const supabase = getSupabase();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: nextJob, error: selectError } = await supabase
      .from("trainingpeaks_jobs")
      .select("*")
      .eq("job_type", "weekly_reports")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to select next TrainingPeaks job: ${selectError.message}`);
    }

    if (!nextJob) {
      return null;
    }

    const { data: claimedJob, error: claimError } = await supabase
      .from("trainingpeaks_jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        error_message: null,
      })
      .eq("id", nextJob.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim TrainingPeaks job ${nextJob.id}: ${claimError.message}`);
    }

    if (claimedJob) {
      return claimedJob as TrainingPeaksJobRow;
    }
  }

  return null;
}

async function listWeeklyReportsWithMarkdown(
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksWeeklyReportRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("student_id, student_name, week_from, week_to, report_markdown")
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .order("student_name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks reports for ${weekFrom}..${weekTo}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksWeeklyReportRow[]) ?? []).filter((report) =>
    Boolean(report.report_markdown?.trim())
  );
}

async function deliverReportsToTelegram(
  chatId: string,
  reports: TrainingPeaksWeeklyReportRow[]
): Promise<{ sentCount: number; warning: string | null }> {
  let sentCount = 0;
  const failures: string[] = [];

  for (const report of reports) {
    try {
      for (const message of buildTelegramReportMessages(report)) {
        await sendTelegramText(chatId, message);
      }

      sentCount += 1;
    } catch (error) {
      const shortMessage = toShortErrorMessage(error);
      failures.push(`${report.student_name}: ${shortMessage}`);
    }
  }

  if (failures.length === 0) {
    return { sentCount, warning: null };
  }

  const warning = `Telegram delivery warning: ${sentCount}/${reports.length} report(s) sent. ${failures.join(" | ")}`;
  console.warn(warning);

  return { sentCount, warning };
}

async function completeTrainingPeaksJob(jobId: string, result: unknown): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "completed",
      result_json: result,
      error_message: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to complete TrainingPeaks job ${jobId}: ${error.message}`);
  }
}

async function failTrainingPeaksJob(
  jobId: string,
  errorMessage: string,
  result?: unknown
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      result_json: result ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to fail TrainingPeaks job ${jobId}: ${error.message}`);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const recoveredJobs = await recoverStaleTrainingPeaksRunningJobs(
    STALE_RUNNING_JOB_TIMEOUT_MINUTES
  );
  if (recoveredJobs > 0) {
    console.log(`Recovered ${recoveredJobs} stale TrainingPeaks job(s).`);
  }

  const job = await claimNextQueuedTrainingPeaksJob();
  if (!job) {
    console.log("No queued TrainingPeaks jobs.");
    return;
  }

  console.log(`Claimed TrainingPeaks job for ${job.week_from}..${job.week_to}.`);

  try {
    console.log("Running tp-sync-students...");
    await runNpmScript("tp-sync-students");
    const expectedStudents = await readExpectedStudentsFromLocalConfig();
    const studentsExpected = expectedStudents.length;
    console.log("Running tp-weekly-all...");
    await runNpmScript("tp-weekly-all", [`--from=${job.week_from}`, `--to=${job.week_to}`]);

    console.log("Running tp-sync-reports...");
    await runNpmScript("tp-sync-reports", [`--from=${job.week_from}`, `--to=${job.week_to}`]);

    const completedAt = new Date().toISOString();
    const reports = await listWeeklyReportsWithMarkdown(job.week_from, job.week_to);
    const reportsFound = reports.length;
    const missingStudents = getMissingStudents(expectedStudents, reports);
    let reportsSentToTelegram = 0;
    let deliveryWarning: string | null = null;
    let note = "Local Mac runner executed tp-weekly-all and tp-sync-reports.";
    const warningMessages: string[] = [];

    if (studentsExpected > 0 && reportsFound === 0) {
      const errorMessage =
        "No synced report drafts with report_markdown were found after pipeline run.";
      const warningMessage = `Expected ${studentsExpected} student(s), but found 0 synced report draft(s).`;
      const failedResult: TrainingPeaksJobResult = {
        week_from: job.week_from,
        week_to: job.week_to,
        students_expected: studentsExpected,
        reports_found: reportsFound,
        reports_sent_to_telegram: 0,
        missing_students: missingStudents,
        has_warnings: true,
        completed_at: completedAt,
        note:
          "Local Mac runner executed tp-weekly-all and tp-sync-reports, but no synced report drafts were produced for the requested week.",
        warning_message: warningMessage,
      };

      console.error(errorMessage);
      console.warn(warningMessage);
      await failTrainingPeaksJob(job.id, errorMessage, failedResult);
      return;
    }

    if (missingStudents.length > 0) {
      const warningMessage = `Missing report drafts for ${missingStudents.length} student(s): ${formatMissingStudentsWarning(missingStudents)}`;
      warningMessages.push(warningMessage);
      console.warn(warningMessage);
    }

    if (!job.requested_by_chat_id) {
      note =
        "Local Mac runner executed tp-weekly-all and tp-sync-reports, but skipped Telegram delivery because requested_by_chat_id is missing.";
    } else if (reportsFound === 0) {
      note =
        "Local Mac runner executed tp-weekly-all and tp-sync-reports, but found no synced report drafts with report_markdown for Telegram delivery.";
    } else {
      const deliveryResult = await deliverReportsToTelegram(job.requested_by_chat_id, reports);
      reportsSentToTelegram = deliveryResult.sentCount;
      deliveryWarning = deliveryResult.warning;
      note =
        reportsSentToTelegram === reportsFound
          ? "Local Mac runner executed tp-weekly-all and tp-sync-reports, then sent report drafts to the Telegram requester."
          : "Local Mac runner executed tp-weekly-all and tp-sync-reports, but Telegram delivery finished with warnings.";
    }

    if (deliveryWarning) {
      warningMessages.push(deliveryWarning);
    }

    const hasWarnings = warningMessages.length > 0;
    const warningMessage = hasWarnings ? warningMessages.join(" ") : undefined;

    const result: TrainingPeaksJobResult = {
      week_from: job.week_from,
      week_to: job.week_to,
      students_expected: studentsExpected,
      reports_found: reportsFound,
      reports_sent_to_telegram: reportsSentToTelegram,
      missing_students: missingStudents,
      has_warnings: hasWarnings,
      completed_at: completedAt,
      note,
    };

    if (deliveryWarning) {
      result.delivery_warning = deliveryWarning;
    }

    if (warningMessage) {
      result.warning_message = warningMessage;
    }

    await completeTrainingPeaksJob(job.id, result);

    console.log(`Completed TrainingPeaks job for ${job.week_from}..${job.week_to}.`);
  } catch (error) {
    const shortErrorMessage = toShortErrorMessage(error);

    try {
      await failTrainingPeaksJob(job.id, shortErrorMessage);
    } catch (markFailedError) {
      console.error("Failed to mark TrainingPeaks job as failed.", markFailedError);
    }

    throw error;
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
