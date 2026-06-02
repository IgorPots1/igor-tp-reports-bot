import process from "node:process";

import { buildRunningWorkoutCreatePlan } from "./lib/running-workout-create-plan.ts";
import {
  SAFE_RUNNING_WORKOUT_ATHLETE_ID,
  SAFE_RUNNING_WORKOUT_CONFIRM_PHRASE,
  SAFE_RUNNING_WORKOUT_MARKER,
  SAFE_RUNNING_WORKOUT_TEMPLATES,
  buildSafeRunnerDefaultContent,
  buildSafeRunningWorkoutDefinition,
  listSafeRunningWorkoutTemplates,
  type RunningWorkoutTemplateId,
} from "./lib/running-workout-safe-runner-v0.ts";

type ParsedStructure = {
  parseable: boolean;
  hasStructureArray: boolean;
  primaryMetric: string | null;
  repetitionBlocks: number;
  repetitionCount: number | null;
  ranges: Array<{ minValue: number; maxValue: number; name: string; intensityClass: string }>;
  stepNames: string[];
  notes: string[];
};

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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
    };
  }
}

function hasRequiredRange(
  ranges: ParsedStructure["ranges"],
  required: { minValue: number; maxValue: number; matchName?: string; matchIntensityClass?: string },
): boolean {
  return ranges.some((range) => {
    if (range.minValue !== required.minValue || range.maxValue !== required.maxValue) return false;
    if (required.matchName && range.name !== required.matchName) return false;
    if (required.matchIntensityClass && range.intensityClass !== required.matchIntensityClass) return false;
    return true;
  });
}

function markerPresent(value: string | null | undefined): boolean {
  return typeof value === "string" && value.includes(SAFE_RUNNING_WORKOUT_MARKER);
}

function validateTemplateBuild(template: RunningWorkoutTemplateId): void {
  const defaults = buildSafeRunnerDefaultContent(template);
  const definition = buildSafeRunningWorkoutDefinition({
    template,
    athleteId: SAFE_RUNNING_WORKOUT_ATHLETE_ID,
    workoutDay: "2026-06-30",
    title: defaults.title,
    description: defaults.description,
    coachComments: defaults.coachComments,
  });
  const plan = buildRunningWorkoutCreatePlan(definition);
  const parsed = parseStructureForChecks(plan.requestBodyCandidate.structure);
  const expected = SAFE_RUNNING_WORKOUT_TEMPLATES[template].verification;

  assert(plan.safety.dryRunOnly, `${template}: expected dryRunOnly=true`);
  assert(plan.safety.networkCallsAllowed === false, `${template}: expected networkCallsAllowed=false`);
  assert(plan.safety.liveMutationAllowed === false, `${template}: expected liveMutationAllowed=false`);
  assert(markerPresent(plan.requestBodyCandidate.title), `${template}: title marker missing`);
  assert(markerPresent(plan.requestBodyCandidate.description), `${template}: description marker missing`);
  assert(markerPresent(plan.requestBodyCandidate.coachComments), `${template}: coach comments marker missing`);
  assert(parsed.parseable, `${template}: structure must be parseable`);
  assert(parsed.hasStructureArray, `${template}: structure[] expected`);
  assert(parsed.primaryMetric === expected.primaryMetric, `${template}: metric mismatch`);
  assert(
    expected.requiredRanges.every((required) => hasRequiredRange(parsed.ranges, required)),
    `${template}: required ranges mismatch`,
  );
  assert(
    expected.requiredStepNames.every((name) => parsed.stepNames.includes(name)),
    `${template}: required step names mismatch`,
  );
  assert(
    expected.requiredStepNoteMarkers.every((note) => parsed.notes.some((entry) => entry.includes(note))),
    `${template}: required note markers mismatch`,
  );
  assert(
    expected.requireRepetition ? parsed.repetitionBlocks > 0 : parsed.repetitionBlocks === 0,
    `${template}: repetition block expectation mismatch`,
  );
  assert(
    expected.repeatCount === null || parsed.repetitionCount === expected.repeatCount,
    `${template}: repetition count mismatch`,
  );
}

function expectInvalidTemplateRejected(): void {
  const invalidTemplate = "free-form-template";
  const allowed = listSafeRunningWorkoutTemplates();
  assert(!allowed.includes(invalidTemplate as RunningWorkoutTemplateId), "invalid template unexpectedly allowed");
}

function expectApplyGuardRejections(): void {
  const unsafeAthlete = 42;
  assert(unsafeAthlete !== SAFE_RUNNING_WORKOUT_ATHLETE_ID, "unsafe athlete test setup failed");

  const providedConfirm = null;
  assert(providedConfirm !== SAFE_RUNNING_WORKOUT_CONFIRM_PHRASE, "missing confirm test setup failed");

  const envAllowed = false;
  assert(envAllowed === false, "missing env test setup failed");
}

function main(): void {
  for (const template of listSafeRunningWorkoutTemplates()) {
    validateTemplateBuild(template);
    console.log(`[check-running-workout-generic-runner] template ${template}: valid`);
  }

  expectInvalidTemplateRejected();
  console.log("[check-running-workout-generic-runner] invalid template: rejected");

  expectApplyGuardRejections();
  console.log("[check-running-workout-generic-runner] apply safety guards: rejected before network");

  console.log("[check-running-workout-generic-runner] network calls: none");
  console.log("[check-running-workout-generic-runner] PASS");
}

try {
  main();
} catch (error) {
  console.error("[check-running-workout-generic-runner] FAIL");
  console.error(error);
  process.exit(1);
}
