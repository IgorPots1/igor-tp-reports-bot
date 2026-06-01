import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildExerciseDbCandidates,
  buildExerciseDbKeywordHits,
  classifyExerciseDbCandidate,
  summarizeExerciseDbFindings,
  type CapturedCallLike,
} from "./lib/strength-exercise-db-capture.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, "fixtures", "strength-exercise-db-capture.fixture.json");

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type FixturePayload = {
  calls: CapturedCallLike[];
};

function run(): void {
  const raw = readFileSync(fixturePath, "utf8");
  const fixture = JSON.parse(raw) as FixturePayload;

  const templateClassification = classifyExerciseDbCandidate({
    endpointPattern: fixture.calls[0].endpointPattern,
    method: fixture.calls[0].method,
    tags: fixture.calls[0].tags,
    requestBodyShape: fixture.calls[0].request.bodyShape,
    responseBodyShape: fixture.calls[0].response.bodyShape,
    sampleSanitizedNames: fixture.calls[0].response.sampleSanitizedNames ?? [],
  });
  assert(templateClassification === "workout-template-library", "Expected exerciselibrary/v2 to classify as workout-template-library.");

  const exerciseDbClassification = classifyExerciseDbCandidate({
    endpointPattern: fixture.calls[1].endpointPattern,
    method: fixture.calls[1].method,
    tags: fixture.calls[1].tags,
    requestBodyShape: fixture.calls[1].request.bodyShape,
    responseBodyShape: fixture.calls[1].response.bodyShape,
    sampleSanitizedNames: fixture.calls[1].response.sampleSanitizedNames ?? [],
  });
  assert(exerciseDbClassification === "exercise-db-like", "Expected strength exercise endpoint to classify as exercise-db-like.");

  const candidates = buildExerciseDbCandidates(fixture.calls);
  assert(candidates.length === 2, "Expected two exercise-db candidates from fixture.");

  const findings = summarizeExerciseDbFindings(candidates);
  assert(findings.workoutTemplateLibraryConfirmed, "Expected workout template library confirmation.");
  assert(findings.exerciseDbLikeEndpoints.includes(fixture.calls[1].endpointPattern), "Expected exercise-db-like endpoint in findings.");

  const keywordHits = buildExerciseDbKeywordHits(candidates);
  assert(keywordHits.glute_bridge?.sampleNames.includes("Glute Bridge"), "Expected Glute Bridge keyword hit.");
  assert(keywordHits.calf_raise?.sampleNames.some((name) => name.includes("Calf")), "Expected calf raise keyword hit.");
  assert(keywordHits.deadlift?.sampleNames.includes("Romanian Deadlift"), "Expected Romanian Deadlift keyword hit.");

  const allowedImports = ["./lib/strength-exercise-db-capture.ts"];
  const selfSource = readFileSync(__filename, "utf8");
  const importBlocks = selfSource.match(/import[\s\S]*?from\s+["'][^"']+["'];?/g) ?? [];
  for (const block of importBlocks) {
    const isNodeBuiltin = /from\s+["']node:/.test(block);
    const isAllowedLocal = allowedImports.some((specifier) => block.includes(specifier));
    assert(isNodeBuiltin || isAllowedLocal, `Unexpected import in check script: ${block.trim()}`);
  }

  console.log("check-strength-exercise-db-capture: ok");
  console.log(`- fixture: ${fixturePath}`);
  console.log(`- candidates: ${candidates.length}`);
  console.log(`- keyword groups: ${Object.keys(keywordHits).length}`);
}

try {
  run();
} catch (error) {
  console.error("check-strength-exercise-db-capture failed.");
  console.error(error);
  process.exit(1);
}
