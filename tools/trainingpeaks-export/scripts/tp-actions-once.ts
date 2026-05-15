import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";

type ActionExecutionStatus =
  | "not_started"
  | "dry_run_running"
  | "dry_run_completed"
  | "execute_pending"
  | "running_local"
  | "completed"
  | "failed";

type ActionExecutionMode = "dry_run" | "real";
type ActionRunType = "dry_run" | "real";
type ActionRunStatus = "running" | "completed" | "failed";

type TrainingPeaksStudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
};

type TrainingPeaksActionRow = {
  id: string;
  student_id: string | null;
  action_type: "move_workout";
  status: "pending_coach" | "approved" | "rejected";
  raw_text: string;
  parsed_payload: unknown;
  coach_chat_id: string | null;
  execution_status: ActionExecutionStatus;
  execution_mode: ActionExecutionMode | null;
};

type TrainingPeaksActionRunRow = {
  id: string;
  action_id: string;
  run_type: ActionRunType;
  status: ActionRunStatus;
  dry_run: boolean;
  runner_id: string | null;
  started_at: string;
};

type ClaimedAction = {
  action: TrainingPeaksActionRow;
  student: TrainingPeaksStudentRow | null;
};

type DryRunArtifacts = {
  screenshotBeforePath: string;
  screenshotAfterPath: string | null;
  pageMeta: {
    url: string;
    title: string;
    loginRequired: boolean;
    athletePageLikelyReachable: boolean;
    trainingPeaksContextLikely: boolean;
  };
};

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const ACTION_ARTIFACTS_ROOT = path.join(toolRoot, "action-artifacts");

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

function getRunnerId(): string {
  const hostname = process.env.HOSTNAME?.trim() || process.env.COMPUTERNAME?.trim() || "local-mac";
  return `tp-actions-once:${hostname}`;
}

function toShortErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= 500) {
    return normalized;
  }
  return `${normalized.slice(0, 497)}...`;
}

function getTargetSummary(parsedPayload: unknown): string {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return "target: unknown";
  }

  const payload = parsedPayload as {
    target?: { kind?: string; value?: string; sourceText?: string };
  };
  const target = payload.target;
  if (!target) {
    return "target: unknown";
  }

  if (target.kind === "relative_day") {
    if (target.value === "tomorrow") {
      return "move_workout на завтра";
    }
    if (target.value === "day_after_tomorrow") {
      return "move_workout на послезавтра";
    }
  }

  if (target.kind === "weekday") {
    const map: Record<string, string> = {
      monday: "понедельник",
      tuesday: "вторник",
      wednesday: "среда",
      thursday: "четверг",
      friday: "пятница",
      saturday: "суббота",
      sunday: "воскресенье",
    };
    if (target.value && map[target.value]) {
      return `move_workout на ${map[target.value]}`;
    }
  }

  return "target: unknown";
}

async function sendTelegramText(chatId: string, text: string): Promise<void> {
  const token = getOptionalEnv("TELEGRAM_BOT_TOKEN");
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN for Telegram delivery.");
  }

  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

async function notifyCoachDryRunResult(input: {
  chatId: string | null;
  action: TrainingPeaksActionRow;
  studentName: string;
  statusText: string;
  note: string;
  errorText?: string | null;
}): Promise<void> {
  if (!input.chatId) {
    return;
  }

  const lines = [
    "TrainingPeaks dry-run",
    `Action ID: ${input.action.id}`,
    `Ученик: ${input.studentName}`,
    `Сообщение: ${input.action.raw_text}`,
    `Target: ${getTargetSummary(input.action.parsed_payload)}`,
    `Статус: ${input.statusText}`,
    `Note: ${input.note}`,
  ];

  if (input.errorText) {
    lines.push(`Ошибка: ${input.errorText}`);
  }

  try {
    await sendTelegramText(input.chatId, lines.join("\n"));
  } catch (error) {
    console.warn(`Telegram action dry-run summary warning: ${toShortErrorMessage(error)}`);
  }
}

