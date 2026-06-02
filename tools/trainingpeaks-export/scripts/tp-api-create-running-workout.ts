import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { buildRunningWorkoutCreatePlan } from "./lib/running-workout-create-plan.ts";
import {
  SAFE_RUNNING_WORKOUT_ATHLETE_ID,
  SAFE_RUNNING_WORKOUT_CONFIRM_PHRASE,
  SAFE_RUNNING_WORKOUT_MARKER,
  SAFE_RUNNING_WORKOUT_TEMPLATES,
  buildSafeRunnerDefaultContent,
  buildSafeRunningWorkoutDefinition,
  isRunningWorkoutTemplateId,
  listSafeRunningWorkoutTemplates,
  type RunningWorkoutTemplateId,
} from "./lib/running-workout-safe-runner-v0.ts";
import { captureSessionAuth, redactUnknown } from "./lib/trainingpeaks-api-move.ts";
import {
  buildCreateWorkoutUrl,
  buildWorkoutByIdUrl,
  buildWorkoutsByDayRangeUrl,
  performApiJsonRequest,
  readWorkoutIdFromBody,
} from "./lib/trainingpeaks-api-create-workout.ts";

type CliArgs = {
  template: RunningWorkoutTemplateId;
  athleteId: number;
  date: string;
  title: string | null;
  description: string | null;
  coachComments: string | null;
  apply: boolean;
  confirm: string | null;
  headless: boolean;
};

type ParsedStructure = {
  parseable: boolean;
  hasStructureArray: boolean;
  primaryMetric: string | null;
  repetitionBlocks: number;
  repetitionCount: number | null;
  ranges: Array<{ minValue: number; maxValue: number; name: string; intensityClass: string }>;
  stepNames: string[];
  notes: string[];
  details: string;
};

type PreflightArtifact = {
  mode: "dry-run" | "apply";
  executeAllowed: boolean;
  template: RunningWorkoutTemplateId;
  athleteId: number;
  date: string;
  endpoint: string;
  safetyChecks: Record<string, { pass: boolean; details: string }>;
  requestSummary: ReturnType<typeof buildRunningWorkoutCreatePlan>["requestBodySummary"];
  expectedVerification: {
    metric: string;
    requiredRanges: string[];
    requiredStepNames: string[];
    repetitionCount: number | null;
  };
  existingDayWorkouts: {
    attempted: boolean;
    status: number | null;
    count: number | null;
    warning: string | null;
  };
};

const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";
const ACTION_ARTIFACTS_ROOT = path.join(toolRoot, "reports", "tp-api-create-running-workout");
const DEFAULT_HEADLESS = true;

