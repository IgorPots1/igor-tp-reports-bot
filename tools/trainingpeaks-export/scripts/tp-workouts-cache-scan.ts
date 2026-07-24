import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
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
import { getTpApiJsonRaw, TpApiAuthError, TpApiHttpError } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { toolRoot } from "./lib/paths.ts";
import type { ApiJsonResponse } from "./lib/trainingpeaks-api-move.ts";
import {
  normalizeTrainingPeaksWorkoutItems,
  type TrainingPeaksWorkoutRaw,
} from "./lib/trainingpeaks-workout-normalization.ts";

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


type CliArgs = {
  from: string;
  to: string;
  allActive: boolean;
  athleteId: number | null;
  athleteUrl: string | null;
  student: string | null;
  headed: boolean;
};

type ResolvedTarget = {
  student: TrainingPeaksStudent;
  athleteId: number;
  athleteUrl: string;
};

type StudentSummary = {
  studentId: string;
  athleteId: number | null;
  studentName: string;
  status: "ok" | "failed" | "skipped";
  rows: number;
  normalizedRows: number;
  planned: number;
  completed: number;
  plannedButNotCompleted: number;
  warnings: number;
  reason?: string;
  rawItemsReturned?: number;
  reconciledDeleted: number;
};

type ReconcilePlannedRowsFn = (input: {
  studentId: string;
  from: string;
  to: string;
  runStartedAt: string;
}) => Promise<number>;

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  upsertTrainingPeaksWorkoutCacheRows?: (rows: TrainingPeaksWorkoutCacheUpsertRow[]) => Promise<void>;
  upsertTrainingPeaksWorkoutCacheScanStatuses?: (
    rows: TrainingPeaksWorkoutCacheScanStatusUpsertRow[],
  ) => Promise<void>;
  reconcileTrainingPeaksWorkoutCachePlannedRows?: ReconcilePlannedRowsFn;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    upsertTrainingPeaksWorkoutCacheRows?: (rows: TrainingPeaksWorkoutCacheUpsertRow[]) => Promise<void>;
    upsertTrainingPeaksWorkoutCacheScanStatuses?: (
      rows: TrainingPeaksWorkoutCacheScanStatusUpsertRow[],
    ) => Promise<void>;
    reconcileTrainingPeaksWorkoutCachePlannedRows?: ReconcilePlannedRowsFn;
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

function readPositiveInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseOptionalIsoDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toCompactText(value: unknown, maxLength = 4000): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function collectStructureSummaryMetrics(input: unknown): {
  nodeCount: number;
  stepCount: number;
  repetitionCount: number;
  targetMetrics: string[];
} {
  const targetMetrics = new Set<string>();
  let nodeCount = 0;
  let stepCount = 0;
  let repetitionCount = 0;

  const visit = (value: unknown, depth = 0): void => {
    if (depth > 14 || nodeCount >= 400) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    nodeCount += 1;
    const typeValue = typeof value.type === "string" ? value.type.toLowerCase() : null;
    if (typeValue === "step") stepCount += 1;
    if (typeValue === "repetition") repetitionCount += 1;

    const maybeMetricKeys = ["metric", "targetType", "type", "field", "unit", "valueType", "name"];
    for (const key of maybeMetricKeys) {
      const rawMetric = value[key];
      if (typeof rawMetric === "string") {
        const normalized = rawMetric.trim().toLowerCase();
        if (normalized.length >= 2 && normalized.length <= 40) {
          targetMetrics.add(normalized);
        }
      }
    }

    for (const childValue of Object.values(value)) {
      if (Array.isArray(childValue) || isRecord(childValue)) {
        visit(childValue, depth + 1);
      }
    }
  };

  visit(input);
  return {
    nodeCount,
    stepCount,
    repetitionCount,
    targetMetrics: [...targetMetrics].sort().slice(0, 20),
  };
}

// Structure is stored verbatim up to this size so per-step target paces/zones
// survive intact; only pathologically large payloads fall back to a summary.
const STRUCTURE_INLINE_MAX_LENGTH = 100_000;

