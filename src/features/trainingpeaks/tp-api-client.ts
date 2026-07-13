import { isSnapshotCookieFresh, readSessionSnapshot } from "./tp-session-snapshot.ts";

/**
 * Shared TrainingPeaks internal-API read client.
 *
 * Consolidates the read-side endpoints scattered across
 * src/features/trainingpeaks/trainingpeaks-completed-workout-*.ts and
 * tools/trainingpeaks-export/scripts/tp-*.ts into a single, tested surface with:
 *  - profile-derived auth (no TRAININGPEAKS_COOKIE env var -- see tp-session-snapshot.ts
 *    and plan §D; the raw cookie is dropped from the design entirely)
 *  - inclusive-boundary 90-day date-range chunking (plan §A: boundaries are
 *    inclusive on BOTH ends, verified 3x separately; do NOT add end+1 to the
 *    request itself -- only the *next chunk* starts at prev end + 1 day)
 *  - the tp-scan-events.ts retry/concurrency pattern (2 attempts, one retry,
 *    transient = 408/429/>=500, one-time auth refresh before retrying a 401/403,
 *    zero backoff delay, bounded concurrency worker pool)
 *  - loud schema validation on the handful of fields this client actually
 *    depends on structurally (workoutId/athleteId/workoutDay etc.) -- a silent
 *    TP contract change on those fields throws, it does not silently corrupt data
 *  - isWorkoutGone(): the PR1 finding that a deleted tpapi workout returns
 *    HTTP 400 "Invalid workoutId (<id>)", not 404/403 -- so PR3/PR4's write
 *    verification doesn't build on a false "still there" reading.
 *
 * PR3 adds write functions (createWorkout, moveWorkout, updateWorkout,
 * deleteWorkout, createStrengthWorkout) on the SAME auth/retry/redaction
 * plumbing as the read functions -- "write through the client, not around
 * it" (plan §C). These are plain capability functions: nothing in this file
 * decides WHETHER a write should happen. That gate lives entirely in the
 * caller (the executor script + the trainingpeaks_actions two-axis
 * lifecycle + TP_ACTIONS_REAL_EXECUTION) -- exactly like the existing
 * move-workout path's PUT call is just a capability, gated by everything
 * around it. No write function in this file is invoked against real
 * TrainingPeaks anywhere in PR3; they are unit-tested with mocked fetch only.
 */

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const TP_STRENGTH_HOST = "https://api.peakswaresb.com";
const MAX_RANGE_DAYS = 90;

const DEFAULT_CONCURRENCY = 3;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── errors ─────────────────────────────────────────────────────────────────

export class TpApiHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "TpApiHttpError";
    this.status = status;
    this.body = body;
  }
}

export class TpApiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TpApiAuthError";
  }
}

export class TpApiSchemaError extends Error {
  readonly endpoint: string;
  constructor(message: string, endpoint: string) {
    super(message);
    this.name = "TpApiSchemaError";
    this.endpoint = endpoint;
  }
}

