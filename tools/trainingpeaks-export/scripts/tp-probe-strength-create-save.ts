import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { captureSessionAuth, performApiJsonRequest, redactUnknown } from "./lib/trainingpeaks-api-move.ts";

/**
 * PR1 task 2 — resolve TrainingPeaks structured-strength persistence.
 *
 * Prior reverse-engineering (this repo's earlier probe work, see plan §B) built a
 * multi-step draft flow against api.peakswaresb.com (create shell -> add block ->
 * add exercise -> PUT) that returns HTTP 200 with an echoed object every step but
 * NEVER PERSISTS: the draft stays `complianceState: "Unplanned"` with a UUID id,
 * a follow-up GET 404s, and the workout never appears on the TP calendar.
 *
 * The open-source nagelflorian/trainingpeaks-mcp-server (same cookie -> bearer
 * auth as this repo) resolves this with a SINGLE atomic call:
 *
 *   POST https://api.peakswaresb.com/rx/activity/v1/workouts/save
 *
 * The full workout object (blocks/prescriptions/sets, all with client-generated
 * UUIDs) is POSTed in one shot to `/save` -- not built incrementally via the
 * create+add+add+PUT dance. This script replicates that exact shape and proves
 * persistence: create -> GET by the returned id (expected numeric, not UUID) ->
 * confirm complianceState flips to a planned/non-"Unplanned" state.
 *
 * There is no delete endpoint for structured strength in nagelflorian's source
 * either (only create_strength_workout + get_strength_workout_summary tools
 * exist there). This script attempts a best-effort DELETE against the same host
 * as a bonus probe, but a failure there is EXPECTED and non-fatal -- manual
 * deletion via the TP UI is the documented fallback for cleanup (safe test
 * athlete only, so a leftover test workout carries no real-athlete risk).
 *
 * PR1 RESULT (2026-07-12, athlete 3102415, date 2026-12-31): full round trip
 * PASSED. POST /save -> HTTP 200, returned id "22291958" (numeric, not UUID),
 * complianceState "NoCompletion" (planned state, not "Unplanned"). GET by that
 * id -> HTTP 200, blocks=1 (persisted). Best-effort DELETE -> HTTP 200 (worked,
 * better than expected -- nagelflorian has no delete tool for this). Follow-up
 * GET after delete -> HTTP 404 (confirmed gone). This resolves plan §B: the
 * missing call was the single atomic POST /save, not the multi-step
 * create+add+add+PUT draft flow used by the earlier (non-persisting) attempt.
 */

const SAFE_ATHLETE_ID = 3102415;
const REQUIRED_CONFIRM = "PROBE TP STRENGTH SAVE";
const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";
const STRENGTH_HOST = "https://api.peakswaresb.com";

type CliArgs = {
  athleteId: number;
  date: string;
  apply: boolean;
  confirm: string | null;
  headless: boolean;
};

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseDateOrThrow(input: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error(`Invalid --date "${input}". Expected YYYY-MM-DD.`);
  }
}

function isFutureDateOnly(dateIso: string): boolean {
  parseDateOrThrow(dateIso);
  const target = new Date(`${dateIso}T00:00:00.000Z`);
  const now = new Date();
  const todayUtcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return target.getTime() > todayUtcStart;
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
  if (!Number.isFinite(parsed.athleteId) || parsed.athleteId <= 0) {
    throw new Error("Invalid --athlete-id.");
  }
  return parsed;
}