function buildCompactStructure(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const serialized = JSON.stringify(parsed);
      if (serialized.length <= STRUCTURE_INLINE_MAX_LENGTH) {
        return parsed;
      }
      const metrics = collectStructureSummaryMetrics(parsed);
      return {
        summaryOnly: true,
        serializedLength: serialized.length,
        ...metrics,
      };
    } catch {
      return {
        summaryOnly: true,
        parseableJson: false,
        rawLength: trimmed.length,
        preview: trimmed.slice(0, 320),
      };
    }
  }

  if (isRecord(value) || Array.isArray(value)) {
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length <= STRUCTURE_INLINE_MAX_LENGTH) {
        return value;
      }
      const metrics = collectStructureSummaryMetrics(value);
      return {
        summaryOnly: true,
        serializedLength: serialized.length,
        ...metrics,
      };
    } catch {
      const metrics = collectStructureSummaryMetrics(value);
      return {
        summaryOnly: true,
        serializationError: true,
        ...metrics,
      };
    }
  }

  return null;
}

function buildCompactSourceSnapshot(raw: TrainingPeaksWorkoutRaw): Record<string, unknown> {
  const structure = buildCompactStructure(raw.structure);
  return {
    rawTitle: raw.title ?? null,
    rawWorkoutDay: raw.workoutDay ?? null,
    rawCode: raw.code ?? null,
    rawWorkoutTypeValueId: raw.workoutTypeValueId ?? null,
    rawWorkoutSubTypeId: raw.workoutSubTypeId ?? null,
    rawTotalTimePlanned: raw.totalTimePlanned ?? null,
    rawTotalTime: raw.totalTime ?? null,
    rawDistancePlanned: raw.distancePlanned ?? null,
    rawDistance: raw.distance ?? null,
    rawComplianceDurationPercent: raw.complianceDurationPercent ?? null,
    rawComplianceDistancePercent: raw.complianceDistancePercent ?? null,
    rawCompleted: raw.completed ?? null,
    description: toCompactText(raw.description),
    coachComments: toCompactText(raw.coachComments),
    structure,
    tssActual: toFiniteNumber(raw.tssActual),
    tssPlanned: toFiniteNumber(raw.tssPlanned),
    ifActual: toFiniteNumber(raw.ifActual ?? raw.if),
    ifPlanned: toFiniteNumber(raw.ifPlanned),
    totalTimePlanned: toFiniteNumber(raw.totalTimePlanned),
    totalDistancePlanned: toFiniteNumber(raw.distancePlanned),
    workoutTypeValueId: readPositiveInt(raw.workoutTypeValueId),
    isHidden: typeof raw.isHidden === "boolean" ? raw.isHidden : null,
    heartRateAverage: toFiniteNumber(raw.heartRateAverage),
    heartRateMinimum: toFiniteNumber(raw.heartRateMinimum),
    heartRateMaximum: toFiniteNumber(raw.heartRateMaximum),
    velocityAverage: toFiniteNumber(raw.velocityAverage),
    cadenceAverage: toFiniteNumber(raw.cadenceAverage),
    cadenceMaximum: toFiniteNumber(raw.cadenceMaximum),
    powerAverage: toFiniteNumber(raw.powerAverage),
    powerMaximum: toFiniteNumber(raw.powerMaximum),
    normalizedSpeedActual: toFiniteNumber(raw.normalizedSpeedActual),
    normalizedPowerActual: toFiniteNumber(raw.normalizedPowerActual),
    torqueAverage: toFiniteNumber(raw.torqueAverage),
    torqueMaximum: toFiniteNumber(raw.torqueMaximum),
    elevationGain: toFiniteNumber(raw.elevationGain),
    elevationLoss: toFiniteNumber(raw.elevationLoss),
    calories: toFiniteNumber(raw.calories),
    rpe: toFiniteNumber(raw.rpe),
    feeling: toFiniteNumber(raw.feeling),
    complianceTssPercent: toFiniteNumber(raw.complianceTssPercent),
  };
}

function hasValidAthleteUrl(value: string): boolean {
  return Boolean(parseAthleteIdFromUrl(value));
}

function toCompactErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
  return raw.replace(/\s+/g, " ").trim().slice(0, 240);
}

