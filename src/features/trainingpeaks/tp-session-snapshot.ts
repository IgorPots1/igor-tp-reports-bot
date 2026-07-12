import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Cross-worktree TrainingPeaks session snapshot.
 *
 * PR1 proved the TP session (Production_tpAuth cookie) can be extracted from the
 * persistent Playwright profile (tools/trainingpeaks-export/.playwright-profile/)
 * via context.cookies() -- but that profile is local to a single checkout path and
 * is NOT shared across git worktrees (confirmed empirically: a fresh worktree has
 * its own empty, unauthenticated profile).
 *
 * This module is the shared contract between:
 *  - the WRITER: tools/trainingpeaks-export/scripts/tp-refresh-session-snapshot.ts
 *    (Playwright-based, runs wherever the one true logged-in profile lives, e.g.
 *    the primary checkout) -- imports writeSessionSnapshotAtomic() from here.
 *  - the READER: tp-api-client.ts in this same directory (pure fetch, no
 *    Playwright dependency -- src/ never depends on the tools/ Playwright
 *    subproject) -- imports readSessionSnapshot() from here.
 *
 * The snapshot lives OUTSIDE any git worktree, at a fixed path under the user's
 * home directory, so every worktree/checkout reads the exact same file regardless
 * of which one refreshed it last. No raw cookie is ever stored in an environment
 * variable, a log, ops-log, or a commit -- see plan §D (TRAININGPEAKS_COOKIE is
 * dropped entirely, not used as a fallback).
 *
 * Race safety: writes are atomic (write to a per-process temp file in the same
 * directory, then rename() -- POSIX rename is atomic on the same filesystem), so
 * a concurrent reader never observes a partially-written file. There is no lock
 * file: the writer is expected to run as a standalone, on-demand/periodic step,
 * not concurrently with itself. A separate, real race exists one level up --
 * Chromium disallows two processes opening the same Playwright profile
 * (user-data-dir) at once, so the refresh script can itself fail with a "profile
 * busy" error if it collides with another Playwright-based script (e.g.
 * tp-actions-once.ts) using the same profile. That failure is non-fatal to
 * readers: the snapshot simply stays at its last-good value until a refresh
 * succeeds. See tp-refresh-session-snapshot.ts for the handling.
 */

export const TP_SESSION_SNAPSHOT_DIR = path.join(os.homedir(), ".tp-reports-bot");
export const TP_SESSION_SNAPSHOT_PATH = path.join(TP_SESSION_SNAPSHOT_DIR, "session-snapshot.json");

const SNAPSHOT_VERSION = 1;

export type TpSessionSnapshot = {
  version: 1;
  /** Value of the Production_tpAuth cookie. Never logged, never redacted-and-kept -- only ever read into memory. */
  cookieValue: string;
  /** Cookie expiry as epoch milliseconds, if the browser reported one; null if session/unknown. */
  cookieExpiresAtMs: number | null;
  /** When this snapshot was captured, epoch milliseconds. */
  capturedAtMs: number;
  /** Always "playwright-profile" today; reserved for a future source (e.g. an eventual auto-mint flow). */
  source: "playwright-profile";
};

export class TpSessionSnapshotMissingError extends Error {
  readonly snapshotPath: string;
  constructor(snapshotPath: string) {
    super(
      `No TrainingPeaks session snapshot at ${snapshotPath}. ` +
        "Run tp-refresh-session-snapshot.ts (in tools/trainingpeaks-export) from a checkout " +
        "with a logged-in Playwright profile first.",
    );
    this.name = "TpSessionSnapshotMissingError";
    this.snapshotPath = snapshotPath;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSnapshot(raw: unknown, snapshotPath: string): TpSessionSnapshot {
  if (!isPlainRecord(raw)) {
    throw new Error(`Malformed session snapshot at ${snapshotPath}: not a JSON object.`);
  }
  const { version, cookieValue, cookieExpiresAtMs, capturedAtMs, source } = raw;
  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported session snapshot version at ${snapshotPath}: ${String(version)}.`);
  }
  if (typeof cookieValue !== "string" || cookieValue.length === 0) {
    throw new Error(`Malformed session snapshot at ${snapshotPath}: missing cookieValue.`);
  }
  if (cookieExpiresAtMs !== null && typeof cookieExpiresAtMs !== "number") {
    throw new Error(`Malformed session snapshot at ${snapshotPath}: cookieExpiresAtMs must be a number or null.`);
  }
  if (typeof capturedAtMs !== "number") {
    throw new Error(`Malformed session snapshot at ${snapshotPath}: missing capturedAtMs.`);
  }
  if (source !== "playwright-profile") {
    throw new Error(`Malformed session snapshot at ${snapshotPath}: unexpected source "${String(source)}".`);
  }
  return { version: SNAPSHOT_VERSION, cookieValue, cookieExpiresAtMs, capturedAtMs, source };
}

/**
 * Reads and validates the session snapshot. Throws TpSessionSnapshotMissingError
 * if the file does not exist; throws a plain Error if it exists but is malformed.
 * Never logs the cookie value.
 */
export async function readSessionSnapshot(
  snapshotPath: string = TP_SESSION_SNAPSHOT_PATH,
): Promise<TpSessionSnapshot> {
  let raw: string;
  try {
    raw = await readFile(snapshotPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new TpSessionSnapshotMissingError(snapshotPath);
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed session snapshot at ${snapshotPath}: invalid JSON.`);
  }
  return parseSnapshot(parsed, snapshotPath);
}

/**
 * Atomically writes the session snapshot (temp file in the same directory, then
 * rename()). Called only from the Playwright-based refresh script in tools/.
 */
export async function writeSessionSnapshotAtomic(
  snapshot: Omit<TpSessionSnapshot, "version">,
  snapshotPath: string = TP_SESSION_SNAPSHOT_PATH,
): Promise<void> {
  const dir = path.dirname(snapshotPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.session-snapshot.${randomUUID()}.tmp`);
  const full: TpSessionSnapshot = { version: SNAPSHOT_VERSION, ...snapshot };
  await writeFile(tmpPath, `${JSON.stringify(full, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, snapshotPath);
}

export function isSnapshotCookieFresh(snapshot: TpSessionSnapshot, nowMs: number = Date.now()): boolean {
  if (snapshot.cookieExpiresAtMs === null) return true;
  // 24h safety margin before the cookie's own reported expiry.
  const marginMs = 24 * 60 * 60 * 1000;
  return snapshot.cookieExpiresAtMs - marginMs > nowMs;
}
