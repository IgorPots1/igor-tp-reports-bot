import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { reportsRoot, toolRoot } from "./lib/paths.ts";

type TrainingPeaksJobStatus = "queued" | "running" | "completed" | "failed";
// Both scan directions run through this same runner + persist. The forward weekly
// job enqueues "race_scan_events"; the backward backfill (enqueue-race-scan-backfill)
// enqueues "race_scan_backfill". Only the window differs — runRaceScanJob just passes
// week_from..week_to to tp-scan-events, so no branching is needed below.
type TrainingPeaksJobType = "race_scan_events" | "race_scan_backfill";
const RACE_SCAN_JOB_TYPES: TrainingPeaksJobType[] = ["race_scan_events", "race_scan_backfill"];

type TrainingPeaksJobRow = {
  id: string;
  job_type: TrainingPeaksJobType;
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

export type RaceRow = {
  student_id?: string | null;
  student_name?: string | null;
  athlete_id?: number | null;
  event_date?: string | null;
  event_title?: string | null;
  distance?: string | null;
  goal?: string | null;
};

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_MESSAGE_LIMIT = 4000;
const STALE_RUNNING_JOB_TIMEOUT_MINUTES = 12 * 60;
const STALE_RUNNING_JOB_ERROR_MESSAGE = "Race scan job marked failed after stale running timeout";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

async function recoverStaleRunningRaceJobs(timeoutMinutes: number): Promise<number> {
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
    .in("job_type", RACE_SCAN_JOB_TYPES)
    .eq("status", "running")
    .not("started_at", "is", null)
    .lt("started_at", cutoff)
    .select("id");
  if (error) {
    throw new Error(`Failed to recover stale race-scan jobs: ${error.message}`);
  }
  return (data ?? []).length;
}

async function claimNextQueuedRaceJob(): Promise<TrainingPeaksJobRow | null> {
  const supabase = getSupabase();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: nextJob, error: selectError } = await supabase
      .from("trainingpeaks_jobs")
      .select("*")
      .in("job_type", RACE_SCAN_JOB_TYPES)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (selectError) {
      throw new Error(`Failed to select next race-scan job: ${selectError.message}`);
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
      throw new Error(`Failed to claim race-scan job ${nextJob.id}: ${claimError.message}`);
    }
    if (claimedJob) {
      return claimedJob as TrainingPeaksJobRow;
    }
  }
  return null;
}

async function completeRaceJob(jobId: string, result: unknown): Promise<void> {
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
    throw new Error(`Failed to complete race-scan job ${jobId}: ${error.message}`);
  }
}