// ─── date-range chunking (inclusive both ends, no overlap) ────────────────────

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDateUtc(dateIso: string): number {
  if (!ISO_DATE_PATTERN.test(dateIso)) {
    throw new Error(`Invalid date "${dateIso}". Expected YYYY-MM-DD.`);
  }
  const [year, month, day] = dateIso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatIsoDateUtc(epochMs: number): string {
  const date = new Date(epochMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type DateRangeChunk = { start: string; end: string };

/**
 * Splits [startIso, endIso] (both inclusive) into <=maxDays-wide chunks, also
 * inclusive on both ends, with NO overlap: chunk N+1 starts the day after chunk
 * N ends. This matches the TP API's own inclusive-both-ends semantics -- do not
 * request end+1 anywhere; only the chunk boundary itself advances by one day.
 */
export function chunkDateRangeInclusive(startIso: string, endIso: string, maxDays: number = MAX_RANGE_DAYS): DateRangeChunk[] {
  const startMs = parseIsoDateUtc(startIso);
  const endMs = parseIsoDateUtc(endIso);
  if (endMs < startMs) {
    throw new Error(`Invalid range: end "${endIso}" is before start "${startIso}".`);
  }
  if (maxDays < 1) {
    throw new Error(`maxDays must be >= 1, got ${maxDays}.`);
  }

  const chunks: DateRangeChunk[] = [];
  let chunkStartMs = startMs;
  while (chunkStartMs <= endMs) {
    const chunkEndMs = Math.min(chunkStartMs + (maxDays - 1) * DAY_MS, endMs);
    chunks.push({ start: formatIsoDateUtc(chunkStartMs), end: formatIsoDateUtc(chunkEndMs) });
    chunkStartMs = chunkEndMs + DAY_MS;
  }
  return chunks;
}

// ─── deletion semantics (PR1 finding) ──────────────────────────────────────────

/**
 * True if `status`/`body` indicate the workout is gone (deleted or never
 * existed). tpapi does NOT return 404/403 for a deleted workout -- it returns
 * HTTP 400 with body "Invalid workoutId (<id>)" (confirmed empirically in PR1).
 * The strength host (api.peakswaresb.com) DOES return a plain 404. Both are
 * covered here so PR3/PR4's post-delete verification doesn't false-negative.
 */
export function isWorkoutGone(status: number, body: unknown): boolean {
  if (status === 404 || status === 403) return true;
  if (status === 400) {
    const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
    return /Invalid workoutId/i.test(text);
  }
  return false;
}

// ─── auth: profile snapshot -> cookie -> bearer, cached in memory ─────────────

type CachedBearer = { token: string; expiresAtMs: number };

let cachedBearer: CachedBearer | null = null;
let bearerRefreshInFlight: Promise<string> | null = null;
let sessionSnapshotPathOverride: string | undefined;

/** Test-only seam: point the client at a temp snapshot file instead of the real one under $HOME. */
export function __setSessionSnapshotPathForTests(path: string | undefined): void {
  sessionSnapshotPathOverride = path;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exchangeCookieForBearer(cookieValue: string): Promise<CachedBearer> {
  const response = await fetch(`${TP_API_HOST}/users/v3/token`, {
    method: "GET",
    headers: { accept: "application/json", Cookie: `Production_tpAuth=${cookieValue}` },
  });
  if (response.status === 401) {
    throw new TpApiAuthError("Cookie rejected exchanging for bearer (401) -- session snapshot is stale.");
  }
  if (!response.ok) {
    throw new TpApiHttpError(`Token exchange failed with HTTP ${response.status}.`, response.status, await safeReadBody(response));
  }
  const body = await response.json();
  if (!isPlainRecord(body) || body.success !== true) {
    throw new TpApiAuthError("Token exchange response missing success:true -- cookie may be expired.");
  }
  const token = isPlainRecord(body.token) ? body.token : null;
  const accessToken = token?.access_token;
  const expiresIn = token?.expires_in;
  if (typeof accessToken !== "string" || !accessToken || typeof expiresIn !== "number") {
    throw new TpApiSchemaError("Token exchange response missing token.access_token/expires_in.", "/users/v3/token");
  }
  return { token: accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };
}

/** Clears the in-memory bearer cache. Exposed for tests; not needed in normal use. */
export function resetTpApiClientAuthCacheForTests(): void {
  cachedBearer = null;
  bearerRefreshInFlight = null;
}

async function getBearer(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedBearer && cachedBearer.expiresAtMs - 60_000 > now) {
    return cachedBearer.token;
  }
  if (bearerRefreshInFlight) {
    return bearerRefreshInFlight;
  }
  bearerRefreshInFlight = (async () => {
    const snapshot = await readSessionSnapshot(sessionSnapshotPathOverride);
    if (!isSnapshotCookieFresh(snapshot)) {
      // Not fatal -- TP may still accept it -- but worth surfacing to callers
      // watching logs, since it means the profile hasn't been refreshed recently.
      console.warn(
        "[tp-api-client] session snapshot cookie is past its freshness margin; " +
          "consider running tp-refresh-session-snapshot.ts.",
      );
    }
    const bearer = await exchangeCookieForBearer(snapshot.cookieValue);
    cachedBearer = bearer;
    return bearer.token;
  })();
  try {
    return await bearerRefreshInFlight;
  } finally {
    bearerRefreshInFlight = null;
  }
}

// ─── retry + concurrency (lifted from tools/trainingpeaks-export/scripts/tp-scan-events.ts) ──

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function safeReadBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export type TpApiClientOptions = {
  /** Bounded worker-pool concurrency for list operations. Clamped to [1, 5]. Default 3. */
  concurrency?: number;
};

function resolveConcurrency(requested: number | undefined): number {
  const value = requested ?? DEFAULT_CONCURRENCY;
  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, value));
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * GET a tpapi/peakswaresb JSON endpoint with the tp-scan-events.ts retry shape:
 * exactly one retry (2 attempts total), zero backoff delay, transient statuses
 * (408/429/>=500) retry as-is, a 401/403 triggers exactly one forced bearer
 * refresh before the single retry. Non-transient, non-auth errors throw
 * immediately without a retry.
 *
 * Deliberate scoping difference from tp-scan-events.ts: that script used a
 * single process-lifetime "have we ever refreshed" flag, appropriate for a
 * one-shot CLI run. This client is meant to stay resident (e.g. in a running
 * server process), so the refresh-once guarantee is scoped PER REQUEST instead
 * -- each call gets its own one-time forced refresh, not a single refresh for
 * the whole process lifetime. Still "one-time refresh before retry" per call,
 * matching the PR2 instruction; just correctly scoped for a long-lived client.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

async function fetchJsonWithRetry(
  url: string,
  options: { method?: HttpMethod; jsonBody?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const method = options.method ?? "GET";
  let authRefreshedThisCall = false;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const bearer = await getBearer();
      const headers: Record<string, string> = {
        accept: "application/json, text/javascript, */*; q=0.01",
        authorization: `Bearer ${bearer}`,
      };
      if (options.jsonBody !== undefined) headers["content-type"] = "application/json";
      const response = await fetch(url, {
        method,
        headers,
        body: options.jsonBody !== undefined ? JSON.stringify(options.jsonBody) : undefined,
      });
      const body = await safeReadBody(response);

      if ((response.status === 401 || response.status === 403) && !authRefreshedThisCall && attempt === 0) {
        authRefreshedThisCall = true;
        await getBearer(true);
        continue;
      }
      if (isTransientStatus(response.status) && attempt === 0) {
        continue;
      }
      return { status: response.status, body };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isNetworkOrTimeout = /timed out|timeout|network|econn|socket|connect|fetch failed|dns|getaddrinfo|enotfound|eai_again/i.test(message);
      if (isNetworkOrTimeout && attempt === 0) {
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetchJsonWithRetry exhausted retries with no response.");
}

async function getJsonOrThrow(url: string): Promise<unknown> {
  const { status, body } = await fetchJsonWithRetry(url);
  if (status < 200 || status >= 300) {
    throw new TpApiHttpError(`GET ${url} failed with HTTP ${status}.`, status, body);
  }
  return body;
}

async function writeJsonOrThrow(url: string, method: "POST" | "PUT", jsonBody: unknown): Promise<unknown> {
  const { status, body } = await fetchJsonWithRetry(url, { method, jsonBody });
  if (status < 200 || status >= 300) {
    throw new TpApiHttpError(`${method} ${url} failed with HTTP ${status}.`, status, body);
  }
  return body;
}

// ─── response validation (loud on the fields this client depends on) ─────────

function assertNumber(value: unknown, field: string, endpoint: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  throw new TpApiSchemaError(`Expected numeric field "${field}", got ${JSON.stringify(value)}.`, endpoint);
}

function assertString(value: unknown, field: string, endpoint: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new TpApiSchemaError(`Expected non-empty string field "${field}", got ${JSON.stringify(value)}.`, endpoint);
}

function assertRecordArray(value: unknown, endpoint: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new TpApiSchemaError(`Expected a JSON array response, got ${typeof value}.`, endpoint);
  }
  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) {
      throw new TpApiSchemaError(`Array item ${index} is not an object.`, endpoint);
    }
    return entry;
  });
}

