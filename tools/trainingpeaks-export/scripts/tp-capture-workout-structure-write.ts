/**
 * PASSIVE network capture to verify the IN-PLACE workout-structure edit request.
 *
 * This script SENDS NOTHING. It opens a headed browser on a SEPARATE, dedicated profile
 * (never the loop's persistent profile) and passively logs every mutating tpapi request
 * (POST/PUT/PATCH/DELETE) plus single-workout GETs, with tokens/cookies redacted. Igor
 * performs all mutations by hand in the TrainingPeaks UI on his own account (3102415),
 * on a disposable test workout.
 *
 * Output (redacted): reports/structure-write-capture/<ts>/events.jsonl (+ live console).
 * Nothing is written to TP or the DB. Does not touch or pause any launchagent loop.
 *
 * Run (headed; keep the window open while editing, close it when done):
 *   npx tsx tools/trainingpeaks-export/scripts/tp-capture-workout-structure-write.ts
 */
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { reportsRoot } from "./lib/paths.ts";
import { redactUnknown } from "./lib/trainingpeaks-api-move.ts";

const TP_APP = "https://app.trainingpeaks.com/#calendar/athletes/3102415";
const TP_API_HOST = "tpapi.trainingpeaks.com";
// dedicated capture profile — NOT the loop's persistent profile (paths.ts:profileDir)
const CAPTURE_PROFILE = path.join(reportsRoot, "capture-profiles", "structure-write");
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY = 200_000;

function tsForPath(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}
function pathOf(url: string): string { try { return new URL(url).pathname; } catch { return url; } }
function endpointPattern(p: string): string {
  return p.replace(/\/athletes\/\d+/gi, "/athletes/{athleteId}").replace(/\/workouts\/\d+/gi, "/workouts/{workoutId}").replace(/\b\d{4}-\d{2}-\d{2}\b/g, "{date}").replace(/\/\d{6,}/g, "/{id}");
}
function parseMaybeJson(text: string | null): unknown { if (!text) return null; try { return JSON.parse(text); } catch { return text.length > 500 ? text.slice(0, 500) + "…[non-json]" : text; } }

/** Is this a request we care about: a workout write, OR a single-workout GET (shows the object shape). */
function isRelevant(method: string, p: string): { relevant: boolean; kind: string } {
  const isWorkoutSingle = /\/workouts\/\d+(\b|\/|$)/i.test(p) && !/\/workouts\/\d{4}-\d{2}-\d{2}/.test(p);
  const isWorkoutsColl = /\/workouts(\?|$)/i.test(p);
  const isCommand = /\/commands\//i.test(p);
  if (MUTATING.has(method) && (isWorkoutSingle || isWorkoutsColl || isCommand)) return { relevant: true, kind: "WORKOUT-WRITE" };
  if (MUTATING.has(method) && p.includes("/fitness/")) return { relevant: true, kind: "OTHER-MUTATION" };
  if (method === "GET" && isWorkoutSingle) return { relevant: true, kind: "workout-GET(shape)" };
  return { relevant: false, kind: "" };
}

async function main(): Promise<void> {
  const outDir = path.join(reportsRoot, "structure-write-capture", tsForPath(new Date()));
  await mkdir(CAPTURE_PROFILE, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const eventsPath = path.join(outDir, "events.jsonl");
  await writeFile(eventsPath, "", "utf8");

  console.log("=".repeat(78));
  console.log("PASSIVE CAPTURE — workout structure in-place edit. THIS SCRIPT SENDS NOTHING.");
  console.log("=".repeat(78));
  console.log(`profile (separate, not the loop's): ${CAPTURE_PROFILE}`);
  console.log(`events (redacted): ${eventsPath}`);
  console.log("Tokens/cookies are redacted and never saved. Do your edits in the opened window.");
  console.log("Close the browser window when finished — capture stops on close.\n");

  const context = await chromium.launchPersistentContext(CAPTURE_PROFILE, { headless: false, viewport: null });

  let n = 0;
  context.on("requestfinished", async (request) => {
    const method = request.method().toUpperCase();
    const url = request.url();
    if (!url.includes(TP_API_HOST)) return;
    const p = pathOf(url);
    const { relevant, kind } = isRelevant(method, p);
    if (!relevant) return;
    let status: number | null = null; let respBody: unknown = null;
    try { const resp = await request.response(); status = resp?.status() ?? null; if (resp) { const txt = (await resp.text()).slice(0, MAX_BODY); respBody = redactUnknown(parseMaybeJson(txt)); } } catch { /* ignore */ }
    const reqBodyRaw = request.postData();
    const event = {
      seq: ++n,
      at: new Date().toISOString(),
      kind,
      method,
      pathname: p,
      endpointPattern: endpointPattern(p),
      contentType: request.headers()["content-type"] ?? null,
      requestHeaders: redactUnknown(request.headers()),
      requestBody: redactUnknown(parseMaybeJson(reqBodyRaw ? reqBodyRaw.slice(0, MAX_BODY) : null)),
      responseStatus: status,
      responseBody: respBody,
    };
    await appendFile(eventsPath, JSON.stringify(event) + "\n", "utf8");
    console.log(`[${event.seq}] ${kind}  ${method} ${event.endpointPattern}  → ${status ?? "?"}${reqBodyRaw ? "  (body " + reqBodyRaw.length + "b)" : ""}`);
  });
  context.on("requestfailed", (request) => {
    const url = request.url(); if (!url.includes(TP_API_HOST)) return; const method = request.method().toUpperCase(); const p = pathOf(url);
    if (isRelevant(method, p).relevant) console.log(`[fail] ${method} ${endpointPattern(p)} — ${request.failure()?.errorText ?? "?"}`);
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(TP_APP).catch(() => { console.log("(navigate to TrainingPeaks manually if the page didn't load)"); });

  await new Promise<void>((resolve) => { context.on("close", () => resolve()); });
  console.log(`\nCapture ended. ${n} relevant request(s) logged → ${eventsPath}`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
