import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { buildStrengthExerciseCatalog } from "./lib/strength-exercise-catalog.ts";
import { parseExerciseCachePayload } from "./lib/strength-template-matcher.ts";
import { toolRoot } from "./lib/paths.ts";

const repoRoot = path.resolve(toolRoot, "..", "..");
const defaultExerciseCachePath = path.join(
  repoRoot,
  "reports",
  "strength-builder-catalog",
  "trainingpeaks-strength-exercises.live.json",
);
const defaultOutDir = path.join(repoRoot, "reports", "strength-builder-catalog");

type CliArgs = {
  help: boolean;
  exerciseCache: string;
  outDir: string;
};

function printHelp(): void {
  console.log("Generate coach-review catalog from TrainingPeaks exercise cache (read-only)");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npm run tp:generate-strength-exercise-catalog -- --exercise-cache reports/strength-builder-catalog/trainingpeaks-strength-exercises.live.json --out reports/strength-builder-catalog",
  );
  console.log("");
  console.log("Options:");
  console.log(`  --exercise-cache=<path>  Exercise cache JSON (default: ${defaultExerciseCachePath})`);
  console.log(`  --out=<path>             Output directory (default: ${defaultOutDir})`);
  console.log("  --help                   Show this help");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    help: false,
    exerciseCache: defaultExerciseCachePath,
    outDir: defaultOutDir,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith("--exercise-cache=")) {
      const value = arg.slice("--exercise-cache=".length).trim();
      if (!value) throw new Error("Empty --exercise-cache value.");
      parsed.exerciseCache = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
      continue;
    }
    if (arg === "--exercise-cache") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --exercise-cache");
      parsed.exerciseCache = path.isAbsolute(next.trim()) ? next.trim() : path.resolve(repoRoot, next.trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length).trim();
      if (!value) throw new Error("Empty --out value.");
      parsed.outDir = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --out");
      parsed.outDir = path.isAbsolute(next.trim()) ? next.trim() : path.resolve(repoRoot, next.trim());
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const raw = await readFile(args.exerciseCache, "utf8");
  const payload = JSON.parse(raw) as unknown;
  const exercises = parseExerciseCachePayload(payload);
  const catalog = buildStrengthExerciseCatalog(exercises);

  await mkdir(args.outDir, { recursive: true });

  const outputs = {
    "catalog-summary.md": catalog.summaryMarkdown,
    "catalog-by-library.md": catalog.byLibraryMarkdown,
    "catalog-search-index.md": catalog.searchIndexMarkdown,
    "catalog-keyword-groups.md": catalog.keywordGroupsMarkdown,
    "catalog-summary.json": `${JSON.stringify(catalog.summaryJson, null, 2)}\n`,
  };

  for (const [filename, content] of Object.entries(outputs)) {
    const filePath = path.join(args.outDir, filename);
    const normalized = filename.endsWith(".json") ? content : `${content}\n`;
    await writeFile(filePath, normalized, "utf8");
  }

  console.log("[tp-generate-strength-exercise-catalog] catalog generation complete.");
  console.log(`- exercise cache: ${args.exerciseCache}`);
  console.log(`- exercises loaded: ${exercises.length}`);
  console.log(`- libraries: ${catalog.summaryJson.totalLibraries}`);
  console.log(`- output directory: ${args.outDir}`);
  console.log("- no TrainingPeaks write request was performed.");
}

main().catch((error: unknown) => {
  console.error("tp-generate-strength-exercise-catalog failed.");
  console.error(error);
  process.exit(1);
});