async function claimOneApprovedActionForDryRun(runnerId: string): Promise<ClaimedAction | null> {
  const supabase = getSupabase();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: candidate, error: selectError } = await supabase
      .from("trainingpeaks_actions")
      .select("*")
      .eq("action_type", "move_workout")
      .eq("status", "approved")
      .eq("execution_status", "not_started")
      .order("approved_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to select approved action for dry-run: ${selectError.message}`);
    }

    if (!candidate) {
      return null;
    }

    const { data: claimed, error: claimError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "dry_run_running",
        execution_mode: "dry_run",
        claimed_by: runnerId,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "approved")
      .eq("execution_status", "not_started")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim action ${candidate.id} for dry-run: ${claimError.message}`);
    }

    if (!claimed) {
      continue;
    }

    const action = claimed as TrainingPeaksActionRow;
    let student: TrainingPeaksStudentRow | null = null;
    if (action.student_id) {
      const { data: studentData, error: studentError } = await supabase
        .from("trainingpeaks_students")
        .select("id, student_id, student_name, trainingpeaks_athlete_url")
        .eq("id", action.student_id)
        .maybeSingle();
      if (studentError) {
        throw new Error(`Failed to fetch student for action ${action.id}: ${studentError.message}`);
      }
      student = (studentData as TrainingPeaksStudentRow | null) ?? null;
    }

    return { action, student };
  }

  return null;
}

async function createActionRun(actionId: string, runnerId: string): Promise<TrainingPeaksActionRunRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_action_runs")
    .insert({
      action_id: actionId,
      run_type: "dry_run",
      status: "running",
      dry_run: true,
      runner_id: runnerId,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create action run for ${actionId}: ${error.message}`);
  }

  return data as TrainingPeaksActionRunRow;
}

async function completeDryRun(
  actionId: string,
  runId: string,
  input: {
    logJson: unknown;
    screenshotBeforePath: string | null;
    screenshotAfterPath: string | null;
  }
): Promise<void> {
  const supabase = getSupabase();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      error_message: null,
      log_json: input.logJson,
      screenshot_before_path: input.screenshotBeforePath,
      screenshot_after_path: input.screenshotAfterPath,
    })
    .eq("id", runId)
    .eq("action_id", actionId)
    .eq("status", "running");
  if (runError) {
    throw new Error(`Failed to mark action run ${runId} completed: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "dry_run_completed",
      execution_mode: "dry_run",
      last_run_id: runId,
    })
    .eq("id", actionId);
  if (actionError) {
    throw new Error(`Failed to update action ${actionId} to dry_run_completed: ${actionError.message}`);
  }
}

async function failDryRun(
  actionId: string,
  runId: string,
  input: { errorMessage: string; logJson: unknown }
): Promise<void> {
  const supabase = getSupabase();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: input.errorMessage,
      log_json: input.logJson,
    })
    .eq("id", runId)
    .eq("action_id", actionId)
    .eq("status", "running");
  if (runError) {
    throw new Error(`Failed to mark action run ${runId} failed: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "failed",
      execution_mode: "dry_run",
      last_run_id: runId,
    })
    .eq("id", actionId);
  if (actionError) {
    throw new Error(`Failed to update action ${actionId} as failed: ${actionError.message}`);
  }
}

async function isVisible(locator: import("playwright").Locator, timeout = 700): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function anyVisible(
  locators: import("playwright").Locator[],
  timeout = 700
): Promise<boolean> {
  for (const locator of locators) {
    if (await isVisible(locator, timeout)) {
      return true;
    }
  }
  return false;
}

async function assessTrainingPeaksPage(page: import("playwright").Page): Promise<{
  loginRequired: boolean;
  athletePageLikelyReachable: boolean;
  trainingPeaksContextLikely: boolean;
}> {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});

  const [title, bodyText, currentUrl] = await Promise.all([
    page.title().catch(() => ""),
    page
      .locator("body")
      .innerText({ timeout: 3000 })
      .catch(() => ""),
    Promise.resolve(page.url()),
  ]);
  const combinedText = `${title} ${bodyText}`.replace(/\s+/g, " ").trim().toLowerCase();
  const trainingPeaksUrlDetected = currentUrl.toLowerCase().includes("trainingpeaks");

  const loginSignals = await Promise.all([
    isVisible(page.locator('input[type="password"]')),
    isVisible(page.locator('input[type="email"], input[name*="email" i], input[autocomplete="username"]')),
    anyVisible([
      page.getByRole("button", { name: /sign in|log in|login/i }),
      page.getByRole("link", { name: /sign in|log in|login/i }),
      page.getByText(/sign in|log in|login/i),
    ]),
  ]);
  const loginTextDetected = /sign in|log in|login|password|forgot password|remember me/.test(combinedText);
  if (/(login|signin|sign-in|auth)/i.test(currentUrl) || loginSignals.some(Boolean) || loginTextDetected) {
    return {
      loginRequired: true,
      athletePageLikelyReachable: false,
      trainingPeaksContextLikely: trainingPeaksUrlDetected,
    };
  }

  const shellTextDetected = /trainingpeaks|calendar|workout|athlete|account settings|export data/.test(combinedText);
  const trainingPeaksContextLikely = trainingPeaksUrlDetected || shellTextDetected;
  const athletePageLikelyReachable =
    trainingPeaksContextLikely && !/something went wrong|404|not found|unavailable|forbidden|access denied/.test(combinedText);

  return {
    loginRequired: false,
    athletePageLikelyReachable,
    trainingPeaksContextLikely,
  };
}