// Minimal single-exercise StructuredStrength body, shaped exactly like
// nagelflorian's createStrengthWorkout() -- one block, one prescription,
// one set, using a known runner-catalog exercise id + video from this
// session's earlier read-probe of api.peakswaresb.com.
function buildStrengthSaveBody(athleteId: number, date: string) {
  const exerciseId = "26"; // "Single Leg Calf Raise" (ownerId 2000301, has videoUrl) — confirmed read this session
  const setId = randomUUID();
  const prescriptionId = randomUUID();
  const blockId = randomUUID();
  const workoutId = randomUUID(); // pre-save placeholder id; /save is expected to replace it

  return {
    workoutType: "StructuredStrength" as const,
    lastUpdatedAt: null,
    compliancePercent: 0,
    rpe: null,
    feel: null,
    blocks: [
      {
        id: blockId,
        blockType: "SingleExercise" as const,
        title: "Single Leg Calf Raise",
        coachNotes: null,
        isComplete: false,
        compliancePercent: 0,
        parameters: [],
        prescriptions: [
          {
            id: prescriptionId,
            exercise: {
              id: exerciseId,
              ownerId: 2000301,
              title: "Single Leg Calf Raise",
              videoUrl: "https://youtu.be/jRB58gIRAyU",
              instructions: null,
              parameters: [
                {
                  parameter: "RepsPerSide",
                  title: "Reps/side",
                  unit: { title: "Reps", abbreviation: "", unit: "Reps" },
                  category: "Reps/side",
                  id: "0",
                },
              ],
              canEdit: false,
            },
            parameters: [
              {
                parameter: "RepsPerSide",
                title: "Reps/side",
                unit: { title: "Reps", abbreviation: "", unit: "Reps" },
                category: "Reps/side",
                id: randomUUID(),
              },
            ],
            sets: [
              {
                id: setId,
                isComplete: false,
                setOrigin: "Prescribed" as const,
                parameterValues: [
                  {
                    id: randomUUID(),
                    parameter: "RepsPerSide",
                    inputFormat: "Integer" as const,
                    prescribedValue: "12",
                    executedValue: null,
                  },
                ],
              },
            ],
            coachNotes: null,
            compliancePercent: 0,
            setSummaryTemplate: "{RepsPerSide} Reps/side",
          },
        ],
      },
    ],
    snapshot: {
      totalBlocks: 1,
      completedBlocks: 0,
      totalSets: 1,
      completedSets: 0,
      totalPrescriptions: 1,
      completedPrescriptions: 0,
    },
    prescribedDate: date,
    prescribedStartTime: null,
    startDateTime: null,
    completedDateTime: null,
    calendarId: athleteId,
    title: "PROBE TP STRENGTH SAVE — DO NOT USE",
    instructions: "PR1_STRENGTH_SAVE_PROBE",
    prescribedDurationInSeconds: null,
    orderOnDay: null,
    executedDurationInSeconds: null,
    isLocked: false,
    isHidden: false,
    workoutSubTypeId: null,
    id: workoutId,
  };
}

