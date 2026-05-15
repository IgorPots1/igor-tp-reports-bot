import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  decided_by_chat_id: string | null;
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
  dryRunEvaluation: DryRunEvaluation;
  pageMeta: {
    url: string;
    title: string;
    loginRequired: boolean;
    athletePageLikelyReachable: boolean;
    trainingPeaksContextLikely: boolean;
  };
};

type TrainingPeaksMoveWorkoutTarget =
  | { kind: "relative_day"; value: "tomorrow" | "day_after_tomorrow"; sourceText?: string }
  | {
      kind: "weekday";
      value: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
      sourceText?: string;
    };

type ParsedMoveWorkoutPayload = {
  actionType?: "move_workout";
  target?: TrainingPeaksMoveWorkoutTarget;
};

type DryRunResult = "candidate_found" | "ambiguous" | "not_found" | "failed";

type DryRunResolvedDates = {
  sourceDate: string | null;
  targetDate: string | null;
  timezone: string | null;
};

type DryRunCandidate = {
  title: string | null;
  type: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
  startTimeLocal: string | null;
  fingerprint: string;
};

type DryRunDiagnostics = {
  loginRequired: boolean;
  athleteReachable: boolean;
  trainingPeaksContextOk: boolean;
  parseWarnings: string[];
};

type DryRunEvaluation = {
  dryRunResult: DryRunResult;
  resolvedDates: DryRunResolvedDates;
  candidate: DryRunCandidate | null;
  candidateAlternativesCount: number;
  confidence: number;
  canExecute: boolean;
  canExecuteReasons: string[];
  diagnostics: DryRunDiagnostics;
};

type RawWorkoutCandidate = {
  title: string | null;
  type: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
  startTimeLocal: string | null;
  dateIso: string | null;
  rawScore: number;
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

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(2));
}

function parseMoveWorkoutPayload(parsedPayload: unknown): ParsedMoveWorkoutPayload | null {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return null;
  }

  const payload = parsedPayload as ParsedMoveWorkoutPayload;
  if (payload.actionType !== "move_workout" || !payload.target) {
    return null;
  }
  if (payload.target.kind !== "relative_day" && payload.target.kind !== "weekday") {
    return null;
  }
  return payload;
}

function resolveTargetDateFromPayload(target: TrainingPeaksMoveWorkoutTarget): { targetDate: string; warnings: string[] } {
  const warnings: string[] = [];
  const now = new Date();

  if (target.kind === "relative_day") {
    if (target.value === "tomorrow") {
      return { targetDate: toIsoDate(addDays(now, 1)), warnings };
    }
    return { targetDate: toIsoDate(addDays(now, 2)), warnings };
  }

  const weekdayMap: Record<TrainingPeaksMoveWorkoutTarget["value"], number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
    tomorrow: 0,
    day_after_tomorrow: 0,
  };

  const nowWeekday = now.getUTCDay();
  const targetWeekday = weekdayMap[target.value];
  if (targetWeekday === undefined) {
    warnings.push("target weekday is unknown");
    return { targetDate: toIsoDate(now), warnings };
  }

  let delta = (targetWeekday - nowWeekday + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  return { targetDate: toIsoDate(addDays(now, delta)), warnings };
}

function dateDistanceDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00.000Z`).getTime();
  const to = new Date(`${toIso}T00:00:00.000Z`).getTime();
  const diffMs = Math.abs(to - from);
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function normalizeDateCandidate(raw: string): string | null {
  const direct = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    return `${direct[1]}-${direct[2]}-${direct[3]}`;
  }

  const slash = raw.trim().match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/);
  if (slash) {
    const now = new Date();
    const year = slash[3] ? Number(slash[3]) : now.getUTCFullYear();
    const month = Number(slash[2]);
    const day = Number(slash[1]);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
      return null;
    }
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${String(year).padStart(4, "0")}-${mm}-${dd}`;
  }

  return null;
}

