import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

import {
  assertRenderedPickerBrowserScriptIsSafe,
  buildRawRenderedExercisesSummary,
  buildSearchTerms,
  EXPECTED_VISIBLE_RENDERED_EXERCISE_NAMES,
  isExcludedShellOrUiLabel,
  RENDERED_EXERCISE_CATALOG_SOURCE,
  RENDERED_EXERCISE_SOURCE,
  RENDERED_PICKER_BROWSER_SCRIPT_PATH,
  renderRawRenderedExercisesCsv,
  renderRawRenderedExercisesMarkdown,
  scrapeRenderedExerciseCatalog,
  type RawRenderedExercisesPayload,
} from "./lib/strength-rendered-exercise-scrape.ts";
import { normalizeExerciseName } from "./lib/strength-exercise-normalization.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturePath = path.join(__dirname, "fixtures", "strength-rendered-exercise-picker.fixture.html");

const FIXTURE_SHELL_LABELS = [
  "search and add block or template",
  "OR SELECT TO CREATE",
  "Single Exercise",
  "Warm Up",
  "Cool Down",
] as const;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function parseFixtureNames(html: string): string[] {
  const matches = [...html.matchAll(/class="exercise-name"[^>]*>([^<]+)</g)];
  return matches.map((match) => match[1]?.replace(/\s+/g, " ").trim()).filter((value): value is string => Boolean(value));
}

function buildFixturePayload(names: string[]): RawRenderedExercisesPayload {
  const exercises = names.map((name, index) => ({
    name,
    normalizedName: normalizeExerciseName(name),
    firstSeenIndex: index,
    seenCount: 1,
    seenVia: ["search"] as const,
    source: RENDERED_EXERCISE_SOURCE,
    domTag: "div",
    role: undefined,
    ariaLabel: undefined,
    dataAttributes: undefined,
  }));

  return {
    generatedAt: "2026-06-01T00:00:00.000Z",
    source: RENDERED_EXERCISE_CATALOG_SOURCE,
    totalUniqueNames: exercises.length,
    namesFirstSeenOrder: exercises.map((exercise) => exercise.name),
    namesAlphabetical: [...exercises.map((exercise) => exercise.name)].sort((left, right) => left.localeCompare(right)),
    exercises,
  };
}

async function assertFixtureExtraction(): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(fixturePath).href, { waitUntil: "domcontentloaded" });

    const searchTerms = ["air", "plank", "clam", "calf", "90", "ab", "squat"];
    const result = await scrapeRenderedExerciseCatalog(page, {
      maxScrolls: 20,
      searchTerms,
      deadlineAt: Date.now() + 20_000,
    });

    assert(result.inspection.inputFound, "Expected fixture search input to be detected.");
    assert(result.payload.totalUniqueNames >= 8, `Expected exercise names from search, got ${result.payload.totalUniqueNames}.`);

    const extractedNames = result.payload.namesFirstSeenOrder;
    for (const shellLabel of FIXTURE_SHELL_LABELS) {
      assert(!extractedNames.includes(shellLabel), `Expected shell label to be excluded: "${shellLabel}".`);
      assert(isExcludedShellOrUiLabel(shellLabel), `Expected shell label helper to reject "${shellLabel}".`);
    }

    const requiredNames = [
      "Air Squat",
      "Dynamic Clam Shell",
      "Elevated Body Weight Calf Raise",
      "Forearm Plank",
      "90 Degree Iso Chin Up Hold",
    ];
    for (const expected of requiredNames) {
      assert(extractedNames.includes(expected), `Expected search extraction to include "${expected}".`);
    }

    for (const expected of EXPECTED_VISIBLE_RENDERED_EXERCISE_NAMES) {
      assert(extractedNames.includes(expected), `Expected rendered picker extraction to include "${expected}".`);
    }

    return extractedNames;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function run(): Promise<void> {
  assertRenderedPickerBrowserScriptIsSafe();
  const browserScript = readFileSync(RENDERED_PICKER_BROWSER_SCRIPT_PATH, "utf8");
  assert(!/\b__name\s*\(/.test(browserScript), "Browser picker script must not call bundler __name helper.");
  assert(
    browserScript.includes("function browserPickerAction"),
    "Browser picker script must define browserPickerAction.",
  );
  assert(browserScript.includes('action === "read-search-results"'), "Browser picker script must support read-search-results.");
  assert(browserScript.includes('action === "debug-search-term"'), "Browser picker script must support debug-search-term.");

  const html = readFileSync(fixturePath, "utf8");
  const fixtureNames = parseFixtureNames(html);
  const extractedNames = await assertFixtureExtraction();
  assert(fixtureNames.length >= 16, "Expected at least 16 rendered exercise names in fixture.");
  assert(buildSearchTerms(true).length > 0, "Expected search prefix terms to be configured.");

  const payload = buildFixturePayload(extractedNames);
  const summary = buildRawRenderedExercisesSummary(payload);
  const markdown = renderRawRenderedExercisesMarkdown(payload);
  const csv = renderRawRenderedExercisesCsv(payload);

  assert(payload.totalUniqueNames === extractedNames.length, "Expected unique total to match extracted exercise count.");
  assert(summary.scrapeMethod === "search_prefixes", "Expected fixture scrape method to use search.");
  assert(markdown.includes("## First-seen order"), "Expected markdown first-seen section.");
  assert(markdown.includes("## Alphabetical order"), "Expected markdown alphabetical section.");
  assert(csv.startsWith("name,normalizedName,firstSeenIndex,seenCount,seenVia,searchTerms"), "Expected CSV header.");

  for (const expected of EXPECTED_VISIBLE_RENDERED_EXERCISE_NAMES) {
    assert(extractedNames.includes(expected), `Expected extraction to include "${expected}".`);
    assert(summary.expectedVisibleNamesFound[expected] === true, `Expected summary marker for "${expected}".`);
  }

  const allowedImports = [
    "./lib/strength-rendered-exercise-scrape.ts",
    "./lib/strength-exercise-normalization.ts",
    "playwright",
  ];
  const selfSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const importSpecifiers = [...selfSource.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  for (const specifier of importSpecifiers) {
    const isNodeBuiltin = specifier.startsWith("node:");
    const isAllowedLocal = allowedImports.includes(specifier);
    assert(isNodeBuiltin || isAllowedLocal, `Unexpected import in check script: ${specifier}`);
  }

  console.log("check-strength-rendered-exercise-scrape: ok");
  console.log(`- fixture: ${fixturePath}`);
  console.log(`- unique names: ${payload.totalUniqueNames}`);
  console.log(`- first item: ${payload.namesFirstSeenOrder[0]}`);
  console.log(`- last item: ${payload.namesFirstSeenOrder[payload.namesFirstSeenOrder.length - 1]}`);
}

try {
  await run();
} catch (error) {
  console.error("check-strength-rendered-exercise-scrape failed.");
  console.error(error);
  process.exit(1);
}
