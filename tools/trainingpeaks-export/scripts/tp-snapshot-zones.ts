/**
 * Stage-1 Part B — one-time READ-ONLY zone/threshold snapshot across the roster.
 *
 * Reads GET /fitness/v1/athletes/{id}/settings for every coached athlete and writes
 * one immutable row per athlete into public.tp_zone_snapshots. This is the read-only
 * PRECONDITION the Zone-write policy requires (docs/tp-api-capability-matrix.md): no
 * future zone apply may run against an athlete without a prior snapshot here.
 *
 * READ-ONLY against TrainingPeaks (GET settings only, via the shared tp-api-client:
 * snapshot cookie → bearer → HTTP, NO Chromium, NO Playwright-profile lock — safe to
 * run alongside tp-actions-loop). The ONLY writes are INSERTs into our own Supabase.
 *
 * Three operating guarantees:
 *   1. Idempotent + resumable. Rows are written PER ATHLETE as the walk proceeds,
 *      never accumulated and flushed at the end. A run that dies mid-roster leaves
 *      every completed athlete already persisted; re-running skips athletes that
 *      already have a snapshot row and only fills in the missing ones. (--force
 *      re-snapshots everyone, e.g. for a deliberate fresh capture later.)
 *   2. Pacing. A small delay between athletes (--delay-ms, default 750) so we don't
 *      hammer TP with 110+ back-to-back GETs.
 *   3. 401 behavior. If the session cookie expires mid-run, the client throws
 *      TpApiAuthError. We do NOT try to refresh it (that needs Chromium and would
 *      conflict with the running loop). We STOP, report how many athletes were
 *      snapshotted, and exit non-zero. Refreshing the snapshot is a manual step.
 *
 * Never prints athlete names — only athlete_id and aggregates.
 *
 * Usage: npm run tp-snapshot-zones -- [--delay-ms=750] [--force] [--limit=N] [--athlete-id=X]
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  getAthleteSettings,
  getCoachedAthletesRoster,
  TpApiAuthError,
} from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { toolRoot } from "./lib/paths.ts";
import { pickWhitelistedSettings, whitelistedKeySignature } from "./lib/tp-settings-whitelist.ts";

// ── env loading (same inline pattern as the other tp-*.ts scripts) ────────────

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) return;
  let content: string;
  try {
    content = readFileSync(dotEnvPath, "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) {
    loadDotEnvFile(p);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  return value;
}

function getSupabase() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── cli ───────────────────────────────────────────────────────────────────────

function getCliValue(prefix: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : null;
}
function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

// ── zones extraction (WHITELIST — the raw settings are never persisted) ────────
//
// The full GET /settings body carries email/firstName and a working iCalendarKeys
// access key, so we store ONLY the whitelisted zone/threshold projection (shared
// with tp-verify-reads via ./lib/tp-settings-whitelist.ts). There is no raw_settings
// column any more — nothing outside the whitelist reaches the database.

/** Whitelisted zone/threshold projection, or null if the athlete has none. */
function extractZones(settings: Record<string, unknown>): Record<string, unknown> | null {
  const zones = pickWhitelistedSettings(settings);
  return Object.keys(zones).length > 0 ? zones : null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── main ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadLocalEnv();
  const supabase = getSupabase();

  const delayMs = Math.max(0, Number(getCliValue("--delay-ms=") ?? 750));
  const force = hasFlag("--force");
  const limitRaw = getCliValue("--limit=");
  const limit = limitRaw ? Math.max(1, Number(limitRaw)) : null;
  const onlyAthleteRaw = getCliValue("--athlete-id=");
  const onlyAthlete = onlyAthleteRaw ? Number(onlyAthleteRaw) : null;

  // Roster (read-only GET /users/v3/user). A dead cookie throws here, before any athlete.
  let roster;
  try {
    roster = await getCoachedAthletesRoster();
  } catch (error) {
    if (error instanceof TpApiAuthError) {
      console.error("STOP: session cookie is dead at roster fetch (401). Nothing snapshotted. Refresh the snapshot (manual) and re-run.");
      process.exit(2);
    }
    throw error;
  }

  let athleteIds = roster.map((a) => a.athleteId).filter((id) => Number.isInteger(id) && id > 0);
  if (onlyAthlete !== null) athleteIds = athleteIds.filter((id) => id === onlyAthlete);
  const rosterCount = athleteIds.length;

  // Resume: which athletes already have a snapshot row (skip unless --force).
  const alreadyDone = new Set<number>();
  if (!force) {
    const { data, error } = await supabase
      .from("tp_zone_snapshots")
      .select("trainingpeaks_athlete_id");
    if (error) throw new Error(`Failed to read existing snapshots: ${error.message}`);
    for (const row of data ?? []) alreadyDone.add(Number(row.trainingpeaks_athlete_id));
  }

  // athlete_id → student uuid (optional linkage; never used to print names).
  const studentIdByAthlete = new Map<number, string>();
  {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .select("id, trainingpeaks_athlete_id");
    if (error) throw new Error(`Failed to read roster mapping: ${error.message}`);
    for (const row of data ?? []) {
      const aid = Number(row.trainingpeaks_athlete_id);
      if (Number.isInteger(aid) && aid > 0 && typeof row.id === "string") studentIdByAthlete.set(aid, row.id);
    }
  }

  let toProcess = athleteIds.filter((id) => force || !alreadyDone.has(id));
  if (limit !== null) toProcess = toProcess.slice(0, limit);

  console.log(
    `tp-snapshot-zones: roster=${rosterCount} alreadySnapshotted=${alreadyDone.size} toProcess=${toProcess.length} ` +
      `delayMs=${delayMs} force=${force}${limit !== null ? ` limit=${limit}` : ""}`,
  );

  let covered = 0;
  let zonesAbsent = 0;
  const failed: number[] = [];
  const signatureCount = new Map<string, number>();
  const signatureByAthlete = new Map<number, string>();

  for (let i = 0; i < toProcess.length; i += 1) {
    const athleteId = toProcess[i];
    try {
      const settings = await getAthleteSettings(athleteId); // read-only GET
      const zones = extractZones(settings); // whitelisted projection only — no PII/secrets
      const signature = whitelistedKeySignature(settings);
      signatureByAthlete.set(athleteId, signature);
      signatureCount.set(signature, (signatureCount.get(signature) ?? 0) + 1);
      if (!zones) zonesAbsent += 1;

      // Write THIS athlete immediately (idempotent/resumable — never batched).
      // Only the whitelisted zones are stored; the raw settings never reach the DB.
      const { error } = await supabase.from("tp_zone_snapshots").insert({
        trainingpeaks_athlete_id: athleteId,
        student_id: studentIdByAthlete.get(athleteId) ?? null,
        captured_at: new Date().toISOString(),
        zones,
        source: "settings_v1",
      });
      if (error) {
        failed.push(athleteId);
        console.warn(`  athlete ${athleteId}: DB insert failed — ${error.message}`);
      } else {
        covered += 1;
        console.log(`  [${i + 1}/${toProcess.length}] athlete ${athleteId}: snapshotted (zones=${zones ? "yes" : "none"})`);
      }
    } catch (error) {
      if (error instanceof TpApiAuthError) {
        console.error(
          `\nSTOP: session cookie expired mid-run (401) at athlete ${athleteId}. ` +
            `Snapshotted ${covered} this run (${alreadyDone.size} already existed before). ` +
            `NOT refreshing (Chromium would conflict with the loop) — refresh the snapshot manually and re-run to continue.`,
        );
        process.exit(2);
      }
      failed.push(athleteId);
      console.warn(`  athlete ${athleteId}: read failed — ${error instanceof Error ? error.message : String(error)}`);
    }
    if (i < toProcess.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  // ── structure-outlier report ──────────────────────────────────────────────
  let modalSignature = "";
  let modalCount = -1;
  for (const [sig, count] of signatureCount) {
    if (count > modalCount) {
      modalCount = count;
      modalSignature = sig;
    }
  }
  const outliers = [...signatureByAthlete.entries()].filter(([, sig]) => sig !== modalSignature).map(([id]) => id);

  const { count: totalRows } = await supabase
    .from("tp_zone_snapshots")
    .select("*", { count: "exact", head: true });

  console.log(`\n── summary ─────────────────────────────────────────────`);
  console.log(`roster athletes:          ${rosterCount}`);
  console.log(`snapshotted this run:     ${covered}`);
  console.log(`skipped (already had):    ${force ? 0 : alreadyDone.size}`);
  console.log(`zones absent (this run):  ${zonesAbsent}`);
  console.log(`read/write failures:      ${failed.length}${failed.length ? ` (athlete_ids: ${failed.join(", ")})` : ""}`);
  console.log(`typical zone-key set:     "${modalSignature}" (${modalCount}/${covered} athletes)`);
  console.log(`structure outliers:       ${outliers.length}${outliers.length ? ` (athlete_ids: ${outliers.join(", ")})` : ""}`);
  console.log(`total rows in table now:  ${totalRows ?? "unknown"}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("tp-snapshot-zones failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