function assertRecord(value: unknown, endpoint: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new TpApiSchemaError(`Expected a JSON object response, got ${typeof value}.`, endpoint);
  }
  return value;
}

// ─── workouts (list + detail) ──────────────────────────────────────────────────

export type TpWorkoutSummary = {
  workoutId: number;
  athleteId: number;
  workoutDay: string;
  title: string | null;
  workoutTypeValueId: number | null;
  /** Full original object, for fields this client doesn't model explicitly. */
  raw: Record<string, unknown>;
};

function toWorkoutSummary(record: Record<string, unknown>, endpoint: string): TpWorkoutSummary {
  return {
    workoutId: assertNumber(record.workoutId, "workoutId", endpoint),
    athleteId: assertNumber(record.athleteId, "athleteId", endpoint),
    workoutDay: assertString(record.workoutDay, "workoutDay", endpoint),
    title: typeof record.title === "string" ? record.title : null,
    workoutTypeValueId: typeof record.workoutTypeValueId === "number" ? record.workoutTypeValueId : null,
    raw: record,
  };
}

/**
 * Lists workouts across [startIso, endIso] (both inclusive), chunking
 * internally at the 90-day API limit. Dedupes by workoutId across chunks as a
 * write invariant (chunks are designed not to overlap, but dedup defensively
 * regardless -- see plan §A open question on the 17-vs-18 cache discrepancy).
 */
