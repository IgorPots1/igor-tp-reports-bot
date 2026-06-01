import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "playwright";

import { normalizeExerciseName } from "./strength-exercise-normalization.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RENDERED_PICKER_BROWSER_SCRIPT_PATH = path.join(
  __dirname,
  "strength-rendered-exercise-picker.browser.js",
);

const RENDERED_PICKER_BROWSER_SCRIPT = readFileSync(RENDERED_PICKER_BROWSER_SCRIPT_PATH, "utf8");

export function assertRenderedPickerBrowserScriptIsSafe(): void {
  if (!RENDERED_PICKER_BROWSER_SCRIPT.includes("function browserPickerAction")) {
    throw new Error("Rendered picker browser script must define browserPickerAction.");
  }
  if (/\b__name\s*\(/.test(RENDERED_PICKER_BROWSER_SCRIPT)) {
    throw new Error("Rendered picker browser script must not call bundler __name helper.");
  }
}

type PickerBrowserInput = {
  action:
    | "inspect"
    | "read"
    | "read-search-results"
    | "scroll"
    | "scroll-search-results"
    | "set-search"
    | "debug"
    | "debug-search-term";
  value?: string;
  searchTerm?: string;
};

export const RENDERED_SEARCH_INPUT_PLACEHOLDER = "Search Exercises, Circuits, or Saved Items";

export const EXCLUDED_SHELL_OR_UI_LABELS = [
  "search and add block or template",
  "or select to create",
  "single exercise",
  "cool down",
  "warm up",
  "search exercises, circuits, or saved items",
  "create custom exercise",
  "add block",
  "add exercise",
  "save",
  "save & close",
  "summary",
  "library",
  "comments",
  "private notes",
  "workout title",
  "add workout instructions",
] as const;

export function isExcludedShellOrUiLabel(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return true;
  return EXCLUDED_SHELL_OR_UI_LABELS.some((label) => normalized === label);
}

export function isOnlyShellOrUiLabels(names: string[]): boolean {
  return names.length > 0 && names.every((name) => isExcludedShellOrUiLabel(name));
}

export const PRIORITY_SEARCH_TERMS = [
  "air",
  "plank",
  "clam",
  "calf",
  "glute",
  "bridge",
  "step",
  "squat",
  "deadlift",
  "romanian",
  "90",
  "ab",
] as const;

export type PickerDebugDom = {
  pickerDetected: boolean;
  inputPlaceholder: string | null;
  inputRect: { x: number; y: number; width: number; height: number } | null;
  candidateContainers: Array<{
    tagName: string;
    role?: string;
    className?: string;
    rect: { x: number; y: number; width: number; height: number };
    scrollHeight: number;
    clientHeight: number;
    textSample: string[];
  }>;
  visibleTextSamples: string[];
};

export const RENDERED_PICKER_DEBUG_FILENAME = "debug-picker-dom.json";
export const RENDERED_PICKER_SEARCH_DEBUG_FILENAME = "debug-rendered-picker-search.json";

export type PickerSearchDebug = {
  pickerDetected: boolean;
  inputDetected: boolean;
  inputPlaceholder: string | null;
  searchTermsTried: string[];
  perTerm: Array<{
    term: string;
    inputValueAfterTyping: string | null;
    visibleTextSamples: string[];
    candidateRows: Array<{
      text: string;
      tagName: string;
      role?: string;
      ariaLabel?: string;
      className?: string;
      rect: { x: number; y: number; width: number; height: number };
    }>;
  }>;
};

async function evaluateRenderedPickerBrowser<T>(page: Page, input: PickerBrowserInput): Promise<T> {
  return page.evaluate(
    ({ script, input: pickerInput }) => {
      const runner = new Function("input", `${script}\nreturn browserPickerAction(input);`);
      return runner(pickerInput);
    },
    { script: RENDERED_PICKER_BROWSER_SCRIPT, input },
  );
}

export const RENDERED_EXERCISE_SOURCE = "rendered_add_block_picker" as const;
export const RENDERED_EXERCISE_CATALOG_SOURCE =
  "trainingpeaks_new_strength_builder_rendered_add_block_picker" as const;

export const EXPECTED_VISIBLE_RENDERED_EXERCISE_NAMES = [
  "90 Degree Iso Chin Up Hold",
  "90-90",
  "90-90 to Lunge",
  "Ab Wheel",
  "Air Squat",
  "Dynamic Clam Shell",
  "Elevated Body Weight Calf Raise",
  "Forearm Plank",
] as const;

export const SEARCH_PREFIX_TERMS = "abcdefghijklmnopqrstuvwxyz".split("");

export const TARGETED_SEARCH_TERMS = [
  "glute",
  "bridge",
  "calf",
  "raise",
  "step",
  "step up",
  "plank",
  "side plank",
  "clam",
  "shell",
  "squat",
  "air squat",
  "deadlift",
  "romanian",
  "band",
  "knee",
  "hip",
  "lunge",
  "hamstring",
  "quad",
] as const;

export type SeenVia = "scroll" | "search";

export type RawRenderedExercise = {
  name: string;
  normalizedName: string;
  firstSeenIndex: number;
  seenCount: number;
  seenVia: SeenVia[];
  searchTerms?: string[];
  source: typeof RENDERED_EXERCISE_SOURCE;
  domTag?: string;
  role?: string;
  ariaLabel?: string;
  dataAttributes?: Record<string, string>;
};

export type RawRenderedExercisesPayload = {
  generatedAt: string;
  source: typeof RENDERED_EXERCISE_CATALOG_SOURCE;
  totalUniqueNames: number;
  namesFirstSeenOrder: string[];
  namesAlphabetical: string[];
  exercises: RawRenderedExercise[];
};

export type RawRenderedExercisesSummary = {
  totalUniqueNames: number;
  scrapeMethod: "scroll" | "search_prefixes" | "mixed";
  firstTenNames: string[];
  lastTenNames: string[];
  expectedVisibleNamesFound: Record<string, boolean>;
};

export type PickerInspection = {
  pickerFound: boolean;
  inputFound: boolean;
  listFound: boolean;
  inputPlaceholder: string | null;
  listTag: string | null;
  listRole: string | null;
};

type BrowserVisibleExercise = {
  name: string;
  domTag?: string;
  role?: string;
  ariaLabel?: string;
  dataAttributes?: Record<string, string>;
};

type BrowserReadResult = PickerInspection & {
  optionCount: number;
  options: BrowserVisibleExercise[];
};

type BrowserScrollResult = PickerInspection & {
  reachedEnd: boolean;
  scrollTopBefore: number;
  scrollTopAfter: number;
};

type BrowserSearchResult = PickerInspection & {
  applied: boolean;
  activeValue: string | null;
};

type AccumulatorRecord = {
  name: string;
  normalizedName: string;
  firstSeenIndex: number;
  seenCount: number;
  seenVia: Set<SeenVia>;
  searchTerms: Set<string>;
  source: typeof RENDERED_EXERCISE_SOURCE;
  domTag?: string;
  role?: string;
  ariaLabel?: string;
  dataAttributes?: Record<string, string>;
};

export type ScrapeRenderedExerciseOptions = {
  maxScrolls: number;
  searchTerms: string[];
  deadlineAt: number;
};

export type ScrapeRenderedExerciseResult = {
  payload: RawRenderedExercisesPayload;
  summary: RawRenderedExercisesSummary;
  inspection: PickerInspection;
  debugDom?: PickerDebugDom;
  searchDebug?: PickerSearchDebug;
};

function sanitizeDataAttributes(dataAttributes: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!dataAttributes) return undefined;
  const entries = Object.entries(dataAttributes)
    .filter(([key, value]) => key.startsWith("data-") && value.trim())
    .slice(0, 20);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function recordObservation(
  map: Map<string, AccumulatorRecord>,
  observation: BrowserVisibleExercise,
  via: SeenVia,
  searchTerm?: string,
): void {
  const name = observation.name.trim();
  if (!name || isExcludedShellOrUiLabel(name)) return;

  const existing = map.get(name);
  if (existing) {
    existing.seenCount += 1;
    existing.seenVia.add(via);
    if (searchTerm) existing.searchTerms.add(searchTerm);
    if (!existing.domTag && observation.domTag) existing.domTag = observation.domTag;
    if (!existing.role && observation.role) existing.role = observation.role;
    if (!existing.ariaLabel && observation.ariaLabel) existing.ariaLabel = observation.ariaLabel;
    if (!existing.dataAttributes && observation.dataAttributes) {
      existing.dataAttributes = sanitizeDataAttributes(observation.dataAttributes);
    }
    return;
  }

  map.set(name, {
    name,
    normalizedName: normalizeExerciseName(name),
    firstSeenIndex: map.size,
    seenCount: 1,
    seenVia: new Set([via]),
    searchTerms: searchTerm ? new Set([searchTerm]) : new Set<string>(),
    source: RENDERED_EXERCISE_SOURCE,
    domTag: observation.domTag,
    role: observation.role,
    ariaLabel: observation.ariaLabel,
    dataAttributes: sanitizeDataAttributes(observation.dataAttributes),
  });
}

function finalizePayload(records: Map<string, AccumulatorRecord>): RawRenderedExercisesPayload {
  const exercises = [...records.values()]
    .sort((left, right) => left.firstSeenIndex - right.firstSeenIndex)
    .map<RawRenderedExercise>((record) => ({
      name: record.name,
      normalizedName: record.normalizedName,
      firstSeenIndex: record.firstSeenIndex,
      seenCount: record.seenCount,
      seenVia: [...record.seenVia],
      searchTerms: record.searchTerms.size > 0 ? [...record.searchTerms] : undefined,
      source: record.source,
      domTag: record.domTag,
      role: record.role,
      ariaLabel: record.ariaLabel,
      dataAttributes: record.dataAttributes,
    }));

  const namesFirstSeenOrder = exercises.map((exercise) => exercise.name);
  const namesAlphabetical = [...namesFirstSeenOrder].sort((left, right) => left.localeCompare(right));

  return {
    generatedAt: new Date().toISOString(),
    source: RENDERED_EXERCISE_CATALOG_SOURCE,
    totalUniqueNames: exercises.length,
    namesFirstSeenOrder,
    namesAlphabetical,
    exercises,
  };
}

export function buildRawRenderedExercisesSummary(
  payload: RawRenderedExercisesPayload,
): RawRenderedExercisesSummary {
  const hasScroll = payload.exercises.some((exercise) => exercise.seenVia.includes("scroll"));
  const hasSearch = payload.exercises.some((exercise) => exercise.seenVia.includes("search"));

  return {
    totalUniqueNames: payload.totalUniqueNames,
    scrapeMethod: hasScroll && hasSearch ? "mixed" : hasSearch ? "search_prefixes" : "scroll",
    firstTenNames: payload.namesFirstSeenOrder.slice(0, 10),
    lastTenNames: payload.namesFirstSeenOrder.slice(-10),
    expectedVisibleNamesFound: Object.fromEntries(
      EXPECTED_VISIBLE_RENDERED_EXERCISE_NAMES.map((name) => [name, payload.namesFirstSeenOrder.includes(name)]),
    ),
  };
}

export function renderRawRenderedExercisesMarkdown(payload: RawRenderedExercisesPayload): string {
  const lines = [
    "# TrainingPeaks Raw Rendered Strength Exercises",
    "",
    "## Summary",
    "",
    `- Generated at: ${payload.generatedAt}`,
    `- Source: ${payload.source}`,
    `- Total unique names: ${payload.totalUniqueNames}`,
    "",
    "## First-seen order",
    "",
  ];

  payload.namesFirstSeenOrder.forEach((name, index) => {
    lines.push(`${index + 1}. ${name}`);
  });

  lines.push("", "## Alphabetical order", "");
  payload.namesAlphabetical.forEach((name, index) => {
    lines.push(`${index + 1}. ${name}`);
  });

  return `${lines.join("\n")}\n`;
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

export function renderRawRenderedExercisesCsv(payload: RawRenderedExercisesPayload): string {
  const header = "name,normalizedName,firstSeenIndex,seenCount,seenVia,searchTerms";
  const rows = payload.exercises.map((exercise) =>
    [
      exercise.name,
      exercise.normalizedName,
      String(exercise.firstSeenIndex),
      String(exercise.seenCount),
      exercise.seenVia.join("|"),
      (exercise.searchTerms ?? []).join("|"),
    ]
      .map(escapeCsvCell)
      .join(","),
  );

  return `${[header, ...rows].join("\n")}\n`;
}

export function buildSearchTerms(useSearchPrefixes: boolean): string[] {
  if (!useSearchPrefixes) return [];
  return [...new Set([...PRIORITY_SEARCH_TERMS, ...TARGETED_SEARCH_TERMS, ...SEARCH_PREFIX_TERMS])];
}

export async function inspectRenderedExercisePicker(page: Page): Promise<PickerInspection> {
  return evaluateRenderedPickerBrowser<PickerInspection>(page, { action: "inspect" });
}

export async function collectRenderedPickerDebugDom(page: Page): Promise<PickerDebugDom> {
  return evaluateRenderedPickerBrowser<PickerDebugDom>(page, { action: "debug" });
}

export async function readRenderedExercisePicker(page: Page): Promise<BrowserReadResult> {
  return evaluateRenderedPickerBrowser<BrowserReadResult>(page, { action: "read" });
}

async function readSearchResultRows(page: Page, searchTerm: string): Promise<BrowserReadResult> {
  return evaluateRenderedPickerBrowser<BrowserReadResult>(page, {
    action: "read-search-results",
    searchTerm,
  });
}

async function scrollSearchResultList(page: Page, searchTerm: string): Promise<BrowserScrollResult> {
  return evaluateRenderedPickerBrowser<BrowserScrollResult>(page, {
    action: "scroll-search-results",
    searchTerm,
  });
}

export async function typeRenderedExerciseSearch(
  page: Page,
  term: string,
): Promise<{ applied: boolean; activeValue: string | null }> {
  const input = page.getByPlaceholder(RENDERED_SEARCH_INPUT_PLACEHOLDER, { exact: true }).first();
  try {
    await input.click({ timeout: 8_000 });
    await input.fill(term, { timeout: 8_000 });
    const activeValue = await input.inputValue();
    const normalizedTerm = term.trim().toLowerCase();
    const normalizedValue = activeValue.trim().toLowerCase();
    return {
      applied: normalizedValue === normalizedTerm || normalizedValue.includes(normalizedTerm),
      activeValue,
    };
  } catch {
    return { applied: false, activeValue: null };
  }
}

export async function clearRenderedExerciseSearch(page: Page): Promise<void> {
  const input = page.getByPlaceholder(RENDERED_SEARCH_INPUT_PLACEHOLDER, { exact: true }).first();
  try {
    await input.click({ timeout: 5_000 });
    await input.fill("", { timeout: 5_000 });
  } catch {
    // Picker may already be closed; ignore.
  }
}

export async function collectRenderedPickerSearchTermDebug(
  page: Page,
  term: string,
): Promise<PickerSearchDebug["perTerm"][number]> {
  return evaluateRenderedPickerBrowser<PickerSearchDebug["perTerm"][number]>(page, {
    action: "debug-search-term",
    searchTerm: term,
  });
}

/** @deprecated Prefer typeRenderedExerciseSearch (Playwright fill). */
export async function setRenderedExerciseSearchValue(page: Page, value: string): Promise<BrowserSearchResult> {
  return evaluateRenderedPickerBrowser<BrowserSearchResult>(page, { action: "set-search", value });
}

export async function waitForRenderedExercisePicker(
  page: Page,
  timeoutMs = 20_000,
): Promise<PickerInspection> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const inspection = await inspectRenderedExercisePicker(page);
    if (inspection.inputFound && inspection.listFound) {
      return inspection;
    }
    await page.waitForTimeout(250);
  }

  return inspectRenderedExercisePicker(page);
}