function parseDurationSeconds(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return null;
  }

  const hhmmss = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmss) {
    const hours = Number(hhmmss[1]);
    const minutes = Number(hhmmss[2]);
    const seconds = Number(hhmmss[3] ?? "0");
    return hours * 3600 + minutes * 60 + seconds;
  }

  const hourMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(h|hr|hour|hours|ч)\b/);
  const minMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(m|min|mins|minute|minutes|мин)\b/);
  const secMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(s|sec|secs|second|seconds|сек)\b/);
  if (hourMatch || minMatch || secMatch) {
    const hours = Number((hourMatch?.[1] ?? "0").replace(",", "."));
    const minutes = Number((minMatch?.[1] ?? "0").replace(",", "."));
    const seconds = Number((secMatch?.[1] ?? "0").replace(",", "."));
    return Math.round(hours * 3600 + minutes * 60 + seconds);
  }

  return null;
}

function parseDistance(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return null;
  }
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(km|км|mi|mile|miles|м|meter|meters)\b/);
  if (!match) {
    return null;
  }
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) {
    return null;
  }
  const unit = match[2];
  if (unit === "mi" || unit === "mile" || unit === "miles") {
    return Number((value * 1.60934).toFixed(2));
  }
  if (unit === "m" || unit === "м" || unit === "meter" || unit === "meters") {
    return Number((value / 1000).toFixed(3));
  }
  return value;
}

function buildCandidateFingerprint(input: {
  studentId: string | null;
  dateIso: string | null;
  title: string | null;
  type: string | null;
  startTimeLocal: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
}): string {
  const stable = [
    input.studentId ?? "na",
    input.dateIso ?? "na",
    (input.title ?? "untitled").trim().toLowerCase(),
    (input.type ?? "na").trim().toLowerCase(),
    input.startTimeLocal ?? "na",
    input.plannedDurationSec === null ? "na" : String(input.plannedDurationSec),
    input.plannedDistance === null ? "na" : String(input.plannedDistance),
  ].join("|");
  return createHash("sha1").update(stable).digest("hex");
}

