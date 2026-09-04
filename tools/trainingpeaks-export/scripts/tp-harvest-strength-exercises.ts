import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import * as tpApiClientModule from "../../../src/features/trainingpeaks/tp-api-client.ts";

import type { StrengthExerciseRecord } from "./lib/strength-workout-renderer.ts";

/**
 * Harvests real TrainingPeaks exercise records out of existing StructuredStrength
 * workouts, so strength workouts can be rendered offline afterwards.
 *
 * Why this exists: TP exercise ids (prescriptions[].exercise.id, e.g. "26") live
 * only inside TP. There is no committed catalog, and the exerciselibrary/v2
 * endpoint returns workout templates, not New-Strength-Builder exercises. The
 * one surface that reliably returns fully-populated exercise records is
 * GET /rx/activity/v1/workouts/{id} on a workout that already uses them.
 *
 * READ-ONLY: this script only issues GETs. It never saves, updates or deletes.
 *
 * Usage:
 *   npx tsx scripts/tp-harvest-strength-exercises.ts --workout-id 22291958
 *   npx tsx scripts/tp-harvest-strength-exercises.ts --workout-ids 111,222,333
 *   ... --out reports/strength-exercise-library/library.json   (default)
 *
 * The output file is merged, not overwritten, so the library grows as more
 * workouts are harvested.
 */

// CJS/ESM boundary workaround -- same pattern as tp-write-executor-once.ts.
type NamespaceWithOptionalDefault<T> = T & { default?: T };
const tpApiClientCompat = tpApiClientModule as NamespaceWithOptionalDefault<typeof tpApiClientModule>;
const getStrengthWorkout = tpApiClientCompat.getStrengthWorkout ?? tpApiClientCompat.default?.getStrengthWorkout;

if (typeof getStrengthWorkout !== "function") {
  throw new Error("tp-api-client.getStrengthWorkout is unavailable across the module boundary.");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(toolRoot, "..", "..");

function loadDotEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) {
    loadDotEnvFile(envPath);
  }
}

type HarvestedLibrary = {
  harvestedAt: string;
  sourceWorkoutIds: string[];
  exercises: StrengthExerciseRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Normalizes a TP exercise object into a renderer-ready record. Per-parameter
 * ids are dropped on purpose: the renderer regenerates them (library-local "0"
 * inside `exercise`, fresh UUIDs at prescription level).
 */
function normalizeExercise(raw: unknown): StrengthExerciseRecord | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  const title = raw.title;
  if (typeof id !== "string" || !id) return null;
  if (typeof title !== "string" || !title) return null;

  const parameters = asArray(raw.parameters).flatMap((parameter) => {
    if (!isRecord(parameter)) return [];
    const name = parameter.parameter;
    const parameterTitle = parameter.title;
    if (typeof name !== "string" || typeof parameterTitle !== "string") return [];
    const unit = isRecord(parameter.unit) ? parameter.unit : {};
    return [
      {
        parameter: name,
        title: parameterTitle,
        unit: {
          title: typeof unit.title === "string" ? unit.title : "",
          abbreviation: typeof unit.abbreviation === "string" ? unit.abbreviation : "",
          unit: typeof unit.unit === "string" ? unit.unit : "",
        },
        category: typeof parameter.category === "string" ? parameter.category : parameterTitle,
      },
    ];
  });

  if (parameters.length === 0) return null;

  return {
    id,
    ownerId: typeof raw.ownerId === "number" ? raw.ownerId : 2000301,
    title,
    videoUrl: typeof raw.videoUrl === "string" ? raw.videoUrl : null,
    instructions: typeof raw.instructions === "string" ? raw.instructions : null,
    parameters,
    canEdit: raw.canEdit === true,
  };
}

function collectExercises(workout: Record<string, unknown>): StrengthExerciseRecord[] {
  const found: StrengthExerciseRecord[] = [];
  for (const block of asArray(workout.blocks)) {
    if (!isRecord(block)) continue;
    for (const prescription of asArray(block.prescriptions)) {
      if (!isRecord(prescription)) continue;
      const exercise = normalizeExercise(prescription.exercise);
      if (exercise) found.push(exercise);
    }
  }
  return found;
}

