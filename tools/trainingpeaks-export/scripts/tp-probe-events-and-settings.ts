import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { captureSessionAuth, performApiJsonRequest, redactUnknown } from "./lib/trainingpeaks-api-move.ts";

/**
 * PR1 task 1 (❓ rows) — cheap, reversible/read-only probes for:
 *  - Events write: POST/DELETE https://tpapi.trainingpeaks.com/fitness/v6/athletes/{id}/events
 *    (endpoint per nagelflorian/trainingpeaks-mcp-server src/api/events.ts)
 *  - Zones/settings read: GET https://tpapi.trainingpeaks.com/fitness/v1/athletes/{id}/settings
 *    (READ ONLY -- zones/FTP writes are policy-excluded per plan §A, never attempted here)
 *
 * Same safe-athlete lock + confirm-phrase + TP_ACTIONS_REAL_EXECUTION gate as the
 * other PR1 probes. Events round-trip is create -> verify -> delete (reversible).
 *
 * PR1 RESULT (2026-07-12, athlete 3102415): settings GET confirmed PASS (200, 57
 * keys). Event create returned HTTP 500 "An error has occurred" against
 * nagelflorian's documented body shape (athleteId/name/eventDate/eventType/
 * description, eventType:"Other") on two attempts -- unresolved this pass, no
 * further field-shape hints in the error body. Endpoint exists and is reachable
 * (not 404/401), but the exact working payload needs a live browser-network
 * capture before PR6 relies on it.
 */

const SAFE_ATHLETE_ID = 3102415;
const REQUIRED_CONFIRM = "PROBE TP EVENTS SETTINGS";
const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";
const API_HOST = "https://tpapi.trainingpeaks.com";

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
function readRequiredNextArg(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (!next) throw new Error(`Missing value after ${flag}`);
  return next.trim();
}
function getRepoReportsRoot(): string { return path.resolve(toolRoot, "..", "..", "reports"); }
function timestampForPath(date: Date): string { return date.toISOString().replace(/[:.]/g, "-").slice(0, 19); }

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let apply = false;
  let confirm: string | null = null;
  let headless = true;
  let date = "2026-12-29";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") { apply = true; continue; }
    if (arg === "--confirm") { confirm = readRequiredNextArg(argv, index, arg); index += 1; continue; }
    if (arg === "--headed") { headless = false; continue; }
    if (arg === "--date") { date = readRequiredNextArg(argv, index, arg); index += 1; continue; }
  }
  const executeAllowed = apply && isTruthyEnvFlag(process.env[TP_ACTIONS_REAL_EXECUTION_ENV]);
  const artifactDir = path.join(getRepoReportsRoot(), "events-settings-probe", timestampForPath(new Date()));
  await mkdir(artifactDir, { recursive: true });

  console.log(`dry_run: ${!apply}`);
  if (!apply) {
    console.log(`To apply: --apply --confirm "${REQUIRED_CONFIRM}" (requires ${TP_ACTIONS_REAL_EXECUTION_ENV}=true)`);
    return;
  }
  if (confirm !== REQUIRED_CONFIRM) throw new Error(`Safety gate failed: confirm phrase.`);
  if (!executeAllowed) throw new Error(`Safety gate failed: ${TP_ACTIONS_REAL_EXECUTION_ENV}=true required.`);

  const context = await chromium.launchPersistentContext(profileDir, { headless, viewport: null });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const capturedAuth = await captureSessionAuth({ context, page, athleteId: SAFE_ATHLETE_ID });
    if (!capturedAuth.authorizationHeader) throw new Error("Authorization header was not observed.");
    const authHeaders = { authorization: capturedAuth.authorizationHeader };

    // --- Settings/zones READ (no mutation, zero risk) ---
    const settingsRes = await performApiJsonRequest({
      page, method: "GET",
      endpoint: `${API_HOST}/fitness/v1/athletes/${SAFE_ATHLETE_ID}/settings`,
      headers: { accept: "application/json", ...authHeaders },
    });
    console.log(`settings_get_status: ${settingsRes.status}`);
    const settingsBody = settingsRes.body as Record<string, unknown> | undefined;
    console.log(`settings_readable: ${settingsRes.ok}`);
    console.log(`settings_keys: ${settingsBody && typeof settingsBody === "object" ? Object.keys(settingsBody).length : 0}`);
    await writeFile(path.join(artifactDir, "settings-get.redacted.json"), `${JSON.stringify(redactUnknown({ response: settingsRes }), null, 2)}\n`, "utf8");

    // --- Events write round trip (create -> verify -> delete) ---
    // Body shape confirmed from nagelflorian/trainingpeaks-mcp-server src/api/events.ts createEvent().
    const createBody = {
      athleteId: SAFE_ATHLETE_ID,
      name: "PROBE TP EVENTS — DO NOT USE",
      eventDate: `${date}T00:00:00`,
      eventType: "Other",
      description: "SAFE_EVENT_PROBE_V0",
    };
    const createRes = await performApiJsonRequest({
      page, method: "POST",
      endpoint: `${API_HOST}/fitness/v6/athletes/${SAFE_ATHLETE_ID}/events`,
      headers: { accept: "application/json", "content-type": "application/json", ...authHeaders },
      body: createBody,
    });
    console.log(`event_create_status: ${createRes.status}`);
    await writeFile(path.join(artifactDir, "event-create.redacted.json"), `${JSON.stringify(redactUnknown({ body: createBody, response: createRes }), null, 2)}\n`, "utf8");

    const createdBody = createRes.body as Record<string, unknown> | undefined;
    const eventId = createdBody?.id ?? createdBody?.eventId ?? null;
    console.log(`event_id: ${String(eventId)}`);

    if (createRes.ok && eventId) {
      const deleteRes = await performApiJsonRequest({
        page, method: "DELETE",
        endpoint: `${API_HOST}/fitness/v6/athletes/${SAFE_ATHLETE_ID}/events/${eventId}`,
        headers: { accept: "application/json", ...authHeaders },
      });
      console.log(`event_delete_status: ${deleteRes.status}`);
      await writeFile(path.join(artifactDir, "event-delete.redacted.json"), `${JSON.stringify(redactUnknown({ response: deleteRes }), null, 2)}\n`, "utf8");
      console.log(`verdict_events: ${createRes.ok && deleteRes.ok ? "PASS — event create+delete both succeed" : "PARTIAL/FAIL"}`);
    } else {
      console.log(`verdict_events: FAIL — create did not return a usable event id (status ${createRes.status})`);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-probe-events-and-settings failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