export async function getWorkoutsByDateRange(
  athleteId: number,
  startIso: string,
  endIso: string,
  options: TpApiClientOptions = {},
): Promise<TpWorkoutSummary[]> {
  const chunks = chunkDateRangeInclusive(startIso, endIso);
  const concurrency = resolveConcurrency(options.concurrency);
  const perChunk = await runWithConcurrency(chunks, concurrency, async (chunk) => {
    const endpoint = `/fitness/v6/athletes/${athleteId}/workouts/${chunk.start}/${chunk.end}`;
    const body = await getJsonOrThrow(`${TP_API_HOST}${endpoint}`);
    return assertRecordArray(body, endpoint).map((record) => toWorkoutSummary(record, endpoint));
  });

  const byWorkoutId = new Map<number, TpWorkoutSummary>();
  for (const chunkResults of perChunk) {
    for (const workout of chunkResults) {
      byWorkoutId.set(workout.workoutId, workout);
    }
  }
  return Array.from(byWorkoutId.values()).sort((a, b) => a.workoutDay.localeCompare(b.workoutDay));
}

/** Full workout detail by id, including structure/laps-adjacent fields on the object itself. */
export async function getWorkoutDetail(athleteId: number, workoutId: number): Promise<Record<string, unknown>> {
  const endpoint = `/fitness/v6/athletes/${athleteId}/workouts/${workoutId}`;
  const body = await getJsonOrThrow(`${TP_API_HOST}${endpoint}`);
  const record = assertRecord(body, endpoint);
  assertNumber(record.workoutId, "workoutId", endpoint);
  return record;
}

// ─── device files (FIT) ─────────────────────────────────────────────────────────
//
// NOTE: the /details endpoint is DISTINCT from getWorkoutDetail's
// /workouts/{id} above -- only /details carries workoutDeviceFileInfos (the
// device-file names we match FIT files by) plus the mean-max curves.
//
// Both /details and the files export below were empirically verified to work
// under the bearer token (2026-07-13 probe). The FIT design doc previously
// claimed they required browser (Playwright) auth -- that claim is WRONG.

