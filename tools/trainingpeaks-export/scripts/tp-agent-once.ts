import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";

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
  student_name: string;
  week_from: string;
  week_to: string;
  report_markdown: string | null;
};

type TrainingPeaksJobResult = {
  week_from: string;
  week_to: string;
  reports_found: number;
  reports_sent_to_telegram: number;
  completed_at: string;
  note: string;
  delivery_warning?: string;
};

const TELEGRAM_MESSAGE_LIMIT = 4000;
const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

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
    .select("student_name, week_from, week_to, report_markdown")
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

async function failTrainingPeaksJob(jobId: string, errorMessage: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      result_json: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to fail TrainingPeaks job ${jobId}: ${error.message}`);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const job = await claimNextQueuedTrainingPeaksJob();
  if (!job) {
    console.log("No queued TrainingPeaks jobs.");
    return;
  }

  console.log(`Claimed TrainingPeaks job for ${job.week_from}..${job.week_to}.`);

  try {
    console.log("Running tp-sync-students...");
    await runNpmScript("tp-sync-students");
    console.log("Running tp-weekly-all...");
    await runNpmScript("tp-weekly-all", [`--from=${job.week_from}`, `--to=${job.week_to}`]);

    console.log("Running tp-sync-reports...");
    await runNpmScript("tp-sync-reports", [`--from=${job.week_from}`, `--to=${job.week_to}`]);

    const completedAt = new Date().toISOString();
    const reports = await listWeeklyReportsWithMarkdown(job.week_from, job.week_to);
    const reportsFound = reports.length;
    let reportsSentToTelegram = 0;
    let deliveryWarning: string | null = null;
    let note = "Local Mac runner executed tp-weekly-all and tp-sync-reports.";

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

    const result: TrainingPeaksJobResult = {
      week_from: job.week_from,
      week_to: job.week_to,
      reports_found: reportsFound,
      reports_sent_to_telegram: reportsSentToTelegram,
      completed_at: completedAt,
      note,
    };

    if (deliveryWarning) {
      result.delivery_warning = deliveryWarning;
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
