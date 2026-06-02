import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildRunningWorkoutFixtureAlignedDefinitions,
  renderRunningWorkoutPayloadPreview,
  type RunningWorkoutCaseId,
  type RunningWorkoutPayloadPreview,
  type RunningWorkoutRenderedStructure,
} from "./lib/running-workout-renderer.ts";

type Fixture = {
  caseId: RunningWorkoutCaseId;
  redaction?: { secretsFound?: boolean };
  request: {
    bodyFieldSamples: {
      title: string;
      description: string;
      workoutTypeValueId: number;
      totalTimePlanned: number;
      structure: string;
    };
  };
  response: {
    bodyFieldSamples: {
      title: string;
      description: string;
      workoutTypeValueId: number;
      totalTimePlanned: number;
    };
    structureSamples: RunningWorkoutRenderedStructure;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

const FIXTURE_BY_CASE_ID: Record<RunningWorkoutCaseId, string> = {
  "easy-pace": "running-workout-structured-easy-pace.network-truth.fixture.json",
  "easy-hr": "running-workout-structured-easy-hr.network-truth.fixture.json",
  "interval-pace": "running-workout-structured-interval-pace.network-truth.fixture.json",
  "interval-hr": "running-workout-structured-interval-hr.network-truth.fixture.json",
};

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApprox(actual: number, expected: number, message: string): void {
  const delta = Math.abs(actual - expected);
  if (delta > 1e-9) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function loadFixture(caseId: RunningWorkoutCaseId): Fixture {
  const fileName = FIXTURE_BY_CASE_ID[caseId];
  const fullPath = path.join(fixturesDir, fileName);
  return JSON.parse(readFileSync(fullPath, "utf8")) as Fixture;
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

function containsSecrets(value: string): boolean {
  return /(authorization|bearer|cookie|session|csrf|jwt)/i.test(value);
}

function validateAllCaseFields(
  caseId: RunningWorkoutCaseId,
  rendered: RunningWorkoutPayloadPreview,
  fixture: Fixture
): void {
  assert(fixture.redaction?.secretsFound === false, `${caseId}: fixture redaction must indicate secretsFound=false.`);
  assert(rendered.workoutId === 0, `${caseId}: workoutId must stay 0 in dry-run preview.`);
  assert(rendered.title === fixture.response.bodyFieldSamples.title, `${caseId}: title mismatch.`);
  assert(rendered.description === fixture.response.bodyFieldSamples.description, `${caseId}: description mismatch.`);
  assert(
    rendered.workoutTypeValueId === fixture.response.bodyFieldSamples.workoutTypeValueId,
    `${caseId}: workoutTypeValueId mismatch.`
  );
  assertApprox(
    rendered.totalTimePlanned,
    fixture.response.bodyFieldSamples.totalTimePlanned,
    `${caseId}: totalTimePlanned mismatch`
  );
  assert(rendered.structure.structure.length > 0, `${caseId}: structure must contain blocks.`);
  assert(rendered.structureSerialized.length > 0, `${caseId}: structureSerialized must not be empty.`);
  assert(
    rendered.structure.primaryIntensityMetric === fixture.response.structureSamples.primaryIntensityMetric,
    `${caseId}: primaryIntensityMetric mismatch.`
  );
  assert(rendered.structure.primaryLengthMetric === "duration", `${caseId}: primaryLengthMetric must be duration.`);
  assert(
    rendered.structure.primaryIntensityTargetOrRange === "range",
    `${caseId}: primaryIntensityTargetOrRange must be range.`
  );
  assert(!containsSecrets(JSON.stringify(rendered)), `${caseId}: rendered payload appears to contain a secret-like token.`);
}

function validateEasyCase(
  caseId: "easy-pace" | "easy-hr",
  rendered: RunningWorkoutPayloadPreview,
  fixture: Fixture
): void {
  assert(rendered.structure.structure.length === 1, `${caseId}: expected single top-level block.`);
  assert(rendered.structure.structure[0]?.type === "step", `${caseId}: top-level block must be step.`);
  const top = rendered.structure.structure[0];
  if (!top || top.type !== "step") {
    throw new Error(`${caseId}: expected step block.`);
  }
  assert(top.steps.length === 1, `${caseId}: expected one step.`);
  assert(top.steps[0]?.intensityClass === "active", `${caseId}: expected active step.`);
  const target = top.steps[0]?.targets[0];
  assert(Boolean(target), `${caseId}: missing target.`);
  const fixtureTarget = fixture.response.structureSamples.structure[0]?.steps[0]?.targets[0];
  assert(target?.minValue === fixtureTarget?.minValue, `${caseId}: min target mismatch.`);
  assert(target?.maxValue === fixtureTarget?.maxValue, `${caseId}: max target mismatch.`);
  const notes = flattenNotes(rendered.structure);
  assert(notes.length === 1, `${caseId}: expected one note.`);
  assert(notes[0] === fixture.response.structureSamples.structure[0]?.steps[0]?.notes, `${caseId}: note mismatch.`);
  assert(!rendered.structure.structure.some((node) => node.type === "repetition"), `${caseId}: repetition not expected.`);
}

function validateIntervalCase(
  caseId: "interval-pace" | "interval-hr",
  rendered: RunningWorkoutPayloadPreview,
  fixture: Fixture
): void {
  assert(rendered.structure.structure.length === 3, `${caseId}: expected warmup + repetition + cooldown.`);
  const [warmup, repetition, cooldown] = rendered.structure.structure;
  assert(warmup?.type === "step", `${caseId}: warmup block must be step.`);
  assert(repetition?.type === "repetition", `${caseId}: middle block must be repetition.`);
  assert(cooldown?.type === "step", `${caseId}: cooldown block must be step.`);
  if (!warmup || warmup.type !== "step" || !repetition || repetition.type !== "repetition" || !cooldown || cooldown.type !== "step") {
    throw new Error(`${caseId}: invalid interval structure.`);
  }

  assert(repetition.length.value === 4, `${caseId}: repeat count must be 4.`);
  assert(repetition.steps.length === 2, `${caseId}: repetition must contain hard/recovery steps.`);
  assert(repetition.steps[0]?.name === "Hard", `${caseId}: first repetition step must be Hard.`);
  assert(repetition.steps[1]?.name === "Easy", `${caseId}: second repetition step must be Easy.`);
  assert(repetition.steps[0]?.intensityClass === "active", `${caseId}: hard step intensityClass must be active.`);
  assert(repetition.steps[1]?.intensityClass === "rest", `${caseId}: recovery step intensityClass must be rest.`);
  assert(warmup.steps[0]?.name === "Warm up", `${caseId}: warmup step name mismatch.`);
  assert(cooldown.steps[0]?.name === "Cool down", `${caseId}: cooldown step name mismatch.`);

  const fixtureRep = fixture.response.structureSamples.structure[1];
  assert(fixtureRep?.type === "repetition", `${caseId}: fixture repetition block missing.`);
  assert(repetition.length.value === fixtureRep?.length.value, `${caseId}: fixture repeat count mismatch.`);

  const ranges = flattenTargets(rendered.structure).map((range) => `${range.minValue}-${range.maxValue}`);
  const expectedRanges = flattenTargets(fixture.response.structureSamples).map(
    (range) => `${range.minValue}-${range.maxValue}`
  );
  assert(
    expectedRanges.every((range) => ranges.includes(range)),
    `${caseId}: target ranges mismatch. expected ${expectedRanges.join(", ")} got ${ranges.join(", ")}`
  );

  const notes = flattenNotes(rendered.structure);
  const expectedNotes = flattenNotes(fixture.response.structureSamples);
  for (const note of expectedNotes) {
    for (const marker of note.split("\n").map((line) => line.trim()).filter(Boolean)) {
      assert(notes.includes(marker), `${caseId}: missing note ${marker}`);
    }
  }
}

function run(): void {
  const definitions = buildRunningWorkoutFixtureAlignedDefinitions();
  assert(definitions.length === 4, "Expected 4 fixture-aligned running workout definitions.");

  for (const definition of definitions) {
    const fixture = loadFixture(definition.caseId);
    const rendered = renderRunningWorkoutPayloadPreview(definition);
    validateAllCaseFields(definition.caseId, rendered, fixture);
    if (definition.caseId === "easy-pace" || definition.caseId === "easy-hr") {
      validateEasyCase(definition.caseId, rendered, fixture);
    } else {
      validateIntervalCase(definition.caseId, rendered, fixture);
    }

    assert(
      rendered.structureSerialized === JSON.stringify(rendered.structure),
      `${definition.caseId}: structureSerialized mismatch.`
    );
    assert(
      fixture.request.bodyFieldSamples.structure === "[captured in structureSamples]",
      `${definition.caseId}: fixture request structure marker expected.`
    );
  }

  console.log("[check-running-workout-renderer] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-running-workout-renderer] FAIL");
  console.error(error);
  process.exit(1);
}
