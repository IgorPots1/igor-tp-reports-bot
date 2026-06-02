import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import {
  buildRunningWorkoutCreatePlan,
  type TrainingPeaksCreateWorkoutPlan,
} from "./lib/running-workout-create-plan.ts";
import { type RunningWorkoutDefinition } from "./lib/running-workout-renderer.ts";
import {
  captureSessionAuth,
  redactUnknown,
} from "./lib/trainingpeaks-api-move.ts";
import {
  buildCreateWorkoutUrl,
  buildWorkoutByIdUrl,
  buildWorkoutsByDayRangeUrl,
  performApiJsonRequest,
  readWorkoutIdFromBody,
} from "./lib/trainingpeaks-api-create-workout.ts";

type CliArgs = {
  caseId: string;
  athleteId: number;
  date: string;
  apply: boolean;
  confirm: string | null;
  headless: boolean;
};

type ProofWorkoutSpec = {
  safeAthleteId: number;
  caseId: "easy-pace";
  title: string;
  description: string;
  stepNote: string;
  confirmPhrase: string;
};

type PreflightArtifact = {
  mode: "dry-run" | "apply";
  executeAllowed: boolean;
  safetyChecks: Record<string, { pass: boolean; details: string }>;
  date: string;
  endpoint: string;
  requestSummary: TrainingPeaksCreateWorkoutPlan["requestBodySummary"];
  existingDayWorkouts: {
    attempted: boolean;
    status: number | null;
    count: number | null;
    warning: string | null;
  };
};

const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";
const SAFE_PROOF: ProofWorkoutSpec = {
  safeAthleteId: 3102415,
  caseId: "easy-pace",
  title: "API CREATE PROOF EASY PACE DO NOT USE",
  description: "API_CREATE_PROOF_DESC_EASY_PACE",
  stepNote: "API_CREATE_PROOF_STEP_NOTE_EASY_PACE",
  confirmPhrase: "CREATE TEST RUN WORKOUT",
};
const ACTION_ARTIFACTS_ROOT = path.join(toolRoot, "reports", "tp-api-create-running-workout-proof");
const DEFAULT_HEADLESS = true;

function printHelp(): void {
  console.log("Controlled API Create Proof: Easy Pace Running Workout");
  console.log("");
  console.log("Usage (dry-run, default):");
  console.log("  npm run tp-api-create-running-workout-proof -- --case easy-pace --athlete-id 3102415 --date YYYY-MM-DD");
  console.log("");
  console.log("Usage (live apply, guarded):");
  console.log(
    '  TP_ACTIONS_REAL_EXECUTION=true npm run tp-api-create-running-workout-proof -- --case easy-pace --athlete-id 3102415 --date YYYY-MM-DD --apply --confirm "CREATE TEST RUN WORKOUT"',
  );
  console.log("");
  console.log("Safety rules:");
  console.log("  - dry-run is default; no POST is sent unless all apply gates pass");
  console.log("  - safe athlete only: 3102415");
  console.log("  - safe case only: easy-pace");
  console.log('  - typed confirmation required: --confirm "CREATE TEST RUN WORKOUT"');
  console.log("  - TP_ACTIONS_REAL_EXECUTION=true required for live POST");
  console.log("  - target date must be in the future (not today)");
  console.log("  - request/response artifacts are redacted");
}

