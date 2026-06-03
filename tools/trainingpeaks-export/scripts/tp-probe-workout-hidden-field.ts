import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { buildSafeRunningWorkoutDefinition } from "./lib/running-workout-safe-runner-v0.ts";
import { buildRunningWorkoutCreatePlan } from "./lib/running-workout-create-plan.ts";
import {
  buildTpApiWorkoutUrl,
  captureSessionAuth,
  performApiJsonRequest as performMoveApiJsonRequest,
  redactUnknown,
} from "./lib/trainingpeaks-api-move.ts";
import {
  buildCreateWorkoutUrl,
  buildWorkoutByIdUrl,
  buildWorkoutsByDayRangeUrl,
  performApiJsonRequest as performCreateApiJsonRequest,
  readWorkoutIdFromBody,
} from "./lib/trainingpeaks-api-create-workout.ts";

type CliArgs = {
  athleteId: number;
  date: string;
  apply: boolean;
  confirm: string | null;
  headless: boolean;
};

type HiddenProbeSummary = {
  mode: "dry-run" | "apply";
  dry_run: boolean;
  athlete_id: number;
  date: string;
  created_workout_id: number | null;
  initial_is_hidden: boolean | null;
  hidden_verify_pass: boolean | null;
  unhidden_verify_pass: boolean | null;
  safe_to_use_hidden_for_future_plan: "true" | "false" | "unknown";
  required_api_payload_field: string;
  report_directory: string;
  guards: Record<string, { pass: boolean; details: string }>;
};

const SAFE_ATHLETE_ID = 3102415;
const REQUIRED_CONFIRM = "PROBE TP HIDDEN WORKOUT";
const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";
const DEFAULT_HEADLESS = true;

