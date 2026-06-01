import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildTemplateReview, matchExerciseName, parseExerciseCachePayload } from "./lib/strength-template-matcher.ts";
import { STRENGTH_TEMPLATES } from "./lib/strength-templates.ts";

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

  const exact = matchExerciseName("Calf Raise", exercises);
  assert(exact.status === "matched", "Expected exact match for Calf Raise.");
  assert(exact.confidence === 1, "Expected exact match confidence 1.");
  assert(exact.exerciseLibraryItemId === "fixture-item-6", "Expected Calf Raise fixture item id.");

  const alias = matchExerciseName("RDL", exercises);
  assert(alias.status === "matched", "Expected alias match for RDL -> Romanian Deadlift.");
  assert(alias.matchedName === "Romanian Deadlift", "Expected alias to resolve to Romanian Deadlift.");

  const ambiguous = matchExerciseName("Squat", exercises);
  assert(ambiguous.status === "ambiguous", "Expected ambiguous match for Squat.");
  assert(ambiguous.alternatives.length >= 2, "Expected at least two alternatives for ambiguous Squat match.");

  const missing = matchExerciseName("Nonexistent Exercise XYZ", exercises);
  assert(missing.status === "missing", "Expected missing match for unknown exercise.");
  assert(missing.confidence === 0, "Expected zero confidence for missing exercise.");

  const reviews = STRENGTH_TEMPLATES.map((template) => buildTemplateReview(template, exercises));
  assert(reviews.length === 2, "Expected two template review objects.");

  for (const review of reviews) {
    assert(review.templateId.length > 0, "Expected non-empty template id.");
    assert(review.blocks.length > 0, `Expected blocks for template ${review.templateId}.`);
    assert(review.summary.totalExercises > 0, `Expected exercises in template ${review.templateId}.`);
    for (const block of review.blocks) {
      for (const exercise of block.exercises) {
        assert(exercise.match.requestedName.length > 0, "Expected requestedName in template exercise match.");
        assert(["matched", "ambiguous", "missing"].includes(exercise.match.status), "Expected valid match status.");
      }
    }
  }

  const baseReview = reviews.find((review) => review.templateId === "strength_for_runners_base");
  assert(baseReview, "Expected strength_for_runners_base review.");
  assert(baseReview.summary.matchedCount >= 5, "Expected most base template exercises to match fixture.");

  const prehabReview = reviews.find((review) => review.templateId === "knee_support_runner_prehab");
  assert(prehabReview, "Expected knee_support_runner_prehab review.");

  // Safety guard: this check must stay fixture-only.
  const allowedImports = ["./lib/strength-template-matcher.ts", "./lib/strength-templates.ts"];
  const selfSource = readFileSync(__filename, "utf8");
  const importLines = selfSource.split("\n").filter((line) => line.trim().startsWith("import "));
  for (const line of importLines) {
    const isNodeBuiltin = /from\s+["']node:/.test(line);
    const isAllowedLocal = allowedImports.some((specifier) => line.includes(specifier));
    assert(isNodeBuiltin || isAllowedLocal, `Unexpected import in check script: ${line.trim()}`);
  }

  console.log("check-strength-template-matcher: ok");
  console.log(`- fixture: ${fixturePath}`);
  console.log(`- exercises: ${exercises.length}`);
  console.log(`- templates reviewed: ${reviews.length}`);
}

try {
  run();
} catch (error) {
  console.error("check-strength-template-matcher failed.");
  console.error(error);
  process.exit(1);
}