function getRepoReportsRoot(): string {
  return path.resolve(toolRoot, "..", "..", "reports");
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const executeAllowed = args.apply && isTruthyEnvFlag(process.env[TP_ACTIONS_REAL_EXECUTION_ENV]);
  const artifactDir = path.join(getRepoReportsRoot(), "strength-save-probe", timestampForPath(new Date()));
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

  const saveBody = buildStrengthSaveBody(args.athleteId, args.date);

  if (!args.apply) {
    await writeFile(
      path.join(artifactDir, "dry-run-body.redacted.json"),
      `${JSON.stringify(redactUnknown({ endpoint: `${STRENGTH_HOST}/rx/activity/v1/workouts/save`, method: "POST", body: saveBody }), null, 2)}\n`,
      "utf8",
    );
    console.log("(dry-run) no network write performed.");
    console.log(`To apply: --apply --confirm "${REQUIRED_CONFIRM}" (requires ${TP_ACTIONS_REAL_EXECUTION_ENV}=true)`);
    return;
  }

  for (const [name, result] of Object.entries(guards)) {
    if (!result.pass) throw new Error(`Safety gate failed: ${name}. ${result.details}`);
  }

  const context = await chromium.launchPersistentContext(profileDir, { headless: args.headless, viewport: null });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const capturedAuth = await captureSessionAuth({ context, page, athleteId: args.athleteId });
    if (!capturedAuth.authorizationHeader) {
      throw new Error("Authorization header was not observed from TP API requests.");
    }
    const authHeaders = { authorization: capturedAuth.authorizationHeader };

    // Step 1: single atomic POST /save (this is the fix vs the old multi-step draft flow).
    const saveResult = await performApiJsonRequest({
      page,
      method: "POST",
      endpoint: `${STRENGTH_HOST}/rx/activity/v1/workouts/save`,
      headers: { accept: "application/json, text/javascript, */*; q=0.01", "content-type": "application/json", ...authHeaders },
      body: saveBody,
    });
    await writeFile(
      path.join(artifactDir, "save-request.redacted.json"),
      `${JSON.stringify(redactUnknown({ endpoint: `${STRENGTH_HOST}/rx/activity/v1/workouts/save`, body: saveBody, response: saveResult }), null, 2)}\n`,
      "utf8",
    );
    console.log(`POST /workouts/save status: ${saveResult.status}`);
    if (!saveResult.ok) throw new Error(`POST /save failed with status ${saveResult.status}`);

    const responseBody = (saveResult.body as { data?: Record<string, unknown> } | undefined)?.data;
    const returnedId = responseBody?.id;
    const complianceState = responseBody?.complianceState;
    const isNumericId = typeof returnedId === "string" && /^\d+$/.test(returnedId);
    console.log(`returned_id: ${String(returnedId)}`);
    console.log(`returned_id_is_numeric: ${isNumericId}`);
    console.log(`complianceState_after_save: ${String(complianceState)}`);

    // Step 2: independent GET verification (does it persist? is it addressable by id?)
    let verifyStatus: number | null = null;
    let verifyBlocks = 0;
    let verifyComplianceState: unknown = null;
    if (typeof returnedId === "string") {
      const verifyResult = await performApiJsonRequest({
        page,
        method: "GET",
        endpoint: `${STRENGTH_HOST}/rx/activity/v1/workouts/${returnedId}`,
        headers: { accept: "application/json, text/javascript, */*; q=0.01", ...authHeaders },
      });
      verifyStatus = verifyResult.status;
      const verifyData = (verifyResult.body as { data?: Record<string, unknown> } | undefined)?.data;
      verifyBlocks = Array.isArray(verifyData?.blocks) ? (verifyData!.blocks as unknown[]).length : 0;
      verifyComplianceState = verifyData?.complianceState;
      await writeFile(
        path.join(artifactDir, "verify-get.redacted.json"),
        `${JSON.stringify(redactUnknown({ endpoint: `${STRENGTH_HOST}/rx/activity/v1/workouts/${returnedId}`, response: verifyResult }), null, 2)}\n`,
        "utf8",
      );
    }
    console.log(`verify_get_status: ${verifyStatus}`);
    console.log(`verify_blocks_count: ${verifyBlocks}`);
    console.log(`verify_complianceState: ${String(verifyComplianceState)}`);

    const persisted = verifyStatus === 200 && verifyBlocks > 0;
    console.log(`persisted: ${persisted}`);
    console.log(
      persisted
        ? "verdict: PASS — /rx/activity/v1/workouts/save persists a structured strength workout, addressable by its returned id."
        : "verdict: FAIL — save did not persist (matches the old draft-only behavior); investigate further before using in PR5.",
    );
    console.log("MANUAL STEP: open the TP calendar for athlete " + args.athleteId + " on " + args.date + " and confirm the workout is visible with the exercise + video, then delete it (best-effort DELETE attempted below; UI delete is the documented fallback).");

    // Best-effort delete (bonus probe; failure here is expected/non-fatal, see header comment).
    if (typeof returnedId === "string") {
      const deleteResult = await performApiJsonRequest({
        page,
        method: "DELETE",
        endpoint: `${STRENGTH_HOST}/rx/activity/v1/workouts/${returnedId}`,
        headers: { accept: "application/json, text/javascript, */*; q=0.01", ...authHeaders },
      });
      console.log(`best_effort_delete_status: ${deleteResult.status}`);
      await writeFile(
        path.join(artifactDir, "best-effort-delete.redacted.json"),
        `${JSON.stringify(redactUnknown({ endpoint: `${STRENGTH_HOST}/rx/activity/v1/workouts/${returnedId}`, response: deleteResult }), null, 2)}\n`,
        "utf8",
      );
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-probe-strength-create-save failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