function getRepoReportsRoot(): string {
  return path.resolve(toolRoot, "..", "..", "reports");
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

function printHelp(): void {
  console.log("TrainingPeaks hidden workout proof probe (guarded)");
  console.log("");
  console.log("Usage (dry-run, default):");
  console.log(
    `  npm run tp-probe-workout-hidden-field -- --athlete-id ${SAFE_ATHLETE_ID} --date YYYY-MM-DD`,
  );
  console.log("");
  console.log("Usage (apply, guarded):");
  console.log(
    `  ${TP_ACTIONS_REAL_EXECUTION_ENV}=true npm run tp-probe-workout-hidden-field -- --athlete-id ${SAFE_ATHLETE_ID} --date YYYY-MM-DD --apply --confirm "${REQUIRED_CONFIRM}"`,
  );
  console.log("");
  console.log("Safety gates:");
  console.log(`  - safe athlete only: ${SAFE_ATHLETE_ID}`);
  console.log("  - date must be future (not today)");
  console.log(`  - apply requires ${TP_ACTIONS_REAL_EXECUTION_ENV}=true`);
  console.log(`  - apply requires exact --confirm "${REQUIRED_CONFIRM}"`);
  console.log("  - dry-run does not send POST/PUT");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteId: SAFE_ATHLETE_ID,
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

function pickObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function readBooleanField(input: unknown, field: string): boolean | null {
  const record = pickObject(input);
  const value = record[field];
  return typeof value === "boolean" ? value : null;
}

function buildSummaryMarkdown(summary: HiddenProbeSummary): string {
  const lines: string[] = [];
  lines.push("# Hidden Workout Proof");
  lines.push("");
  lines.push(`- mode: \`${summary.mode}\``);
  lines.push(`- dry_run: \`${summary.dry_run}\``);
  lines.push(`- athlete_id: \`${summary.athlete_id}\``);
  lines.push(`- date: \`${summary.date}\``);
  lines.push(`- created_workout_id: \`${summary.created_workout_id ?? "null"}\``);
  lines.push(`- initial_is_hidden: \`${summary.initial_is_hidden === null ? "null" : String(summary.initial_is_hidden)}\``);
  lines.push(`- hidden_verify_pass: \`${summary.hidden_verify_pass === null ? "null" : String(summary.hidden_verify_pass)}\``);
  lines.push(`- unhidden_verify_pass: \`${summary.unhidden_verify_pass === null ? "null" : String(summary.unhidden_verify_pass)}\``);
  lines.push(`- required_api_payload_field: \`${summary.required_api_payload_field}\``);
  lines.push(`- safe_to_use_hidden_for_future_plan: \`${summary.safe_to_use_hidden_for_future_plan}\``);
  lines.push("");
  lines.push("## Guard checks");
  for (const [name, result] of Object.entries(summary.guards)) {
    lines.push(`- ${name}: ${result.pass ? "pass" : "fail"} (${result.details})`);
  }
  lines.push("");
  lines.push(`- report_directory: \`${summary.report_directory}\``);
  return `${lines.join("\n")}\n`;
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
  const reportsRoot = getRepoReportsRoot();
  const artifactDir = path.join(reportsRoot, "hidden-workout-proof", timestampForPath(new Date()));

  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  const guards: Record<string, { pass: boolean; details: string }> = {
    safeAthleteOnly: {
      pass: args.athleteId === SAFE_ATHLETE_ID,
      details: `athlete_id=${args.athleteId}; expected=${SAFE_ATHLETE_ID}`,
    },
    futureDateOnly: {
      pass: isFutureDateOnly(args.date),
      details: `date=${args.date}; must be future day`,
    },
    applyConfirmPhrase: {
      pass: !args.apply || args.confirm === REQUIRED_CONFIRM,
      details: `confirm=${args.confirm ?? "null"}; expected="${REQUIRED_CONFIRM}"`,
    },
    applyEnvGuard: {
      pass: !args.apply || executeAllowed,
      details: `${TP_ACTIONS_REAL_EXECUTION_ENV} must be true for apply`,
    },
  };

  const summary: HiddenProbeSummary = {
    mode,
    dry_run: !args.apply,
    athlete_id: args.athleteId,
    date: args.date,
    created_workout_id: null,
    initial_is_hidden: null,
    hidden_verify_pass: null,
    unhidden_verify_pass: null,
    safe_to_use_hidden_for_future_plan: "unknown",
    required_api_payload_field: "isHidden",
    report_directory: artifactDir,
    guards,
  };

  console.log(`dry_run: ${summary.dry_run}`);
  console.log(`athlete_id: ${summary.athlete_id}`);
  console.log(`date: ${summary.date}`);
  console.log(`report_directory: ${summary.report_directory}`);

  if (!args.apply) {
    await writeFile(path.join(artifactDir, "summary.json"), `${JSON.stringify(redactUnknown(summary), null, 2)}\n`, "utf8");
    await writeFile(path.join(artifactDir, "summary.md"), buildSummaryMarkdown(summary), "utf8");
    await writeFile(
      path.join(artifactDir, "create-request.redacted.json"),
      `${JSON.stringify(redactUnknown({ dry_run: true, note: "POST not sent in dry-run mode." }), null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(artifactDir, "hide-request.redacted.json"),
      `${JSON.stringify(redactUnknown({ dry_run: true, note: "PUT hide not sent in dry-run mode." }), null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(artifactDir, "unhide-request.redacted.json"),
      `${JSON.stringify(redactUnknown({ dry_run: true, note: "PUT unhide not sent in dry-run mode." }), null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(artifactDir, "verify-hidden.redacted.json"),
      `${JSON.stringify(redactUnknown({ dry_run: true, note: "GET hidden verification not run in dry-run mode." }), null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(artifactDir, "verify-unhidden.redacted.json"),
      `${JSON.stringify(redactUnknown({ dry_run: true, note: "GET unhidden verification not run in dry-run mode." }), null, 2)}\n`,
      "utf8",
    );

    console.log("created_workout_id: null");
    console.log("initial_is_hidden: null");
    console.log("hidden_verify_pass: null");
    console.log("unhidden_verify_pass: null");
    console.log("safe_to_use_hidden_for_future_plan: unknown");
    return;
  }

  for (const key of Object.keys(guards)) {
    mustPass(guards, key);
  }

  const definition = buildSafeRunningWorkoutDefinition({
    template: "easy-pace",
    athleteId: args.athleteId,
    workoutDay: args.date,
    title: "HIDDEN PROBE TEST WORKOUT DO NOT USE",
    description: "HIDDEN_PROBE_TEST_WORKOUT",
    coachComments: "HIDDEN_PROBE_TEST_COACH_COMMENT",
  });
  const createPlan = buildRunningWorkoutCreatePlan(definition);
  const createEndpoint = buildCreateWorkoutUrl(args.athleteId);
  const dayListEndpoint = buildWorkoutsByDayRangeUrl(args.athleteId, args.date);

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
    if (!capturedAuth.authorizationHeader) {
      throw new Error("Authorization header was not observed from TP API requests.");
    }

    const authHeaders: Record<string, string> = {
      authorization: capturedAuth.authorizationHeader,
    };

    await performCreateApiJsonRequest({
      page,
      method: "GET",
      endpoint: dayListEndpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        ...authHeaders,
      },
    });

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

    const createResult = await performCreateApiJsonRequest({
      page,
      method: "POST",
      endpoint: createEndpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json",
        ...authHeaders,
      },
      body: createBody,
    });
    await writeFile(
      path.join(artifactDir, "create-request.redacted.json"),
      `${JSON.stringify(redactUnknown({ endpoint: createEndpoint, body: createBody, response: createResult }), null, 2)}\n`,
      "utf8",
    );
    if (!createResult.ok) {
      throw new Error(`POST create failed with status ${createResult.status}.`);
    }

    const createdWorkoutId = readWorkoutIdFromBody(createResult.body);
    if (!createdWorkoutId) {
      throw new Error("POST response does not contain valid workoutId.");
    }
    summary.created_workout_id = createdWorkoutId;

    const workoutEndpoint = buildWorkoutByIdUrl(args.athleteId, createdWorkoutId);
    const initialGet = await performMoveApiJsonRequest({
      page,
      method: "GET",
      endpoint: workoutEndpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        ...authHeaders,
      },
    });
    if (!initialGet.ok) {
      throw new Error(`GET initial workout failed with status ${initialGet.status}.`);
    }
    const initialWorkout = pickObject(initialGet.body);
    const initialIsHidden = readBooleanField(initialWorkout, "isHidden");
    summary.initial_is_hidden = initialIsHidden;

    const hidePayload = {
      ...initialWorkout,
      workoutId: createdWorkoutId,
      athleteId: args.athleteId,
      workoutDay: initialWorkout.workoutDay ?? `${args.date}T00:00:00`,
      isHidden: true,
    };
    const hideResult = await performMoveApiJsonRequest({
      page,
      method: "PUT",
      endpoint: buildTpApiWorkoutUrl(args.athleteId, createdWorkoutId),
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json",
        ...authHeaders,
      },
      body: hidePayload,
    });
    await writeFile(
      path.join(artifactDir, "hide-request.redacted.json"),
      `${JSON.stringify(
        redactUnknown({
          endpoint: buildTpApiWorkoutUrl(args.athleteId, createdWorkoutId),
          payload: hidePayload,
          response: hideResult,
          required_payload_field: "isHidden",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    if (!hideResult.ok) {
      throw new Error(`PUT hide failed with status ${hideResult.status}.`);
    }

    const verifyHidden = await performMoveApiJsonRequest({
      page,
      method: "GET",
      endpoint: workoutEndpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        ...authHeaders,
      },
    });
    const verifyHiddenValue = readBooleanField(verifyHidden.body, "isHidden");
    summary.hidden_verify_pass = verifyHidden.ok && verifyHiddenValue === true;
    await writeFile(
      path.join(artifactDir, "verify-hidden.redacted.json"),
      `${JSON.stringify(redactUnknown({ response: verifyHidden, observed_isHidden: verifyHiddenValue }), null, 2)}\n`,
      "utf8",
    );

    const verifyHiddenBody = pickObject(verifyHidden.body);
    const unhidePayload = {
      ...verifyHiddenBody,
      workoutId: createdWorkoutId,
      athleteId: args.athleteId,
      workoutDay: verifyHiddenBody.workoutDay ?? `${args.date}T00:00:00`,
      isHidden: false,
    };
    const unhideResult = await performMoveApiJsonRequest({
      page,
      method: "PUT",
      endpoint: buildTpApiWorkoutUrl(args.athleteId, createdWorkoutId),
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json",
        ...authHeaders,
      },
      body: unhidePayload,
    });
    await writeFile(
      path.join(artifactDir, "unhide-request.redacted.json"),
      `${JSON.stringify(
        redactUnknown({
          endpoint: buildTpApiWorkoutUrl(args.athleteId, createdWorkoutId),
          payload: unhidePayload,
          response: unhideResult,
          required_payload_field: "isHidden",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    if (!unhideResult.ok) {
      throw new Error(`PUT unhide failed with status ${unhideResult.status}.`);
    }

    const verifyUnhidden = await performMoveApiJsonRequest({
      page,
      method: "GET",
      endpoint: workoutEndpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        ...authHeaders,
      },
    });
    const verifyUnhiddenValue = readBooleanField(verifyUnhidden.body, "isHidden");
    summary.unhidden_verify_pass = verifyUnhidden.ok && verifyUnhiddenValue === false;
    await writeFile(
      path.join(artifactDir, "verify-unhidden.redacted.json"),
      `${JSON.stringify(redactUnknown({ response: verifyUnhidden, observed_isHidden: verifyUnhiddenValue }), null, 2)}\n`,
      "utf8",
    );

    if (summary.hidden_verify_pass && summary.unhidden_verify_pass) {
      summary.safe_to_use_hidden_for_future_plan = "true";
    } else {
      summary.safe_to_use_hidden_for_future_plan = "false";
    }
  } finally {
    await context.close().catch(() => {});
  }

  await writeFile(path.join(artifactDir, "summary.json"), `${JSON.stringify(redactUnknown(summary), null, 2)}\n`, "utf8");
  await writeFile(path.join(artifactDir, "summary.md"), buildSummaryMarkdown(summary), "utf8");

  console.log(`created_workout_id: ${summary.created_workout_id ?? "null"}`);
  console.log(`initial_is_hidden: ${summary.initial_is_hidden === null ? "null" : String(summary.initial_is_hidden)}`);
  console.log(`hidden_verify_pass: ${summary.hidden_verify_pass === null ? "null" : String(summary.hidden_verify_pass)}`);
  console.log(`unhidden_verify_pass: ${summary.unhidden_verify_pass === null ? "null" : String(summary.unhidden_verify_pass)}`);
  console.log(`safe_to_use_hidden_for_future_plan: ${summary.safe_to_use_hidden_for_future_plan}`);
}

main().catch((error: unknown) => {
  console.error("tp-probe-workout-hidden-field failed.");
  console.error(error);
  process.exit(1);
});
