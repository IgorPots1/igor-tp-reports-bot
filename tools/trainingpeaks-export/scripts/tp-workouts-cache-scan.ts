import process from "node:process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  TrainingPeaksStudent,
  TrainingPeaksWorkoutCacheScanStatusUpsertRow,
  TrainingPeaksWorkoutCacheUpsertRow,
} from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
// Fetch-client path (наряд ЭТАП 2): session-snapshot → cookie → bearer over plain HTTP,
// NO Playwright, NO persistent-profile lock — so this scan no longer collides with the
// move/races loops that share that browser profile. Same client fit-ingest already uses.
import {
  chunkDateRangeInclusive,
  getTpApiJsonRaw,
  TpApiAuthError,
  TpApiHttpError,
} from "../../../src/features/trainingpeaks/tp-api-client.ts";
import {
  belgradeTodayIso,
  extractStrengthCalendarItems,
  isStrengthScanEnabled,
  STRENGTH_SCAN_FLAG,
  strengthCalendarPath,
} from "./lib/strength-cache-rows.ts";
import { toolRoot } from "./lib/paths.ts";
import type { ApiJsonResponse } from "./lib/trainingpeaks-api-move.ts";
import {
  scanOneStudent,
  type ResolvedTarget,
  type StudentSummary,
  type ReconcilePlannedRowsFn,
  type StrengthScanInput,
} from "./lib/workout-cache-scan-student.ts";
import {
  classifyScanFailure,
  evaluateScanRunHealth,
  shouldSkipAccessLostStudent,
  TP_ACCESS_LOST_RECHECK_HOURS,
} from "../../../src/features/trainingpeaks/yesterday-execution.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";

// Thrown when the TrainingPeaks session is dead and re-capturing the auth token
// did not recover it — the runner needs a manual re-login in the persistent
// Chromium profile. Escalated to a Telegram alert + run abort, never swallowed
// as a per-student "failed".
class AuthDeadError extends Error {
  constructor(message = "TrainingPeaks session dead (re-capture failed).") {
    super(message);
    this.name = "AuthDeadError";
  }
}

// Coach chat ids for operational alerts. Read inline (same env var as
// getTrainingPeaksCoachChatIds) to avoid pulling the attention-telegram module
// graph into the runner.
function getCoachAlertChatIds(): string[] {
  const value = process.env.TELEGRAM_COACH_CHAT_IDS?.trim();
  if (!value) return [];
  return value
    .split(",")
    .map((chatId) => chatId.trim())
    .filter(Boolean);
}

async function sendSessionDeadAlert(): Promise<void> {
  const chatIds = getCoachAlertChatIds();
  if (chatIds.length === 0) {
    console.error("[tp-workouts-cache-scan] TP session dead, but no TELEGRAM_COACH_CHAT_IDS configured for alert.");
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[tp-workouts-cache-scan] TP session dead, but TELEGRAM_BOT_TOKEN is not set for alert.");
    return;
  }
  const message =
    "⚠️ TP session dead: скан кэша тренировок прерван. Нужен перелогин в TrainingPeaks в persistent-профиле раннера (код re-login не делает).";
  // Direct Telegram Bot API call — keep the runner free of the app's telegram
  // module graph (cross-package .ts imports break under the runner's loader).
  for (const chatId of chatIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      });
      if (!res.ok) {
        console.error(`[tp-workouts-cache-scan] Session-dead alert to ${chatId} failed: HTTP ${res.status}`);
      }
    } catch (error) {
      console.error(`[tp-workouts-cache-scan] Failed to send session-dead alert to ${chatId}:`, error);
    }
  }
}