async function collectSearchResultsForTerm(
  page: Page,
  records: Map<string, AccumulatorRecord>,
  term: string,
  deadlineAt: number,
  maxScrolls: number,
): Promise<void> {
  let stagnantReads = 0;
  let previousSignature = "";

  for (let index = 0; index < maxScrolls; index += 1) {
    if (Date.now() >= deadlineAt) break;

    const readResult = await readSearchResultRows(page, term);
    if (!readResult.inputFound) {
      throw new Error("Rendered Add Block search input disappeared before scraping completed.");
    }

    const signature = readResult.options.map((option) => option.name).join("||");
    if (signature === previousSignature) {
      stagnantReads += 1;
    } else {
      stagnantReads = 0;
      previousSignature = signature;
    }

    readResult.options.forEach((option) => {
      recordObservation(records, option, "search", term);
    });

    const scrollResult = await scrollSearchResultList(page, term);
    await page.waitForTimeout(140);

    if (scrollResult.reachedEnd || stagnantReads >= 3) {
      break;
    }
  }
}

export async function scrapeRenderedExerciseCatalog(
  page: Page,
  options: ScrapeRenderedExerciseOptions,
): Promise<ScrapeRenderedExerciseResult> {
  const inspection = await waitForRenderedExercisePicker(page, Math.max(5_000, options.deadlineAt - Date.now()));
  if (!inspection.inputFound) {
    throw new Error("Could not detect the TrainingPeaks Add Block rendered exercise search input.");
  }

  const records = new Map<string, AccumulatorRecord>();
  const searchTermsTried: string[] = [];
  const perTermDebug: PickerSearchDebug["perTerm"] = [];

  for (const term of options.searchTerms) {
    if (Date.now() >= options.deadlineAt) break;
    searchTermsTried.push(term);

    const typed = await typeRenderedExerciseSearch(page, term);
    await page.waitForTimeout(typed.applied ? 550 : 200);

    if (typed.applied) {
      await collectSearchResultsForTerm(page, records, term, options.deadlineAt, options.maxScrolls);
    }

    const termDebug = await collectRenderedPickerSearchTermDebug(page, term).catch(() => ({
      term,
      inputValueAfterTyping: typed.activeValue,
      visibleTextSamples: [],
      candidateRows: [],
    }));
    perTermDebug.push(termDebug);
  }

  if (options.searchTerms.length > 0) {
    await clearRenderedExerciseSearch(page);
    await page.waitForTimeout(120);
  }

  const payload = finalizePayload(records);
  const summary = buildRawRenderedExercisesSummary(payload);
  const needsSearchDebug =
    options.searchTerms.length > 0 &&
    (payload.totalUniqueNames === 0 || isOnlyShellOrUiLabels(payload.namesFirstSeenOrder));
  const searchDebug: PickerSearchDebug | undefined = needsSearchDebug
    ? {
        pickerDetected: inspection.pickerFound,
        inputDetected: inspection.inputFound,
        inputPlaceholder: inspection.inputPlaceholder,
        searchTermsTried,
        perTerm: perTermDebug,
      }
    : undefined;
  const debugDom =
    payload.totalUniqueNames === 0 && !searchDebug
      ? await collectRenderedPickerDebugDom(page).catch(() => undefined)
      : undefined;

  return { payload, summary, inspection, debugDom, searchDebug };
}
