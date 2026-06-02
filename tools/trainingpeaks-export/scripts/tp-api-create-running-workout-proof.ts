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

type ProofCaseId = "easy-pace" | "easy-hr" | "interval-pace" | "interval-hr";

type ProofWorkoutSpec = {
  safeAthleteId: number;
  caseId: ProofCaseId;
  title: string;
  description: string;
  blocks: RunningWorkoutDefinition["blocks"];
  verification: {
    primaryMetric: "percentOfThresholdPace" | "percentOfThresholdHr";
    requireRepetition: boolean;
    repeatCount: number | null;
    requiredRanges: Array<{
      minValue: number;
      maxValue: number;
      matchName?: string;
      matchIntensityClass?: string;
    }>;
    requiredStepNames: string[];
    requiredStepNoteMarkers: string[];
  };
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
const SAFE_PROOF_BY_CASE: Record<ProofCaseId, ProofWorkoutSpec> = {
  "easy-pace": {
    safeAthleteId: 3102415,
    caseId: "easy-pace",
    title: "API CREATE PROOF EASY PACE DO NOT USE",
    description: "API_CREATE_PROOF_DESC_EASY_PACE",
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
        notes: "API_CREATE_PROOF_STEP_NOTE_EASY_PACE",
      },
    ],
    verification: {
      primaryMetric: "percentOfThresholdPace",
      requireRepetition: false,
      repeatCount: null,
      requiredRanges: [{ minValue: 75, maxValue: 85 }],
      requiredStepNames: ["Active"],
      requiredStepNoteMarkers: ["API_CREATE_PROOF_STEP_NOTE_EASY_PACE"],
    },
    confirmPhrase: "CREATE TEST RUN WORKOUT",
  },
  "easy-hr": {
    safeAthleteId: 3102415,
    caseId: "easy-hr",
    title: "API CREATE PROOF EASY HR DO NOT USE",
    description: "API_CREATE_PROOF_DESC_EASY_HR",
    blocks: [
      {
        kind: "step",
        label: "Active",
        durationSeconds: 1800,
        intensityClass: "active",
        target: {
          metric: "percentOfThresholdHr",
          minValue: 70,
          maxValue: 80,
        },
        notes: "API_CREATE_PROOF_STEP_NOTE_EASY_HR",
      },
    ],
    verification: {
      primaryMetric: "percentOfThresholdHr",
      requireRepetition: false,
      repeatCount: null,
      requiredRanges: [{ minValue: 70, maxValue: 80, matchName: "Active" }],
      requiredStepNames: ["Active"],
      requiredStepNoteMarkers: ["API_CREATE_PROOF_STEP_NOTE_EASY_HR"],
    },
    confirmPhrase: "CREATE TEST RUN WORKOUT",
  },
  "interval-pace": {
    safeAthleteId: 3102415,
    caseId: "interval-pace",
    title: "API CREATE PROOF INTERVAL PACE DO NOT USE",
    description: "API_CREATE_PROOF_DESC_INTERVAL_PACE",
    blocks: [
      {
        kind: "step",
        label: "Warm up",
        durationSeconds: 600,
        intensityClass: "warmup",
        target: {
          metric: "percentOfThresholdPace",
          minValue: 75,
          maxValue: 85,
        },
        notes: "API_CREATE_PROOF_NOTE_WARMUP_PACE",
      },
      {
        kind: "repetition",
        repeatCount: 4,
        steps: [
          {
            kind: "step",
            label: "Hard",
            durationSeconds: 360,
            intensityClass: "active",
            target: {
              metric: "percentOfThresholdPace",
              minValue: 105,
              maxValue: 115,
            },
            notes: "API_CREATE_PROOF_NOTE_HARD_PACE",
          },
          {
            kind: "step",
            label: "Easy",
            durationSeconds: 180,
            intensityClass: "recovery",
            target: {
              metric: "percentOfThresholdPace",
              minValue: 75,
              maxValue: 85,
            },
            notes: "API_CREATE_PROOF_NOTE_RECOVERY_PACE",
          },
        ],
      },
      {
        kind: "step",
        label: "Cool down",
        durationSeconds: 600,
        intensityClass: "cooldown",
        target: {
          metric: "percentOfThresholdPace",
          minValue: 75,
          maxValue: 85,
        },
        notes: "API_CREATE_PROOF_NOTE_COOLDOWN_PACE",
      },
    ],
    verification: {
      primaryMetric: "percentOfThresholdPace",
      requireRepetition: true,
      repeatCount: 4,
      requiredRanges: [
        { minValue: 105, maxValue: 115, matchName: "Hard" },
        { minValue: 75, maxValue: 85, matchName: "Warm up" },
        { minValue: 75, maxValue: 85, matchName: "Easy" },
        { minValue: 75, maxValue: 85, matchName: "Cool down" },
      ],
      requiredStepNames: ["Warm up", "Hard", "Easy", "Cool down"],
      requiredStepNoteMarkers: [
        "API_CREATE_PROOF_NOTE_WARMUP_PACE",
        "API_CREATE_PROOF_NOTE_HARD_PACE",
        "API_CREATE_PROOF_NOTE_RECOVERY_PACE",
        "API_CREATE_PROOF_NOTE_COOLDOWN_PACE",
      ],
    },
    confirmPhrase: "CREATE TEST RUN WORKOUT",
  },
  "interval-hr": {
    safeAthleteId: 3102415,
    caseId: "interval-hr",
    title: "API CREATE PROOF INTERVAL HR DO NOT USE",
    description: "API_CREATE_PROOF_DESC_INTERVAL_HR",
    blocks: [
      {
        kind: "step",
        label: "Warm up",
        durationSeconds: 1200,
        intensityClass: "warmup",
        target: {
          metric: "percentOfThresholdHr",
          minValue: 70,
          maxValue: 80,
        },
        notes: "API_CREATE_PROOF_NOTE_WARMUP_HR",
      },
      {
        kind: "repetition",
        repeatCount: 4,
        steps: [
          {
            kind: "step",
            label: "Hard",
            durationSeconds: 300,
            intensityClass: "active",
            target: {
              metric: "percentOfThresholdHr",
              minValue: 90,
              maxValue: 95,
            },
            notes: "API_CREATE_PROOF_NOTE_HARD_HR",
          },
          {
            kind: "step",
            label: "Easy",
            durationSeconds: 180,
            intensityClass: "recovery",
            target: {
              metric: "percentOfThresholdHr",
              minValue: 70,
              maxValue: 80,
            },
            notes: "API_CREATE_PROOF_NOTE_RECOVERY_HR",
          },
        ],
      },
      {
        kind: "step",
        label: "Cool down",
        durationSeconds: 600,
        intensityClass: "cooldown",
        target: {
          metric: "percentOfThresholdHr",
          minValue: 70,
          maxValue: 80,
        },
        notes: "API_CREATE_PROOF_NOTE_COOLDOWN_HR",
      },
    ],
    verification: {
      primaryMetric: "percentOfThresholdHr",
      requireRepetition: true,
      repeatCount: 4,
      requiredRanges: [
        { minValue: 90, maxValue: 95, matchName: "Hard" },
        { minValue: 70, maxValue: 80, matchName: "Warm up" },
        { minValue: 70, maxValue: 80, matchName: "Easy" },
        { minValue: 70, maxValue: 80, matchName: "Cool down" },
      ],
      requiredStepNames: ["Warm up", "Hard", "Easy", "Cool down"],
      requiredStepNoteMarkers: [
        "API_CREATE_PROOF_NOTE_WARMUP_HR",
        "API_CREATE_PROOF_NOTE_HARD_HR",
        "API_CREATE_PROOF_NOTE_RECOVERY_HR",
        "API_CREATE_PROOF_NOTE_COOLDOWN_HR",
      ],
    },
    confirmPhrase: "CREATE TEST RUN WORKOUT",
  },
};
const ACTION_ARTIFACTS_ROOT = path.join(toolRoot, "reports", "tp-api-create-running-workout-proof");
const DEFAULT_HEADLESS = true;

