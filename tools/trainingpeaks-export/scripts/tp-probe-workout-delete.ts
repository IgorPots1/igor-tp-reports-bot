import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { buildSafeRunningWorkoutDefinition } from "./lib/running-workout-safe-runner-v0.ts";
import { buildRunningWorkoutCreatePlan } from "./lib/running-workout-create-plan.ts";
import { captureSessionAuth, performApiJsonRequest, redactUnknown, buildTpApiWorkoutUrl } from "./lib/trainingpeaks-api-move.ts";
import { buildCreateWorkoutUrl, readWorkoutIdFromBody } from "./lib/trainingpeaks-api-create-workout.ts";

/**
 * PR1 task 1 (❓ row) — verify DELETE /fitness/v6/athletes/{id}/workouts/{workoutId}
 * on the primary tpapi host (cardio workout, NOT the peakswaresb strength host —
 * see tp-probe-strength-create-save.ts for that one). Endpoint confirmed to exist
 * in nagelflorian/trainingpeaks-mcp-server (src/api/workouts.ts); this proves it
 * against our own account/safe-athlete session.
 *
 * Round trip: create a disposable running workout via the existing safe-create
 * harness -> GET verify it exists -> DELETE -> GET verify it is gone (404/403).
 *
 * PR1 RESULT (2026-07-12, athlete 3102415, date 2026-12-30): full round trip
 * PASSED. Create -> workoutId 3840679213. DELETE -> HTTP 200, body `true`.
 * IMPORTANT: the follow-up GET-by-id does NOT return 404/403 -- it returns
 * HTTP 400 with body "Invalid workoutId (<id>)". Confirmed truly gone via the
 * day-range list endpoint instead (0 workouts, id absent). The `gone` check
 * below accounts for this (400 + "Invalid workoutId" body counts as gone).
 */

const SAFE_ATHLETE_ID = 3102415;
const REQUIRED_CONFIRM = "PROBE TP WORKOUT DELETE";
const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";

