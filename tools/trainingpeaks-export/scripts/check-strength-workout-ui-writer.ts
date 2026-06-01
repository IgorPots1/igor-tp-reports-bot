import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildCatalogPreflight,
  buildStrengthWorkoutSummaryMarkdown,
  decideExactVisibleResult,
  flattenWorkoutExercises,
  parseStrengthWorkoutTemplate,
  sanitizeAthleteUrl,
  type StrengthWorkoutRunSummary,
} from "./lib/strength-workout-ui-writer.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, "fixtures", "strength-workout-template.fixture.json");
const minimalFixturePath = path.join(__dirname, "fixtures", "strength-workout-template.minimal-strength.fixture.json");
const probeFixturePath = path.join(
  __dirname,
  "fixtures",
  "strength-workout-template.runner-strength-fields-probe.fixture.json"
);

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function loadFixtureTemplate() {
  const raw = readFileSync(fixturePath, "utf8");
  return parseStrengthWorkoutTemplate(JSON.parse(raw) as unknown);
}

function run(): void {
  const template = loadFixtureTemplate();
  const flatExercises = flattenWorkoutExercises(template);
  const minimalTemplate = parseStrengthWorkoutTemplate(
    JSON.parse(readFileSync(minimalFixturePath, "utf8")) as unknown
  );
  const minimalFlat = flattenWorkoutExercises(minimalTemplate);
  const probeTemplate = parseStrengthWorkoutTemplate(JSON.parse(readFileSync(probeFixturePath, "utf8")) as unknown);
  const probeFlat = flattenWorkoutExercises(probeTemplate);

  assert(template.title === "TEST - Beginner Runner Strength Foundation", "Expected fixed TEST workout title.");
  assert(flatExercises.length === 13, `Expected 13 exercises, got ${flatExercises.length}.`);
  assert(flatExercises[0]?.name === "Jog In Place", "Expected Jog In Place first.");
  assert(flatExercises[12]?.name === "Supported Calf Stretch", "Expected Supported Calf Stretch last.");
  assert(minimalTemplate.id === "minimal_strength", "Expected minimal template id.");
  assert(minimalFlat.length === 5, `Expected 5 minimal exercises, got ${minimalFlat.length}.`);
  assert(minimalFlat[0]?.name === "Glute Bridge", "Expected minimal template to start from Glute Bridge.");
  assert(probeTemplate.id === "runner_strength_fields_probe", "Expected fields probe template id.");
  assert(
    probeTemplate.title === "TEST - Runner Strength Template Fields Probe",
    "Expected fixed fields probe title."
  );
  assert(probeFlat.length === 6, `Expected 6 probe exercises, got ${probeFlat.length}.`);
  assert(probeFlat[0]?.name === "Glute Bridge", "Expected probe first exercise Glute Bridge.");
  assert(probeFlat[5]?.name === "Single Leg Calf Raise", "Expected probe last exercise Single Leg Calf Raise.");
  assert(probeFlat[4]?.durationSeconds === "30", "Expected Forearm Plank durationSeconds=30.");
  assert(typeof probeFlat[4]?.reps === "undefined", "Expected Forearm Plank without reps.");

  const catalogPreflight = buildCatalogPreflight(template, flatExercises.map((entry) => entry.name));
  assert(catalogPreflight.missingNames.length === 0, "Expected all exact names to be present in synthetic catalog preflight.");

  const missingPreflight = buildCatalogPreflight(template, flatExercises.filter((entry) => entry.name !== "Bird Dog").map((entry) => entry.name));
  assert(missingPreflight.missingNames.includes("Bird Dog"), "Expected Bird Dog to be reported missing.");

  const exactDecision = decideExactVisibleResult("Glute Bridge", ["Glute Bridge", "Banded Glute Bridge"]);
  assert(exactDecision.status === "exact", "Expected exact result decision for Glute Bridge.");
  assert(
    exactDecision.exactVisibleMatches.length === 1 && exactDecision.exactVisibleMatches[0] === "Glute Bridge",
    "Expected only exact Glute Bridge match, without banded/single-leg variants."
  );

  const ambiguousDecision = decideExactVisibleResult("Glute Bridge", ["Glute Bridge", "Glute Bridge"]);
  assert(ambiguousDecision.status === "ambiguous", "Expected ambiguous status for duplicate exact matches.");

  const missingDecision = decideExactVisibleResult("Glute Bridge", ["Banded Glute Bridge", "Single Leg Glute Bridge"]);
  assert(missingDecision.status === "missing", "Expected missing status when exact visible match is absent.");

  const unrelatedMissingDecision = decideExactVisibleResult("Bird Dog", ["Banded Bird Dog", "Bird Dog Row"]);
  assert(unrelatedMissingDecision.status === "missing", "Expected missing status when exact visible match is absent.");

  const redactedUrl = sanitizeAthleteUrl("https://app.trainingpeaks.com/#calendar/athletes/3102415?athleteId=3102415");
  assert(redactedUrl.includes("<ATHLETE_ID>"), "Expected athlete id redaction.");

  const summary: StrengthWorkoutRunSummary = {
    runAt: "2026-06-01T00:00:00.000Z",
    mode: "dry-run",
    athleteUrlRedacted: redactedUrl,
    targetDate: "2026-06-02",
    title: template.title,
    saveClicked: false,
    builderOpened: true,
    addBlockButtonFound: true,
    pickerSearchFound: true,
    localCatalogPreflight: catalogPreflight,
    attemptedExercises: flatExercises.slice(0, 2).map((exercise) => ({
      blockName: exercise.blockName,
      name: exercise.name,
      sets: exercise.sets,
      selectionStatus: "not_run",
      clicked: false,
      added: false,
      visibleExactMatches: [],
      visibleTextsSample: [],
      inputValueAfterTyping: exercise.name,
      candidateRows: [exercise.name],
      fields: {
        sets: { attempted: false, required: true, status: "not_attempted" },
        reps: { attempted: false, required: false, status: "unsupported" },
        duration: { attempted: false, required: false, status: "unsupported" },
        coachNote: { attempted: false, required: false, status: "unsupported" },
      },
    })),
    verification: {
      titleVisible: false,
      expectedExercisesVisible: [],
      missingExercisesVisible: flatExercises.map((exercise) => exercise.name),
      visibleExerciseCount: 0,
      unexpectedExerciseCheck: "dry-run: verification not executed",
      status: "partial",
    },
    screenshots: ["reports/strength-builder-create-test-workout/screenshots/dry-run-home.png"],
    warnings: ["Dry-run summary fixture."],
    errors: [],
  };

  const markdown = buildStrengthWorkoutSummaryMarkdown(summary);
  assert(markdown.includes("TEST - Beginner Runner Strength Foundation"), "Expected title in summary markdown.");
  assert(markdown.includes("Missing visible exercises"), "Expected verification section in markdown.");
  const readySummary: StrengthWorkoutRunSummary = {
    ...summary,
    verification: {
      ...summary.verification,
      status: "ready_for_apply",
      unexpectedExerciseCheck: "Manual builder gate passed. UI is ready for apply probe.",
    },
  };
  const readyMarkdown = buildStrengthWorkoutSummaryMarkdown(readySummary);
  assert(readyMarkdown.includes("ready_for_apply"), "Expected ready_for_apply status in summary markdown.");

  const allowedImports = ["./lib/strength-workout-ui-writer.ts"];
  const selfSource = readFileSync(__filename, "utf8");
  const importSpecifiers = [...selfSource.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  for (const specifier of importSpecifiers) {
    const isNodeBuiltin = specifier.startsWith("node:");
    const isAllowedLocal = allowedImports.includes(specifier);
    assert(isNodeBuiltin || isAllowedLocal, `Unexpected import in check script: ${specifier}`);
  }

  console.log("check-strength-workout-ui-writer: ok");
  console.log(`- fixture: ${fixturePath}`);
  console.log(`- exercises: ${flatExercises.length}`);
  console.log(`- minimal exercises: ${minimalFlat.length}`);
  console.log(`- probe exercises: ${probeFlat.length}`);
  console.log(`- title: ${template.title}`);
}

try {
  run();
} catch (error) {
  console.error("check-strength-workout-ui-writer failed.");
  console.error(error);
  process.exit(1);
}