function resolveDryRunNotificationChatId(action: TrainingPeaksActionRow): string | null {
  const chatId = action.coach_chat_id ?? action.decided_by_chat_id;
  if (!chatId) {
    console.warn(
      `TrainingPeaks dry-run: skipping coach Telegram notification — no chat id (coach_chat_id and decided_by_chat_id both null) for action ${action.id}, status=${action.status}`
    );
  }
  return chatId;
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
  dryRunEvaluation?: DryRunEvaluation | null;
  errorText?: string | null;
}): Promise<void> {
  if (!input.chatId) {
    return;
  }

  const lines = [
    "TrainingPeaks dry-run",
    `Action ID: ${input.action.id}`,
    `Ученик: ${input.studentName}`,
    `Raw text: ${input.action.raw_text}`,
    `Target: ${getTargetSummary(input.action.parsed_payload)}`,
    `Статус: ${input.statusText}`,
  ];

  if (input.dryRunEvaluation) {
    const evaluation = input.dryRunEvaluation;
    lines.push(`dryRunResult: ${evaluation.dryRunResult}`);
    lines.push(`resolved target date: ${evaluation.resolvedDates.targetDate ?? "unknown"}`);
    lines.push(`resolved source date: ${evaluation.resolvedDates.sourceDate ?? "unknown"}`);
    lines.push(`candidate: ${formatCandidateLine(evaluation.candidate)}`);
    if (!evaluation.canExecute) {
      const reason = evaluation.canExecuteReasons.join("; ") || "небезопасно выполнить";
      lines.push(`reason: ${reason}`);
    }
    lines.push(`confidence: ${evaluation.confidence.toFixed(2)}`);
    lines.push(`canExecute: ${evaluation.canExecute ? "yes" : "no"}`);
  }

  if (input.errorText) {
    lines.push(`Ошибка: ${input.errorText}`);
  }
  lines.push(input.note);

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

function scoreWorkoutCandidate(input: {
  title: string | null;
  type: string | null;
  dateIso: string | null;
  targetDate: string | null;
  distanceFromTodayDays: number | null;
}): number {
  let score = 0.35;
  if (input.title) {
    score += 0.2;
  }
  if (input.type) {
    score += 0.1;
  }
  if (input.dateIso && input.targetDate) {
    const days = dateDistanceDays(input.dateIso, input.targetDate);
    if (days === 0) {
      score += 0.3;
    } else if (days === 1) {
      score += 0.2;
    } else if (days === 2) {
      score += 0.08;
    } else {
      score -= Math.min(0.2, days * 0.03);
    }
  }
  if (input.distanceFromTodayDays !== null) {
    if (input.distanceFromTodayDays <= 3) {
      score += 0.1;
    } else if (input.distanceFromTodayDays >= 8) {
      score -= 0.1;
    }
  }
  return clampConfidence(score);
}

async function extractWorkoutCandidatesFromPage(
  page: import("playwright").Page,
  targetDateIso: string | null
): Promise<RawWorkoutCandidate[]> {
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  const texts = await page.locator("div,li,article,section,a").allInnerTexts().catch(() => []);
  const MAX_CANDIDATES = 40;
  const seen = new Set<string>();

  const candidates = texts
    .map((value) => normalize(value))
    .filter((text) => text.length >= 3 && text.length <= 280)
    .filter((text) => /(run|bike|swim|workout|strength|йога|бег|вел|плав|трениров)/i.test(text))
    .slice(0, 1200)
    .map((text) => {
      const lower = text.toLowerCase();
      const type =
        lower.includes("run") || lower.includes("бег")
          ? "run"
          : lower.includes("bike") || lower.includes("вел")
            ? "bike"
            : lower.includes("swim") || lower.includes("плав")
              ? "swim"
              : lower.includes("strength")
                ? "strength"
                : null;
      const dateRaw =
        text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ??
        text.match(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{4})?\b/)?.[0] ??
        null;
      const startTimeLocal = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] ?? null;
      const plannedDurationRaw =
        text.match(
          /\b(?:\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)?\s*(?:h|hr|hour|hours|ч|min|mins|minute|minutes|мин|sec|secs|second|seconds|сек))\b/i
        )?.[0] ?? null;
      const plannedDistanceRaw = text.match(/\b\d+(?:[.,]\d+)?\s*(?:km|км|mi|mile|miles|m|м|meter|meters)\b/i)?.[0] ?? null;
      const title = text.split(/[,|]/)[0]?.slice(0, 120) ?? null;
      const dateIso = dateRaw ? normalizeDateCandidate(dateRaw) : null;
      const distanceFromTodayDays = dateIso === null ? null : dateDistanceDays(toIsoDate(new Date()), dateIso);

      return {
        title,
        type,
        plannedDurationRaw,
        plannedDistanceRaw,
        startTimeLocal,
        dateIsoRaw: dateIso,
        distanceFromTodayDays,
      };
    })
    .filter((candidate) => {
      if (!targetDateIso || !candidate.dateIsoRaw) {
        return true;
      }
      return dateDistanceDays(candidate.dateIsoRaw, targetDateIso) <= 14;
    })
    .filter((candidate) => {
      const key = `${candidate.title ?? "na"}|${candidate.type ?? "na"}|${candidate.dateIsoRaw ?? "na"}|${candidate.startTimeLocal ?? "na"}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CANDIDATES);

  return candidates
    .map((candidate) => {
      const dateIso = candidate.dateIsoRaw ? normalizeDateCandidate(candidate.dateIsoRaw) : null;
      const rawScore = scoreWorkoutCandidate({
        title: candidate.title,
        type: candidate.type,
        dateIso,
        targetDate: targetDateIso,
        distanceFromTodayDays: candidate.distanceFromTodayDays,
      });
      return {
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationRaw ? parseDurationSeconds(candidate.plannedDurationRaw) : null,
        plannedDistance: candidate.plannedDistanceRaw ? parseDistance(candidate.plannedDistanceRaw) : null,
        startTimeLocal: candidate.startTimeLocal,
        dateIso,
        rawScore,
      } satisfies RawWorkoutCandidate;
    })
    .sort((left, right) => right.rawScore - left.rawScore);
}

function evaluateDryRunOutcome(input: {
  action: TrainingPeaksActionRow;
  student: TrainingPeaksStudentRow | null;
  pageMeta: {
    loginRequired: boolean;
    athletePageLikelyReachable: boolean;
    trainingPeaksContextLikely: boolean;
  };
  candidates: RawWorkoutCandidate[];
}): DryRunEvaluation {
  const parseWarnings: string[] = [];
  const payload = parseMoveWorkoutPayload(input.action.parsed_payload);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  let targetDate: string | null = null;
  let sourceDate: string | null = null;

  if (!payload?.target) {
    parseWarnings.push("parsed_payload.target is missing or invalid");
  } else {
    const resolved = resolveTargetDateFromPayload(payload.target);
    targetDate = resolved.targetDate;
    parseWarnings.push(...resolved.warnings);
  }

  const diagnostics: DryRunDiagnostics = {
    loginRequired: input.pageMeta.loginRequired,
    athleteReachable: input.pageMeta.athletePageLikelyReachable,
    trainingPeaksContextOk: input.pageMeta.trainingPeaksContextLikely,
    parseWarnings,
  };

  const canExecuteReasons: string[] = [];
  if (diagnostics.loginRequired) {
    canExecuteReasons.push("login required");
  }
  if (!diagnostics.athleteReachable) {
    canExecuteReasons.push("athlete page unreachable");
  }
  if (!diagnostics.trainingPeaksContextOk) {
    canExecuteReasons.push("trainingpeaks context not confirmed");
  }

  if (canExecuteReasons.length > 0) {
    return {
      dryRunResult: "failed",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: input.candidates.length,
      confidence: 0,
      canExecute: false,
      canExecuteReasons,
      diagnostics,
    };
  }

  if (input.candidates.length === 0) {
    return {
      dryRunResult: "not_found",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0.2,
      canExecute: false,
      canExecuteReasons: ["no workout candidates found on page"],
      diagnostics,
    };
  }

  const top = input.candidates[0]!;
  const second = input.candidates[1] ?? null;
  const confidence = clampConfidence(
    top.rawScore - (second ? Math.min(0.18, Math.max(0, second.rawScore - 0.45)) : 0)
  );
  sourceDate = top.dateIso;
  const alternativesCount = Math.max(0, input.candidates.length - 1);

  const candidate: DryRunCandidate = {
    title: top.title,
    type: top.type,
    plannedDurationSec: top.plannedDurationSec,
    plannedDistance: top.plannedDistance,
    startTimeLocal: top.startTimeLocal,
    fingerprint: buildCandidateFingerprint({
      studentId: input.student?.id ?? null,
      dateIso: sourceDate,
      title: top.title,
      type: top.type,
      startTimeLocal: top.startTimeLocal,
      plannedDurationSec: top.plannedDurationSec,
      plannedDistance: top.plannedDistance,
    }),
  };

  let dryRunResult: DryRunResult = "candidate_found";
  const reasons: string[] = [];

  if (input.candidates.length > 1 && second && Math.abs(top.rawScore - second.rawScore) < 0.12) {
    dryRunResult = "ambiguous";
    reasons.push("multiple plausible workout candidates");
  }
  if (!targetDate) {
    reasons.push("target date could not be resolved");
  }
  if (!sourceDate) {
    reasons.push("source date could not be resolved safely");
  }
  if (!candidate.fingerprint) {
    reasons.push("candidate fingerprint missing");
  }
  if (confidence < 0.8) {
    reasons.push("confidence below threshold 0.8");
  }

  const canExecute =
    dryRunResult === "candidate_found" &&
    input.candidates.length === 1 &&
    Boolean(targetDate) &&
    Boolean(sourceDate) &&
    Boolean(candidate.fingerprint) &&
    confidence >= 0.8;

  if (!canExecute && reasons.length === 0) {
    reasons.push("safety policy conditions not met");
  }

  if (dryRunResult === "candidate_found" && !canExecute) {
    dryRunResult = input.candidates.length > 1 ? "ambiguous" : "not_found";
  }

  return {
    dryRunResult,
    resolvedDates: {
      sourceDate: sourceDate ?? null,
      targetDate: targetDate ?? null,
      timezone,
    },
    candidate,
    candidateAlternativesCount: alternativesCount,
    confidence,
    canExecute,
    canExecuteReasons: canExecute ? [] : reasons,
    diagnostics,
  };
}

function formatCandidateLine(candidate: DryRunCandidate | null): string {
  if (!candidate) {
    return "кандидат не найден";
  }
  const parts: string[] = [];
  if (candidate.title) {
    parts.push(candidate.title);
  }
  if (candidate.type) {
    parts.push(`тип=${candidate.type}`);
  }
  if (candidate.plannedDurationSec !== null) {
    parts.push(`длит=${candidate.plannedDurationSec}с`);
  }
  if (candidate.plannedDistance !== null) {
    parts.push(`дист=${candidate.plannedDistance}км`);
  }
  if (candidate.startTimeLocal) {
    parts.push(`старт=${candidate.startTimeLocal}`);
  }
  return parts.join(", ") || "кандидат без деталей";
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

    const parsedPayload = parseMoveWorkoutPayload(claimed.action.parsed_payload);
    const resolvedTargetDate = parsedPayload?.target
      ? resolveTargetDateFromPayload(parsedPayload.target).targetDate
      : null;
    const extractedCandidates = await extractWorkoutCandidatesFromPage(page, resolvedTargetDate);
    const dryRunEvaluation = evaluateDryRunOutcome({
      action: claimed.action,
      student,
      pageMeta: pageAssessment,
      candidates: extractedCandidates,
    });

    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotAfterPath, fullPage: true });

    return {
      screenshotBeforePath,
      screenshotAfterPath,
      dryRunEvaluation,
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
    const evaluation = artifacts.dryRunEvaluation;
    const logJson = {
      ...baseLog,
      status: "dry_run_completed",
      inspectedAt: new Date().toISOString(),
      pageMeta: artifacts.pageMeta,
      dryRunResult: evaluation.dryRunResult,
      resolvedDates: evaluation.resolvedDates,
      candidate: evaluation.candidate,
      candidateAlternativesCount: evaluation.candidateAlternativesCount,
      confidence: evaluation.confidence,
      canExecute: evaluation.canExecute,
      canExecuteReasons: evaluation.canExecuteReasons,
      diagnostics: evaluation.diagnostics,
      note: "Ничего не изменено в TrainingPeaks",
    };

    await completeDryRun(claimed.action.id, run.id, {
      logJson,
      screenshotBeforePath: artifacts.screenshotBeforePath,
      screenshotAfterPath: artifacts.screenshotAfterPath,
    });

    await notifyCoachDryRunResult({
      chatId: resolveDryRunNotificationChatId(claimed.action),
      action: claimed.action,
      studentName,
      statusText: "dry-run completed",
      dryRunEvaluation: evaluation,
      note: "Ничего не изменено в TrainingPeaks",
    });

    console.log(`Dry-run completed for action ${claimed.action.id}.`);
  } catch (error) {
    const errorMessage = toShortErrorMessage(error);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    const failedEvaluation: DryRunEvaluation = {
      dryRunResult: "failed",
      resolvedDates: {
        sourceDate: null,
        targetDate: null,
        timezone,
      },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0,
      canExecute: false,
      canExecuteReasons: [errorMessage],
      diagnostics: {
        loginRequired: /login|sign in|session expired/i.test(errorMessage),
        athleteReachable: false,
        trainingPeaksContextOk: false,
        parseWarnings: [],
      },
    };
    const failedLog = {
      ...baseLog,
      status: "failed",
      failedAt: new Date().toISOString(),
      error: errorMessage,
      dryRunResult: failedEvaluation.dryRunResult,
      resolvedDates: failedEvaluation.resolvedDates,
      candidate: failedEvaluation.candidate,
      candidateAlternativesCount: failedEvaluation.candidateAlternativesCount,
      confidence: failedEvaluation.confidence,
      canExecute: failedEvaluation.canExecute,
      canExecuteReasons: failedEvaluation.canExecuteReasons,
      diagnostics: failedEvaluation.diagnostics,
      note: "Ничего не изменено в TrainingPeaks",
    };
    await failDryRun(claimed.action.id, run.id, {
      errorMessage,
      logJson: failedLog,
    });

    await notifyCoachDryRunResult({
      chatId: resolveDryRunNotificationChatId(claimed.action),
      action: claimed.action,
      studentName,
      statusText: "dry-run failed",
      dryRunEvaluation: failedEvaluation,
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