function printHelp(): void {
  const templates = listSafeRunningWorkoutTemplates().join("|");
  console.log("Generic safe running workout API create runner v0");
  console.log("");
  console.log("Usage:");
  console.log(
    `  npm run tp-api-create-running-workout -- --template ${templates} --athlete-id ${SAFE_RUNNING_WORKOUT_ATHLETE_ID} --date YYYY-MM-DD [--title \"...\"] [--description \"...\"] [--coach-comments \"...\"]`,
  );
  console.log("");
  console.log("Dry-run example (default mode):");
  console.log(
    `  npm run tp-api-create-running-workout -- --template easy-hr --athlete-id ${SAFE_RUNNING_WORKOUT_ATHLETE_ID} --date 2026-06-18`,
  );
  console.log("");
  console.log("Apply example (guarded):");
  console.log(
    `  TP_ACTIONS_REAL_EXECUTION=true npm run tp-api-create-running-workout -- --template easy-hr --athlete-id ${SAFE_RUNNING_WORKOUT_ATHLETE_ID} --date 2026-06-18 --apply --confirm "${SAFE_RUNNING_WORKOUT_CONFIRM_PHRASE}"`,
  );
  console.log("");
  console.log("Allowed templates:");
  for (const template of listSafeRunningWorkoutTemplates()) {
    console.log(`  - ${template}`);
  }
  console.log("");
  console.log("Safety gates:");
  console.log("  - dry-run is default; no POST in dry-run");
  console.log(`  - apply requires --confirm "${SAFE_RUNNING_WORKOUT_CONFIRM_PHRASE}"`);
  console.log(`  - apply requires ${TP_ACTIONS_REAL_EXECUTION_ENV}=true`);
  console.log(`  - safe athlete only: ${SAFE_RUNNING_WORKOUT_ATHLETE_ID}`);
  console.log("  - date must be in the future (not today)");
  console.log(`  - title/description/coach comments must include marker: ${SAFE_RUNNING_WORKOUT_MARKER}`);
  console.log("  - post-create GET verification must pass");
  console.log("");
  console.log(`SAFE ATHLETE WARNING: v0 runner is restricted to athlete ${SAFE_RUNNING_WORKOUT_ATHLETE_ID} only.`);
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
    template: "easy-pace",
    athleteId: SAFE_RUNNING_WORKOUT_ATHLETE_ID,
    date: "",
    title: null,
    description: null,
    coachComments: null,
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
    if (arg.startsWith("--template=")) {
      const rawTemplate = arg.slice("--template=".length).trim();
      if (!isRunningWorkoutTemplateId(rawTemplate)) {
        throw new Error(`Unsupported --template "${rawTemplate}". Allowed: ${listSafeRunningWorkoutTemplates().join(", ")}`);
      }
      parsed.template = rawTemplate;
      continue;
    }
    if (arg === "--template") {
      const rawTemplate = readRequiredNextArg(argv, index, "--template");
      if (!isRunningWorkoutTemplateId(rawTemplate)) {
        throw new Error(`Unsupported --template "${rawTemplate}". Allowed: ${listSafeRunningWorkoutTemplates().join(", ")}`);
      }
      parsed.template = rawTemplate;
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
    if (arg.startsWith("--title=")) {
      parsed.title = arg.slice("--title=".length).trim();
      continue;
    }
    if (arg === "--title") {
      parsed.title = readRequiredNextArg(argv, index, "--title");
      index += 1;
      continue;
    }
    if (arg.startsWith("--description=")) {
      parsed.description = arg.slice("--description=".length).trim();
      continue;
    }
    if (arg === "--description") {
      parsed.description = readRequiredNextArg(argv, index, "--description");
      index += 1;
      continue;
    }
    if (arg.startsWith("--coach-comments=")) {
      parsed.coachComments = arg.slice("--coach-comments=".length).trim();
      continue;
    }
    if (arg === "--coach-comments") {
      parsed.coachComments = readRequiredNextArg(argv, index, "--coach-comments");
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

function parseStructureForChecks(serialized: string): ParsedStructure {
  try {
    const parsed = JSON.parse(serialized) as {
      primaryIntensityMetric?: unknown;
      structure?: Array<{
        type?: string;
        length?: { value?: unknown };
        steps?: Array<{
          name?: string;
          intensityClass?: string;
          notes?: string;
          targets?: Array<{ minValue?: unknown; maxValue?: unknown }>;
        }>;
      }>;
    };
    const primaryMetric = typeof parsed.primaryIntensityMetric === "string" ? parsed.primaryIntensityMetric : null;
    const structure = Array.isArray(parsed.structure) ? parsed.structure : [];
    const hasStructureArray = Array.isArray(parsed.structure);
    const repetitionBlocks = structure.filter((entry) => entry.type === "repetition").length;
    const firstRepetition = structure.find((entry) => entry.type === "repetition");
    const repetitionCount =
      firstRepetition && typeof firstRepetition.length?.value === "number" ? firstRepetition.length.value : null;

    const ranges: ParsedStructure["ranges"] = [];
    const stepNames: string[] = [];
    const notes: string[] = [];
    for (const block of structure) {
      const steps = Array.isArray(block.steps) ? block.steps : [];
      for (const step of steps) {
        if (typeof step.name === "string") stepNames.push(step.name);
        if (typeof step.notes === "string") notes.push(step.notes);
        const firstTarget = Array.isArray(step.targets) ? step.targets[0] : null;
        if (
          firstTarget &&
          typeof firstTarget === "object" &&
          typeof firstTarget.minValue === "number" &&
          typeof firstTarget.maxValue === "number"
        ) {
          ranges.push({
            minValue: firstTarget.minValue,
            maxValue: firstTarget.maxValue,
            name: typeof step.name === "string" ? step.name : "",
            intensityClass: typeof step.intensityClass === "string" ? step.intensityClass : "",
          });
        }
      }
    }

    return {
      parseable: true,
      hasStructureArray,
      primaryMetric,
      repetitionBlocks,
      repetitionCount,
      ranges,
      stepNames,
      notes,
      details: `metric=${primaryMetric ?? "missing"} ranges=${ranges.map((x) => `${x.name}:${x.minValue}-${x.maxValue}`).join(",") || "none"} notes=${notes.length} repetitionBlocks=${repetitionBlocks} repetitionCount=${repetitionCount ?? "none"}`,
    };
  } catch {
    return {
      parseable: false,
      hasStructureArray: false,
      primaryMetric: null,
      repetitionBlocks: 0,
      repetitionCount: null,
      ranges: [],
      stepNames: [],
      notes: [],
      details: "structure is not parseable JSON",
    };
  }
}

function hasRequiredRange(
  ranges: ParsedStructure["ranges"],
  required: { minValue: number; maxValue: number; matchName?: string; matchIntensityClass?: string },
): boolean {
  return ranges.some((range) => {
    if (range.minValue !== required.minValue || range.maxValue !== required.maxValue) {
      return false;
    }
    if (required.matchName && range.name !== required.matchName) {
      return false;
    }
    if (required.matchIntensityClass && range.intensityClass !== required.matchIntensityClass) {
      return false;
    }
    return true;
  });
}

function markerPresent(value: string | null | undefined): boolean {
  return typeof value === "string" && value.includes(SAFE_RUNNING_WORKOUT_MARKER);
}

function mustPass(checks: Record<string, { pass: boolean; details: string }>, name: string): void {
  if (!checks[name]?.pass) {
    throw new Error(`Safety gate failed: ${name}. ${checks[name]?.details ?? ""}`.trim());
  }
}

function formatRangeList(parsed: ParsedStructure["ranges"]): string {
  if (parsed.length === 0) return "none";
  return parsed.map((entry) => `${entry.name || "*"}:${entry.minValue}-${entry.maxValue}`).join("; ");
}

function formatExpectedRangeList(
  requiredRanges: Array<{ minValue: number; maxValue: number; matchName?: string }>,
): string {
  if (requiredRanges.length === 0) return "none";
  return requiredRanges.map((entry) => `${entry.matchName ?? "*"}:${entry.minValue}-${entry.maxValue}`).join("; ");
}

function buildVerificationDetails(input: {
  structure: ParsedStructure;
  requiredRanges: Array<{ minValue: number; maxValue: number; matchName?: string }>;
  requiredStepNames: string[];
  requiredStepNoteMarkers: string[];
}): string {
  const observedRequiredNotes = input.requiredStepNoteMarkers.filter((marker) =>
    input.structure.notes.some((note) => note.includes(marker)),
  );
  return [
    `metric=${input.structure.primaryMetric ?? "missing"}`,
    `ranges=${formatRangeList(input.structure.ranges)}`,
    `expected_ranges=${formatExpectedRangeList(input.requiredRanges)}`,
    `steps=${input.structure.stepNames.join(";") || "none"}`,
    `expected_steps=${input.requiredStepNames.join(";") || "none"}`,
    `required_notes_present=${observedRequiredNotes.join(";") || "none"}`,
    `required_notes_expected=${input.requiredStepNoteMarkers.join(";") || "none"}`,
    `repetition_count=${input.structure.repetitionCount ?? "none"}`,
  ].join(" ");
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

  const defaults = buildSafeRunnerDefaultContent(args.template);
  const title = args.title && args.title.length > 0 ? args.title : defaults.title;
  const description = args.description && args.description.length > 0 ? args.description : defaults.description;
  const coachComments =
    args.coachComments && args.coachComments.length > 0 ? args.coachComments : defaults.coachComments;

  const definition = buildSafeRunningWorkoutDefinition({
    template: args.template,
    athleteId: args.athleteId,
    workoutDay: args.date,
    title,
    description,
    coachComments,
  });
  const templateSpec = SAFE_RUNNING_WORKOUT_TEMPLATES[args.template];
  const plan = buildRunningWorkoutCreatePlan(definition);
  const structureChecks = parseStructureForChecks(plan.requestBodyCandidate.structure);
  const endpoint = buildCreateWorkoutUrl(args.athleteId);
  const listEndpoint = buildWorkoutsByDayRangeUrl(args.athleteId, args.date);

  const safetyChecks: Record<string, { pass: boolean; details: string }> = {
    safeAthleteOnly: {
      pass: args.athleteId === SAFE_RUNNING_WORKOUT_ATHLETE_ID,
      details: `athleteId=${args.athleteId}; expected=${SAFE_RUNNING_WORKOUT_ATHLETE_ID}`,
    },
    safeTemplateOnly: {
      pass: Boolean(SAFE_RUNNING_WORKOUT_TEMPLATES[args.template]),
      details: `template=${args.template}; allowed=${listSafeRunningWorkoutTemplates().join(",")}`,
    },
    futureDateOnly: {
      pass: isFutureDateOnly(args.date),
      details: `date=${args.date}; must be future day`,
    },
    markerInTitle: {
      pass: markerPresent(title),
      details: `title must contain ${SAFE_RUNNING_WORKOUT_MARKER}`,
    },
    markerInDescription: {
      pass: markerPresent(description),
      details: `description must contain ${SAFE_RUNNING_WORKOUT_MARKER}`,
    },
    markerInCoachComments: {
      pass: markerPresent(coachComments),
      details: `coach comments must contain ${SAFE_RUNNING_WORKOUT_MARKER}`,
    },
    structureParseable: {
      pass: structureChecks.parseable,
      details: structureChecks.details,
    },
    structureArrayPresent: {
      pass: structureChecks.hasStructureArray,
      details: "expected structure[] in serialized payload",
    },
    structureMetric: {
      pass: structureChecks.primaryMetric === templateSpec.verification.primaryMetric,
      details: `expected metric=${templateSpec.verification.primaryMetric}`,
    },
    structureRanges: {
      pass: templateSpec.verification.requiredRanges.every((required) => hasRequiredRange(structureChecks.ranges, required)),
      details: `required ranges: ${templateSpec.verification.requiredRanges
        .map((item) => `${item.matchName ?? "*"}:${item.minValue}-${item.maxValue}`)
        .join(", ")}`,
    },
    structureStepNames: {
      pass: templateSpec.verification.requiredStepNames.every((name) => structureChecks.stepNames.includes(name)),
      details: `required steps: ${templateSpec.verification.requiredStepNames.join(", ")}`,
    },
    structureStepNotes: {
      pass: templateSpec.verification.requiredStepNoteMarkers.every((note) =>
        structureChecks.notes.some((item) => item.includes(note)),
      ),
      details: `required note markers: ${templateSpec.verification.requiredStepNoteMarkers.join(", ")}`,
    },
    structureRepetitionBlock: {
      pass: templateSpec.verification.requireRepetition
        ? structureChecks.repetitionBlocks > 0
        : structureChecks.repetitionBlocks === 0,
      details: templateSpec.verification.requireRepetition ? "repetition block required" : "repetition block must not exist",
    },
    structureRepetitionCount: {
      pass:
        templateSpec.verification.repeatCount === null || structureChecks.repetitionCount === templateSpec.verification.repeatCount,
      details:
        templateSpec.verification.repeatCount === null
          ? "repeat count not required"
          : `expected repetition count=${templateSpec.verification.repeatCount}`,
    },
    applyConfirmPhrase: {
      pass: !args.apply || args.confirm === SAFE_RUNNING_WORKOUT_CONFIRM_PHRASE,
      details: `confirm=${args.confirm ?? "null"}; expected="${SAFE_RUNNING_WORKOUT_CONFIRM_PHRASE}"`,
    },
    applyEnvGuard: {
      pass: !args.apply || executeAllowed,
      details: `${TP_ACTIONS_REAL_EXECUTION_ENV} must be true for apply`,
    },
  };

  const preflight: PreflightArtifact = {
    mode,
    executeAllowed,
    template: args.template,
    athleteId: args.athleteId,
    date: args.date,
    endpoint,
    safetyChecks,
    requestSummary: plan.requestBodySummary,
    expectedVerification: {
      metric: templateSpec.verification.primaryMetric,
      requiredRanges: templateSpec.verification.requiredRanges.map(
        (range) => `${range.matchName ?? "*"}:${range.minValue}-${range.maxValue}`,
      ),
      requiredStepNames: templateSpec.verification.requiredStepNames,
      repetitionCount: templateSpec.verification.repeatCount,
    },
    existingDayWorkouts: {
      attempted: false,
      status: null,
      count: null,
      warning: null,
    },
  };

  console.log(`[tp-api-create-running-workout] mode=${mode}`);
  console.log(`[tp-api-create-running-workout] artifacts=${artifactDir}`);
  console.log(`template: ${args.template}`);
  console.log(`athlete_id: ${args.athleteId}`);
  console.log(`date: ${args.date}`);
  console.log(`mode: ${mode}`);
  console.log(`network calls: ${args.apply ? "yes" : "no"}`);
  console.log(`title: ${title}`);
  console.log(`description marker: ${markerPresent(description) ? "present" : "missing"}`);
  console.log(`coach comments marker: ${markerPresent(coachComments) ? "present" : "missing"}`);
  console.log(`metric: ${templateSpec.verification.primaryMetric}`);
  console.log(`ranges: ${formatExpectedRangeList(templateSpec.verification.requiredRanges)}`);
  if (templateSpec.verification.repeatCount !== null) {
    console.log(`repetition count: ${templateSpec.verification.repeatCount}`);
  }

  if (!args.apply) {
    await writeFile(preflightPath, `${JSON.stringify(redactUnknown(preflight), null, 2)}\n`, "utf8");
    await writeFile(requestPath, `${JSON.stringify(redactUnknown(plan.requestBodyCandidate), null, 2)}\n`, "utf8");
    console.log(`request preview: ${JSON.stringify(redactUnknown(plan.requestBodyCandidate))}`);
    console.log(
      `verification preflight: ${buildVerificationDetails({
        structure: structureChecks,
        requiredRanges: templateSpec.verification.requiredRanges,
        requiredStepNames: templateSpec.verification.requiredStepNames,
        requiredStepNoteMarkers: templateSpec.verification.requiredStepNoteMarkers,
      })}`,
    );
    console.log(`artifact_preflight: ${preflightPath}`);
    console.log(`artifact_request: ${requestPath}`);
    console.log("POST not sent");
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
    preflight.existingDayWorkouts = {
      attempted: true,
      status: preflightList.status,
      count: dayItems.length,
      warning: dayItems.length > 0 ? "target date already has existing workouts" : null,
    };
    await writeFile(preflightPath, `${JSON.stringify(redactUnknown(preflight), null, 2)}\n`, "utf8");

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
      `${JSON.stringify(redactUnknown({ status: postResult.status, ok: postResult.ok, body: postResult.body }), null, 2)}\n`,
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
    const verifyTitle = typeof verifyRecord.title === "string" ? verifyRecord.title : "";
    const verifyDescription = typeof verifyRecord.description === "string" ? verifyRecord.description : "";
    const verifyCoachComments = typeof verifyRecord.coachComments === "string" ? verifyRecord.coachComments : "";
    const verifyWorkoutDay = typeof verifyRecord.workoutDay === "string" ? verifyRecord.workoutDay : "";
    const verifyStructure = typeof verifyRecord.structure === "string" ? verifyRecord.structure : JSON.stringify(verifyRecord.structure ?? "");
    const verifyParsed = parseStructureForChecks(verifyStructure);

    const verificationChecks = {
      athleteId: verifyRecord.athleteId === SAFE_RUNNING_WORKOUT_ATHLETE_ID,
      titleMarker: markerPresent(verifyTitle),
      descriptionMarker: markerPresent(verifyDescription),
      coachCommentsMarker: markerPresent(verifyCoachComments),
      workoutDay: verifyWorkoutDay.startsWith(args.date),
      structurePresent: verifyStructure.length > 0 && verifyParsed.hasStructureArray,
      structureParseable: verifyParsed.parseable,
      structureMetric: verifyParsed.primaryMetric === templateSpec.verification.primaryMetric,
      structureRepetitionBlock: templateSpec.verification.requireRepetition
        ? verifyParsed.repetitionBlocks > 0
        : verifyParsed.repetitionBlocks === 0,
      structureRepetitionCount:
        templateSpec.verification.repeatCount === null || verifyParsed.repetitionCount === templateSpec.verification.repeatCount,
      structureRanges: templateSpec.verification.requiredRanges.every((required) => hasRequiredRange(verifyParsed.ranges, required)),
      structureStepNames: templateSpec.verification.requiredStepNames.every((name) => verifyParsed.stepNames.includes(name)),
      structureStepNotes: templateSpec.verification.requiredStepNoteMarkers.every((marker) =>
        verifyParsed.notes.some((entry) => entry.includes(marker)),
      ),
    };

    const failedChecks = Object.entries(verificationChecks)
      .filter(([, pass]) => !pass)
      .map(([name]) => name);
    const verificationStatus: "pass" | "fail" = verifyResult.ok && failedChecks.length === 0 ? "pass" : "fail";
    const verificationDetails = {
      template: args.template,
      observed: {
        primaryMetric: verifyParsed.primaryMetric,
        repetitionBlocks: verifyParsed.repetitionBlocks,
        repetitionCount: verifyParsed.repetitionCount,
        ranges: verifyParsed.ranges,
        stepNames: verifyParsed.stepNames,
        notes: verifyParsed.notes,
      },
      expected: templateSpec.verification,
      failedChecks,
      parseDetails: verifyParsed.details,
    };

    await writeFile(
      verifyPath,
      `${JSON.stringify(
        redactUnknown({
          workoutId: createdWorkoutId,
          status: verifyResult.status,
          ok: verifyResult.ok,
          verificationStatus,
          checks: verificationChecks,
          details: verificationDetails,
          body: verifyResult.body,
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(`created_workout_id: ${createdWorkoutId}`);
    console.log(`verification_status: ${verificationStatus}`);
    console.log(`verification_details: ${JSON.stringify(verificationDetails)}`);
    console.log(`artifact_preflight: ${preflightPath}`);
    console.log(`artifact_request: ${requestPath}`);
    console.log(`artifact_response: ${responsePath}`);
    console.log(`artifact_verify: ${verifyPath}`);

    if (verificationStatus !== "pass") {
      throw new Error(`Verification failed for template=${args.template}. Failed checks: ${failedChecks.join(", ") || "unknown"}.`);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-api-create-running-workout failed.");
  console.error(error);
  process.exit(1);
});
