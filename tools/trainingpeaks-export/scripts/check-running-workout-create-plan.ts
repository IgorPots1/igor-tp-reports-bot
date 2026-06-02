import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildRunningWorkoutFixtureAlignedDefinitions,
  type RunningWorkoutCaseId,
  type RunningWorkoutRenderedStructure,
} from "./lib/running-workout-renderer.ts";
import { buildRunningWorkoutCreatePlan } from "./lib/running-workout-create-plan.ts";

type Fixture = {
  caseId: RunningWorkoutCaseId;
  method?: string;
  athleteId?: number;
  endpointPattern?: string;
  request: {
    endpointPattern?: string;
    bodyFieldSamples: {
      athleteId: number;
      workoutDay: string;
      workoutId: number;
      title: string;
      workoutTypeValueId: number;
      workoutSubTypeId: number | null;
      description: string;
      coachComments: string | null;
      distancePlanned: number | null;
      totalTimePlanned: number;
      structure: string;
    };
    structureShape?: {
      type?: string;
    };
    structureSamples?: string;
  };
  response: {
    bodyFieldSamples: {
      athleteId: number;
      title: string;
      workoutTypeValueId: number;
      description: string;
      coachComments: string | null;
      distancePlanned: number | null;
      totalTimePlanned: number;
    };
    structureSamples: RunningWorkoutRenderedStructure;
  };
  redaction?: { secretsFound?: boolean };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

const CASE_FIXTURES: Record<RunningWorkoutCaseId, string> = {
  "easy-pace": "running-workout-structured-easy-pace.network-truth.fixture.json",
  "easy-hr": "running-workout-structured-easy-hr.network-truth.fixture.json",
  "interval-pace": "running-workout-structured-interval-pace.network-truth.fixture.json",
  "interval-hr": "running-workout-structured-interval-hr.network-truth.fixture.json",
};

const BASIC_CREATE_FIXTURE = "running-workout-create.network-truth.fixture.json";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApprox(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function loadFixture(fileName: string): Fixture {
  return JSON.parse(readFileSync(path.join(fixturesDir, fileName), "utf8")) as Fixture;
}

function flattenTargets(structure: RunningWorkoutRenderedStructure): Array<{ minValue: number; maxValue: number }> {
  const targets: Array<{ minValue: number; maxValue: number }> = [];
  for (const block of structure.structure) {
    for (const step of block.steps) {
      const target = step.targets[0];
      if (target) targets.push({ minValue: target.minValue, maxValue: target.maxValue });
    }
  }
  return targets;
}

function flattenNotes(structure: RunningWorkoutRenderedStructure): string[] {
  const notes: string[] = [];
  for (const block of structure.structure) {
    for (const step of block.steps) {
      if (step.notes) notes.push(step.notes);
    }
  }
  return notes;
}

function containsSecrets(value: string): boolean {
  return /(authorization|bearer|cookie|session|csrf|jwt)/i.test(value);
}

function validateBasicCreateFixtureEnvelope(fixture: Fixture): void {
  assert(fixture.method === "POST", "basic create fixture method must be POST.");
  assert(
    fixture.endpointPattern === "/fitness/v6/athletes/{athleteId}/workouts",
    "basic create fixture endpoint pattern mismatch."
  );
  assert(fixture.request.bodyFieldSamples.athleteId === 3102415, "basic create fixture athleteId must be 3102415.");
  assert(fixture.request.bodyFieldSamples.workoutId === 0, "basic create fixture request workoutId must be 0.");
}

function validateCase(caseId: RunningWorkoutCaseId, fixture: Fixture): void {
  const definition = buildRunningWorkoutFixtureAlignedDefinitions().find((item) => item.caseId === caseId);
  assert(Boolean(definition), `${caseId}: definition not found.`);
  if (!definition) return;

  const plan = buildRunningWorkoutCreatePlan(definition);
  const candidate = plan.requestBodyCandidate;
  const candidateStructureParsed = JSON.parse(candidate.structure) as RunningWorkoutRenderedStructure;
  const responseStructure = fixture.response.structureSamples;
  const requestSample = fixture.request.bodyFieldSamples;
  const responseSample = fixture.response.bodyFieldSamples;

  assert(plan.operation === "create_running_workout", `${caseId}: operation mismatch.`);
  assert(plan.endpoint.method === "POST", `${caseId}: endpoint method must be POST.`);
  assert(
    plan.endpoint.pathTemplate === "/fitness/v6/athletes/{athleteId}/workouts",
    `${caseId}: endpoint path template mismatch.`
  );
  assert(plan.endpoint.athleteId === 3102415, `${caseId}: athleteId must be 3102415.`);
  assert(plan.safety.dryRunOnly, `${caseId}: dryRunOnly must be true.`);
  assert(plan.safety.networkCallsAllowed === false, `${caseId}: networkCallsAllowed must be false.`);
  assert(plan.safety.liveMutationAllowed === false, `${caseId}: liveMutationAllowed must be false.`);

  assert(candidate.athleteId === requestSample.athleteId, `${caseId}: athleteId mismatch.`);
  assert(candidate.workoutDay === requestSample.workoutDay, `${caseId}: workoutDay mismatch.`);
  assert(candidate.workoutId === 0, `${caseId}: workoutId must be 0.`);
  assert(candidate.title === requestSample.title, `${caseId}: title mismatch.`);
  assert(candidate.workoutTypeValueId === requestSample.workoutTypeValueId, `${caseId}: workoutTypeValueId mismatch.`);
  assert(candidate.workoutSubTypeId === requestSample.workoutSubTypeId, `${caseId}: workoutSubTypeId mismatch.`);
  assert(candidate.description === requestSample.description, `${caseId}: description mismatch.`);
  assert(candidate.coachComments === requestSample.coachComments, `${caseId}: coachComments mismatch.`);
  assert(candidate.distancePlanned === requestSample.distancePlanned, `${caseId}: distancePlanned mismatch.`);
  assertApprox(candidate.totalTimePlanned, requestSample.totalTimePlanned, `${caseId}: totalTimePlanned mismatch`);

  assert(typeof candidate.structure === "string", `${caseId}: structure must be string.`);
  assert(candidate.structure.length > 0, `${caseId}: structure string must be non-empty.`);
  assert(JSON.stringify(candidateStructureParsed) === JSON.stringify(candidate.structureObject), `${caseId}: structure parse mismatch.`);

  assert(
    candidateStructureParsed.primaryIntensityMetric === responseStructure.primaryIntensityMetric,
    `${caseId}: primaryIntensityMetric mismatch.`
  );
  assert(candidateStructureParsed.primaryLengthMetric === "duration", `${caseId}: primaryLengthMetric mismatch.`);
  assert(candidateStructureParsed.primaryIntensityTargetOrRange === "range", `${caseId}: intensity target/range mismatch.`);

  const expectedTargets = flattenTargets(responseStructure).map((t) => `${t.minValue}-${t.maxValue}`);
  const actualTargets = flattenTargets(candidateStructureParsed).map((t) => `${t.minValue}-${t.maxValue}`);
  assert(
    expectedTargets.every((target) => actualTargets.includes(target)),
    `${caseId}: target ranges mismatch. expected ${expectedTargets.join(", ")} got ${actualTargets.join(", ")}`
  );

  const expectedNotes = flattenNotes(responseStructure);
  const actualNotes = flattenNotes(candidateStructureParsed);
  for (const note of expectedNotes) {
    assert(actualNotes.includes(note), `${caseId}: missing note ${note}`);
  }

  assert(
    candidateStructureParsed.structure.length === responseStructure.structure.length,
    `${caseId}: top-level structure block count mismatch.`
  );
  assert(
    candidateStructureParsed.structure.filter((node) => node.type === "repetition").length ===
      responseStructure.structure.filter((node) => node.type === "repetition").length,
    `${caseId}: repetition block count mismatch.`
  );

  assert(
    plan.requestBodySummary.primaryIntensityMetric === responseStructure.primaryIntensityMetric,
    `${caseId}: requestBodySummary primaryIntensityMetric mismatch.`
  );
  assert(plan.requestBodySummary.structureSerialized, `${caseId}: requestBodySummary.structureSerialized expected true.`);
  assert(plan.requestBodySummary.hasStructure, `${caseId}: requestBodySummary.hasStructure expected true.`);
  assertApprox(
    plan.requestBodySummary.totalTimePlanned,
    responseSample.totalTimePlanned,
    `${caseId}: requestBodySummary totalTimePlanned mismatch`
  );
  assert(plan.validation.status !== "invalid", `${caseId}: validation status must not be invalid.`);
  assert(
    plan.validation.warnings.some((item) => item.includes("wrapper inferred")),
    `${caseId}: expected explicit warning about request-side structure wrapper inference.`
  );
  assert(!containsSecrets(JSON.stringify(plan)), `${caseId}: plan appears to contain secret-like token.`);
  assert(fixture.redaction?.secretsFound === false, `${caseId}: fixture redaction.secretsFound must be false.`);
}

function main(): void {
  const basicFixture = loadFixture(BASIC_CREATE_FIXTURE);
  validateBasicCreateFixtureEnvelope(basicFixture);

  const definitions = buildRunningWorkoutFixtureAlignedDefinitions();
  assert(definitions.length === 4, "Expected 4 fixture-aligned definitions.");

  for (const definition of definitions) {
    const fixture = loadFixture(CASE_FIXTURES[definition.caseId]);
    validateCase(definition.caseId, fixture);
    console.log(`[check-running-workout-create-plan] case ${definition.caseId}: valid`);
  }

  console.log("[check-running-workout-create-plan] PASS");
}

try {
  main();
} catch (error) {
  console.error("[check-running-workout-create-plan] FAIL");
  console.error(error);
  process.exit(1);
}