// «Нет доступа к TP»: одно уведомление на эпизод 403, не на каждый прогон (наряд 2026-10-02).
// Эпизоды ведутся всегда; ОТПРАВКА — только при TP_ACCESS_LOST_NOTIFY=1. Пока флаг выключен,
// неуведомлённые эпизоды копятся и уйдут ОДНИМ сообщением в первом прогоне после включения.
// Никогда не роняет скан.
async function syncAccessLostNotices(input: {
  summaries: Array<{ studentId: string | null; studentName: string; status: string; reason?: string }>;
  seenAt: string;
  repoCompat: RepositoryCompat;
}): Promise<void> {
  const sync =
    input.repoCompat.syncTrainingPeaksTpAccessLostNotices ??
    input.repoCompat.default?.syncTrainingPeaksTpAccessLostNotices;
  const markNotified =
    input.repoCompat.markTrainingPeaksTpAccessLostNotified ??
    input.repoCompat.default?.markTrainingPeaksTpAccessLostNotified;
  if (!sync || !markNotified) {
    console.error("[tp-workouts-cache-scan] access-lost helpers unavailable — episodes not tracked.");
    return;
  }
  try {
    const lost = input.summaries
      .filter((item) => item.studentId && item.status === "failed" && classifyScanFailure(item.reason) === "access_lost")
      .map((item) => ({ studentId: item.studentId as string, studentName: item.studentName }));
    const okStudentIds = input.summaries
      .filter((item) => item.studentId && item.status === "ok")
      .map((item) => item.studentId as string);
    const pending = await sync({ lost, okStudentIds, seenAt: input.seenAt });
    console.log(`access_lost_episodes: open=${lost.length}, not_notified=${pending.length}`);
    if (pending.length === 0 || process.env.TP_ACCESS_LOST_NOTIFY?.trim() !== "1") return;

    const names = pending
      .map((item) => item.studentName?.trim() || item.studentId)
      .sort((a, b) => a.localeCompare(b, "ru-RU"));
    const message =
      `🔒 Нет доступа к TP (403): ${names.join(", ")}.\n` +
      "Скан не видит их календарь, пропуски по ним не считаются. Проверь, не закрыл ли ученик доступ тренеру в TP.";
    const sent = await sendCoachAlert(message);
    if (sent) {
      await markNotified(
        pending.map((item) => item.studentId),
        new Date().toISOString(),
      );
    }
  } catch (error) {
    console.error(`[tp-workouts-cache-scan] access-lost episodes sync failed: ${toCompactErrorMessage(error)}`);
  }
}

/** Счётчики прошлого прогона из counts последнего heartbeat. null — нет или старый формат. */
async function readPreviousScanRun(
  repoCompat: RepositoryCompat,
): Promise<{ accessLost: number | null; verdict: string | null } | null> {
  const getLatest =
    repoCompat.getLatestTrainingPeaksCronRunLog ?? repoCompat.default?.getLatestTrainingPeaksCronRunLog;
  if (!getLatest) return null;
  try {
    const log = await getLatest({ jobName: "workout_cache_scan" });
    const counts = (log?.counts ?? null) as Record<string, unknown> | null;
    if (!counts) return null;
    return {
      accessLost: typeof counts.accessLost === "number" ? counts.accessLost : null,
      verdict: typeof counts.verdict === "string" ? counts.verdict : null,
    };
  } catch (error) {
    console.error(`[tp-workouts-cache-scan] previous run read failed: ${toCompactErrorMessage(error)}`);
    return null;
  }
}

/** true — ушло хотя бы в один чат тренера. */
async function sendCoachAlert(message: string): Promise<boolean> {
  const chatIds = getCoachAlertChatIds();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (chatIds.length === 0 || !token) {
    console.error("[tp-workouts-cache-scan] coach alert skipped: TELEGRAM_COACH_CHAT_IDS / TELEGRAM_BOT_TOKEN not set.");
    return false;
  }
  let delivered = false;
  for (const chatId of chatIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      });
      if (res.ok) delivered = true;
      else console.error(`[tp-workouts-cache-scan] coach alert to ${chatId} failed: HTTP ${res.status}`);
    } catch (error) {
      console.error(`[tp-workouts-cache-scan] coach alert to ${chatId} failed:`, error);
    }
  }
  return delivered;
}

type CliArgs = {
  from: string;
  to: string;
  allActive: boolean;
  athleteId: number | null;
  athleteUrl: string | null;
  student: string | null;
  headed: boolean;
};