/** Raw /details record for a workout (carries workoutDeviceFileInfos[]). */
export async function getWorkoutDetailsRecord(athleteId: number, workoutId: number): Promise<Record<string, unknown>> {
  const endpoint = `/fitness/v6/athletes/${athleteId}/workouts/${workoutId}/details`;
  const body = await getJsonOrThrow(`${TP_API_HOST}${endpoint}`);
  return assertRecord(body, endpoint);
}

export type WorkoutFilesExport = { fileName: string; zip: Buffer };

/**
 * Bulk device-file export for a date range. This is the ONLY working download
 * path: the per-file `/fitness/v{1,6}/files/{fileId}` endpoint returns 404
 * (verified live) and must not be used. Response is JSON -- not binary --
 * carrying a base64 ZIP, so it rides the normal JSON transport.
 *
 * Callers match a workout to its FIT file by EXACT ZIP-entry name against
 * workoutDeviceFileInfos[].fileName. Never by date/duration: TP's own fileId
 * is int32-overflowed (observed -1296859130) and file timestamps are UTC-
 * shifted relative to the workout date, so only the name is trustworthy.
 */
export async function getWorkoutFilesExport(
  athleteId: number,
  startIso: string,
  endIso: string
): Promise<WorkoutFilesExport[]> {
  const chunks = chunkDateRangeInclusive(startIso, endIso);
  const exports: WorkoutFilesExport[] = [];

  for (const chunk of chunks) {
    const endpoint = `/fitness/v1/export/${athleteId}/files/${chunk.start}/${chunk.end}`;
    const body = await getJsonOrThrow(`${TP_API_HOST}${endpoint}`);
    if (!isPlainRecord(body)) {
      throw new TpApiSchemaError("Files export response was not a JSON object.", endpoint);
    }
    const fileName = body.fileName;
    const data = body.data;
    // An empty range legitimately yields no archive -- not an error.
    if (typeof fileName !== "string" || typeof data !== "string" || data.length === 0) {
      continue;
    }
    exports.push({ fileName, zip: Buffer.from(data, "base64") });
  }

  return exports;
}

// ─── health metrics ─────────────────────────────────────────────────────────────

export async function getHealthMetrics(athleteId: number, startIso: string, endIso: string): Promise<Record<string, unknown>[]> {
  const chunks = chunkDateRangeInclusive(startIso, endIso);
  const perChunk = await runWithConcurrency(chunks, resolveConcurrency(undefined), async (chunk) => {
    const endpoint = `/metrics/v3/athletes/${athleteId}/consolidatedtimedmetrics/${chunk.start}/${chunk.end}`;
    const body = await getJsonOrThrow(`${TP_API_HOST}${endpoint}`);
    return assertRecordArray(body, endpoint);
  });
  return perChunk.flat();
}

// ─── events ─────────────────────────────────────────────────────────────────────

export async function getEvents(athleteId: number, startIso: string, endIso: string): Promise<Record<string, unknown>[]> {
  const endpoint = `/fitness/v6/athletes/${athleteId}/events/${startIso}/${endIso}`;
  const body = await getJsonOrThrow(`${TP_API_HOST}${endpoint}`);
  return assertRecordArray(body, endpoint);
}

// ─── strength (peakswaresb host, same bearer) ──────────────────────────────────

export async function getStrengthWorkout(strengthWorkoutId: number | string): Promise<Record<string, unknown>> {
  const endpoint = `/rx/activity/v1/workouts/${strengthWorkoutId}`;
  const body = await getJsonOrThrow(`${TP_STRENGTH_HOST}${endpoint}`);
  const wrapper = assertRecord(body, endpoint);
  const data = assertRecord(wrapper.data, endpoint);
  assertString(data.id, "data.id", endpoint);
  return data;
}

// ─── writes (PR3) ───────────────────────────────────────────────────────────────
// Same auth/retry/redaction plumbing as the reads above. See the module-level
// comment: these are plain capability functions -- the caller (executor +
// action lifecycle) decides whether/when a write actually happens.

