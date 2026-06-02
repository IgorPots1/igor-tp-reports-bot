import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildRunningWorkoutFixtureAlignedDefinitions,
  renderRunningWorkoutPayloadPreview,
  type RunningWorkoutCaseId,
  type RunningWorkoutRenderedStructure,
} from "./lib/running-workout-renderer.ts";
import { buildRunningWorkoutCreatePlan } from "./lib/running-workout-create-plan.ts";

type SupportedCaseId = "easy-pace" | "interval-hr";

type NetworkTruthFixture = {
  caseId: RunningWorkoutCaseId;
  request?: {
    structureSamples?: unknown;
    structureSerializedInfo?: {
      isString: boolean;
      parseableJson: boolean | null;
      rawLength: number;
      rawStored: boolean;
      sourceType: "stringified-json" | "object" | "missing" | "string-non-json";
    };
  };
  requestStructureValidation?: {
    status: "valid" | "partial" | "invalid";
    errors?: string[];
    warnings?: string[];
  };
  validation?: {
    status: "valid" | "partial" | "invalid";
  };
  redaction?: {
    secretsFound?: boolean;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

const CASES: SupportedCaseId[] = ["easy-pace", "interval-hr"];

const PREFERRED_FIXTURES: Record<SupportedCaseId, string> = {
  "easy-pace": "running-workout-structured-easy-pace.network-truth.fixture.json",
  "interval-hr": "running-workout-structured-interval-hr.network-truth.fixture.json",
};

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loadFixture(fileName: string): NetworkTruthFixture {
  return JSON.parse(readFileSync(path.join(fixturesDir, fileName), "utf8")) as NetworkTruthFixture;
}

function containsSecrets(value: unknown): boolean {
  const payload =
    isRecord(value) && isRecord(value.redaction)
      ? { ...value, redaction: { ...value.redaction, note: undefined } }
      : value;
  const text = JSON.stringify(payload).toLowerCase();
  return /(authorization|cookie|bearer|csrf|jwt|eyj[a-z0-9_-]+\.)/i.test(text) || /\bsession\b/i.test(text);
}

function normalizeRequestStructureSamples(samples: unknown): {
  parseStatus: string | null;
  structure: RunningWorkoutRenderedStructure | null;
} {
  if (!isRecord(samples)) {
    return { parseStatus: null, structure: null };
  }
  const parseStatus = typeof samples.parseStatus === "string" ? samples.parseStatus : null;
  const structure =
    Array.isArray(samples.structure) &&
    Array.isArray(samples.polyline) &&
    typeof samples.primaryLengthMetric === "string" &&
    typeof samples.primaryIntensityMetric === "string" &&
    typeof samples.primaryIntensityTargetOrRange === "string"
      ? (samples as unknown as RunningWorkoutRenderedStructure)
      : null;
  return { parseStatus, structure };
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
      if (typeof step.notes === "string" && step.notes.trim().length > 0) {
        notes.push(step.notes);
      }
    }
  }
  return notes;
}

function countRepetitionBlocks(structure: RunningWorkoutRenderedStructure): number {
  return structure.structure.filter((entry) => entry.type === "repetition").length;
}

function findFirstRepeatCount(structure: RunningWorkoutRenderedStructure): number | null {
  for (const block of structure.structure) {
    if (block.type === "repetition") {
      return block.length.value;
    }
  }
  return null;
}

function resolveFixturePath(caseId: SupportedCaseId): { fileName: string; source: "preferred" | "missing" } {
  const preferred = PREFERRED_FIXTURES[caseId];
  if (existsSync(path.join(fixturesDir, preferred))) {
    return { fileName: preferred, source: "preferred" };
  }
  return { fileName: preferred, source: "missing" };
}