function printHelp(): void {
  console.log("Controlled API Create Proof: Running Workout");
  console.log("");
  console.log("Usage (dry-run, default):");
  console.log(
    "  npm run tp-api-create-running-workout-proof -- --case easy-pace|easy-hr|interval-pace|interval-hr --athlete-id 3102415 --date YYYY-MM-DD",
  );
  console.log("");
  console.log("Usage (live apply, guarded):");
  console.log(
    '  TP_ACTIONS_REAL_EXECUTION=true npm run tp-api-create-running-workout-proof -- --case easy-pace|easy-hr|interval-pace|interval-hr --athlete-id 3102415 --date YYYY-MM-DD --apply --confirm "CREATE TEST RUN WORKOUT"',
  );
  console.log("");
  console.log("Safety rules:");
  console.log("  - dry-run is default; no POST is sent unless all apply gates pass");
  console.log("  - safe athlete only: 3102415");
  console.log("  - safe case only: easy-pace, easy-hr, interval-pace, interval-hr");
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
  const defaultCaseId = "easy-pace" as const;
  const parsed: CliArgs = {
    caseId: defaultCaseId,
    athleteId: SAFE_PROOF_BY_CASE[defaultCaseId].safeAthleteId,
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
  const safeProof = SAFE_PROOF_BY_CASE[args.caseId as keyof typeof SAFE_PROOF_BY_CASE];
  if (!safeProof) {
    throw new Error(`Unsupported --case "${args.caseId}". Allowed: ${Object.keys(SAFE_PROOF_BY_CASE).join(", ")}`);
  }
  return {
    caseId: safeProof.caseId,
    athleteId: args.athleteId,
    workoutDay: args.date,
    title: safeProof.title,
    description: safeProof.description,
    workoutTypeValueId: 3,
    workoutSubTypeId: null,
    blocks: safeProof.blocks,
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
  hasStructureArray: boolean;
  primaryMetric: string | null;
  repetitionBlocks: number;
  repetitionCount: number | null;
  ranges: Array<{ minValue: number; maxValue: number; name: string; intensityClass: string }>;
  stepNames: string[];
  notes: string[];
  details: string;
} {
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

    const ranges: Array<{ minValue: number; maxValue: number; name: string; intensityClass: string }> = [];
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
  ranges: Array<{ minValue: number; maxValue: number; name: string; intensityClass: string }>,
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

function mustPass(checks: Record<string, { pass: boolean; details: string }>, name: string): void {
  if (!checks[name]?.pass) {
    throw new Error(`Safety gate failed: ${name}. ${checks[name]?.details ?? ""}`.trim());
  }
}

function caseDetailTag(caseId: string): string {
  return caseId.replace(/-/g, "_");
}

function summarizeCaseVerificationDetails(
  checks: {
    primaryMetric: string | null;
    repetitionCount: number | null;
    ranges: Array<{ minValue: number; maxValue: number; name: string }>;
    stepNames: string[];
    notes: string[];
  },
  spec: ProofWorkoutSpec,
): string {
  const rangeText = checks.ranges.map((entry) => `${entry.name}:${entry.minValue}-${entry.maxValue}`).join(";") || "none";
  const expectedRanges = spec.verification.requiredRanges
    .map((entry) => `${entry.matchName ?? "*"}:${entry.minValue}-${entry.maxValue}`)
    .join(";");
  const expectedNotes = spec.verification.requiredStepNoteMarkers.join(";");
  const observedRequiredNotes = spec.verification.requiredStepNoteMarkers.filter((marker) =>
    checks.notes.some((note) => note.includes(marker)),
  );
  return [
    `metric=${checks.primaryMetric ?? "missing"}`,
    `repetitionCount=${checks.repetitionCount ?? "none"}`,
    `ranges=${rangeText}`,
    `expectedRanges=${expectedRanges}`,
    `steps=${checks.stepNames.join(";") || "none"}`,
    `expectedSteps=${spec.verification.requiredStepNames.join(";") || "none"}`,
    `requiredNotesPresent=${observedRequiredNotes.join(";") || "none"}`,
    `requiredNotesExpected=${expectedNotes || "none"}`,
  ].join(" ");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const safeProof = SAFE_PROOF_BY_CASE[args.caseId as keyof typeof SAFE_PROOF_BY_CASE];
  if (!safeProof) {
    throw new Error(`Unsupported --case "${args.caseId}". Allowed: ${Object.keys(SAFE_PROOF_BY_CASE).join(", ")}`);
  }
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
  const description = plan.requestBodyCandidate.description;

  const safetyChecks: Record<string, { pass: boolean; details: string }> = {
    safeAthleteOnly: {
      pass: args.athleteId === safeProof.safeAthleteId,
      details: `athleteId=${args.athleteId}; expected=${safeProof.safeAthleteId}`,
    },
    safeCaseOnly: {
      pass: Boolean(SAFE_PROOF_BY_CASE[args.caseId as keyof typeof SAFE_PROOF_BY_CASE]),
      details: `case=${args.caseId}; allowed=${Object.keys(SAFE_PROOF_BY_CASE).join(",")}`,
    },
    titleGuard: {
      pass: title.includes("API CREATE PROOF") && title.includes("DO NOT USE"),
      details: `title=${title}`,
    },
    descriptionMarker: {
      pass: description.includes(safeProof.description),
      details: `description must include marker=${safeProof.description}`,
    },
    futureDateOnly: {
      pass: isFutureDateOnly(args.date),
      details: `date=${args.date}; must be future day`,
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
      pass: structureChecks.primaryMetric === safeProof.verification.primaryMetric,
      details: `expected metric=${safeProof.verification.primaryMetric}`,
    },
    structureRanges: {
      pass: safeProof.verification.requiredRanges.every((required) => hasRequiredRange(structureChecks.ranges, required)),
      details: `required ranges: ${safeProof.verification.requiredRanges
        .map((item) => `${item.matchName ?? "*"}:${item.minValue}-${item.maxValue}`)
        .join(", ")}`,
    },
    structureStepNames: {
      pass: safeProof.verification.requiredStepNames.every((name) => structureChecks.stepNames.includes(name)),
      details: `required steps: ${safeProof.verification.requiredStepNames.join(", ")}`,
    },
    structureStepNotes: {
      pass: safeProof.verification.requiredStepNoteMarkers.every((note) =>
        structureChecks.notes.some((item) => item.includes(note))
      ),
      details: `required step note markers: ${safeProof.verification.requiredStepNoteMarkers.join(", ")}`,
    },
    structureRepetitionBlock: {
      pass: safeProof.verification.requireRepetition
        ? structureChecks.repetitionBlocks > 0
        : structureChecks.repetitionBlocks === 0,
      details: safeProof.verification.requireRepetition
        ? "repetition block required"
        : "repetition block must not exist",
    },
    structureRepetitionCount: {
      pass:
        safeProof.verification.repeatCount === null || structureChecks.repetitionCount === safeProof.verification.repeatCount,
      details:
        safeProof.verification.repeatCount === null
          ? "repeat count not required"
          : `expected repetition count=${safeProof.verification.repeatCount}`,
    },
    applyConfirmPhrase: {
      pass: !args.apply || args.confirm === safeProof.confirmPhrase,
      details: `confirm=${args.confirm ?? "null"}; expected="${safeProof.confirmPhrase}"`,
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
  console.log(`case: ${args.caseId}`);
  console.log(`athlete_id: ${args.athleteId}`);
  console.log(`date: ${args.date}`);
  console.log(`mode: ${mode}`);

  if (!args.apply) {
    await writeFile(preflightPath, `${JSON.stringify(redactUnknown(preflightBase), null, 2)}\n`, "utf8");
    await writeFile(requestPath, `${JSON.stringify(redactUnknown(plan.requestBodyCandidate), null, 2)}\n`, "utf8");
    console.log("dry-run summary:");
    console.log(`- title: ${plan.requestBodyCandidate.title}`);
    console.log(`- workoutTypeValueId: ${plan.requestBodyCandidate.workoutTypeValueId}`);
    console.log(`- totalTimePlanned: ${plan.requestBodyCandidate.totalTimePlanned}`);
    console.log("- network calls: no");
    console.log("- verification_status: not-run");
    console.log(
      `- verification_details_${caseDetailTag(args.caseId)}: ${summarizeCaseVerificationDetails(structureChecks, safeProof)}`,
    );
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
      athleteId: verifyRecord.athleteId === safeProof.safeAthleteId,
      title: verifyTitle === safeProof.title,
      workoutDay: Boolean(verifyWorkoutDay?.startsWith(args.date)),
      descriptionMarker: verifyDescription.includes(safeProof.description),
      structurePresent: verifyStructure.length > 0 && verifyParsed.hasStructureArray,
      structureParseable: verifyParsed.parseable,
      structureMetric: verifyParsed.primaryMetric === safeProof.verification.primaryMetric,
      structureRepetitionBlock: safeProof.verification.requireRepetition
        ? verifyParsed.repetitionBlocks > 0
        : verifyParsed.repetitionBlocks === 0,
      structureRepetitionCount:
        safeProof.verification.repeatCount === null || verifyParsed.repetitionCount === safeProof.verification.repeatCount,
      structureRanges: safeProof.verification.requiredRanges.every((required) => hasRequiredRange(verifyParsed.ranges, required)),
      structureStepNames: safeProof.verification.requiredStepNames.every((name) => verifyParsed.stepNames.includes(name)),
      structureStepNotes: safeProof.verification.requiredStepNoteMarkers.every((note) =>
        verifyParsed.notes.some((item) => item.includes(note))
      ),
    };

    const failedChecks = Object.entries(verificationChecks)
      .filter(([, pass]) => !pass)
      .map(([name]) => name);
    const verificationStatus: "pass" | "fail" =
      verifyResult.ok && failedChecks.length === 0
        ? "pass"
        : "fail";
    const verificationDetails = {
      caseId: args.caseId,
      observed: {
        primaryMetric: verifyParsed.primaryMetric,
        repetitionBlocks: verifyParsed.repetitionBlocks,
        repetitionCount: verifyParsed.repetitionCount,
        ranges: verifyParsed.ranges,
        stepNames: verifyParsed.stepNames,
        notes: verifyParsed.notes,
      },
      expected: safeProof.verification,
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
    console.log(`verification_details_${caseDetailTag(args.caseId)}: ${JSON.stringify(verificationDetails)}`);
    console.log(`preflight_artifact: ${preflightPath}`);
    console.log(`request_artifact: ${requestPath}`);
    console.log(`response_artifact: ${responsePath}`);
    console.log(`verify_artifact: ${verifyPath}`);
    if (verificationStatus !== "pass") {
      throw new Error(
        `Verification failed for case=${args.caseId}. Failed checks: ${failedChecks.join(", ") || "unknown"}.`,
      );
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-api-create-running-workout-proof failed.");
  console.error(error);
  process.exit(1);
});
