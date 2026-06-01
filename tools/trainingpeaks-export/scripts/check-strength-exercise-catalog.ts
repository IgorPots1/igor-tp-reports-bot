import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildStrengthExerciseCatalog } from "./lib/strength-exercise-catalog.ts";
import { parseExerciseCachePayload } from "./lib/strength-template-matcher.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, "fixtures", "strength-exercises.fixture.json");

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function loadFixtureExercises() {
  const raw = readFileSync(fixturePath, "utf8");
  const payload = JSON.parse(raw) as unknown;
  return parseExerciseCachePayload(payload);
}

function run(): void {
  const exercises = loadFixtureExercises();
  const catalog = buildStrengthExerciseCatalog(exercises);

  assert(catalog.summaryJson.totalExercises === exercises.length, "Expected summary exercise count to match fixture.");
  assert(catalog.summaryJson.totalLibraries === 1, "Expected one library in fixture summary.");
  assert(catalog.summaryJson.libraries[0]?.itemCount === exercises.length, "Expected library item count to match fixture.");

  assert(catalog.summaryMarkdown.includes("Total exercises:"), "Expected totals section in summary markdown.");
  assert(catalog.byLibraryMarkdown.includes("Fixture Library"), "Expected fixture library in by-library markdown.");
  assert(catalog.searchIndexMarkdown.includes("## B"), "Expected B bucket in search index.");
  assert(catalog.searchIndexMarkdown.includes("- Banded Glute Bridge"), "Expected Banded Glute Bridge in search index.");

  const gluteGroup = catalog.summaryJson.keywordGroups.glute_bridge;
  assert(gluteGroup.count >= 2, "Expected at least two glute bridge matches in fixture.");
  assert(
    gluteGroup.items.some((item) => item.itemName === "Glute Bridge"),
    "Expected Glute Bridge in glute keyword group.",
  );

  const calfGroup = catalog.summaryJson.keywordGroups.calf_raise;
  assert(calfGroup.count >= 1, "Expected calf raise matches in fixture.");

  const stepGroup = catalog.summaryJson.keywordGroups.step_up;
  assert(stepGroup.count >= 1, "Expected step up matches in fixture.");

  const emptyGroup = catalog.summaryJson.keywordGroups.mobility_ankle;
  assert(emptyGroup.count === 0, "Expected no mobility matches in minimal fixture.");

  // Safety guard: this check must stay fixture-only.
  const allowedImports = ["./lib/strength-exercise-catalog.ts", "./lib/strength-template-matcher.ts"];
  const selfSource = readFileSync(__filename, "utf8");
  const importLines = selfSource.split("\n").filter((line) => line.trim().startsWith("import "));
  for (const line of importLines) {
    const isNodeBuiltin = /from\s+["']node:/.test(line);
    const isAllowedLocal = allowedImports.some((specifier) => line.includes(specifier));
    assert(isNodeBuiltin || isAllowedLocal, `Unexpected import in check script: ${line.trim()}`);
  }

  console.log("check-strength-exercise-catalog: ok");
  console.log(`- fixture: ${fixturePath}`);
  console.log(`- exercises: ${exercises.length}`);
  console.log(`- keyword groups: ${Object.keys(catalog.summaryJson.keywordGroups).length}`);
}

try {
  run();
} catch (error) {
  console.error("check-strength-exercise-catalog failed.");
  console.error(error);
  process.exit(1);
}
