import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";

type TrainingPeaksJobStatus = "queued" | "running" | "completed" | "failed";

type TrainingPeaksJobScope = "all_enabled" | "single_student";

type TrainingPeaksJobRow = {
  id: string;
  job_type: "weekly_reports";
  scope: TrainingPeaksJobScope;
  student_id: string | null;
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
  id: string;
  student_id: string;
  student_name: string;
  week_from: string;
  week_to: string;
  report_markdown: string | null;
};

type TrainingPeaksExpectedStudent = {
  student_id: string;
  student_name: string;
  telegram_chat_id: string | null;
  telegram_delivery_enabled: boolean;
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
  reports_without_telegram?: number;
  stale_reports_skipped?: number;
  reports_requiring_review?: number;
  admin_reports_url?: string | null;
  warning_message?: string;
};

type TrainingPeaksSingleStudentJobResult = {
  scope: "single_student";
  student_id: string;
  student_name: string | null;
  week_from: string;
  week_to: string;
  success: boolean;
  report_found: boolean;
  report_id: string | null;
  report_markdown_path: string | null;
  admin_report_url: string | null;
  admin_reports_url: string | null;
  completed_at: string;
  note: string;
  warning_message?: string;
};

type TelegramBatchSummaryInput = {
  weekFrom: string;
  weekTo: string;
  finalStatus: "completed" | "failed";
  readyReports: number | null;
  failedReports: number | null;
  missingTelegramBindings: number | null;
  reportsRequiringReview: number | null;
  staleReportsSkipped: number | null;
  adminReportsUrl: string | null;
  errorMessage?: string | null;
};

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

