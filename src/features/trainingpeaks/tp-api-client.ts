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
 * READ ONLY. No POST/PUT/DELETE calls are made anywhere in this module.
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
async function fetchJsonWithRetry(url: string): Promise<{ status: number; body: unknown }> {
  let authRefreshedThisCall = false;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const bearer = await getBearer();
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json, text/javascript, */*; q=0.01", authorization: `Bearer ${bearer}` },
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