type CliArgs = { athleteId: number; date: string; apply: boolean; confirm: string | null; headless: boolean };

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
function parseDateOrThrow(input: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error(`Invalid --date "${input}". Expected YYYY-MM-DD.`);
}
function isFutureDateOnly(dateIso: string): boolean {
  parseDateOrThrow(dateIso);
  const target = new Date(`${dateIso}T00:00:00.000Z`);
  const now = new Date();
  return target.getTime() > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
function readRequiredNextArg(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (!next) throw new Error(`Missing value after ${flag}`);
  return next.trim();
}
function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { athleteId: SAFE_ATHLETE_ID, date: "", apply: false, confirm: null, headless: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--athlete-id") { parsed.athleteId = Number(readRequiredNextArg(argv, index, arg)); index += 1; continue; }
    if (arg === "--date") { parsed.date = readRequiredNextArg(argv, index, arg); index += 1; continue; }
    if (arg === "--apply") { parsed.apply = true; continue; }
    if (arg === "--confirm") { parsed.confirm = readRequiredNextArg(argv, index, arg); index += 1; continue; }
    if (arg === "--headed") { parsed.headless = false; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!parsed.date) throw new Error("Missing required --date=YYYY-MM-DD.");
  parseDateOrThrow(parsed.date);
  return parsed;
}
function getRepoReportsRoot(): string { return path.resolve(toolRoot, "..", "..", "reports"); }
function timestampForPath(date: Date): string { return date.toISOString().replace(/[:.]/g, "-").slice(0, 19); }

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const executeAllowed = args.apply && isTruthyEnvFlag(process.env[TP_ACTIONS_REAL_EXECUTION_ENV]);
  const artifactDir = path.join(getRepoReportsRoot(), "workout-delete-probe", timestampForPath(new Date()));
  await mkdir(artifactDir, { recursive: true });

  const guards = {
    safeAthleteOnly: { pass: args.athleteId === SAFE_ATHLETE_ID, details: `athlete_id=${args.athleteId}` },
    futureDateOnly: { pass: isFutureDateOnly(args.date), details: `date=${args.date}` },
    applyConfirmPhrase: { pass: !args.apply || args.confirm === REQUIRED_CONFIRM, details: "confirm phrase" },
    applyEnvGuard: { pass: !args.apply || executeAllowed, details: `${TP_ACTIONS_REAL_EXECUTION_ENV}=true required` },
  };

  console.log(`dry_run: ${!args.apply}`);
  console.log(`athlete_id: ${args.athleteId}`);
  console.log(`date: ${args.date}`);
  console.log(`report_directory: ${artifactDir}`);

  if (!args.apply) {
    console.log("(dry-run) no network write performed.");
    console.log(`To apply: --apply --confirm "${REQUIRED_CONFIRM}" (requires ${TP_ACTIONS_REAL_EXECUTION_ENV}=true)`);
    return;
  }
  for (const [name, result] of Object.entries(guards)) {
    if (!result.pass) throw new Error(`Safety gate failed: ${name}. ${result.details}`);
  }

  const definition = buildSafeRunningWorkoutDefinition({
    template: "easy-pace",
    athleteId: args.athleteId,
    workoutDay: args.date,
    title: "PROBE TP WORKOUT DELETE — DO NOT USE",
    description: "SAFE_RUN_WORKOUT_V0 delete-probe",
    coachComments: "SAFE_RUN_WORKOUT_V0",
  });
  const createPlan = buildRunningWorkoutCreatePlan(definition);
  const createEndpoint = buildCreateWorkoutUrl(args.athleteId);

  const context = await chromium.launchPersistentContext(profileDir, { headless: args.headless, viewport: null });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const capturedAuth = await captureSessionAuth({ context, page, athleteId: args.athleteId });
    if (!capturedAuth.authorizationHeader) throw new Error("Authorization header was not observed.");
    const authHeaders = { authorization: capturedAuth.authorizationHeader };

    const createBody = {
      athleteId: createPlan.requestBodyCandidate.athleteId,
      workoutDay: createPlan.requestBodyCandidate.workoutDay,
      workoutId: 0,
      title: createPlan.requestBodyCandidate.title,
      workoutTypeValueId: createPlan.requestBodyCandidate.workoutTypeValueId,
      workoutSubTypeId: createPlan.requestBodyCandidate.workoutSubTypeId,
      description: createPlan.requestBodyCandidate.description,
      coachComments: createPlan.requestBodyCandidate.coachComments,
      distancePlanned: createPlan.requestBodyCandidate.distancePlanned,
      totalTimePlanned: createPlan.requestBodyCandidate.totalTimePlanned,
      structure: createPlan.requestBodyCandidate.structure,
    };
    const createResult = await performApiJsonRequest({
      page, method: "POST", endpoint: createEndpoint,
      headers: { accept: "application/json, text/javascript, */*; q=0.01", "content-type": "application/json", ...authHeaders },
      body: createBody,
    });
    await writeFile(path.join(artifactDir, "create.redacted.json"), `${JSON.stringify(redactUnknown({ body: createBody, response: createResult }), null, 2)}\n`, "utf8");
    if (!createResult.ok) throw new Error(`POST create failed with status ${createResult.status}`);
    const workoutId = readWorkoutIdFromBody(createResult.body);
    if (!workoutId) throw new Error("POST response missing workoutId.");
    console.log(`created_workout_id: ${workoutId}`);

    const workoutEndpoint = buildTpApiWorkoutUrl(args.athleteId, workoutId);
    const verifyBefore = await performApiJsonRequest({ page, method: "GET", endpoint: workoutEndpoint, headers: { accept: "application/json", ...authHeaders } });
    console.log(`verify_before_delete_status: ${verifyBefore.status}`);

    const deleteResult = await performApiJsonRequest({ page, method: "DELETE", endpoint: workoutEndpoint, headers: { accept: "application/json", ...authHeaders } });
    console.log(`delete_status: ${deleteResult.status}`);
    await writeFile(path.join(artifactDir, "delete.redacted.json"), `${JSON.stringify(redactUnknown({ endpoint: workoutEndpoint, response: deleteResult }), null, 2)}\n`, "utf8");

    const verifyAfter = await performApiJsonRequest({ page, method: "GET", endpoint: workoutEndpoint, headers: { accept: "application/json", ...authHeaders } });
    // NOTE: tpapi returns HTTP 400 with body "Invalid workoutId (<id>)" for a
    // deleted/nonexistent id -- NOT 404/403 as one might assume. Confirmed empirically.
    const bodyIsInvalidIdMessage = typeof verifyAfter.body === "string" && verifyAfter.body.startsWith("Invalid workoutId");
    const gone = verifyAfter.status === 404 || verifyAfter.status === 403 || (verifyAfter.status === 400 && bodyIsInvalidIdMessage);
    console.log(`verify_after_delete_status: ${verifyAfter.status}`);
    console.log(`gone: ${gone}`);
    console.log(`verdict: ${deleteResult.ok && gone ? "PASS — DELETE removes the workout" : "FAIL"}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-probe-workout-delete failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