type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  upsertTrainingPeaksWorkoutCacheRows?: (rows: TrainingPeaksWorkoutCacheUpsertRow[]) => Promise<void>;
  upsertTrainingPeaksWorkoutCacheScanStatuses?: (
    rows: TrainingPeaksWorkoutCacheScanStatusUpsertRow[],
  ) => Promise<void>;
  reconcileTrainingPeaksWorkoutCachePlannedRows?: ReconcilePlannedRowsFn;
  syncTrainingPeaksTpAccessLostNotices?: typeof trainingPeaksRepository.syncTrainingPeaksTpAccessLostNotices;
  markTrainingPeaksTpAccessLostNotified?: typeof trainingPeaksRepository.markTrainingPeaksTpAccessLostNotified;
  getLatestTrainingPeaksCronRunLog?: typeof trainingPeaksRepository.getLatestTrainingPeaksCronRunLog;
  listOpenTrainingPeaksTpAccessLostEpisodes?: typeof trainingPeaksRepository.listOpenTrainingPeaksTpAccessLostEpisodes;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    upsertTrainingPeaksWorkoutCacheRows?: (rows: TrainingPeaksWorkoutCacheUpsertRow[]) => Promise<void>;
    upsertTrainingPeaksWorkoutCacheScanStatuses?: (
      rows: TrainingPeaksWorkoutCacheScanStatusUpsertRow[],
    ) => Promise<void>;
    reconcileTrainingPeaksWorkoutCachePlannedRows?: ReconcilePlannedRowsFn;
    syncTrainingPeaksTpAccessLostNotices?: typeof trainingPeaksRepository.syncTrainingPeaksTpAccessLostNotices;
    markTrainingPeaksTpAccessLostNotified?: typeof trainingPeaksRepository.markTrainingPeaksTpAccessLostNotified;
    getLatestTrainingPeaksCronRunLog?: typeof trainingPeaksRepository.getLatestTrainingPeaksCronRunLog;
    listOpenTrainingPeaksTpAccessLostEpisodes?: typeof trainingPeaksRepository.listOpenTrainingPeaksTpAccessLostEpisodes;
  };
};

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

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}