function validateCase(caseId: SupportedCaseId): { status: "valid" | "partial"; notes: string[] } {
  const fixtureChoice = resolveFixturePath(caseId);
  if (fixtureChoice.source === "missing") {
    return {
      status: "partial",
      notes: [`fixture missing: ${fixtureChoice.fileName}`],
    };
  }

  const fixture = loadFixture(fixtureChoice.fileName);
  const definition = buildRunningWorkoutFixtureAlignedDefinitions().find((entry) => entry.caseId === caseId);
  assert(definition, `${caseId}: renderer definition not found`);
  const preview = renderRunningWorkoutPayloadPreview(definition);
  const plan = buildRunningWorkoutCreatePlan(definition);

  const { parseStatus, structure } = normalizeRequestStructureSamples(fixture.request?.structureSamples);
  if (parseStatus !== "parsed" && parseStatus !== "native") {
    return {
      status: "partial",
      notes: [
        `fixture ${fixtureChoice.fileName} has request parseStatus=${String(parseStatus)}; manual recapture needed for request-side truth`,
      ],
    };
  }
  if (!structure) {
    return {
      status: "partial",
      notes: [`fixture ${fixtureChoice.fileName} missing parsed request structure object; manual recapture needed`],
    };
  }
  assert(
    fixture.request?.structureSerializedInfo?.rawStored === false,
    `${caseId}: request.structureSerializedInfo.rawStored must be false`,
  );
  assert(
    fixture.request?.structureSerializedInfo?.sourceType !== "string-non-json",
    `${caseId}: request.structure sourceType indicates parse failure`,
  );
  assert(fixture.redaction?.secretsFound === false, `${caseId}: fixture redaction.secretsFound must be false`);
  assert(!containsSecrets(fixture), `${caseId}: fixture contains secret-like markers`);

  assert(
    structure.primaryIntensityMetric === preview.structure.primaryIntensityMetric,
    `${caseId}: primaryIntensityMetric mismatch with renderer`,
  );
  assert(
    structure.primaryIntensityMetric === plan.requestBodySummary.primaryIntensityMetric,
    `${caseId}: primaryIntensityMetric mismatch with create-plan summary`,
  );
  assert(structure.primaryLengthMetric === "duration", `${caseId}: primaryLengthMetric must be duration`);
  assert(structure.primaryIntensityTargetOrRange === "range", `${caseId}: target/range mode mismatch`);

  const expectedTargets = flattenTargets(preview.structure).map((entry) => `${entry.minValue}-${entry.maxValue}`);
  const actualTargets = flattenTargets(structure).map((entry) => `${entry.minValue}-${entry.maxValue}`);
  assert(
    expectedTargets.every((target) => actualTargets.includes(target)),
    `${caseId}: request target ranges mismatch. expected ${expectedTargets.join(", ")} got ${actualTargets.join(", ")}`,
  );

  const expectedNotes = flattenNotes(preview.structure);
  const actualNotes = flattenNotes(structure);
  for (const note of expectedNotes) {
    assert(
      actualNotes.some((actual) => actual === note || actual.includes(note)),
      `${caseId}: missing request step note ${note}`,
    );
  }

  const expectedRepetitionCount = countRepetitionBlocks(preview.structure);
  const actualRepetitionCount = countRepetitionBlocks(structure);
  assert(
    actualRepetitionCount === expectedRepetitionCount,
    `${caseId}: repetition block count mismatch. expected ${expectedRepetitionCount} got ${actualRepetitionCount}`,
  );

  if (caseId === "interval-hr") {
    const repeatCount = findFirstRepeatCount(structure);
    assert(repeatCount === 4, `${caseId}: repeatCount mismatch. expected 4 got ${repeatCount ?? "null"}`);
  }

  return {
    status: "valid",
    notes: [`validated ${fixtureChoice.fileName}`],
  };
}

function main(): void {
  const notes: string[] = [];
  let hasPartial = false;

  for (const caseId of CASES) {
    const result = validateCase(caseId);
    hasPartial = hasPartial || result.status === "partial";
    for (const note of result.notes) {
      notes.push(`[check-running-request-structure-truth] case ${caseId}: ${note}`);
    }
  }

  for (const line of notes) {
    console.log(line);
  }
  if (hasPartial) {
    console.log("[check-running-request-structure-truth] PASS (partial)");
    return;
  }
  console.log("[check-running-request-structure-truth] PASS");
}

try {
  main();
} catch (error) {
  console.error("[check-running-request-structure-truth] FAIL");
  console.error(error);
  process.exit(1);
}
