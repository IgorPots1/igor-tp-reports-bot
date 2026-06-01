import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { captureSessionAuth, performApiJsonRequest } from "./lib/trainingpeaks-api-move.ts";
import { normalizeStrengthExerciseRecord } from "./lib/strength-template-matcher.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const TP_APP_HOST = "https://app.trainingpeaks.com";
const DEFAULT_ATHLETE_ID = 3102415;

const repoRoot = path.resolve(toolRoot, "..", "..");
const defaultOutPath = path.join(repoRoot, "reports", "strength-builder-templates", "trainingpeaks-strength-exercises.json");

type CliArgs = {
  help: boolean;
  out: string;
  athleteId: number;
  headless: boolean;
};

type ExerciseLibraryRecord = Record<string, unknown>;
type ExerciseLibraryItemRecord = Record<string, unknown>;

function printHelp(): void {
  console.log("TrainingPeaks strength exercise library cache (read-only)");
  console.log("");
  console.log("Usage:");
  console.log("  npm run tp:cache-strength-exercises -- --out reports/strength-builder-templates/trainingpeaks-strength-exercises.json");
  console.log("");
  console.log("Options:");
  console.log(`  --out=<path>           Output JSON path (default: ${defaultOutPath})`);
  console.log(`  --athlete-id=<id>      Athlete id for session warmup (default: ${DEFAULT_ATHLETE_ID})`);
  console.log("  --headless             Launch browser headless (default: headed)");
  console.log("  --headed               Force headed browser mode");
  console.log("  --help                 Show this help");
  console.log("");
  console.log("Safety:");
  console.log("  - Read-only GET requests to exercise library endpoints only.");
  console.log("  - No workout create/update/save actions.");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    help: false,
    out: defaultOutPath,
    athleteId: DEFAULT_ATHLETE_ID,
    headless: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length).trim();
      if (!value) throw new Error("Empty --out value.");
      parsed.out = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --out");
      parsed.out = path.isAbsolute(next.trim()) ? next.trim() : path.resolve(repoRoot, next.trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      const value = Number(arg.slice("--athlete-id=".length).trim());
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid --athlete-id value: "${arg}"`);
      }
      parsed.athleteId = value;
      continue;
    }
    if (arg === "--athlete-id") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --athlete-id");
      const value = Number(next.trim());
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid --athlete-id value: "${next}"`);
      }
      parsed.athleteId = value;
      index += 1;
      continue;
    }
    if (arg === "--headless") {
      parsed.headless = true;
      continue;
    }
    if (arg === "--headed") {
      parsed.headless = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildAuthHeaders(auth: Awaited<ReturnType<typeof captureSessionAuth>>): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json, text/javascript, */*; q=0.01",
    "content-type": "application/json",
    referer: `${TP_APP_HOST}/`,
  };
  if (auth.authorizationHeader) {
    headers.authorization = auth.authorizationHeader;
  }
  return headers;
}

async function fetchLibraries(input: {
  page: import("playwright").Page;
  headers: Record<string, string>;
}): Promise<ExerciseLibraryRecord[]> {
  const response = await performApiJsonRequest({
    page: input.page,
    method: "GET",
    endpoint: `${TP_API_HOST}/exerciselibrary/v2/libraries`,
    headers: input.headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch exercise libraries (HTTP ${response.status}).`);
  }
  if (!Array.isArray(response.body)) {
    throw new Error("Exercise libraries response was not an array.");
  }

  return response.body.filter(isRecord);
}

async function fetchLibraryItems(input: {
  page: import("playwright").Page;
  headers: Record<string, string>;
  libraryId: string | number;
}): Promise<ExerciseLibraryItemRecord[]> {
  const response = await performApiJsonRequest({
    page: input.page,
    method: "GET",
    endpoint: `${TP_API_HOST}/exerciselibrary/v2/libraries/${input.libraryId}/items`,
    headers: input.headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch library items for ${input.libraryId} (HTTP ${response.status}).`);
  }
  if (!Array.isArray(response.body)) {
    throw new Error(`Library items response for ${input.libraryId} was not an array.`);
  }

  return response.body.filter(isRecord);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  await mkdir(profileDir, { recursive: true });

  console.log("[tp-cache-strength-exercise-library] mode: READ-ONLY");
  console.log(`[tp-cache-strength-exercise-library] output: ${args.out}`);
  console.log("[tp-cache-strength-exercise-library] endpoints: GET /exerciselibrary/v2/libraries and /items only");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const auth = await captureSessionAuth({
      context,
      page,
      athleteId: args.athleteId,
    });

    if (!auth.authorizationHeader) {
      throw new Error("Could not capture TrainingPeaks authorization header from browser session.");
    }

    const headers = buildAuthHeaders(auth);
    const libraries = await fetchLibraries({ page, headers });
    const exercises: Array<Record<string, unknown>> = [];

    for (const library of libraries) {
      const libraryId = library.exerciseLibraryId;
      if (typeof libraryId !== "string" && typeof libraryId !== "number") {
        continue;
      }

      const items = await fetchLibraryItems({ page, headers, libraryId });
      for (const item of items) {
        const normalized = normalizeStrengthExerciseRecord({ item, library });
        if (!normalized) continue;

        exercises.push({
          exerciseLibraryId: normalized.exerciseLibraryId,
          exerciseLibraryItemId: normalized.exerciseLibraryItemId,
          itemName: normalized.itemName,
          normalizedName: normalized.normalizedName,
          description: normalized.description,
          libraryName: normalized.libraryName,
          isDefaultContent: normalized.isDefaultContent,
          ownerType: normalized.ownerType,
        });
      }
    }

    exercises.sort((left, right) => {
      const leftName = String(left.normalizedName ?? "");
      const rightName = String(right.normalizedName ?? "");
      return leftName.localeCompare(rightName);
    });

    const payload = {
      cachedAt: new Date().toISOString(),
      mode: "read-only",
      libraryCount: libraries.length,
      exerciseCount: exercises.length,
      exercises,
    };

    await writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    console.log("");
    console.log("[tp-cache-strength-exercise-library] cache complete.");
    console.log(`- libraries fetched: ${libraries.length}`);
    console.log(`- exercises cached: ${exercises.length}`);
    console.log(`- output: ${args.out}`);
    console.log("- no TrainingPeaks write request was performed.");
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-cache-strength-exercise-library failed.");
  console.error(error);
  process.exit(1);
});