async function runDryRunInspection(claimed: ClaimedAction, runId: string): Promise<DryRunArtifacts> {
  const student = claimed.student;
  if (!student) {
    throw new Error(`Student is missing for action ${claimed.action.id}.`);
  }
  if (!student.trainingpeaks_athlete_url?.trim()) {
    throw new Error(`Missing trainingpeaks_athlete_url for student ${student.student_name}.`);
  }

  await mkdir(profileDir, { recursive: true });
  const artifactDir = path.join(ACTION_ARTIFACTS_ROOT, claimed.action.id, runId);
  await mkdir(artifactDir, { recursive: true });

  const screenshotBeforePath = path.join(artifactDir, "before.png");
  const screenshotAfterPath = path.join(artifactDir, "after.png");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.bringToFront();

    const pageAssessment = await assessTrainingPeaksPage(page);
    await page.screenshot({ path: screenshotBeforePath, fullPage: true });

    if (pageAssessment.loginRequired) {
      throw new Error("TrainingPeaks session expired or login required.");
    }
    if (!pageAssessment.trainingPeaksContextLikely) {
      throw new Error("Could not confirm TrainingPeaks context on athlete page.");
    }
    if (!pageAssessment.athletePageLikelyReachable) {
      throw new Error("Athlete page is not reachable or failed to load fully.");
    }

    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotAfterPath, fullPage: true });

    return {
      screenshotBeforePath,
      screenshotAfterPath,
      pageMeta: {
        url: page.url(),
        title: await page.title().catch(() => ""),
        loginRequired: pageAssessment.loginRequired,
        athletePageLikelyReachable: pageAssessment.athletePageLikelyReachable,
        trainingPeaksContextLikely: pageAssessment.trainingPeaksContextLikely,
      },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const runnerId = getRunnerId();
  const claimed = await claimOneApprovedActionForDryRun(runnerId);
  if (!claimed) {
    console.log("No approved TrainingPeaks actions ready for dry-run.");
    return;
  }

  console.log(`Claimed TrainingPeaks action ${claimed.action.id} for dry-run.`);
  const run = await createActionRun(claimed.action.id, runnerId);
  const baseLog: Record<string, unknown> = {
    actionId: claimed.action.id,
    runId: run.id,
    runnerId,
    runType: "dry_run",
    dryRun: true,
    actionType: claimed.action.action_type,
    actionStatus: claimed.action.status,
    rawText: claimed.action.raw_text,
    targetSummary: getTargetSummary(claimed.action.parsed_payload),
    student: claimed.student
      ? {
          id: claimed.student.id,
          studentId: claimed.student.student_id,
          studentName: claimed.student.student_name,
          trainingPeaksAthleteUrl: claimed.student.trainingpeaks_athlete_url,
        }
      : null,
  };

  const studentName = claimed.student?.student_name ?? "(unknown)";

  try {
    const artifacts = await runDryRunInspection(claimed, run.id);
    const logJson = {
      ...baseLog,
      status: "dry_run_completed",
      inspectedAt: new Date().toISOString(),
      pageMeta: artifacts.pageMeta,
      note: "Ничего не изменено в TrainingPeaks",
    };

    await completeDryRun(claimed.action.id, run.id, {
      logJson,
      screenshotBeforePath: artifacts.screenshotBeforePath,
      screenshotAfterPath: artifacts.screenshotAfterPath,
    });

    await notifyCoachDryRunResult({
      chatId: claimed.action.coach_chat_id,
      action: claimed.action,
      studentName,
      statusText: "dry-run completed",
      note: "Ничего не изменено в TrainingPeaks",
    });

    console.log(`Dry-run completed for action ${claimed.action.id}.`);
  } catch (error) {
    const errorMessage = toShortErrorMessage(error);
    const failedLog = {
      ...baseLog,
      status: "failed",
      failedAt: new Date().toISOString(),
      error: errorMessage,
      note: "Ничего не изменено в TrainingPeaks",
    };
    await failDryRun(claimed.action.id, run.id, {
      errorMessage,
      logJson: failedLog,
    });

    await notifyCoachDryRunResult({
      chatId: claimed.action.coach_chat_id,
      action: claimed.action,
      studentName,
      statusText: "dry-run failed",
      note: "Ничего не изменено в TrainingPeaks",
      errorText: errorMessage,
    });

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
