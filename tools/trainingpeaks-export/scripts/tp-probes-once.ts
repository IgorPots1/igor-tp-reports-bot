import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";

type TrainingPeaksJobStatus = "queued" | "running" | "completed" | "failed";
type TrainingPeaksJobType = "race_results_probe";

type RaceResultsProbeRequestJson = {
  distance?: string;
  preset?: string;
  from?: string;
  to?: string;
  athleteId?: number;
  studentSlug?: string;
};

type TrainingPeaksJobRow = {
  id: string;
  job_type: TrainingPeaksJobType;
  status: TrainingPeaksJobStatus;
  scope: string;
  student_id: string | null;
  week_from: string;
  week_to: string;
  request_json: RaceResultsProbeRequestJson | null;
  requested_by_chat_id: string | null;
  requested_by_user_id: string | null;
  result_json: unknown | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

type ResultCandidate = {
  date?: string;
  pace_text?: string;
  duration_text?: string;
  distance_km?: number;
};

type DistanceBucketReport = {
  label?: string;
  official_best?: ResultCandidate | null;
  probable_best?: ResultCandidate | null;
  probable_or_possible_best?: ResultCandidate | null;
  candidate_result_summary?: {
    probable_best?: ResultCandidate | null;
    probable_or_possible_best?: ResultCandidate | null;
    clean_training_best?: ResultCandidate | null;
  };
  clean_training_best?: ResultCandidate | null;
};

type ManualReviewCandidate = {
  distance_bucket?: string;
  distance_label?: string;
  date?: string;
  distance_km?: number;
  duration_text?: string;
  pace_text?: string;
  warnings?: string[];
  same_day_event?: boolean;
  event_name?: string | null;
  result_status?:
    | "official_event"
    | "probable_result"
    | "possible_result"
    | "training_candidate"
    | "needs_coach_review"
    | "excluded";
  display_class?: string;
  rationale?: string;
  short_review_reason?: string;
};

type RaceResultsProbeReport = {
  athlete?: {
    athlete_id?: number;
    student_id?: string | null;
    student_name?: string | null;
  };
  range?: {
    from?: string;
    to?: string;
  };
  distance_results?: Record<string, DistanceBucketReport>;
  manual_review_candidates?: ManualReviewCandidate[];
  manual_review_summary?: {
    total?: number;
  };
  workouts_scanned?: number;
  output_paths?: {
    report_json?: string;
    report_md?: string;
  };
};

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_MESSAGE_LIMIT = 4000;
const STALE_RUNNING_JOB_TIMEOUT_MINUTES = 12 * 60;
const STALE_RUNNING_JOB_ERROR_MESSAGE = "Race-results probe job marked failed after stale running timeout";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MANUAL_REVIEW_CANDIDATES_IN_TELEGRAM = 5;
const SHORT_COURSE_NOTE_THRESHOLD_KM: Record<string, number> = {
  "5k": 4.85,
};

const DISTANCE_LINES = [
  { key: "5k", label: "5 км" },
  { key: "10k", label: "10 км" },
  { key: "half", label: "21.1 км" },
  { key: "marathon", label: "42.2 км" },
] as const;

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

function toShortErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length <= 350 ? normalized : `${normalized.slice(0, 347)}...`;
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

async function recoverStaleRunningProbeJobs(timeoutMinutes: number): Promise<number> {
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
    .eq("job_type", "race_results_probe")
    .eq("status", "running")
    .not("started_at", "is", null)
    .lt("started_at", cutoff)
    .select("id");
  if (error) {
    throw new Error(`Failed to recover stale race-results probe jobs: ${error.message}`);
  }
  return (data ?? []).length;
}

async function claimNextQueuedProbeJob(): Promise<TrainingPeaksJobRow | null> {
  const supabase = getSupabase();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: nextJob, error: selectError } = await supabase
      .from("trainingpeaks_jobs")
      .select("*")
      .eq("job_type", "race_results_probe")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (selectError) {
      throw new Error(`Failed to select next race-results probe job: ${selectError.message}`);
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
      throw new Error(`Failed to claim race-results probe job ${nextJob.id}: ${claimError.message}`);
    }
    if (claimedJob) {
      return claimedJob as TrainingPeaksJobRow;
    }
  }
  return null;
}

async function completeProbeJob(jobId: string, result: unknown): Promise<void> {
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
    throw new Error(`Failed to complete race-results probe job ${jobId}: ${error.message}`);
  }
}