function timestampForPath(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseDateOrThrow(input: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error(`Invalid --date "${input}". Expected YYYY-MM-DD.`);
  }
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --date "${input}".`);
  }
  return parsed;
}

function isFutureDateOnly(dateIso: string): boolean {
  const target = parseDateOrThrow(dateIso);
  const now = new Date();
  const todayUtcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return target.getTime() > todayUtcStart;
}

function readRequiredNextArg(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (!next) {
    throw new Error(`Missing value after ${flag}`);
  }
  const value = next.trim();
  if (!value) {
    throw new Error(`Empty ${flag} value.`);
  }
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    caseId: SAFE_PROOF.caseId,
    athleteId: SAFE_PROOF.safeAthleteId,
    date: "",
    apply: false,
    confirm: null,
    headless: DEFAULT_HEADLESS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--case=")) {
      parsed.caseId = arg.slice("--case=".length).trim();
      continue;
    }
    if (arg === "--case") {
      parsed.caseId = readRequiredNextArg(argv, index, "--case");
      index += 1;
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      parsed.athleteId = Number(arg.slice("--athlete-id=".length));
      continue;
    }
    if (arg === "--athlete-id") {
      parsed.athleteId = Number(readRequiredNextArg(argv, index, "--athlete-id"));
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      parsed.date = arg.slice("--date=".length).trim();
      continue;
    }
    if (arg === "--date") {
      parsed.date = readRequiredNextArg(argv, index, "--date");
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      parsed.confirm = arg.slice("--confirm=".length);
      continue;
    }
    if (arg === "--confirm") {
      parsed.confirm = readRequiredNextArg(argv, index, "--confirm");
      index += 1;
      continue;
    }
    if (arg === "--headed") {
      parsed.headless = false;
      continue;
    }
    if (arg === "--headless") {
      parsed.headless = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.date) {
    throw new Error("Missing required --date=YYYY-MM-DD.");
  }
  parseDateOrThrow(parsed.date);

  if (!Number.isFinite(parsed.athleteId) || parsed.athleteId <= 0) {
    throw new Error("Invalid --athlete-id. Expected positive integer.");
  }

  return parsed;
}

function buildDefinitionFromProof(args: CliArgs): RunningWorkoutDefinition {
  return {
    caseId: SAFE_PROOF.caseId,
    athleteId: args.athleteId,
    workoutDay: args.date,
    title: SAFE_PROOF.title,
    description: SAFE_PROOF.description,
    workoutTypeValueId: 3,
    workoutSubTypeId: null,
    blocks: [
      {
        kind: "step",
        label: "Active",
        durationSeconds: 1800,
        intensityClass: "active",
        target: {
          metric: "percentOfThresholdPace",
          minValue: 75,
          maxValue: 85,
        },
        notes: SAFE_PROOF.stepNote,
      },
    ],
  };
}

function pickObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function findArrayFromUnknown(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];
  const record = input as Record<string, unknown>;
  for (const key of ["data", "items", "workouts", "results"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function parseStructureForChecks(serialized: string): {
  parseable: boolean;
  metricOk: boolean;
  rangeOk: boolean;
  noteOk: boolean;
  noRepetition: boolean;
  details: string;
} {
  try {
    const parsed = JSON.parse(serialized) as {
      primaryIntensityMetric?: unknown;
      structure?: Array<{ type?: string; steps?: Array<{ notes?: string; targets?: Array<{ minValue?: unknown; maxValue?: unknown }> }> }>;
    };
    const metricOk = parsed.primaryIntensityMetric === "percentOfThresholdPace";
    const structure = Array.isArray(parsed.structure) ? parsed.structure : [];
    const noRepetition = structure.every((entry) => entry.type !== "repetition");

    const targets: Array<{ minValue: number; maxValue: number }> = [];
    const notes: string[] = [];
    for (const block of structure) {
      const steps = Array.isArray(block.steps) ? block.steps : [];
      for (const step of steps) {
        if (typeof step.notes === "string") notes.push(step.notes);
        const firstTarget = Array.isArray(step.targets) ? step.targets[0] : null;
        if (
          firstTarget &&
          typeof firstTarget === "object" &&
          typeof firstTarget.minValue === "number" &&
          typeof firstTarget.maxValue === "number"
        ) {
          targets.push({ minValue: firstTarget.minValue, maxValue: firstTarget.maxValue });
        }
      }
    }

    const rangeOk = targets.some((item) => item.minValue === 75 && item.maxValue === 85);
    const noteOk = notes.some((value) => value.includes(SAFE_PROOF.stepNote));
    return {
      parseable: true,
      metricOk,
      rangeOk,
      noteOk,
      noRepetition,
      details: `targets=${targets.map((x) => `${x.minValue}-${x.maxValue}`).join(",") || "none"} notes=${notes.length}`,
    };
  } catch {
    return {
      parseable: false,
      metricOk: false,
      rangeOk: false,
      noteOk: false,
      noRepetition: false,
      details: "structure is not parseable JSON",
    };
  }
}

function mustPass(checks: Record<string, { pass: boolean; details: string }>, name: string): void {
  if (!checks[name]?.pass) {
    throw new Error(`Safety gate failed: ${name}. ${checks[name]?.details ?? ""}`.trim());
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode: "dry-run" | "apply" = args.apply ? "apply" : "dry-run";
  const executeAllowed = args.apply && isTruthyEnvFlag(process.env[TP_ACTIONS_REAL_EXECUTION_ENV]);
  const timestamp = timestampForPath(new Date());
  const artifactDir = path.join(ACTION_ARTIFACTS_ROOT, timestamp);
  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  const preflightPath = path.join(artifactDir, "PREFLIGHT.json");
  const requestPath = path.join(artifactDir, "REQUEST_REDACTED.json");
  const responsePath = path.join(artifactDir, "RESPONSE_REDACTED.json");
  const verifyPath = path.join(artifactDir, "VERIFY.json");

  const definition = buildDefinitionFromProof(args);
  const plan = buildRunningWorkoutCreatePlan(definition);
  const structureChecks = parseStructureForChecks(plan.requestBodyCandidate.structure);
  const title = plan.requestBodyCandidate.title;

  const safetyChecks: Record<string, { pass: boolean; details: string }> = {
    safeAthleteOnly: {
      pass: args.athleteId === SAFE_PROOF.safeAthleteId,
      details: `athleteId=${args.athleteId}; expected=${SAFE_PROOF.safeAthleteId}`,
    },
    safeCaseOnly: {
      pass: args.caseId === SAFE_PROOF.caseId,
      details: `case=${args.caseId}; expected=${SAFE_PROOF.caseId}`,
    },
    titleGuard: {
      pass: title.includes("API CREATE PROOF") && title.includes("DO NOT USE"),
      details: `title=${title}`,
    },
    futureDateOnly: {
      pass: isFutureDateOnly(args.date),
      details: `date=${args.date}; must be future day`,
    },
    structureParseable: {
      pass: structureChecks.parseable,
      details: structureChecks.details,
    },
    structureMetric: {
      pass: structureChecks.metricOk,
      details: "expected metric=percentOfThresholdPace",
    },
    structureRange: {
      pass: structureChecks.rangeOk,
      details: "expected one target range=75-85",
    },
    structureNoteMarker: {
      pass: structureChecks.noteOk,
      details: `expected note marker=${SAFE_PROOF.stepNote}`,
    },
    structureNoRepetition: {
      pass: structureChecks.noRepetition,
      details: "easy-pace proof must not contain repetition blocks",
    },
    applyConfirmPhrase: {
      pass: !args.apply || args.confirm === SAFE_PROOF.confirmPhrase,
      details: `confirm=${args.confirm ?? "null"}; expected="${SAFE_PROOF.confirmPhrase}"`,
    },
    applyEnvGuard: {
      pass: !args.apply || executeAllowed,
      details: `${TP_ACTIONS_REAL_EXECUTION_ENV} must be true for apply`,
    },
  };

  const endpoint = buildCreateWorkoutUrl(args.athleteId);
  const listEndpoint = buildWorkoutsByDayRangeUrl(args.athleteId, args.date);
  const preflightBase: PreflightArtifact = {
    mode,
    executeAllowed,
    safetyChecks,
    date: args.date,
    endpoint,
    requestSummary: plan.requestBodySummary,
    existingDayWorkouts: {
      attempted: false,
      status: null,
      count: null,
      warning: null,
    },
  };

  console.log(`[tp-api-create-running-workout-proof] mode=${mode}`);
  console.log(`[tp-api-create-running-workout-proof] athleteId=${args.athleteId} case=${args.caseId} date=${args.date}`);
  console.log(`[tp-api-create-running-workout-proof] artifacts=${artifactDir}`);

  if (!args.apply) {
    await writeFile(preflightPath, `${JSON.stringify(redactUnknown(preflightBase), null, 2)}\n`, "utf8");
    await writeFile(requestPath, `${JSON.stringify(redactUnknown(plan.requestBodyCandidate), null, 2)}\n`, "utf8");
    console.log("dry-run summary:");
    console.log(`- title: ${plan.requestBodyCandidate.title}`);
    console.log(`- workoutTypeValueId: ${plan.requestBodyCandidate.workoutTypeValueId}`);
    console.log(`- totalTimePlanned: ${plan.requestBodyCandidate.totalTimePlanned}`);
    console.log("- network calls: no");
    console.log(`- preflight artifact: ${preflightPath}`);
    console.log(`- request artifact: ${requestPath}`);
    console.log("dry-run complete. POST not sent.");
    return;
  }

  for (const key of Object.keys(safetyChecks)) {
    mustPass(safetyChecks, key);
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.bringToFront();

    const capturedAuth = await captureSessionAuth({
      context,
      page,
      athleteId: args.athleteId,
    });
    const authHeaders: Record<string, string> = {};
    if (capturedAuth.authorizationHeader) {
      authHeaders.authorization = capturedAuth.authorizationHeader;
    }
    if (!capturedAuth.authorizationHeader) {
      throw new Error("Authorization header was not observed from TP API requests.");
    }

    const preflightList = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint: listEndpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        ...authHeaders,
      },
    });
    const dayItems = findArrayFromUnknown(preflightList.body);
    preflightBase.existingDayWorkouts = {
      attempted: true,
      status: preflightList.status,
      count: dayItems.length,
      warning: dayItems.length > 0 ? "target date already has existing workouts" : null,
    };
    await writeFile(preflightPath, `${JSON.stringify(redactUnknown(preflightBase), null, 2)}\n`, "utf8");

    const requestBody = {
      athleteId: plan.requestBodyCandidate.athleteId,
      workoutDay: plan.requestBodyCandidate.workoutDay,
      workoutId: 0,
      title: plan.requestBodyCandidate.title,
      workoutTypeValueId: plan.requestBodyCandidate.workoutTypeValueId,
      workoutSubTypeId: plan.requestBodyCandidate.workoutSubTypeId,
      description: plan.requestBodyCandidate.description,
      coachComments: plan.requestBodyCandidate.coachComments,
      distancePlanned: plan.requestBodyCandidate.distancePlanned,
      totalTimePlanned: plan.requestBodyCandidate.totalTimePlanned,
      structure: plan.requestBodyCandidate.structure,
    };

    await writeFile(requestPath, `${JSON.stringify(redactUnknown(requestBody), null, 2)}\n`, "utf8");

    const postResult = await performApiJsonRequest({
      page,
      method: "POST",
      endpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json",
        ...authHeaders,
      },
      body: requestBody,
    });

    await writeFile(
      responsePath,
      `${JSON.stringify(
        redactUnknown({
          status: postResult.status,
          ok: postResult.ok,
          body: postResult.body,
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    if (!postResult.ok) {
      throw new Error(`POST failed with status ${postResult.status}.`);
    }

    const createdWorkoutId = readWorkoutIdFromBody(postResult.body);
    if (!createdWorkoutId) {
      throw new Error("POST response does not contain valid workoutId.");
    }

    const verifyEndpoint = buildWorkoutByIdUrl(args.athleteId, createdWorkoutId);
    const verifyResult = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint: verifyEndpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        ...authHeaders,
      },
    });

    const verifyRecord = pickObject(verifyResult.body);
    const verifyTitle = typeof verifyRecord.title === "string" ? verifyRecord.title : null;
    const verifyWorkoutDay = typeof verifyRecord.workoutDay === "string" ? verifyRecord.workoutDay : null;
    const verifyDescription = typeof verifyRecord.description === "string" ? verifyRecord.description : "";
    const verifyStructure = typeof verifyRecord.structure === "string" ? verifyRecord.structure : JSON.stringify(verifyRecord.structure ?? "");
    const verifyParsed = parseStructureForChecks(verifyStructure);

    const verificationChecks = {
      athleteId: verifyRecord.athleteId === SAFE_PROOF.safeAthleteId,
      title: verifyTitle === SAFE_PROOF.title,
      workoutDay: Boolean(verifyWorkoutDay?.startsWith(args.date)),
      descriptionMarker: verifyDescription.includes(SAFE_PROOF.description),
      structurePresent: verifyStructure.length > 0,
      structureMetric: verifyParsed.metricOk,
      structureRange: verifyParsed.rangeOk,
      stepNoteMarker: verifyParsed.noteOk,
    };

    const verificationStatus: "pass" | "warn" | "fail" =
      verifyResult.ok && Object.values(verificationChecks).every(Boolean)
        ? "pass"
        : verifyResult.ok
          ? "warn"
          : "fail";

    await writeFile(
      verifyPath,
      `${JSON.stringify(
        redactUnknown({
          workoutId: createdWorkoutId,
          status: verifyResult.status,
          ok: verifyResult.ok,
          verificationStatus,
          checks: verificationChecks,
          body: verifyResult.body,
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(`created_workout_id: ${createdWorkoutId}`);
    console.log(`verification_status: ${verificationStatus}`);
    console.log(`preflight_artifact: ${preflightPath}`);
    console.log(`request_artifact: ${requestPath}`);
    console.log(`response_artifact: ${responsePath}`);
    console.log(`verify_artifact: ${verifyPath}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-api-create-running-workout-proof failed.");
  console.error(error);
  process.exit(1);
});
