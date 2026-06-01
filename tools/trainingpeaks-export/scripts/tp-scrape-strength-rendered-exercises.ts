import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import {
  buildSearchTerms,
  inspectRenderedExercisePicker,
  renderRawRenderedExercisesCsv,
  renderRawRenderedExercisesMarkdown,
  scrapeRenderedExerciseCatalog,
} from "./lib/strength-rendered-exercise-scrape.ts";

const DEFAULT_DURATION_SEC = 420;
const DEFAULT_MAX_SCROLLS = 300;

const repoRoot = path.resolve(toolRoot, "..", "..");
const defaultOutDir = path.join(repoRoot, "reports", "strength-builder-rendered-exercise-catalog");

type CliArgs = {
  help: boolean;
  durationSec: number;
  outDir: string;
  headless: boolean;
  manual: boolean;
  searchPrefixes: boolean;
  maxScrolls: number;
};

function printHelp(): void {
  console.log("TrainingPeaks rendered strength exercise catalog scraper (read-only)");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npm run tp:scrape-strength-rendered-exercises -- --out reports/strength-builder-rendered-exercise-catalog --headed --manual --duration 420",
  );
  console.log("");
  console.log("Options:");
  console.log(`  --duration=<seconds>   Manual session budget (default: ${DEFAULT_DURATION_SEC})`);
  console.log(`  --out=<path>           Output directory (default: ${defaultOutDir})`);
  console.log("  --headed               Launch browser headed (default)");
  console.log("  --headless             Launch browser headless");
  console.log("  --manual               Wait for operator to open Add Block picker before scraping");
  console.log("  --search-prefixes      Use search-term fallback to collect more raw names");
  console.log(`  --max-scrolls=<count>  Max incremental scrolls per pass (default: ${DEFAULT_MAX_SCROLLS})`);
  console.log("  --help                 Show this help");
  console.log("");
  console.log("Safety:");
  console.log("  - Read-only DOM scraping only.");
  console.log("  - No clicks on exercise options.");
  console.log("  - No Save / create / update actions.");
}

function parsePositiveInt(value: string, flagName: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flagName} value: "${value}"`);
  }
  return Math.floor(parsed);
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    help: false,
    durationSec: DEFAULT_DURATION_SEC,
    outDir: defaultOutDir,
    headless: false,
    manual: false,
    searchPrefixes: false,
    maxScrolls: DEFAULT_MAX_SCROLLS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith("--duration=")) {
      parsed.durationSec = parsePositiveInt(arg.slice("--duration=".length), "--duration");
      continue;
    }
    if (arg === "--duration") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --duration");
      parsed.durationSec = parsePositiveInt(next, "--duration");
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
      const value = next.trim();
      if (!value) throw new Error("Empty --out value.");
      parsed.outDir = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
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
    if (arg === "--manual") {
      parsed.manual = true;
      continue;
    }
    if (arg === "--search-prefixes") {
      parsed.searchPrefixes = true;
      continue;
    }
    if (arg.startsWith("--max-scrolls=")) {
      parsed.maxScrolls = parsePositiveInt(arg.slice("--max-scrolls=".length), "--max-scrolls");
      continue;
    }
    if (arg === "--max-scrolls") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --max-scrolls");
      parsed.maxScrolls = parsePositiveInt(next, "--max-scrolls");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function waitForEnter(prompt: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${prompt}\n`);
  } finally {
    rl.close();
  }
}

async function ensureManualPickerReady(): Promise<void> {
  console.log("");
  console.log("Manual mode:");
  console.log("1. Open a safe test athlete calendar.");
  console.log("2. Open the New Strength Builder.");
  console.log("3. Click Add Block so the picker is visible.");
  console.log("4. Do NOT click any exercise names.");
  console.log("5. Press Enter here once the picker is fully open.");
  console.log("");
  await waitForEnter("Press Enter when the Add Block picker is visible.");
}

async function writeOutputs(input: {
  outDir: string;
  payload: ReturnType<typeof scrapeRenderedExerciseCatalog> extends Promise<infer T>
    ? T["payload"]
    : never;
  summary: ReturnType<typeof scrapeRenderedExerciseCatalog> extends Promise<infer T>
    ? T["summary"]
    : never;
}): Promise<void> {
  await mkdir(input.outDir, { recursive: true });

  const jsonPath = path.join(input.outDir, "raw-rendered-exercises.json");
  const markdownPath = path.join(input.outDir, "raw-rendered-exercises.md");
  const csvPath = path.join(input.outDir, "raw-rendered-exercises.csv");
  const summaryPath = path.join(input.outDir, "summary.json");

  await writeFile(jsonPath, `${JSON.stringify(input.payload, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderRawRenderedExercisesMarkdown(input.payload), "utf8");
  await writeFile(csvPath, renderRawRenderedExercisesCsv(input.payload), "utf8");
  await writeFile(summaryPath, `${JSON.stringify(input.summary, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  await mkdir(profileDir, { recursive: true });

  console.log("[tp-scrape-strength-rendered-exercises] mode: READ-ONLY DOM scrape");
  console.log(`[tp-scrape-strength-rendered-exercises] profile: ${profileDir}`);
  console.log(`[tp-scrape-strength-rendered-exercises] output: ${args.outDir}`);
  console.log(`[tp-scrape-strength-rendered-exercises] duration budget: ${args.durationSec} seconds`);
  console.log(
    `[tp-scrape-strength-rendered-exercises] search fallback: ${args.searchPrefixes ? "enabled" : "disabled"}`,
  );
  console.log(
    "[tp-scrape-strength-rendered-exercises] safety: no exercise item clicks, no Save clicks, no TrainingPeaks write actions.",
  );

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    if (args.manual) {
      await ensureManualPickerReady();
    }

    const inspection = await inspectRenderedExercisePicker(page);
    if (!inspection.inputFound || !inspection.listFound) {
      throw new Error(
        "Add Block picker was not detected. Ensure the search input and rendered exercise list are visible before scraping.",
      );
    }

    const deadlineAt = Date.now() + args.durationSec * 1000;
    const result = await scrapeRenderedExerciseCatalog(page, {
      maxScrolls: args.maxScrolls,
      searchTerms: buildSearchTerms(args.searchPrefixes),
      deadlineAt,
    });

    await writeOutputs({
      outDir: args.outDir,
      payload: result.payload,
      summary: result.summary,
    });

    console.log("");
    console.log("[tp-scrape-strength-rendered-exercises] scrape complete.");
    console.log(`- picker detected: ${result.inspection.inputFound && result.inspection.listFound ? "yes" : "no"}`);
    console.log(`- unique names: ${result.payload.totalUniqueNames}`);
    console.log(`- list tag: ${result.inspection.listTag ?? "unknown"}`);
    console.log(`- list role: ${result.inspection.listRole ?? "unknown"}`);
    console.log(`- output: ${args.outDir}`);
    console.log("- no exercise option was clicked by automation.");
    console.log("- no TrainingPeaks save/write action was performed.");
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-scrape-strength-rendered-exercises failed.");
  console.error(error);
  process.exit(1);
});
