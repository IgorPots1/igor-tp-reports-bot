import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const createScriptPath = path.join(__dirname, "tp-create-test-strength-workout.ts");
const scanScriptPath = path.join(__dirname, "tp-workouts-cache-scan.ts");
const actionsOnceScriptPath = path.join(__dirname, "tp-actions-once.ts");
const actionsLoopScriptPath = path.join(__dirname, "tp-actions-loop.ts");

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const createScript = readFileSync(createScriptPath, "utf8");
  const scanScript = readFileSync(scanScriptPath, "utf8");
  const actionsOnceScript = readFileSync(actionsOnceScriptPath, "utf8");
  const actionsLoopScript = readFileSync(actionsLoopScriptPath, "utf8");

  assert(
    createScript.includes("strengthBuilderProfileDir"),
    "tp-create-test-strength-workout.ts must use strengthBuilderProfileDir."
  );
  assert(
    createScript.includes('from "./lib/paths.ts"') && createScript.includes("strengthBuilderProfileDir"),
    "tp-create-test-strength-workout.ts must import strengthBuilderProfileDir from ./lib/paths.ts."
  );
  assert(
    !createScript.includes("launchPersistentContext(profileDir"),
    "tp-create-test-strength-workout.ts must not launch with generic profileDir."
  );

  assert(
    !scanScript.includes("strengthBuilderProfileDir"),
    "tp-workouts-cache-scan.ts must not use strengthBuilderProfileDir."
  );
  assert(
    !actionsOnceScript.includes("strengthBuilderProfileDir"),
    "tp-actions-once.ts must not use strengthBuilderProfileDir."
  );
  assert(
    !actionsLoopScript.includes("strengthBuilderProfileDir"),
    "tp-actions-loop.ts must not use strengthBuilderProfileDir."
  );

  console.log("[check-strength-builder-profile-routing] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-strength-builder-profile-routing] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