async function failProbeJob(jobId: string, errorMessage: string, result?: unknown): Promise<void> {
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
    throw new Error(`Failed to fail race-results probe job ${jobId}: ${error.message}`);
  }
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

function splitTelegramMessage(text: string): string[] {
  const normalizedText = text.trim();
  if (normalizedText.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [normalizedText];
  }
  const chunks: string[] = [];
  let rest = normalizedText;
  while (rest.length > 0) {
    if (rest.length <= TELEGRAM_MESSAGE_LIMIT) {
      chunks.push(rest);
      break;
    }
    let boundary = rest.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    if (boundary < Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5)) {
      boundary = rest.lastIndexOf(" ", TELEGRAM_MESSAGE_LIMIT);
    }
    if (boundary <= 0) {
      boundary = TELEGRAM_MESSAGE_LIMIT;
    }
    chunks.push(rest.slice(0, boundary).trimEnd());
    rest = rest.slice(boundary).trimStart();
  }
  return chunks.filter(Boolean);
}

async function sendTelegramChunks(chatId: string, text: string): Promise<number> {
  const chunks = splitTelegramMessage(text);
  for (const chunk of chunks) {
    await sendTelegramText(chatId, chunk);
  }
  return chunks.length;
}

function readRequestJson(job: TrainingPeaksJobRow): RaceResultsProbeRequestJson {
  if (job.request_json && typeof job.request_json === "object") {
    return job.request_json;
  }
  return {};
}

function resolveAthleteId(job: TrainingPeaksJobRow, request: RaceResultsProbeRequestJson): number {
  const athleteId = request.athleteId;
  if (typeof athleteId === "number" && Number.isInteger(athleteId) && athleteId > 0) {
    return athleteId;
  }
  throw new Error(`Job ${job.id} is missing a valid athleteId in request_json.`);
}

function resolveDateRange(
  job: TrainingPeaksJobRow,
  request: RaceResultsProbeRequestJson
): { from: string; to: string } {
  const from = request.from ?? job.week_from;
  const to = request.to ?? job.week_to;
  if (!ISO_DATE_PATTERN.test(from) || !ISO_DATE_PATTERN.test(to)) {
    throw new Error(`Invalid date range in job ${job.id}: ${from}..${to}`);
  }
  return { from, to };
}