export type CreateWorkoutRequestBody = {
  athleteId: number;
  workoutDay: string;
  title: string;
  workoutTypeValueId: number;
  workoutSubTypeId: number | null;
  description: string | null;
  coachComments: string | null;
  distancePlanned: number | null;
  totalTimePlanned: number | null;
  structure: unknown | null;
};

/**
 * Create a cardio/interval workout. `workoutId: 0` in the request body signals
 * "create" to tpapi (confirmed working end-to-end in this session's earlier
 * probe work); the response contains the server-assigned numeric workoutId.
 */
export async function createWorkout(payload: CreateWorkoutRequestBody): Promise<{ workoutId: number; raw: Record<string, unknown> }> {
  const endpoint = `/fitness/v6/athletes/${payload.athleteId}/workouts`;
  const body = await writeJsonOrThrow(`${TP_API_HOST}${endpoint}`, "POST", { ...payload, workoutId: 0 });
  const record = assertRecord(body, endpoint);
  const workoutId = assertNumber(record.workoutId, "workoutId", endpoint);
  return { workoutId, raw: record };
}

/**
 * Full-object PUT to /workouts/{workoutId} -- the same underlying operation
 * used for both "move" (only workoutDay changes) and "update" (arbitrary
 * fields change). Callers are responsible for building `fullBody` (typically:
 * prefetch GET the current object, then override the changed fields) -- this
 * function is the raw write primitive, matching the existing
 * buildWorkoutMovePayload + PUT pattern already proven in production for move.
 */
export async function putWorkout(athleteId: number, workoutId: number, fullBody: Record<string, unknown>): Promise<Record<string, unknown>> {
  const endpoint = `/fitness/v6/athletes/${athleteId}/workouts/${workoutId}`;
  const body = await writeJsonOrThrow(`${TP_API_HOST}${endpoint}`, "PUT", { ...fullBody, athleteId, workoutId });
  return assertRecord(body, endpoint);
}

/**
 * DELETE a workout. Returns the raw status/body rather than throwing on a
 * non-2xx, because interpreting the result correctly requires isWorkoutGone()
 * (a "successful" delete followed by a readback GET returns HTTP 400 "Invalid
 * workoutId", not 2xx/404 -- see PR1 finding above). The DELETE call itself is
 * expected to return 200 on success (confirmed empirically for both the tpapi
 * and peakswaresb hosts).
 */
export async function deleteWorkout(host: "tpapi" | "strength", athleteId: number, workoutId: number): Promise<{ status: number; body: unknown }> {
  const base = host === "tpapi" ? TP_API_HOST : TP_STRENGTH_HOST;
  const endpoint = `/fitness/v6/athletes/${athleteId}/workouts/${workoutId}`;
  const strengthEndpoint = `/rx/activity/v1/workouts/${workoutId}`;
  const path = host === "tpapi" ? endpoint : strengthEndpoint;
  return fetchJsonWithRetry(`${base}${path}`, { method: "DELETE" });
}

export type CreateStrengthWorkoutRequestBody = {
  workoutType: "StructuredStrength";
  calendarId: number;
  prescribedDate: string;
  title: string;
  blocks: unknown[];
  [key: string]: unknown;
};

/**
 * Create a structured strength workout via the single atomic call resolved in
 * PR1: POST .../workouts/save with the FULL object in one shot (not the old
 * multi-step create+add+add+PUT draft flow, which never persisted). Verified
 * live end-to-end in PR1 (numeric id returned, GET persisted, DELETE worked).
 */
export async function createStrengthWorkout(payload: CreateStrengthWorkoutRequestBody): Promise<Record<string, unknown>> {
  const endpoint = "/rx/activity/v1/workouts/save";
  const body = await writeJsonOrThrow(`${TP_STRENGTH_HOST}${endpoint}`, "POST", payload);
  const wrapper = assertRecord(body, endpoint);
  const data = assertRecord(wrapper.data, endpoint);
  assertString(data.id, "data.id", endpoint);
  return data;
}
