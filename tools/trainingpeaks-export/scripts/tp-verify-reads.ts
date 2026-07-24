/**
 * Stage-1 Part A — live READ verification (GET only, zero mutation).
 *
 * Re-verifies read-side capabilities against the live TP API 11+ days after the
 * capability matrix was captured, and closes the "не проверено" gaps from the
 * connector recon. Everything here is a GET through the shared tp-api-client
 * (snapshot cookie → bearer → HTTP); NO Chromium, NO write, so it is safe to run
 * concurrently with the tp-actions-loop (no Playwright-profile lock is taken).
 *
 * What it checks:
 *   1. Zones/thresholds in GET /fitness/v1/athletes/{id}/settings — under which
 *      keys, what structure (power/hr/pace separate?), and whether FTP/LTHR/
 *      threshold pace live there too.
 *   2. Read shape of GET /fitness/v2/athletes/{id}/{power|heartrate|speed}zones
 *      (the resource the zone PUT targets) — to see whether the settings read
 *      shape matches the v2 zone shape a future PUT would need (Stage-2 mapping).
 *   3. Gap probes (read-only): workout attachments, goals (goallists), season/
 *      ATP, athlete groups — report HTTP status + structure, or "absent".
 *
 * Prints STRUCTURE (key names, types, array element shapes, HTTP statuses) to
 * stdout; writes the full redacted responses to reports/tp-verify-reads/<ts>/
 * (gitignored + .graphifyignore) for inspection. No cookie/bearer is ever printed.
 *
 * Usage:  npm run tp-verify-reads -- [--athlete-id=3102415]
 * Default athlete is the repo's safe test athlete (Igor's own account) — reading
 * one's own zones is harmless; pass --athlete-id to verify a specific athlete.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  getAthleteSettings,
  getTpApiJsonRaw,
  getWorkoutsByDateRange,
} from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { reportsRoot } from "./lib/paths.ts";

const DEFAULT_ATHLETE_ID = 3102415;

function getCliValue(prefix: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : null;
}

/** Compact structural descriptor: key names + types, array → first element shape. No leaf values. */
function describeShape(value: unknown, depth = 0): unknown {
  if (depth > 3) return "…";
  if (Array.isArray(value)) {
    return value.length === 0 ? "[](empty)" : [`[${value.length}]`, describeShape(value[0], depth + 1)];
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = describeShape(v, depth + 1);
    }
    return out;
  }
  return typeof value;
}

/** Top-level keys whose name hints at a zone or threshold, for a quick "where do zones live" answer. */
function zoneRelatedKeys(settings: Record<string, unknown>): string[] {
  return Object.keys(settings).filter((k) => /zone|ftp|threshold|lthr|maxhr|resthr|pace|power|heart/i.test(k));
}

async function main(): Promise<void> {
  const athleteId = Number(getCliValue("--athlete-id=") ?? DEFAULT_ATHLETE_ID);
  if (!Number.isInteger(athleteId) || athleteId <= 0) {
    throw new Error(`Invalid --athlete-id: ${athleteId}`);
  }
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(reportsRoot, "tp-verify-reads", `${athleteId}-${stamp}`);
  await mkdir(outDir, { recursive: true });

  const findings: Record<string, unknown> = { athleteId, ranAt: now.toISOString() };
  console.log(`tp-verify-reads: athlete ${athleteId} (GET-only, no mutation)\n`);

  // ── 1. settings: zones + thresholds ────────────────────────────────────────
  const settings = await getAthleteSettings(athleteId);
  const zoneKeys = zoneRelatedKeys(settings);
  await writeFile(path.join(outDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  console.log(`[1] GET /fitness/v1/athletes/${athleteId}/settings — ${Object.keys(settings).length} top-level keys`);
  console.log(`    zone/threshold-related keys: ${zoneKeys.join(", ") || "(none found by name)"}`);
  for (const k of zoneKeys) {
    console.log(`      ${k}: ${JSON.stringify(describeShape(settings[k]))}`);
  }
  findings.settings = { topLevelKeyCount: Object.keys(settings).length, zoneRelatedKeys: zoneKeys };

  // ── 2. v2 zone read shape (the PUT target resource) ────────────────────────
  const v2 = ["heartrate", "power", "speed"] as const;
  const v2Shapes: Record<string, unknown> = {};
  for (const kind of v2) {
    const { status, body } = await getTpApiJsonRaw("tpapi", `/fitness/v2/athletes/${athleteId}/${kind}zones`);
    v2Shapes[kind] = { status, shape: status >= 200 && status < 300 ? describeShape(body) : null };
    console.log(`[2] GET /fitness/v2/athletes/${athleteId}/${kind}zones — HTTP ${status}`);
    if (status >= 200 && status < 300) {
      console.log(`      shape: ${JSON.stringify(describeShape(body))}`);
    }
  }
  await writeFile(path.join(outDir, "v2-zones.json"), `${JSON.stringify(v2Shapes, null, 2)}\n`, "utf8");
  findings.v2Zones = v2Shapes;

  // ── 3. gap probes ──────────────────────────────────────────────────────────
  const year = now.getUTCFullYear();
  const gaps: Array<{ name: string; host: "tpapi"; path: string }> = [
    { name: "goals (goallists)", host: "tpapi", path: `/fitness/v1/athletes/${athleteId}/goallists` },
    { name: "season/ATP", host: "tpapi", path: `/fitness/v1/athletes/${athleteId}/atp/${year}-01-01/${year}-12-31` },
    { name: "athlete groups", host: "tpapi", path: `/fitness/v1/athletes/${athleteId}/athletegroups` },
  ];

  // attachments need a real workoutId — sample one from the last ~120 days.
  const toIso = now.toISOString().slice(0, 10);
  const fromIso = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent = await getWorkoutsByDateRange(athleteId, fromIso, toIso).catch(() => []);
  const sampleWorkoutId = recent[0]?.workoutId ?? null;
  if (sampleWorkoutId !== null) {
    gaps.push({ name: "workout attachments", host: "tpapi", path: `/fitness/v6/athletes/${athleteId}/workouts/${sampleWorkoutId}/attachments` });
  }

  const gapResults: Record<string, unknown> = {};
  for (const g of gaps) {
    const { status, body } = await getTpApiJsonRaw(g.host, g.path);
    const ok = status >= 200 && status < 300;
    gapResults[g.name] = { path: g.path, status, shape: ok ? describeShape(body) : null };
    console.log(`[3] ${g.name} — GET ${g.path} — HTTP ${status}${ok ? "" : " (gap: not available at this path)"}`);
    if (ok) console.log(`      shape: ${JSON.stringify(describeShape(body))}`);
  }
  if (sampleWorkoutId === null) {
    gapResults["workout attachments"] = { note: "no recent workout found in last 120d to sample; attachments not probed" };
    console.log(`[3] workout attachments — SKIPPED (no recent workout to sample)`);
  }
  await writeFile(path.join(outDir, "gaps.json"), `${JSON.stringify(gapResults, null, 2)}\n`, "utf8");
  findings.gaps = gapResults;

  await writeFile(path.join(outDir, "findings.json"), `${JSON.stringify(findings, null, 2)}\n`, "utf8");
  console.log(`\nFull redacted responses + findings written to: ${outDir}`);
}

main().catch((error: unknown) => {
  console.error("tp-verify-reads failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