function getOptionalEnv(name: string): string | null {
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

function normalizeAppBaseUrl(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getAppBaseUrl(): string | null {
  for (const envName of ["APP_BASE_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"]) {
    const value = getOptionalEnv(envName);
    if (!value) {
      continue;
    }

    const normalized = normalizeAppBaseUrl(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function buildAdminReportsUrl(weekFrom: string): string | null {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const url = new URL("/admin/reports", `${baseUrl}/`);
  url.searchParams.set("week", weekFrom);
  return url.toString();
}

function buildAdminReportUrl(reportId: string): string | null {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) {
    return null;
  }

  return new URL(`/admin/reports/${reportId}`, `${baseUrl}/`).toString();
}

function buildLocalReportMarkdownPath(studentId: string, weekFrom: string, weekTo: string): string {
  return path.join(toolRoot, "reports", studentId, `${weekFrom}_${weekTo}`, "report-draft.md");
}

async function sendTelegramText(
  chatId: string,
  text: string
): Promise<void> {
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

function hasCliFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function runNpmScript(
  scriptName: string,
  args: string[] = [],
  envOverrides: NodeJS.ProcessEnv = {}
): Promise<void> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const childArgs = ["run", scriptName];

  if (args.length > 0) {
    childArgs.push("--", ...args);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmCommand, childArgs, {
      cwd: toolRoot,
      stdio: "inherit",
      env: { ...process.env, ...envOverrides },
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

function buildTelegramBatchSummaryMessage(input: TelegramBatchSummaryInput): string {
  const readyReports = input.readyReports ?? 0;
  const failedReports = input.failedReports ?? 0;
  const missingTelegramBindings = input.missingTelegramBindings ?? 0;
  const reportsRequiringReview = input.reportsRequiringReview ?? readyReports;
  const staleReportsSkipped = input.staleReportsSkipped ?? 0;
  const warningsCount =
    failedReports +
    staleReportsSkipped +
    (input.finalStatus === "failed" && !input.errorMessage ? 1 : 0);
  const title =
    input.finalStatus === "failed"
      ? "❌ Отчёты TrainingPeaks не готовы"
      : warningsCount > 0
        ? "⚠️ Отчёты TrainingPeaks готовы с предупреждениями"
        : "✅ Отчёты TrainingPeaks готовы";

  const lines = [
    title,
    "",
    `Неделя: ${input.weekFrom} — ${input.weekTo}`,
    "",
    `Готово: ${readyReports}`,
    `Ошибки: ${failedReports}`,
    `Без Telegram: ${missingTelegramBindings}`,
    `Требуют проверки: ${reportsRequiringReview}`,
  ];

  const warningLines: string[] = [];
  if (failedReports > 0) {
    warningLines.push(`Есть ошибки генерации: ${failedReports}.`);
  }
  if (staleReportsSkipped > 0) {
    warningLines.push(`Пропущены stale-черновики: ${staleReportsSkipped}.`);
  }
  if (input.finalStatus === "failed" && input.errorMessage) {
    warningLines.push(`Ошибка: ${input.errorMessage}`);
  }
  if (warningLines.length > 0) {
    lines.push("", ...warningLines);
  }

  if (input.adminReportsUrl) {
    lines.push("", "Проверь и отправь отчёты в админке:", input.adminReportsUrl);
  } else {
    lines.push("", "Проверь и отправь отчёты в админке.", "Нужен APP_BASE_URL для прямой ссылки.");
  }

  return lines.join("\n");
}

async function readExpectedStudentsFromSupabase(): Promise<TrainingPeaksExpectedStudent[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("student_id, student_name, telegram_chat_id, telegram_delivery_enabled")
    .eq("is_active", true)
    .eq("weekly_report_enabled", true)
    .order("student_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch expected TrainingPeaks students from Supabase: ${error.message}`);
  }

  return ((data as TrainingPeaksExpectedStudent[]) ?? []).map((student) => ({
    student_id: student.student_id,
    student_name: student.student_name?.trim() || student.student_id,
    telegram_chat_id: student.telegram_chat_id?.trim() || null,
    telegram_delivery_enabled: student.telegram_delivery_enabled === true,
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

async function getStudentNameFromSupabase(studentId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("student_name")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch student name for ${studentId}: ${error.message}`);
  }

  const studentName = (data as { student_name?: string | null } | null)?.student_name?.trim();
  return studentName || null;
}

async function getWeeklyReportForStudentWeek(
  studentId: string,
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksWeeklyReportRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("id, student_id, student_name, week_from, week_to, report_markdown")
    .eq("student_id", studentId)
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks report for ${studentId} ${weekFrom}..${weekTo}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  const report = data as TrainingPeaksWeeklyReportRow;
  return report.report_markdown?.trim() ? report : null;
}

async function listWeeklyReportsWithMarkdown(
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksWeeklyReportRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("id, student_id, student_name, week_from, week_to, report_markdown")
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

function hasTelegramDeliveryBinding(student: TrainingPeaksExpectedStudent | undefined): boolean {
  return Boolean(student?.telegram_chat_id) && student?.telegram_delivery_enabled === true;
}

function countReportsWithoutTelegramBinding(
  expectedStudents: TrainingPeaksExpectedStudent[],
  reports: TrainingPeaksWeeklyReportRow[]
): number {
  const studentById = new Map(
    expectedStudents.map((student) => [student.student_id.trim(), student] as const)
  );

  return reports.reduce((count, report) => {
    const student = studentById.get(report.student_id.trim());
    return hasTelegramDeliveryBinding(student) ? count : count + 1;
  }, 0);
}

function filterReportsForCurrentStudents(
  reports: TrainingPeaksWeeklyReportRow[],
  expectedStudents: TrainingPeaksExpectedStudent[]
): {
  deliverableReports: TrainingPeaksWeeklyReportRow[];
  staleReports: TrainingPeaksWeeklyReportRow[];
} {
  const activeStudentIds = new Set(
    expectedStudents
      .map((student) => student.student_id.trim())
      .filter((studentId) => studentId.length > 0)
  );

  const deliverableReports: TrainingPeaksWeeklyReportRow[] = [];
  const staleReports: TrainingPeaksWeeklyReportRow[] = [];

  for (const report of reports) {
    if (activeStudentIds.has(report.student_id.trim())) {
      deliverableReports.push(report);
    } else {
      staleReports.push(report);
    }
  }

  return { deliverableReports, staleReports };
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

async function sendTelegramBatchSummaryIfPossible(
  chatId: string | null,
  summary: TelegramBatchSummaryInput
): Promise<boolean> {
  if (!chatId) {
    return false;
  }

  try {
    await sendTelegramText(chatId, buildTelegramBatchSummaryMessage(summary));
    return true;
  } catch (error) {
    console.warn(`Telegram batch summary warning: ${toShortErrorMessage(error)}`);
    return false;
  }
}

async function runSingleStudentWeeklyJob(
  job: TrainingPeaksJobRow,
  headless: boolean
): Promise<void> {
  const studentId = job.student_id?.trim();
  if (!studentId) {
    throw new Error("single_student job is missing student_id.");
  }

  const scriptEnv: NodeJS.ProcessEnv = {
    TP_SINGLE_STUDENT_JOB: "1",
  };
  if (headless) {
    scriptEnv.TP_NON_INTERACTIVE = "1";
  }

  const adminReportsUrl = buildAdminReportsUrl(job.week_from);
  const completedAt = new Date().toISOString();
  const studentName = await getStudentNameFromSupabase(studentId);
  const reportMarkdownPath = buildLocalReportMarkdownPath(studentId, job.week_from, job.week_to);

  try {
    console.log(`Running single-student weekly job for ${studentId} (${job.week_from}..${job.week_to})...`);
    await runNpmScript("tp-sync-students");
    await runNpmScript(
      "tp-weekly-one",
      [
        `--student=${studentId}`,
        `--from=${job.week_from}`,
        `--to=${job.week_to}`,
        "--force-single-student-job",
        ...(headless ? ["--headless"] : []),
      ],
      scriptEnv
    );

    console.log("Running tp-sync-reports...");
    await runNpmScript("tp-sync-reports", [`--from=${job.week_from}`, `--to=${job.week_to}`], scriptEnv);

    const syncedReport = await getWeeklyReportForStudentWeek(studentId, job.week_from, job.week_to);
    const success = Boolean(syncedReport);
    const result: TrainingPeaksSingleStudentJobResult = {
      scope: "single_student",
      student_id: studentId,
      student_name: studentName,
      week_from: job.week_from,
      week_to: job.week_to,
      success,
      report_found: success,
      report_id: syncedReport?.id ?? null,
      report_markdown_path: existsSync(reportMarkdownPath) ? reportMarkdownPath : null,
      admin_report_url: syncedReport ? buildAdminReportUrl(syncedReport.id) : null,
      admin_reports_url: adminReportsUrl,
      completed_at: completedAt,
      note: "Local Mac runner executed tp-weekly-one and tp-sync-reports for a single-student ad-hoc job.",
    };

    if (!success) {
      result.warning_message =
        "Pipeline finished, but no synced report draft with report_markdown was found for this student/week.";
      await failTrainingPeaksJob(
        job.id,
        "No synced report draft with report_markdown was found after single-student pipeline run.",
        result
      );
      if (job.requested_by_chat_id) {
        await sendTelegramText(
          job.requested_by_chat_id,
          [
            "❌ Не удалось подготовить отчёт TrainingPeaks",
            "",
            `Ученик: ${studentName ?? studentId} (${studentId})`,
            `Неделя: ${job.week_from} — ${job.week_to}`,
            "",
            result.warning_message,
            ...(adminReportsUrl ? ["", "Админка:", adminReportsUrl] : []),
          ].join("\n")
        );
      }
      return;
    }

    await completeTrainingPeaksJob(job.id, result);

    if (job.requested_by_chat_id) {
      const summaryLines = [
        "✅ Отчёт TrainingPeaks для одного ученика готов",
        "",
        `Ученик: ${studentName ?? studentId} (${studentId})`,
        `Неделя: ${job.week_from} — ${job.week_to}`,
        "",
        "Отчёт не отправлен ученику автоматически.",
      ];
      if (result.admin_report_url) {
        summaryLines.push("", "Открыть отчёт:", result.admin_report_url);
      } else if (adminReportsUrl) {
        summaryLines.push("", "Проверь отчёт в админке:", adminReportsUrl);
      }
      await sendTelegramText(job.requested_by_chat_id, summaryLines.join("\n"));
    }

    console.log(
      `Completed single-student TrainingPeaks job for ${studentId} ${job.week_from}..${job.week_to}. report_id=${syncedReport?.id ?? "missing"}`
    );
  } catch (error) {
    const shortErrorMessage = toShortErrorMessage(error);
    const failedResult: TrainingPeaksSingleStudentJobResult = {
      scope: "single_student",
      student_id: studentId,
      student_name: studentName,
      week_from: job.week_from,
      week_to: job.week_to,
      success: false,
      report_found: false,
      report_id: null,
      report_markdown_path: existsSync(reportMarkdownPath) ? reportMarkdownPath : null,
      admin_report_url: null,
      admin_reports_url: adminReportsUrl,
      completed_at: completedAt,
      note: "Local Mac runner failed while executing a single-student ad-hoc weekly job.",
      warning_message: shortErrorMessage,
    };

    await failTrainingPeaksJob(job.id, shortErrorMessage, failedResult);

    if (job.requested_by_chat_id) {
      try {
        await sendTelegramText(
          job.requested_by_chat_id,
          [
            "❌ Не удалось подготовить отчёт TrainingPeaks",
            "",
            `Ученик: ${studentName ?? studentId} (${studentId})`,
            `Неделя: ${job.week_from} — ${job.week_to}`,
            "",
            `Ошибка: ${shortErrorMessage}`,
          ].join("\n")
        );
      } catch (telegramError) {
        console.warn(`Telegram single-student summary warning: ${toShortErrorMessage(telegramError)}`);
      }
    }

    throw error;
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const headless = hasCliFlag("--headless");
  if (headless) {
    process.env.TP_NON_INTERACTIVE = "1";
  }

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

  const jobScope = job.scope ?? "all_enabled";
  console.log(
    `Claimed TrainingPeaks job for ${job.week_from}..${job.week_to} (scope=${jobScope}${job.student_id ? `, student=${job.student_id}` : ""}).`
  );

  if (jobScope === "single_student") {
    await runSingleStudentWeeklyJob(job, headless);
    return;
  }

  let studentsExpected: number | null = null;
  let reportsFound: number | null = null;
  let reportsSentToTelegram = 0;
  let missingStudents: TrainingPeaksMissingStudent[] = [];
  let staleReportsSkipped = 0;
  let reportsWithoutTelegram = 0;
  const adminReportsUrl = buildAdminReportsUrl(job.week_from);

  if (!adminReportsUrl) {
    console.warn("Admin reports URL is not configured. Set APP_BASE_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL.");
  }

  try {
    console.log("Running tp-sync-students...");
    await runNpmScript("tp-sync-students");
    const expectedStudents = await readExpectedStudentsFromSupabase();
    studentsExpected = expectedStudents.length;
    const batchEnv: NodeJS.ProcessEnv = headless ? { TP_NON_INTERACTIVE: "1" } : {};
    console.log(`Running tp-weekly-all...${headless ? " (headless)" : ""}`);
    await runNpmScript(
      "tp-weekly-all",
      [`--from=${job.week_from}`, `--to=${job.week_to}`, ...(headless ? ["--headless"] : [])],
      batchEnv
    );

    console.log("Running tp-sync-reports...");
    await runNpmScript("tp-sync-reports", [`--from=${job.week_from}`, `--to=${job.week_to}`], batchEnv);

    const completedAt = new Date().toISOString();
    const syncedReports = await listWeeklyReportsWithMarkdown(job.week_from, job.week_to);
    const { deliverableReports, staleReports } = filterReportsForCurrentStudents(
      syncedReports,
      expectedStudents
    );
    staleReportsSkipped = staleReports.length;
    for (const staleReport of staleReports) {
      console.warn(
        `Skipping stale report for inactive/missing/disabled student: ${staleReport.student_id}`
      );
    }

    reportsFound = deliverableReports.length;
    missingStudents = getMissingStudents(expectedStudents, deliverableReports);
    reportsWithoutTelegram = countReportsWithoutTelegramBinding(expectedStudents, deliverableReports);
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
        reports_without_telegram: 0,
        stale_reports_skipped: staleReportsSkipped,
        reports_requiring_review: 0,
        admin_reports_url: adminReportsUrl,
        note:
          "Local Mac runner executed tp-weekly-all and tp-sync-reports, but no synced report drafts were produced for the requested week.",
        warning_message: warningMessage,
      };

      console.error(errorMessage);
      console.warn(warningMessage);
      await failTrainingPeaksJob(job.id, errorMessage, failedResult);
      await sendTelegramBatchSummaryIfPossible(job.requested_by_chat_id, {
        weekFrom: job.week_from,
        weekTo: job.week_to,
        finalStatus: "failed",
        readyReports: 0,
        failedReports: missingStudents.length,
        missingTelegramBindings: 0,
        reportsRequiringReview: 0,
        staleReportsSkipped,
        adminReportsUrl,
        errorMessage,
      });
      return;
    }

    if (missingStudents.length > 0) {
      const warningMessage = `Missing report drafts for ${missingStudents.length} student(s): ${formatMissingStudentsWarning(missingStudents)}`;
      warningMessages.push(warningMessage);
      console.warn(warningMessage);
    }

    if (staleReportsSkipped > 0) {
      const warningMessage = `Skipped ${staleReportsSkipped} stale synced report draft(s) that no longer match active weekly-enabled students.`;
      warningMessages.push(warningMessage);
      console.warn(warningMessage);
    }

    if (reportsWithoutTelegram > 0) {
      const warningMessage = `Found ${reportsWithoutTelegram} ready report(s) without Telegram delivery binding in the current student registry.`;
      warningMessages.push(warningMessage);
      console.warn(warningMessage);
    }

    if (!job.requested_by_chat_id) {
      note =
        "Local Mac runner executed tp-weekly-all and tp-sync-reports, but skipped Telegram summary notification because requested_by_chat_id is missing.";
    } else {
      const summarySent = await sendTelegramBatchSummaryIfPossible(job.requested_by_chat_id, {
        weekFrom: job.week_from,
        weekTo: job.week_to,
        finalStatus: "completed",
        readyReports: reportsFound,
        failedReports: missingStudents.length,
        missingTelegramBindings: reportsWithoutTelegram,
        reportsRequiringReview: reportsFound,
        staleReportsSkipped,
        adminReportsUrl,
      });
      reportsSentToTelegram = summarySent ? 1 : 0;
      note =
        summarySent
          ? "Local Mac runner executed tp-weekly-all and tp-sync-reports, then sent a compact Telegram summary with the admin review link to the Telegram requester."
          : "Local Mac runner executed tp-weekly-all and tp-sync-reports, but failed to send the compact Telegram summary to the Telegram requester.";
      console.log(
        `[telegram] summary.${summarySent ? "sent" : "failed"} week=${job.week_from}..${job.week_to} ready=${reportsFound} failed=${missingStudents.length} without_telegram=${reportsWithoutTelegram} admin_url=${adminReportsUrl ?? "missing"}`
      );
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
      reports_without_telegram: reportsWithoutTelegram,
      stale_reports_skipped: staleReportsSkipped,
      reports_requiring_review: reportsFound,
      admin_reports_url: adminReportsUrl,
      note,
    };

    if (warningMessage) {
      result.warning_message = warningMessage;
    }

    await completeTrainingPeaksJob(job.id, result);

    console.log(
      `Completed TrainingPeaks job for ${job.week_from}..${job.week_to}. reports_found=${reportsFound} failed_reports=${missingStudents.length} without_telegram=${reportsWithoutTelegram} telegram_notifications=${reportsSentToTelegram} warnings=${warningMessages.length}`
    );
  } catch (error) {
    const shortErrorMessage = toShortErrorMessage(error);

    try {
      await failTrainingPeaksJob(job.id, shortErrorMessage);
      await sendTelegramBatchSummaryIfPossible(job.requested_by_chat_id, {
        weekFrom: job.week_from,
        weekTo: job.week_to,
        finalStatus: "failed",
        readyReports: reportsFound,
        failedReports: missingStudents.length,
        missingTelegramBindings: reportsWithoutTelegram,
        reportsRequiringReview: reportsFound,
        staleReportsSkipped,
        adminReportsUrl,
        errorMessage: shortErrorMessage,
      });
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