function parseArgs(argv: string[]): CliArgs {
  let date: string | null = null;
  const parsed: CliArgs = {
    from: "",
    to: "",
    allActive: false,
    athleteId: null,
    athleteUrl: null,
    student: null,
    headed: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length).trim();
      continue;
    }
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      const athleteId = Number(arg.slice("--athlete-id=".length).trim());
      if (!Number.isInteger(athleteId) || athleteId <= 0) {
        throw new Error(`Invalid --athlete-id value: ${arg}`);
      }
      parsed.athleteId = athleteId;
      continue;
    }
    if (arg.startsWith("--athlete-url=")) {
      const athleteUrl = arg.slice("--athlete-url=".length).trim();
      if (!athleteUrl) {
        throw new Error("Empty --athlete-url value.");
      }
      parsed.athleteUrl = athleteUrl;
      continue;
    }
    if (arg.startsWith("--student=")) {
      const student = arg.slice("--student=".length).trim();
      parsed.student = student || null;
      continue;
    }
    if (arg === "--all-active") {
      parsed.allActive = true;
      continue;
    }
    if (arg === "--headed") {
      parsed.headed = true;
      continue;
    }
    if (arg === "--headless") {
      parsed.headed = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (date && (parsed.from || parsed.to)) {
    throw new Error("Use either --date=YYYY-MM-DD or --from=YYYY-MM-DD --to=YYYY-MM-DD, not both.");
  }
  if (date) {
    if (!isIsoDate(date)) {
      throw new Error(`Missing or invalid --date value: "${date}". Expected YYYY-MM-DD.`);
    }
    parsed.from = date;
    parsed.to = date;
  }

  if (!isIsoDate(parsed.from)) {
    throw new Error(`Missing or invalid --from date: "${parsed.from}". Expected YYYY-MM-DD.`);
  }
  if (!isIsoDate(parsed.to)) {
    throw new Error(`Missing or invalid --to date: "${parsed.to}". Expected YYYY-MM-DD.`);
  }
  if (parsed.from > parsed.to) {
    throw new Error(`Invalid date range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }

  if (parsed.allActive) {
    if (parsed.athleteId || parsed.athleteUrl || parsed.student) {
      throw new Error("Do not combine --all-active with --athlete-id, --athlete-url, or --student.");
    }
  } else if (!parsed.athleteId && !parsed.athleteUrl && !parsed.student) {
    throw new Error("Provide one identity input: --athlete-id, --athlete-url, --student, or use --all-active.");
  }

  return parsed;
}

function resolveTargetStudent(input: { args: CliArgs; students: TrainingPeaksStudent[] }): ResolvedTarget {
  const { args, students } = input;
  const studentNeedle = args.student?.trim().toLowerCase() ?? null;
  const athleteIdFromUrl = args.athleteUrl ? parseAthleteIdFromUrl(args.athleteUrl) : null;
  const resolvedAthleteId = args.athleteId ?? athleteIdFromUrl;
  const normalizedAthleteUrl = args.athleteUrl ? normalizeUrl(args.athleteUrl) : null;

  const matched = students.filter((student) => {
    if (!student.isActive) return false;
    if (studentNeedle) {
      const idMatch = student.id.toLowerCase() === studentNeedle;
      const studentIdMatch = student.studentId.toLowerCase() === studentNeedle;
      const nameMatch = student.studentName.toLowerCase() === studentNeedle;
      if (!idMatch && !studentIdMatch && !nameMatch) {
        return false;
      }
    }

    const studentAthleteId = parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
    if (resolvedAthleteId && studentAthleteId !== resolvedAthleteId) {
      if (!normalizedAthleteUrl) return false;
      if (normalizeUrl(student.trainingPeaksAthleteUrl) !== normalizedAthleteUrl) {
        return false;
      }
    }

    if (normalizedAthleteUrl && normalizeUrl(student.trainingPeaksAthleteUrl) !== normalizedAthleteUrl) {
      if (!resolvedAthleteId || studentAthleteId !== resolvedAthleteId) {
        return false;
      }
    }

    return true;
  });

  if (matched.length === 0) {
    const identityParts = [
      args.student ? `student=${args.student}` : null,
      args.athleteId ? `athleteId=${args.athleteId}` : null,
      args.athleteUrl ? `athleteUrl=${args.athleteUrl}` : null,
    ].filter(Boolean);
    throw new Error(
      `No active TrainingPeaks student matched (${identityParts.join(", ")}). Refusing to write orphan rows.`,
    );
  }
  if (matched.length > 1) {
    const sample = matched.slice(0, 5).map((student) => `${student.studentName} (${student.studentId})`);
    throw new Error(`Multiple active students matched. Please narrow input. Matches: ${sample.join(", ")}`);
  }

  const student = matched[0]!;
  const athleteId = resolvedAthleteId ?? parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
  if (!athleteId) {
    throw new Error(
      `Matched student "${student.studentName}" has no parseable athlete id in URL: ${student.trainingPeaksAthleteUrl}`,
    );
  }

  const athleteUrl = args.athleteUrl ?? `${APP_HOST}/#calendar/athletes/${athleteId}`;
  return { student, athleteId, athleteUrl };
}


function hasValidAthleteUrl(value: string): boolean {
  return Boolean(parseAthleteIdFromUrl(value));
}

function toCompactErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
  return raw.replace(/\s+/g, " ").trim().slice(0, 240);
}


async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn =
    repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const upsertCacheFn =
    repoCompat.upsertTrainingPeaksWorkoutCacheRows ?? repoCompat.default?.upsertTrainingPeaksWorkoutCacheRows;
  const upsertScanStatusesFn =
    repoCompat.upsertTrainingPeaksWorkoutCacheScanStatuses ??
    repoCompat.default?.upsertTrainingPeaksWorkoutCacheScanStatuses;
  const reconcileFn =
    repoCompat.reconcileTrainingPeaksWorkoutCachePlannedRows ??
    repoCompat.default?.reconcileTrainingPeaksWorkoutCachePlannedRows;

  if (!listStudentsFn || !upsertCacheFn || !upsertScanStatusesFn || !reconcileFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const students = await listStudentsFn();
  const targets: ResolvedTarget[] = [];
  const summaries: StudentSummary[] = [];

  if (args.allActive) {
    const eligible = students.filter((student) => student.isActive);
    for (const student of eligible) {
      const athleteId = parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
      if (!athleteId || !hasValidAthleteUrl(student.trainingPeaksAthleteUrl)) {
        summaries.push({
          studentId: student.id,
          athleteId: null,
          studentName: student.studentName,
          status: "skipped",
          rows: 0,
          normalizedRows: 0,
          planned: 0,
          completed: 0,
          plannedButNotCompleted: 0,
          warnings: 0,
          reason: "missing valid TrainingPeaks athlete URL/id",
          reconciledDeleted: 0,
        });
        continue;
      }
      targets.push({
        student,
        athleteId,
        athleteUrl: `${APP_HOST}/#calendar/athletes/${athleteId}`,
      });
    }
    if (targets.length === 0) {
      throw new Error("No eligible active students with valid TrainingPeaks athlete mapping.");
    }
  } else {
    targets.push(resolveTargetStudent({ args, students }));
  }

  // Открытый эпизод 403 — сканируем раз в TP_ACCESS_LOST_RECHECK_HOURS, иначе пропускаем
  // (см. shouldSkipAccessLostStudent). Только --all-active: точечный запуск по ученику — всегда
  // честный скан. Не прочитали эпизоды — сканируем всех, как раньше.
  const accessLostSkipped: ResolvedTarget[] = [];
  if (args.allActive) {
    const listOpenEpisodesFn =
      repoCompat.listOpenTrainingPeaksTpAccessLostEpisodes ??
      repoCompat.default?.listOpenTrainingPeaksTpAccessLostEpisodes;
    try {
      const episodes = listOpenEpisodesFn ? await listOpenEpisodesFn() : [];
      const lastSeenByStudentId = new Map(episodes.map((episode) => [episode.studentId, episode.lastSeenAt]));
      const now = new Date();
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        const target = targets[index]!;
        if (shouldSkipAccessLostStudent(lastSeenByStudentId.get(target.student.id), now)) {
          accessLostSkipped.push(target);
          targets.splice(index, 1);
        }
      }
    } catch (error) {
      console.error(
        `[tp-workouts-cache-scan] access-lost episodes unavailable, scanning everyone: ${toCompactErrorMessage(error)}`,
      );
    }
  }

  const scannedAt = new Date().toISOString();

  let writeSucceeded = false;
  try {
    // Fetch one workouts endpoint via the shared HTTP client (tp-api-client). The client
    // OWNS auth: session-snapshot cookie → bearer (cached), a one-time forced refresh on
    // 401/403, transient 408/429/5xx backoff — no Playwright, no persistent-profile lock.
    // This wrapper only maps the client's result/errors into the ApiJsonResponse the scan
    // already expects:
    //  - success → {status, ok, body};
    //  - TpApiAuthError (snapshot cookie itself dead) → AuthDeadError → run abort + alert;
    //  - TpApiHttpError (e.g. a permanently-403 athlete) → {status, ok:false} so ONLY that
    //    student is marked failed and the loop continues (never aborts the run).
    async function fetchViaApiClient(endpoint: string): Promise<ApiJsonResponse> {
      const apiPath = endpoint.startsWith(TP_API_HOST) ? endpoint.slice(TP_API_HOST.length) : endpoint;
      try {
        const { status, body } = await getTpApiJsonRaw("tpapi", apiPath);
        return { status, ok: status === 200, body } as ApiJsonResponse;
      } catch (error) {
        if (error instanceof TpApiAuthError) throw new AuthDeadError(error.message);
        if (error instanceof TpApiHttpError) return { status: error.status, ok: false, body: error.body } as ApiJsonResponse;
        throw error;
      }
    }

    // Тренерские силовые (наряд 19.10, п.4) — ЗА ФЛАГОМ TP_SCAN_STRENGTH=1, по умолчанию выкл.
    // Только GET (getTpApiJsonRaw другого метода не умеет) в сервис силовых, кусками по 90 дней.
    // Ошибка здесь не роняет ученика: scanOneStudent отметит её в итоге и пропустит сверку.
    const strengthInput: StrengthScanInput | undefined = isStrengthScanEnabled()
      ? {
        todayIso: belgradeTodayIso(),
        fetchItems: async (athleteId, from, to) => {
          const items: Record<string, unknown>[] = [];
          for (const chunk of chunkDateRangeInclusive(from, to)) {
            const { status, body } = await getTpApiJsonRaw("strength", strengthCalendarPath(athleteId, chunk.start, chunk.end));
            if (status !== 200) throw new Error(`TrainingPeaks strength calendar GET failed: status=${status}`);
            const list = extractStrengthCalendarItems(body);
            if (!list) throw new Error("TrainingPeaks strength calendar GET returned non-array JSON body.");
            items.push(...list);
          }
          return items;
        },
      }
      : undefined;
    if (strengthInput) console.log(`[tp-workouts-cache-scan] ${STRENGTH_SCAN_FLAG}=1: coach strength from the strength service is ON`);

    // Probe once before the loop: a dead session-snapshot cookie → alert + abort instead
    // of hammering all ~110. Only TpApiAuthError (the cookie itself is dead) counts as
    // session death; a per-athlete 403 on the first student is athlete-specific, so we
    // swallow non-auth probe errors and let the per-student loop handle them.
    if (targets.length > 0) {
      const warmupAthleteId = targets[0]!.athleteId;
      try {
        await getTpApiJsonRaw("tpapi", `/fitness/v6/athletes/${warmupAthleteId}/workouts/${args.from}/${args.from}`);
      } catch (error) {
        if (error instanceof TpApiAuthError) {
          await sendSessionDeadAlert();
          throw new Error(
            "TrainingPeaks session dead: aborting scan run (run tp-refresh-session-snapshot / tp-login).",
          );
        }
        // non-auth probe error (first athlete 403 / transient) — ignore; loop handles per-student.
      }
    }

    for (const target of targets) {
      try {
        const studentSummary = await scanOneStudent({
          upsertCacheFn,
          reconcileFn,
          fetchFn: fetchViaApiClient,
          target,
          from: args.from,
          to: args.to,
          scannedAt,
          strength: strengthInput,
        });
        summaries.push(studentSummary);
      } catch (error) {
        // Per-student failure (403 forbidden, unrecoverable 401, retries
        // exhausted) — mark this student failed and continue with the rest.
        // A genuinely dead session is caught up-front by the probe (alert +
        // abort); a mid-run token death simply fails the remaining students and
        // is surfaced by the next run's probe, so we never abort mid-loop over
        // one athlete.
        summaries.push({
          studentId: target.student.id,
          athleteId: target.athleteId,
          studentName: target.student.studentName,
          status: "failed",
          rows: 0,
          normalizedRows: 0,
          planned: 0,
          completed: 0,
          plannedButNotCompleted: 0,
          warnings: 1,
          reason: toCompactErrorMessage(error),
          reconciledDeleted: 0,
        });
      }
    }

    const statusRows: TrainingPeaksWorkoutCacheScanStatusUpsertRow[] = summaries
      .filter((item) => item.studentId)
      .map((item) => ({
        student_id: item.studentId,
        student_name: item.studentName,
        trainingpeaks_athlete_id: item.athleteId,
        scan_from: args.from,
        scan_to: args.to,
        status: item.status,
        raw_items_count: item.rawItemsReturned ?? 0,
        normalized_items_count: item.normalizedRows,
        upserted_rows_count: item.rows,
        planned_count: item.planned,
        completed_count: item.completed,
        planned_not_completed_count: item.plannedButNotCompleted,
        warnings_count: item.warnings,
        error_message: item.status === "ok" ? null : (item.reason ?? null),
        scanned_at: scannedAt,
      }));

    await upsertScanStatusesFn(statusRows);

    writeSucceeded = summaries.some((item) => item.status === "ok");
    const selectedStudents =
      targets.length + accessLostSkipped.length + summaries.filter((item) => item.status === "skipped").length;
    const successCount = summaries.filter((item) => item.status === "ok").length;
    const failedCount = summaries.filter((item) => item.status === "failed").length;
    const skippedCount = summaries.filter((item) => item.status === "skipped").length;
    const totalRawItems = summaries.reduce((acc, item) => acc + (item.rawItemsReturned ?? 0), 0);
    const totalRows = summaries.reduce((acc, item) => acc + item.rows, 0);
    const totalPlanned = summaries.reduce((acc, item) => acc + item.planned, 0);
    const totalCompleted = summaries.reduce((acc, item) => acc + item.completed, 0);
    const totalPlannedNotCompleted = summaries.reduce((acc, item) => acc + item.plannedButNotCompleted, 0);
    const totalReconciledDeleted = summaries.reduce((acc, item) => acc + item.reconciledDeleted, 0);

    console.log("[tp-workouts-cache-scan] Summary");
    console.log(`mode: ${args.allActive ? "all-active" : "single-student"}`);
    console.log(`date_range: ${args.from} -> ${args.to}`);
    console.log(`selected_students: ${selectedStudents}`);
    console.log(`scanned_successfully: ${successCount}`);
    console.log(`failed: ${failedCount}`);
    console.log(`skipped: ${skippedCount}`);
    console.log(
      `access_lost_skipped: ${accessLostSkipped.length} (open 403 episode, rechecked every ${TP_ACCESS_LOST_RECHECK_HOURS}h)`,
    );
    console.log(`total_raw_items: ${totalRawItems}`);
    console.log(`total_upserted_rows: ${totalRows}`);
    console.log(`total_planned: ${totalPlanned}`);
    console.log(`total_completed: ${totalCompleted}`);
    console.log(`total_planned_but_not_completed: ${totalPlannedNotCompleted}`);
    console.log(`total_reconciled_deleted: ${totalReconciledDeleted}`);
    console.log(`table_write_succeeded: ${writeSucceeded ? "yes" : "no"}`);
    console.log("");
    console.log("per_student:");
    for (const item of summaries.sort((a, b) => a.studentName.localeCompare(b.studentName))) {
      const shortReason = item.reason ? ` (${item.reason})` : "";
      const incomplete = item.incompleteDays?.length ? `, incomplete_days=${item.incompleteDays.join(",")}` : "";
      const strength = item.strength
        ? item.strength.ok
          ? `, strength_rows=${item.strength.counts.rows}, strength_watch_files=${item.strength.counts.watchFiles}, strength_hidden=${item.strength.counts.hidden}, strength_past=${item.strength.counts.past}`
          : `, strength_failed (${item.strength.error}), reconcile_skipped`
        : "";
      console.log(
        `- ${item.studentName}: rows=${item.rows}, planned=${item.planned}, completed=${item.completed}, planned_not_completed=${item.plannedButNotCompleted}, reconciled_deleted=${item.reconciledDeleted}, warnings=${item.warnings}, status=${item.status}${incomplete}${strength}${shortReason}`,
      );
    }
    // Отдельно от warnings: тот у каждой строки уже содержит «completed is non-boolean» и
    // поэтому ничего не сообщает. Здесь — только дни с дырой в нумерации TP.
    const incompleteDays = summaries.flatMap((item) =>
      (item.incompleteDays ?? []).map((date) => `${item.studentName} ${date}`),
    );
    console.log(`incomplete_days_total: ${incompleteDays.length}`);
    if (strengthInput) {
      const strengthOk = summaries.filter((item) => item.strength?.ok);
      const sum = (key: "rows" | "watchFiles" | "hidden" | "past" | "badId" | "idCollision") =>
        strengthOk.reduce((acc, item) => acc + (item.strength?.ok ? item.strength.counts[key] : 0), 0);
      console.log(
        `strength: students_ok=${strengthOk.length}, students_failed=${summaries.filter((item) => item.strength && !item.strength.ok).length}, ` +
          `rows=${sum("rows")}, watch_files_skipped=${sum("watchFiles")}, hidden_skipped=${sum("hidden")}, past_skipped=${sum("past")}, ` +
          `bad_id=${sum("badId")}, id_collision=${sum("idCollision")}`,
      );
    }

    // Итог прогона для обёртки (heartbeat sent / partial). 403 и сетевой сбой — раздельно.
    const failedKinds = summaries
      .filter((item) => item.status === "failed")
      .map((item) => classifyScanFailure(item.reason));
    const outcome = {
      ok: successCount,
      // Пропущенные с открытым эпизодом 403 — тоже 403 (не сканировали, потому что знаем исход).
      // Без них счётчик скакал бы 0 → 15 на суточной перепроверке и правило скачка тревожило бы.
      accessLost: failedKinds.filter((kind) => kind === "access_lost").length + accessLostSkipped.length,
      fetchFailed: failedKinds.filter((kind) => kind === "fetch_failed").length,
      otherFailed: failedKinds.filter((kind) => kind === "other").length,
      skipped: skippedCount,
      incompleteDays: incompleteDays.length,
      // Сигнал «посмотри», не тревога: вердикт прогона от него не зависит (~7 таких дней в неделю
      // по всему ростеру на 3338 днях с нумерацией, авг–окт 2026; часть — переносы без перенумерации).
      incompleteDayList: incompleteDays.slice(0, 40),
    };
    console.log(
      `failed_by_kind: access_lost(403)=${outcome.accessLost}, fetch_failed=${outcome.fetchFailed}, other=${outcome.otherFailed}`,
    );
    // Вердикт прогона: partial не безусловно живой. Тревога — при обвале доли ok или скачке 403
    // к прошлому прогону (его счётчики лежат в counts последнего heartbeat этого потока).
    const previousRun = args.allActive ? await readPreviousScanRun(repoCompat) : null;
    const health = evaluateScanRunHealth({
      current: outcome,
      previousAccessLost: previousRun?.accessLost ?? null,
    });
    console.log(`run_health: ${health.verdict}${health.reasons.length ? ` (${health.reasons.join("; ")})` : ""}`);
    if (health.verdict === "alarm" && previousRun?.verdict !== "alarm") {
      // Только при ПЕРЕХОДЕ в тревогу, не каждые 30 минут. Операционный алерт тренеру, как
      // session-dead выше, — флагу TP_ACCESS_LOST_NOTIFY не подчиняется.
      await sendCoachAlert(
        `⚠️ Скан кэша TP: тревога — ${health.reasons.join("; ")}. ` +
          "Похоже на протухшую сессию или массовую потерю доступа: npm run tp-login (в tools/trainingpeaks-export) и проверь доступ в TP.",
      );
    }
    const outcomeFile = process.env.SCAN_OUTCOME_FILE?.trim();
    if (outcomeFile) {
      try {
        writeFileSync(outcomeFile, JSON.stringify({ ...outcome, verdict: health.verdict, reasons: health.reasons }));
      } catch (error) {
        console.error(`[tp-workouts-cache-scan] Failed to write SCAN_OUTCOME_FILE: ${toCompactErrorMessage(error)}`);
      }
    }

    if (args.allActive) {
      await syncAccessLostNotices({ summaries, seenAt: scannedAt, repoCompat });
    }

    if (!args.allActive && failedCount > 0) {
      throw new Error("Single-student scan failed.");
    }
  } finally {
    // fetch-client path holds no browser / persistent profile to release.
  }
}

main().catch((error: unknown) => {
  console.error("tp-workouts-cache-scan failed.");
  console.error(error);
  process.exit(1);
});