function parseArgs(argv: string[]): { workoutIds: string[]; outPath: string } {
  const workoutIds: string[] = [];
  let outPath = path.join(repoRoot, "reports", "strength-exercise-library", "library.json");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workout-id") {
      const value = argv[index + 1];
      if (value) workoutIds.push(value.trim());
      index += 1;
    } else if (arg === "--workout-ids") {
      const value = argv[index + 1] ?? "";
      for (const part of value.split(",")) {
        if (part.trim()) workoutIds.push(part.trim());
      }
      index += 1;
    } else if (arg === "--out") {
      const value = argv[index + 1];
      if (value) outPath = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
      index += 1;
    }
  }

  return { workoutIds, outPath };
}

function readExistingLibrary(outPath: string): HarvestedLibrary {
  if (!existsSync(outPath)) {
    return { harvestedAt: "", sourceWorkoutIds: [], exercises: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(outPath, "utf8")) as Partial<HarvestedLibrary>;
    return {
      harvestedAt: typeof parsed.harvestedAt === "string" ? parsed.harvestedAt : "",
      sourceWorkoutIds: Array.isArray(parsed.sourceWorkoutIds) ? parsed.sourceWorkoutIds.map(String) : [],
      exercises: Array.isArray(parsed.exercises) ? (parsed.exercises as StrengthExerciseRecord[]) : [],
    };
  } catch {
    console.warn(`Could not parse existing library at ${outPath}; starting a fresh one.`);
    return { harvestedAt: "", sourceWorkoutIds: [], exercises: [] };
  }
}

function printUsage(): void {
  console.log("tp-harvest-strength-exercises -- read TP exercise records out of existing strength workouts");
  console.log("");
  console.log("Usage:");
  console.log("  npx tsx scripts/tp-harvest-strength-exercises.ts --workout-id <id> [--workout-id <id> ...]");
  console.log("  npx tsx scripts/tp-harvest-strength-exercises.ts --workout-ids <id,id,id>");
  console.log("  [--out reports/strength-exercise-library/library.json]");
  console.log("");
  console.log("Read-only: issues GET /rx/activity/v1/workouts/{id} only. Never writes to TrainingPeaks.");
  console.log("Find the id in the Strength Builder URL of an existing strength workout.");
}

async function main(): Promise<void> {
  loadLocalEnv();
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    printUsage();
    return;
  }

  const { workoutIds, outPath } = parseArgs(argv);
  if (workoutIds.length === 0) {
    printUsage();
    throw new Error("No --workout-id / --workout-ids given.");
  }

  const library = readExistingLibrary(outPath);
  const byId = new Map(library.exercises.map((exercise) => [exercise.id, exercise]));
  const knownSources = new Set(library.sourceWorkoutIds);
  const addedTitles: string[] = [];

  for (const workoutId of workoutIds) {
    console.log(`GET /rx/activity/v1/workouts/${workoutId} ...`);
    const workout = await getStrengthWorkout(workoutId);
    const exercises = collectExercises(workout);
    if (exercises.length === 0) {
      console.warn(`  no exercises found (is ${workoutId} a StructuredStrength workout?)`);
      continue;
    }
    for (const exercise of exercises) {
      if (!byId.has(exercise.id)) addedTitles.push(`${exercise.title} (id ${exercise.id})`);
      // Re-harvesting refreshes the record; TP is the source of truth.
      byId.set(exercise.id, exercise);
    }
    knownSources.add(String(workoutId));
    console.log(`  ${exercises.length} exercise record(s) read`);
  }

  const merged: HarvestedLibrary = {
    harvestedAt: new Date().toISOString(),
    sourceWorkoutIds: [...knownSources].sort(),
    exercises: [...byId.values()].sort((left, right) => left.title.localeCompare(right.title)),
  };

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`Library: ${merged.exercises.length} exercise(s) -> ${path.relative(repoRoot, outPath)}`);
  if (addedTitles.length > 0) {
    console.log(`New this run (${addedTitles.length}):`);
    for (const title of addedTitles) console.log(`  + ${title}`);
  } else {
    console.log("No new exercises this run.");
  }
  console.log("");
  console.log("Available exercises:");
  for (const exercise of merged.exercises) {
    const parameters = exercise.parameters.map((parameter) => parameter.parameter).join(", ");
    console.log(`  ${exercise.id.padStart(6)}  ${exercise.title}  [${parameters}]`);
  }
}

main().catch((error: unknown) => {
  console.error("tp-harvest-strength-exercises failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
