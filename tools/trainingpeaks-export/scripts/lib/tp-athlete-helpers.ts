/**
 * Shared helpers for the tp-athlete CLI (show / set-threshold / add-race).
 *
 * SAFETY POSTURE (read before editing):
 *  - Reads go through the shared read-only client (src/features/trainingpeaks/tp-api-client.ts).
 *  - The ONLY write primitive lives here: `authedWriteOnce()`. It is a single fetch,
 *    NO retry, and it is the caller's job to gate it (dry-run default + explicit
 *    --apply + env TP_ATHLETE_REAL_WRITE=1 + exact confirm phrase). This helper does
 *    not gate — it just performs one authenticated request and reports the raw result.
 *  - Tokens/cookies are never logged.
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { normalizeDisplayName } from "../../../../src/features/trainingpeaks/athlete-roster-import.ts";
import { getCoachedAthletesRoster } from "../../../../src/features/trainingpeaks/tp-api-client.ts";
import { readSessionSnapshot } from "../../../../src/features/trainingpeaks/tp-session-snapshot.ts";
import { toolRoot } from "./paths.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";

// ── env / supabase (same inline pattern as tp-snapshot-zones.ts) ──────────────

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

export function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  // Repo env for Supabase; the coach-id config lives OUTSIDE the repo (see loadCoachUserId).
  for (const p of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) {
    loadDotEnvFile(p);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  return value;
}

export function getSupabase(): SupabaseClient {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Active manual "do NOT auto-override" hold for an athlete, or null. Every zone-WRITE tool must
 *  call this before writing and REFUSE if a hold exists (Buchkina-style manual exceptions). If the
 *  tp_threshold_holds table is missing (migration not applied yet), fail-OPEN with a warning so
 *  existing flows don't break — the hold is still recorded in ops-log/memory until the table lands. */
export async function findActiveHold(supabase: SupabaseClient, athleteId: number): Promise<{ reason: string; heldBy: string | null } | null> {
  const { data, error } = await supabase
    .from("tp_threshold_holds")
    .select("reason, held_by")
    .eq("trainingpeaks_athlete_id", athleteId)
    .eq("active", true)
    .limit(1);
  if (error) {
    console.warn(`  (проверка holds не удалась — таблица tp_threshold_holds применена? ${error.message})`);
    return null;
  }
  const r = (data ?? [])[0];
  return r ? { reason: String(r.reason), heldBy: typeof r.held_by === "string" ? r.held_by : null } : null;
}

// ── config that must stay OUTSIDE the repo/skill (mirrors feedback-worker.env) ─

const LOCAL_CONFIG_PATH = path.join(os.homedir(), ".tp-reports-bot", "tp-athlete.env");

/**
 * The `currentUserId` a zone PUT must carry (GET does not return it). In the one
 * captured working PUT it was Igor's COACH id editing his OWN account; whether a
 * STUDENT's zones want the coach id or the student id is an OPEN QUESTION (see
 * SKILL.md). We never guess it — it is read from ~/.tp-reports-bot/tp-athlete.env
 * (TP_COACH_USER_ID=...). If absent, writes refuse with a setup hint.
 */
