import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";

// Backward race scan (Вариант A). The weekly forward job (enqueue-race-scan-weekly)
// only ever looks [today, today+120d], so a race is captured only during the finite
// window it is upcoming — once it is run and past, it is never re-fetched and the
// threshold engine loses it. This enqueues a SEPARATE job_type "race_scan_backfill"
// with a backward window [today − BACKFILL_DAYS, today]; the SAME runner
// (tp-races-requests-once) claims it and persists via the SAME upsert
// (source 'scan', onConflict student_id,event_date,source → idempotent). The forward
// weekly job and its enqueue are NOT touched.

// --- .env loading: identical behaviour to enqueue-race-scan-weekly.ts ---
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
  for (const p of [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ]) {
    loadDotEnvFile(p);
  }
}

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  return value;
}

function belgradeToday(): string {
  // en-CA renders as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const BACKFILL_DAYS = Number(process.env.RACE_SCAN_BACKFILL_DAYS ?? "400");

async function main(): Promise<void> {
  loadLocalEnv();
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Dedupe guard: skip if a backfill scan is already queued or running. Independent
  // of the forward weekly job (different job_type), so the two never block each other.
  const { data: active, error: selectError } = await supabase
    .from("trainingpeaks_jobs")
    .select("id,status")
    .eq("job_type", "race_scan_backfill")
    .in("status", ["queued", "running"])
    .limit(1);
  if (selectError) throw new Error(`select active race-scan-backfill job failed: ${selectError.message}`);
  if (active && active.length > 0) {
    console.log(`[enqueue-race-scan-backfill] skip: a backfill scan is already ${active[0].status} (id=${active[0].id}).`);
    return;
  }

  const backfillDays = Number.isFinite(BACKFILL_DAYS) && BACKFILL_DAYS > 0 ? Math.floor(BACKFILL_DAYS) : 400;
  const to = belgradeToday();
  const from = addDays(to, -backfillDays);

  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .insert({
      job_type: "race_scan_backfill",
      scope: "all_enabled",
      student_id: null,
      status: "queued",
      week_from: from,
      week_to: to,
      // requested_by_chat_id omitted (null) → silent, no Telegram summary.
    })
    .select("id")
    .single();
  if (error) {
    // Unique/conflict guard in DB — treat as already-active, not a failure.
    if (/duplicate|conflict|unique/i.test(error.message)) {
      console.log(`[enqueue-race-scan-backfill] skip: backfill scan already active (db conflict).`);
      return;
    }
    throw new Error(`insert race-scan-backfill job failed: ${error.message}`);
  }
  console.log(`[enqueue-race-scan-backfill] queued backfill scan id=${data.id} window ${from} -> ${to} (${backfillDays}d back).`);
}

main().catch((error: unknown) => {
  console.error(`[enqueue-race-scan-backfill] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