async function scanOneStudent(input: {
  upsertCacheFn: (rows: TrainingPeaksWorkoutCacheUpsertRow[]) => Promise<void>;
  reconcileFn: ReconcilePlannedRowsFn;
  // Performs the GET with auth resilience (retry + token re-capture on 401/403).
  // Throws AuthDeadError if the session is dead; that escalates to a run abort.
  fetchFn: (endpoint: string) => Promise<ApiJsonResponse>;
  target: ResolvedTarget;
  from: string;
  to: string;
  scannedAt: string;
}): Promise<StudentSummary> {
  const { upsertCacheFn, reconcileFn, fetchFn, target, from, to, scannedAt } = input;
  const endpoint = `${TP_API_HOST}/fitness/v6/athletes/${target.athleteId}/workouts/${from}/${to}`;
  const result = await fetchFn(endpoint);

  if (result.status !== 200) {
    throw new Error(`TrainingPeaks workouts GET failed: status=${result.status}, ok=${result.ok}`);
  }
  if (!Array.isArray(result.body)) {
    throw new Error("TrainingPeaks workouts GET returned non-array JSON body.");
  }

  const rawItems = result.body.filter((item): item is TrainingPeaksWorkoutRaw => isRecord(item));
  const normalizedItems = normalizeTrainingPeaksWorkoutItems({
    athleteId: target.athleteId,
    rawItems,
  });
  const filteredItems = normalizedItems.filter((item) => item.workoutDate >= from && item.workoutDate <= to);

  const rawByWorkoutId = new Map<number, TrainingPeaksWorkoutRaw>();
  for (const rawItem of rawItems) {
    const workoutId = readPositiveInt(rawItem.workoutId);
    if (workoutId && !rawByWorkoutId.has(workoutId)) {
      rawByWorkoutId.set(workoutId, rawItem);
    }
  }

  const rows: TrainingPeaksWorkoutCacheUpsertRow[] = filteredItems.map((item) => {
    const rawItem = rawByWorkoutId.get(item.trainingPeaksWorkoutId);
    return {
      student_id: target.student.id,
      student_name: target.student.studentName,
      trainingpeaks_athlete_id: item.trainingPeaksAthleteId,
      trainingpeaks_workout_id: item.trainingPeaksWorkoutId,
      workout_date: item.workoutDate,
      title: item.title,
      sport_or_type_code: item.sportOrTypeCode,
      workout_type_value_id: item.workoutTypeValueId,
      workout_sub_type_id: item.workoutSubTypeId,
      is_planned: item.isPlanned,
      is_completed: item.isCompleted,
      planned_time_raw: item.plannedTimeRaw,
      completed_time_raw: item.completedTimeRaw,
      planned_distance_raw: item.plannedDistanceRaw,
      completed_distance_raw: item.completedDistanceRaw,
      compliance_duration_percent: item.complianceDurationPercent,
      compliance_distance_percent: item.complianceDistancePercent,
      start_time_planned: item.startTimePlanned,
      start_time: item.startTime,
      source_updated_at: parseOptionalIsoDateTime(item.lastModifiedDate),
      order_on_day: item.orderOnDay,
      scanned_at: scannedAt,
      normalization_warnings: item.normalizationWarnings,
      source_snapshot: rawItem ? buildCompactSourceSnapshot(rawItem) : {},
    };
  });

  await upsertCacheFn(rows);

  // Reconciliation: only reached after a successful scan (HTTP 200 + parsed
  // array) and a successful upsert above. Deletes stale phantom plans this run
  // did not refresh. runStartedAt === scannedAt (fixed once before the loop), so
  // the rows just upserted are never deleted.
  const reconciledDeleted = await reconcileFn({
    studentId: target.student.id,
    from,
    to,
    runStartedAt: scannedAt,
  });

  const planned = filteredItems.filter((item) => item.isPlanned).length;
  const completed = filteredItems.filter((item) => item.isCompleted).length;
  const plannedButNotCompleted = filteredItems.filter((item) => item.isPlanned && !item.isCompleted).length;
  const warnings = filteredItems.reduce((acc, item) => acc + item.normalizationWarnings.length, 0);

  return {
    studentId: target.student.id,
    athleteId: target.athleteId,
    studentName: target.student.studentName,
    status: "ok",
    rows: rows.length,
    normalizedRows: filteredItems.length,
    planned,
    completed,
    plannedButNotCompleted,
    warnings,
    rawItemsReturned: result.body.length,
    reconciledDeleted,
  };
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

    // Probe once before the loop: a dead session-snapshot cookie → alert + abort instead
    // of hammering all ~110. Only TpApiAuthError (the cookie itself is dead) counts as
    // session death; a per-athlete 403 on the first student is athlete-specific, so we
    // swallow non-auth probe errors and let the per-student loop handle them.
    {
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
    const selectedStudents = targets.length + summaries.filter((item) => item.status === "skipped").length;
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
      console.log(
        `- ${item.studentName}: rows=${item.rows}, planned=${item.planned}, completed=${item.completed}, planned_not_completed=${item.plannedButNotCompleted}, reconciled_deleted=${item.reconciledDeleted}, warnings=${item.warnings}, status=${item.status}${shortReason}`,
      );
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