async function failRaceJob(jobId: string, errorMessage: string, result?: unknown): Promise<void> {
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
    throw new Error(`Failed to fail race-scan job ${jobId}: ${error.message}`);
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
    let boundary = rest.lastIndexOf("\n\n", TELEGRAM_MESSAGE_LIMIT);
    if (boundary < Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5)) {
      boundary = rest.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    }
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

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${value}T00:00:00Z`))
    .replace(/\.$/, "");
}

function readStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readRaceRows(resultJson: unknown): RaceRow[] {
  if (!resultJson || typeof resultJson !== "object") {
    return [];
  }
  const rows = (resultJson as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.filter((row) => row && typeof row === "object") as RaceRow[];
}

export type StudentRecord = {
  id: string;
  student_id?: string | null;
  student_name?: string | null;
  trainingpeaks_athlete_url?: string | null;
};

/** Parse the numeric athlete id embedded in a TrainingPeaks athlete URL. */
export function parseAthleteIdFromUrl(athleteUrl: string | null | undefined): number | null {
  if (!athleteUrl) return null;
  const match = athleteUrl.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeStudentName(name: string | null | undefined): string {
  return (name ?? "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

export type RaceStudentMatch = {
  student: StudentRecord;
  matchedBy: "athlete_id" | "student_name" | "slug";
};

/**
 * Resolve a scanned race row to a nutrition student. Task 10d (race persist):
 * races.json carries `athlete_id` + `student_name` but NO `student_id` slug, so
 * the old slug-only match dropped every row silently. Primary key is athlete_id
 * (parsed from trainingpeaks_athlete_url); fall back to an unambiguous name, then
 * the legacy slug. Ambiguous names (two students share one name) never match by
 * name — only athlete_id can disambiguate them.
 */
export function buildRaceStudentResolver(students: StudentRecord[]): {
  resolve: (row: RaceRow) => RaceStudentMatch | null;
} {
  const byAthleteId = new Map<number, StudentRecord>();
  const bySlug = new Map<string, StudentRecord>();
  const byName = new Map<string, StudentRecord>();
  const ambiguousNames = new Set<string>();
  for (const student of students) {
    const athleteId = parseAthleteIdFromUrl(student.trainingpeaks_athlete_url);
    if (athleteId != null && !byAthleteId.has(athleteId)) byAthleteId.set(athleteId, student);
    const slug = readStringValue(student.student_id);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, student);
    const nameKey = normalizeStudentName(student.student_name);
    if (nameKey) {
      if (byName.has(nameKey)) ambiguousNames.add(nameKey);
      else byName.set(nameKey, student);
    }
  }
  return {
    resolve(row) {
      const athleteId = typeof row.athlete_id === "number" ? row.athlete_id : null;
      if (athleteId != null) {
        const hit = byAthleteId.get(athleteId);
        if (hit) return { student: hit, matchedBy: "athlete_id" };
      }
      const nameKey = normalizeStudentName(row.student_name);
      if (nameKey && !ambiguousNames.has(nameKey)) {
        const hit = byName.get(nameKey);
        if (hit) return { student: hit, matchedBy: "student_name" };
      }
      const slug = readStringValue(row.student_id);
      if (slug) {
        const hit = bySlug.get(slug);
        if (hit) return { student: hit, matchedBy: "slug" };
      }
      return null;
    },
  };
}

function parseEventDateMs(value: string | null): number | null {
  if (!value || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function raceSortDateMs(row: RaceRow): number {
  const eventDate = readStringValue(row.event_date);
  return parseEventDateMs(eventDate) ?? Number.POSITIVE_INFINITY;
}

function compareRaceRowsByDateThenTitle(a: RaceRow, b: RaceRow): number {
  const dateDiff = raceSortDateMs(a) - raceSortDateMs(b);
  if (dateDiff !== 0) {
    return dateDiff;
  }
  const titleA = (readStringValue(a.event_title) ?? "").toLocaleLowerCase("ru-RU");
  const titleB = (readStringValue(b.event_title) ?? "").toLocaleLowerCase("ru-RU");
  if (titleA < titleB) return -1;
  if (titleA > titleB) return 1;
  return 0;
}

function formatDistanceValue(rawDistance: string): string {
  const normalized = rawDistance.replace(",", ".").trim();
  const parsed = Number(normalized);
  if (Number.isFinite(parsed) && parsed > 0) {
    if (Number.isInteger(parsed)) {
      return `${String(parsed)} км`;
    }
    return `${String(parsed)} км`;
  }
  return rawDistance.trim();
}

function titleHasDistanceLikePattern(title: string): boolean {
  const normalized = title.toLowerCase();
  return (
    /\(\s*\d+(?:[.,]\d+)?\s*(?:k|km|км)\s*\)/i.test(title) ||
    /\b\d+(?:[.,]\d+)?\s*(?:k|km|км)\b/i.test(normalized)
  );
}

function formatRaceTitleWithDistance(row: RaceRow): string {
  const title = readStringValue(row.event_title) ?? "Без названия";
  const distance = readStringValue(row.distance);
  if (!distance) {
    return title;
  }
  if (titleHasDistanceLikePattern(title)) {
    return title;
  }
  return `${title} (${formatDistanceValue(distance)})`;
}

function buildRaceSummaryText(fromDate: string, toDate: string, rows: RaceRow[]): string {
  const header = ["🏁 Забеги", `Период: ${formatShortDate(fromDate)} — ${formatShortDate(toDate)}`, ""];
  if (rows.length === 0) {
    return [...header, "Забегов не найдено."].join("\n");
  }
  const groups = new Map<string, RaceRow[]>();
  for (const row of rows) {
    const studentName = readStringValue(row.student_name) ?? "Неизвестный ученик";
    const groupRows = groups.get(studentName);
    if (groupRows) {
      groupRows.push(row);
    } else {
      groups.set(studentName, [row]);
    }
  }

  const sortedGroups = Array.from(groups.entries()).sort(([nameA, racesA], [nameB, racesB]) => {
    const earliestA = Math.min(...racesA.map((race) => raceSortDateMs(race)));
    const earliestB = Math.min(...racesB.map((race) => raceSortDateMs(race)));
    if (earliestA !== earliestB) {
      return earliestA - earliestB;
    }
    return nameA.localeCompare(nameB, "ru");
  });

  const lines: string[] = [...header, `Найдено: ${rows.length}`, ""];
  for (const [studentName, groupRows] of sortedGroups) {
    lines.push(studentName);
    const sortedRows = [...groupRows].sort(compareRaceRowsByDateThenTitle);
    for (const row of sortedRows) {
      const rawDate = readStringValue(row.event_date);
      const dateLabel = rawDate ? formatShortDate(rawDate) : "дата не указана";
      lines.push(`• ${dateLabel} — ${formatRaceTitleWithDistance(row)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function getLatestRaceScanOutputDir(): Promise<string | null> {
  const scanRoot = path.join(reportsRoot, "races-scan");
  await mkdir(scanRoot, { recursive: true });
  const entries = await readdir(scanRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (dirs.length === 0) {
    return null;
  }
  return path.join(scanRoot, dirs[0]!);
}

async function runRaceScanJob(job: TrainingPeaksJobRow): Promise<{
  rowsCount: number;
  outputDir: string | null;
  summaryText: string;
  racesJsonPath: string | null;
}> {
  if (!ISO_DATE_PATTERN.test(job.week_from) || !ISO_DATE_PATTERN.test(job.week_to)) {
    throw new Error(`Invalid date range in job ${job.id}: ${job.week_from}..${job.week_to}`);
  }
  await runNpmScript("tp-scan-events", [
    `--from=${job.week_from}`,
    `--to=${job.week_to}`,
    "--limit=10000",
  ]);
  const outputDir = await getLatestRaceScanOutputDir();
  if (!outputDir) {
    throw new Error("Race scan finished, but output directory was not found.");
  }
  const racesJsonPath = path.join(outputDir, "races.json");
  if (!existsSync(racesJsonPath)) {
    throw new Error(`Race scan output missing races.json: ${racesJsonPath}`);
  }
  const racesJsonRaw = readTextFileSyncSafe(racesJsonPath);
  if (!racesJsonRaw) {
    throw new Error("Race scan produced empty races.json.");
  }
  let racesJson: unknown = null;
  try {
    racesJson = JSON.parse(racesJsonRaw);
  } catch (error) {
    throw new Error(`Failed to parse races.json: ${toShortErrorMessage(error)}`);
  }
  const rows = readRaceRows(racesJson);
  // Наряд 3 (A): bridge scanned races into the DB so nutrition (serverless) can
  // read them. Best-effort — never fail the scan/Telegram flow if the table is
  // missing (migration not applied yet) or a student can't be resolved.
  try {
    await persistScannedRaceEvents(rows);
  } catch (error) {
    console.warn(`Race events persist skipped: ${toShortErrorMessage(error)}`);
  }
  return {
    rowsCount: rows.length,
    outputDir,
    racesJsonPath,
    summaryText: buildRaceSummaryText(job.week_from, job.week_to, rows),
  };
}

/** Parse a leading numeric distance ("21.1 км" / "21,1" / "10K") to km. */
function parseDistanceKm(distance: string | null | undefined): number | null {
  if (!distance) return null;
  const match = distance.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Upsert scanned races into trainingpeaks_race_events (source 'scan'). Resolves
 * each nutrition student by athlete_id (primary) → name → legacy slug; see
 * buildRaceStudentResolver. Manual marks (source 'manual') are never touched here.
 */
export async function persistScannedRaceEvents(rows: RaceRow[]): Promise<void> {
  const supabase = getSupabase();
  // Load the roster once and resolve in-memory (races.json has no student_id slug).
  const { data: students, error: studentsError } = await supabase
    .from("trainingpeaks_students")
    .select("id,student_id,student_name,trainingpeaks_athlete_url");
  if (studentsError) {
    throw new Error(`Failed to load students for race persist: ${studentsError.message}`);
  }
  const resolver = buildRaceStudentResolver((students ?? []) as StudentRecord[]);
  let written = 0;
  let unresolved = 0;
  for (const row of rows) {
    const eventDate = readStringValue(row.event_date);
    if (!eventDate || !ISO_DATE_PATTERN.test(eventDate)) {
      continue;
    }
    const match = resolver.resolve(row);
    if (!match) {
      // Task 10d: this was the invisible root — the bridge dropped every race
      // because it matched only on a slug races.json never carries. Keep the skip
      // loud so an unattributed race is diagnosable, not silently vanished.
      unresolved += 1;
      console.warn(
        `[tp-races] skip race ${eventDate} «${readStringValue(row.event_title) ?? "?"}»: ` +
          `could not resolve student (athlete_id=${row.athlete_id ?? "?"}, ` +
          `name="${readStringValue(row.student_name) ?? "?"}") in trainingpeaks_students`
      );
      continue;
    }
    const { error: upsertError } = await supabase.from("trainingpeaks_race_events").upsert(
      {
        student_id: match.student.id,
        trainingpeaks_athlete_id: typeof row.athlete_id === "number" ? row.athlete_id : null,
        event_date: eventDate,
        title: readStringValue(row.event_title),
        distance_km: parseDistanceKm(row.distance),
        distance_raw: readStringValue(row.distance),
        source: "scan",
      },
      { onConflict: "student_id,event_date,source" }
    );
    if (upsertError) {
      // Stop entirely if the table is missing; otherwise surface and skip the row.
      if (/does not exist|could not find the table|schema cache|42P01/i.test(upsertError.message)) {
        throw new Error(`trainingpeaks_race_events not available: ${upsertError.message}`);
      }
      console.warn(
        `[tp-races] upsert failed for ${eventDate} «${readStringValue(row.event_title) ?? "?"}»: ${upsertError.message}`
      );
      continue;
    }
    written += 1;
  }
  console.log(
    `[tp-races] persisted ${written} race event(s); ${unresolved} unresolved of ${rows.length} scanned.`
  );
}

async function main(): Promise<void> {
  loadLocalEnv();
  const recoveredJobs = await recoverStaleRunningRaceJobs(STALE_RUNNING_JOB_TIMEOUT_MINUTES);
  if (recoveredJobs > 0) {
    console.log(`Recovered ${recoveredJobs} stale race-scan job(s).`);
  }
  const job = await claimNextQueuedRaceJob();
  if (!job) {
    console.log("No queued TrainingPeaks race-scan jobs.");
    return;
  }
  console.log(`Claimed race-scan job ${job.id} for ${job.week_from}..${job.week_to}.`);
  try {
    const run = await runRaceScanJob(job);
    let telegramParts = 0;
    if (job.requested_by_chat_id) {
      telegramParts = await sendTelegramChunks(job.requested_by_chat_id, run.summaryText);
    }
    await completeRaceJob(job.id, {
      from_date: job.week_from,
      to_date: job.week_to,
      rows_found: run.rowsCount,
      output_dir: run.outputDir,
      races_json_path: run.racesJsonPath,
      telegram_messages_sent: telegramParts,
      completed_at: new Date().toISOString(),
      request_mode: "GET",
      note: "Race scan executed on local Mac via tp-scan-events (GET-only).",
    });
    console.log(
      `Completed race-scan job ${job.id}. rows=${run.rowsCount} telegram_parts=${telegramParts} output=${run.outputDir ?? "n/a"}`
    );
  } catch (error) {
    const shortErrorMessage = toShortErrorMessage(error);
    try {
      await failRaceJob(job.id, shortErrorMessage, {
        from_date: job.week_from,
        to_date: job.week_to,
        failed_at: new Date().toISOString(),
        request_mode: "GET",
      });
      if (job.requested_by_chat_id) {
        await sendTelegramChunks(
          job.requested_by_chat_id,
          [
            "🏁 Забеги",
            `Период: ${formatShortDate(job.week_from)} — ${formatShortDate(job.week_to)}`,
            "",
            "Не удалось выполнить сканирование. Попробуй позже.",
          ].join("\n")
        );
      }
    } catch (markFailedError) {
      console.error("Failed to mark race-scan job as failed.", markFailedError);
    }
    throw error;
  }
}

// Run only when invoked directly (the launchagent loop spawns `npm run
// tp-races-requests-once`). Guarded so diagnostics can import the resolver
// helpers without triggering a job claim.
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}