async function getLatestRaceResultsProbeReportPath(athleteId: number): Promise<string | null> {
  const probeRoot = path.join(toolRoot, "debug", "race-results-probe", String(athleteId));
  await mkdir(probeRoot, { recursive: true });
  const entries = await readdir(probeRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (dirs.length === 0) {
    return null;
  }
  const latestDir = path.join(probeRoot, dirs[0]!);
  const reportJsonPath = path.join(latestDir, "report.json");
  return existsSync(reportJsonPath) ? reportJsonPath : null;
}

function formatCompactResult(candidate: ResultCandidate | null | undefined): string {
  if (!candidate?.date || !candidate.pace_text) {
    return "—";
  }
  const [, month, day] = candidate.date.split("-");
  const shortDate = month && day ? `${day}.${month}` : candidate.date;
  return `${shortDate} ${candidate.pace_text}`;
}

function pickCandidateResult(bucket: DistanceBucketReport | undefined): ResultCandidate | null {
  if (!bucket) {
    return null;
  }
  return (
    bucket.candidate_result_summary?.probable_or_possible_best ??
    bucket.candidate_result_summary?.probable_best ??
    bucket.probable_or_possible_best ??
    bucket.probable_best ??
    null
  );
}

function pickTrainingResult(bucket: DistanceBucketReport | undefined): ResultCandidate | null {
  if (!bucket) {
    return null;
  }
  return bucket.candidate_result_summary?.clean_training_best ?? bucket.clean_training_best ?? null;
}

function formatManualReviewResultStatus(candidate: ManualReviewCandidate): string | null {
  switch (candidate.result_status) {
    case "official_event":
      return "официальный старт";
    case "probable_result":
      return "вероятный результат";
    case "possible_result":
      return "возможный результат";
    case "training_candidate":
      return "тренировка";
    case "needs_coach_review":
      return "проверить тренеру";
    case "excluded":
      return "исключено";
    default:
      return null;
  }
}

function formatManualReviewShortCourseNote(candidate: ManualReviewCandidate): string | null {
  const bucket = candidate.distance_bucket;
  const thresholdKm = bucket ? SHORT_COURSE_NOTE_THRESHOLD_KM[bucket] : undefined;
  const distanceKm = candidate.distance_km;
  const distanceLabel = candidate.distance_label?.trim();
  if (thresholdKm === undefined || distanceKm === undefined || distanceKm >= thresholdKm || !distanceLabel) {
    return null;
  }
  return `дистанция короче ${distanceLabel}, проверить контекст`;
}

function formatManualReviewCandidateReason(candidate: ManualReviewCandidate): string | null {
  const parts: string[] = [];
  const shortCourseNote = formatManualReviewShortCourseNote(candidate);
  if (shortCourseNote) {
    parts.push(shortCourseNote);
  }

  const eventName = candidate.event_name?.trim();
  if (candidate.same_day_event && eventName) {
    parts.push(eventName);
  } else if (
    !candidate.same_day_event &&
    candidate.result_status &&
    ["probable_result", "possible_result", "needs_coach_review"].includes(candidate.result_status)
  ) {
    parts.push("быстрый кандидат без старта");
  }

  const warnings = (candidate.warnings ?? []).filter(Boolean);
  if (warnings.length > 0) {
    parts.push(warnings.join(" / "));
  }

  if (parts.length > 0) {
    return parts.join(" / ");
  }

  const fallbackReason = candidate.short_review_reason?.trim() || candidate.rationale?.trim();
  if (fallbackReason) {
    return fallbackReason.length <= 120 ? fallbackReason : `${fallbackReason.slice(0, 117)}...`;
  }

  return null;
}

function formatManualReviewCandidateBlock(candidate: ManualReviewCandidate): string[] {
  const mainParts = [
    candidate.distance_label?.trim() || "—",
    candidate.date?.trim() || "—",
    candidate.duration_text?.trim() || "—",
    candidate.pace_text?.trim() || "—",
  ];
  const resultStatus = formatManualReviewResultStatus(candidate);
  if (resultStatus) {
    mainParts.push(resultStatus);
  }
  const lines = [`• ${mainParts.join(" · ")}`];
  const reason = formatManualReviewCandidateReason(candidate);
  if (reason) {
    lines.push(`  ${reason}`);
  }
  return lines;
}

function buildManualReviewSection(report: RaceResultsProbeReport): string[] {
  const candidates = report.manual_review_candidates ?? [];
  const total =
    report.manual_review_summary?.total ?? (candidates.length > 0 ? candidates.length : 0);

  if (total <= 0) {
    return ["", "⚠️ Проверить: нет"];
  }

  const lines = ["", "⚠️ Проверить:"];
  const topCandidates = candidates.slice(0, MAX_MANUAL_REVIEW_CANDIDATES_IN_TELEGRAM);
  for (const candidate of topCandidates) {
    lines.push(...formatManualReviewCandidateBlock(candidate));
  }

  const remaining = total - topCandidates.length;
  if (remaining > 0) {
    lines.push(`Ещё ${remaining} кандидатов в полном отчёте.`);
  }

  return lines;
}

async function loadStudentName(studentInternalId: string | null, fallbackSlug: string | null): Promise<string> {
  if (!studentInternalId) {
    return fallbackSlug ?? "ученик";
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("student_name, student_id")
    .eq("id", studentInternalId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load student ${studentInternalId}: ${error.message}`);
  }
  if (!data) {
    return fallbackSlug ?? studentInternalId;
  }
  return data.student_name?.trim() || data.student_id?.trim() || studentInternalId;
}

function buildRaceResultsProbeSummaryText(input: {
  studentName: string;
  from: string;
  to: string;
  report: RaceResultsProbeReport;
}): string {
  const lines = [
    `🏁 Результаты — ${input.studentName}`,
    `Период: ${input.from} — ${input.to}`,
    "",
  ];

  for (const distance of DISTANCE_LINES) {
    const bucket = input.report.distance_results?.[distance.key];
    const official = formatCompactResult(bucket?.official_best);
    const candidate = formatCompactResult(pickCandidateResult(bucket));
    const training = formatCompactResult(pickTrainingResult(bucket));
    lines.push(`${distance.label}: офиц. ${official} · канд. ${candidate} · трен. ${training}`);
  }

  lines.push(...buildManualReviewSection(input.report));
  return lines.join("\n");
}

async function runRaceResultsProbeJob(job: TrainingPeaksJobRow): Promise<{
  athleteId: number;
  studentInternalId: string | null;
  studentSlug: string | null;
  reportJsonPath: string;
  reportMdPath: string | null;
  workoutsScanned: number;
  manualReviewCount: number;
  summaryText: string;
}> {
  const request = readRequestJson(job);
  const athleteId = resolveAthleteId(job, request);
  const { from, to } = resolveDateRange(job, request);
  const distance = request.distance?.trim() || "all";

  await runNpmScript("tp-probe-race-results", [
    `--athlete-id=${athleteId}`,
    `--from=${from}`,
    `--to=${to}`,
    `--distance=${distance}`,
  ]);

  let reportJsonPath = await getLatestRaceResultsProbeReportPath(athleteId);
  if (!reportJsonPath) {
    throw new Error(`Race-results probe finished, but report.json was not found for athlete ${athleteId}.`);
  }

  const reportJsonRaw = readTextFileSyncSafe(reportJsonPath);
  if (!reportJsonRaw) {
    throw new Error(`Race-results probe produced empty report.json: ${reportJsonPath}`);
  }

  let report: RaceResultsProbeReport;
  try {
    report = JSON.parse(reportJsonRaw) as RaceResultsProbeReport;
  } catch (error) {
    throw new Error(`Failed to parse report.json: ${toShortErrorMessage(error)}`);
  }

  if (report.output_paths?.report_json && existsSync(report.output_paths.report_json)) {
    reportJsonPath = report.output_paths.report_json;
  }

  const reportMdPath =
    report.output_paths?.report_md && existsSync(report.output_paths.report_md)
      ? report.output_paths.report_md
      : reportJsonPath.replace(/\.json$/i, ".md");

  const studentName = await loadStudentName(
    job.student_id,
    report.athlete?.student_name ?? request.studentSlug ?? null
  );

  const manualReviewCount =
    report.manual_review_summary?.total ?? report.manual_review_candidates?.length ?? 0;

  return {
    athleteId,
    studentInternalId: job.student_id,
    studentSlug: request.studentSlug ?? report.athlete?.student_id ?? null,
    reportJsonPath,
    reportMdPath: existsSync(reportMdPath) ? reportMdPath : null,
    workoutsScanned: report.workouts_scanned ?? 0,
    manualReviewCount,
    summaryText: buildRaceResultsProbeSummaryText({
      studentName,
      from: report.range?.from ?? from,
      to: report.range?.to ?? to,
      report,
    }),
  };
}

async function main(): Promise<void> {
  loadLocalEnv();
  const recoveredJobs = await recoverStaleRunningProbeJobs(STALE_RUNNING_JOB_TIMEOUT_MINUTES);
  if (recoveredJobs > 0) {
    console.log(`Recovered ${recoveredJobs} stale race-results probe job(s).`);
  }

  const job = await claimNextQueuedProbeJob();
  if (!job) {
    console.log("No queued TrainingPeaks race-results probe jobs.");
    return;
  }

  const request = readRequestJson(job);
  const athleteId = resolveAthleteId(job, request);
  const { from, to } = resolveDateRange(job, request);
  console.log(`Claimed race-results probe job ${job.id} for athlete ${athleteId} (${from}..${to}).`);

  try {
    const run = await runRaceResultsProbeJob(job);
    let telegramParts = 0;
    if (job.requested_by_chat_id) {
      telegramParts = await sendTelegramChunks(job.requested_by_chat_id, run.summaryText);
    }

    await completeProbeJob(job.id, {
      athlete_id: run.athleteId,
      student_id: run.studentSlug,
      student_internal_id: run.studentInternalId,
      report_json_path: run.reportJsonPath,
      report_md_path: run.reportMdPath,
      workouts_scanned: run.workoutsScanned,
      manual_review_count: run.manualReviewCount,
      completed_at: new Date().toISOString(),
      telegram_messages_sent: telegramParts,
      note: "Race-results probe executed on local Mac via tp-probe-race-results (read-only).",
    });

    console.log(
      `Completed race-results probe job ${job.id}. workouts=${run.workoutsScanned} manual_review=${run.manualReviewCount} telegram_parts=${telegramParts} report=${run.reportJsonPath}`
    );
  } catch (error) {
    const shortErrorMessage = toShortErrorMessage(error);
    try {
      await failProbeJob(job.id, shortErrorMessage, {
        athlete_id: athleteId,
        student_internal_id: job.student_id,
        failed_at: new Date().toISOString(),
      });
      if (job.requested_by_chat_id) {
        await sendTelegramChunks(
          job.requested_by_chat_id,
          ["🏁 Результаты по дистанциям", "", "Не удалось выполнить отчёт. Попробуй позже."].join("\n")
        );
      }
    } catch (markFailedError) {
      console.error("Failed to mark race-results probe job as failed.", markFailedError);
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
