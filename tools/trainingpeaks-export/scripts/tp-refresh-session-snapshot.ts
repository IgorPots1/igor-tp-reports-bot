import { chromium } from "playwright";

import { profileDir } from "./lib/paths.ts";
import * as tpSessionSnapshotModule from "../../../src/features/trainingpeaks/tp-session-snapshot.ts";

// CJS/ESM boundary workaround (this package is "type":"module", src/ is CJS-default):
// a plain named import of a src/ file intermittently loses named exports across this
// boundary under Node's native TS stripping. Namespace import + .default fallback is
// the established pattern — see tp-actions-once.ts.
type NamespaceWithOptionalDefault<T> = T & { default?: T };
const tpSessionSnapshotModuleCompat =
  tpSessionSnapshotModule as NamespaceWithOptionalDefault<typeof tpSessionSnapshotModule>;

const TP_SESSION_SNAPSHOT_PATH =
  tpSessionSnapshotModuleCompat.TP_SESSION_SNAPSHOT_PATH ?? tpSessionSnapshotModuleCompat.default?.TP_SESSION_SNAPSHOT_PATH;
const writeSessionSnapshotAtomic =
  tpSessionSnapshotModuleCompat.writeSessionSnapshotAtomic ?? tpSessionSnapshotModuleCompat.default?.writeSessionSnapshotAtomic;

if (!TP_SESSION_SNAPSHOT_PATH) {
  throw new Error("tp-session-snapshot.TP_SESSION_SNAPSHOT_PATH is unavailable.");
}
if (typeof writeSessionSnapshotAtomic !== "function") {
  throw new Error("tp-session-snapshot.writeSessionSnapshotAtomic is unavailable.");
}

/**
 * PR2 — cross-worktree session snapshot writer.
 *
 * Extracts the Production_tpAuth cookie from the persistent Playwright profile
 * (this checkout's tools/trainingpeaks-export/.playwright-profile/trainingpeaks
 * -- confirmed in PR1 to be local to a single checkout path, not shared across
 * git worktrees) and writes it to a fixed, worktree-independent snapshot file
 * under the user's home directory (see tp-session-snapshot.ts). Any worktree's
 * tp-api-client.ts reads that same file, so only ONE checkout (the one with a
 * real logged-in profile) ever needs to run this script.
 *
 * This is the ONLY place in the whole design that touches Playwright to obtain
 * auth. Everything downstream (tp-api-client.ts, and eventually the write
 * executor) is a plain fetch() against the snapshot's cookie value -- no
 * Playwright dependency needed outside this tools/ subproject.
 *
 * Concurrency note: Chromium disallows two processes opening the same
 * profile (user-data-dir) at once. If another Playwright-based script (e.g.
 * tp-actions-once.ts) currently holds this profile open, launchPersistentContext
 * below will fail or hang. This script fails LOUDLY and non-destructively in
 * that case -- the existing snapshot file is left untouched (writes are atomic,
 * see writeSessionSnapshotAtomic) -- rather than silently producing a stale or
 * corrupt snapshot. Run this when no other Playwright session against this
 * profile is expected to be active; retry later on failure.
 *
 * Usage:
 *   npm run tp-refresh-session-snapshot
 *   (add --headed to watch it, e.g. to confirm login state visually)
 */

const LAUNCH_TIMEOUT_MS = 30_000;
const COOKIE_NAME = "Production_tpAuth";
const WARMUP_URL = "https://app.trainingpeaks.com/#calendar";

function isProfileLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /processsingleton|singletonlock|already running|target closed|timeout.*launch/i.test(message);
}

async function main(): Promise<void> {
  const headless = !process.argv.includes("--headed");
  console.log(`profileDir: ${profileDir}`);
  console.log(`snapshotPath: ${TP_SESSION_SNAPSHOT_PATH}`);

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: null,
      timeout: LAUNCH_TIMEOUT_MS,
    });
  } catch (error) {
    if (isProfileLockError(error)) {
      console.error(
        "Could not open the Playwright profile -- it is likely already in use by another " +
          "process (e.g. tp-actions-once.ts). The existing snapshot is left untouched. Try again " +
          "once that process finishes.",
      );
      process.exit(1);
    }
    throw error;
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(WARMUP_URL, { waitUntil: "domcontentloaded", timeout: LAUNCH_TIMEOUT_MS });
    await page.waitForTimeout(1_500);

    const cookies = await context.cookies(["https://app.trainingpeaks.com", "https://tpapi.trainingpeaks.com"]);
    const tpAuthCookie = cookies.find((c) => c.name === COOKIE_NAME);

    if (!tpAuthCookie) {
      console.error(
        `No ${COOKIE_NAME} cookie found in this profile. The profile is not logged into TrainingPeaks -- ` +
          "log in manually in a browser window pointed at this same profile directory first.",
      );
      process.exit(1);
    }

    const cookieExpiresAtMs = tpAuthCookie.expires && tpAuthCookie.expires > 0 ? Math.round(tpAuthCookie.expires * 1000) : null;

    await writeSessionSnapshotAtomic({
      cookieValue: tpAuthCookie.value,
      cookieExpiresAtMs,
      capturedAtMs: Date.now(),
      source: "playwright-profile",
    });

    console.log(`cookie_length: ${tpAuthCookie.value.length}`);
    console.log(`cookie_expires_at: ${cookieExpiresAtMs ? new Date(cookieExpiresAtMs).toISOString() : "session (no expiry reported)"}`);
    console.log("verdict: snapshot written successfully.");
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-refresh-session-snapshot failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