export function loadCoachUserId(): number | null {
  // env first, then the local file (never committed, never in the skill).
  const fromEnv = process.env.TP_COACH_USER_ID?.trim();
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  if (!existsSync(LOCAL_CONFIG_PATH)) return null;
  try {
    for (const line of readFileSync(LOCAL_CONFIG_PATH, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      if (t.slice(0, eq).trim() === "TP_COACH_USER_ID") {
        const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        return /^\d+$/.test(v) ? Number(v) : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export const COACH_ID_SETUP_HINT =
  `currentUserId for zone writes is not configured. Create ~/.tp-reports-bot/tp-athlete.env with:\n` +
  `  TP_COACH_USER_ID=<your TP coach user id>\n` +
  `and chmod 600 it. This file stays OUTSIDE the repo and the skill (nothing secret in either).`;

// ── pace conversions (CLI speaks min/km; TP speed threshold is m/s) ───────────

/** "4:45" or "4:45.5" (min:sec per km) → seconds per km. Throws on garbage. */
export function parsePaceToSecPerKm(input: string): number {
  const m = input.trim().match(/^(\d{1,2}):([0-5]?\d(?:\.\d+)?)$/);
  if (!m) throw new Error(`bad pace "${input}" — expected mm:ss per km, e.g. 4:45`);
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  const total = minutes * 60 + seconds;
  if (!(total > 0)) throw new Error(`bad pace "${input}" — must be positive`);
  return total;
}

export function secPerKmToMps(secPerKm: number): number {
  return 1000 / secPerKm;
}

export function mpsToSecPerKm(mps: number): number {
  return 1000 / mps;
}

/** seconds/km → "m:ss/km" for human display. */
export function formatPaceSecPerKm(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  const ss = s === 60 ? "00" : s.toString().padStart(2, "0");
  const mm = s === 60 ? m + 1 : m;
  return `${mm}:${ss}/км`;
}

export function formatMpsAsPace(mps: number | null): string {
  if (mps === null || !Number.isFinite(mps) || mps <= 0) return "—";
  return formatPaceSecPerKm(mpsToSecPerKm(mps));
}

// ── athlete lookup (fuzzy name → id, via the live TP roster) ──────────────────

export type RosterMatch = { athleteId: number; displayName: string };

export type LookupResult =
  | { kind: "one"; match: RosterMatch }
  | { kind: "many"; matches: RosterMatch[] }
  | { kind: "none" };

/**
 * Resolve a query (numeric athlete id OR a fuzzy name) against the live coached
 * roster. Never auto-picks when ambiguous — returns all matches and lets the
 * caller show them and ask. A pure numeric query is treated as an id and matched
 * exactly (still resolved through the roster to attach a display name).
 */
export async function lookupAthlete(query: string): Promise<LookupResult> {
  const roster = await getCoachedAthletesRoster();
  const all: RosterMatch[] = roster
    .filter((a) => Number.isInteger(a.athleteId) && a.athleteId > 0)
    .map((a) => ({ athleteId: a.athleteId, displayName: a.displayName }));

  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    const exact = all.find((a) => a.athleteId === id);
    return exact ? { kind: "one", match: exact } : { kind: "none" };
  }

  const q = normalizeDisplayName(trimmed);
  const tokens = q.split(" ").filter(Boolean);
  const matches = all.filter((a) => {
    const name = normalizeDisplayName(a.displayName);
    // match if every query token appears in the name (order-independent), or the
    // whole normalized name contains the query / vice-versa.
    return tokens.every((t) => name.includes(t)) || name.includes(q) || q.includes(name);
  });

  if (matches.length === 1) return { kind: "one", match: matches[0] };
  if (matches.length > 1) return { kind: "many", matches };
  return { kind: "none" };
}

// ── zone-set extraction ───────────────────────────────────────────────────────

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The array key inside GET /settings for a zone type. */
export function settingsKeyFor(type: "speed" | "heartRate"): "speedZones" | "heartRateZones" {
  return type === "speed" ? "speedZones" : "heartRateZones";
}

/** Find the workoutTypeId=0 set (the one TP reads for zone calc) within a zones array. */
export function findWt0Set(zonesArray: unknown): Record<string, unknown> | null {
  if (!Array.isArray(zonesArray)) return null;
  const wt0 = zonesArray.find((s) => isRecord(s) && s.workoutTypeId === 0);
  return isRecord(wt0) ? wt0 : null;
}

// ── the single guarded write primitive (no retry) ─────────────────────────────

export type WriteResult = { status: number; bodyText: string };

async function getBearer(): Promise<string> {
  const snap = await readSessionSnapshot();
  const res = await fetch(`${TP_API_HOST}/users/v3/token`, {
    method: "GET",
    headers: { accept: "application/json", Cookie: `Production_tpAuth=${snap.cookieValue}` },
  });
  if (!res.ok) throw new Error(`token exchange failed HTTP ${res.status}`);
  const body: unknown = await res.json();
  const token = isRecord(body) && isRecord(body.token) ? body.token.access_token : null;
  if (typeof token !== "string" || !token) throw new Error("no access_token from /users/v3/token");
  return token; // never logged
}

/**
 * Perform EXACTLY ONE authenticated write (PUT or POST) to a tpapi path. No retry.
 * Returns the raw status + body text so the caller can decide success (e.g. 204 for
 * a zones PUT, 200 for an event POST). This function performs no gating of its own —
 * every caller must have already passed the dry-run/apply/confirm/env gates.
 */
export async function authedWriteOnce(method: "PUT" | "POST", apiPath: string, payload: unknown): Promise<WriteResult> {
  const bearer = await getBearer();
  const res = await fetch(`${TP_API_HOST}${apiPath}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await res.text().catch(() => "");
  return { status: res.status, bodyText };
}

export { TP_API_HOST };
