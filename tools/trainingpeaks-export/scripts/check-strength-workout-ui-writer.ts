import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

import {
  assertStrengthWorkoutFieldWriterBrowserScriptIsSafe,
  browserIsValueVisibleInBlock,
  browserWriteSemanticField,
  STRENGTH_WORKOUT_FIELD_WRITER_BROWSER_SCRIPT_PATH,
} from "./lib/strength-workout-field-writer-scrape.ts";
import {
  assertVisualFieldEvidenceBrowserScriptIsSafe,
  collectVisualFieldEvidence,
  VISUAL_FIELD_EVIDENCE_BROWSER_SCRIPT_PATH,
} from "./lib/strength-visual-field-evidence-scrape.ts";
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
const tpCreateScriptPath = path.join(__dirname, "tp-create-test-strength-workout.ts");
const fixturePath = path.join(__dirname, "fixtures", "strength-workout-template.fixture.json");
const minimalFixturePath = path.join(__dirname, "fixtures", "strength-workout-template.minimal-strength.fixture.json");
const probeFixturePath = path.join(
  __dirname,
  "fixtures",
  "strength-workout-template.runner-strength-fields-probe.fixture.json"
);
const visualProbeFixturePath = path.join(__dirname, "fixtures", "strength-workout-template.visual-field-probe.fixture.json");
const visualRepsNotesProbeFixturePath = path.join(
  __dirname,
  "fixtures",
  "strength-workout-template.visual-field-reps-notes-probe.fixture.json"
);
const writerSmokeFixturePath = path.join(__dirname, "fixtures", "strength-workout-field-writer.fixture.html");

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function loadFixtureTemplate() {
  const raw = readFileSync(fixturePath, "utf8");
  return parseStrengthWorkoutTemplate(JSON.parse(raw) as unknown);
}

async function assertVisualFieldEvidenceFixture(
  visualProbeFlat: ReturnType<typeof flattenWorkoutExercises>
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const rowsHtml = visualProbeFlat
      .map((entry) => {
        const metric = entry.reps
          ? `<span class="reps">${entry.reps}</span>`
          : entry.durationSeconds
            ? `<span class="duration">00:${String(entry.durationSeconds).padStart(2, "0")}</span>`
            : "";
        return `
          <div role="dialog">
            <div class="exercise-card" data-exercise="${entry.name}">
              <div>${entry.name}</div>
              <div>Sets</div>
              <input type="text" value="${entry.sets}" />
              ${metric}
              <label>Coach Notes</label>
              <textarea>${entry.coachNote ?? ""}</textarea>
            </div>
          </div>
        `;
      })
      .join("\n");
    await page.setContent(`<html><body>${rowsHtml}</body></html>`, { waitUntil: "domcontentloaded" });
    const evidence = await collectVisualFieldEvidence(page, visualProbeFlat);
    assert(evidence.fieldsVisible, "Expected visual evidence fieldsVisible=true on fixture.");
    assert(evidence.notesVisible, "Expected visual evidence notesVisible=true on fixture.");
    assert(evidence.details.length === 3, `Expected 3 visual evidence details, got ${evidence.details.length}.`);
    for (const row of evidence.details) {
      assert(row.setsVisible, `Expected sets visible for ${row.name}.`);
      assert(row.repsVisible, `Expected reps visible (or optional) for ${row.name}.`);
      assert(row.durationVisible, `Expected duration visible (or optional) for ${row.name}.`);
      assert(row.noteVisible, `Expected coach note visible for ${row.name}.`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function assertStrengthFieldWriterFixture(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(writerSmokeFixturePath).href, { waitUntil: "domcontentloaded" });
    const glute = page.locator("[data-exercise='Glute Bridge']").first();
    const plank = page.locator("[data-exercise='Forearm Plank']").first();

    const setsWrite = await browserWriteSemanticField(glute, {
      kind: "sets",
      value: "2",
      labelTokens: ["sets"],
      placeholderTokens: ["sets"],
      ariaTokens: ["sets"],
      inputTypeAllowList: ["text", "number"],
    });
    assert(setsWrite.ok, "Expected sets write to succeed on writer fixture.");
    assert(setsWrite.readBack === "2", `Expected sets readBack=2, got ${setsWrite.readBack ?? "<empty>"}.`);

    const repsWrite = await browserWriteSemanticField(glute, {
      kind: "reps",
      value: "15",
      labelTokens: ["reps", "count"],
      placeholderTokens: ["reps", "count"],
      ariaTokens: ["reps", "count"],
      inputTypeAllowList: ["text", "number"],
    });
    assert(repsWrite.ok, "Expected reps write to succeed on writer fixture.");
    assert(repsWrite.readBack === "15", `Expected reps readBack=15, got ${repsWrite.readBack ?? "<empty>"}.`);
    assert(repsWrite.readBack !== "hh:mm:ss", "Reps writer must not report hh:mm:ss as semantic success.");

    const noteWrite = await browserWriteSemanticField(glute, {
      kind: "coachNote",
      value: "TEST NOTE Glute Bridge - pause 1 sec at top",
      labelTokens: ["coach note", "notes"],
      placeholderTokens: ["coach note", "notes"],
      ariaTokens: ["coach note", "notes"],
      allowTextarea: true,
      allowContentEditable: true,
      inputTypeAllowList: ["text"],
    });
    assert(noteWrite.ok, "Expected coach note write to succeed on writer fixture.");
    assert(
      noteWrite.readBack === "TEST NOTE Glute Bridge - pause 1 sec at top",
      `Expected note readBack to match written value, got ${noteWrite.readBack ?? "<empty>"}.`
    );

    const durationWrite = await browserWriteSemanticField(plank, {
      kind: "duration",
      value: "30",
      labelTokens: ["duration", "time", "sec"],
      placeholderTokens: ["duration", "time", "sec", "hh:mm:ss"],
      ariaTokens: ["duration", "time", "sec"],
      inputTypeAllowList: ["text", "number", "time"],
    });
    assert(durationWrite.ok, "Expected duration write to succeed on writer fixture.");
    assert(durationWrite.readBack === "30", `Expected duration readBack=30, got ${durationWrite.readBack ?? "<empty>"}.`);

    const setsVisible = await browserIsValueVisibleInBlock(glute, ["2"]);
    const repsVisible = await browserIsValueVisibleInBlock(glute, ["15"]);
    const noteVisible = await browserIsValueVisibleInBlock(glute, ["TEST NOTE Glute Bridge - pause 1 sec at top"]);
    const durationVisible = await browserIsValueVisibleInBlock(plank, ["30", "30 sec", "00:30"]);
    assert(setsVisible, "Expected sets visible after writer fixture write.");
    assert(repsVisible, "Expected reps visible after writer fixture write.");
    assert(noteVisible, "Expected coach note visible after writer fixture write.");
    assert(durationVisible, "Expected duration visible after writer fixture write.");
  } finally {
    await browser.close().catch(() => {});
  }
}

async function assertDialogScopedCardDetectionFixtures(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const detect = async (html: string, exerciseName: string) => {
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      const normalizedName = exerciseName.replace(/\s+/g, " ").trim().toLowerCase();
      const dialog = page.locator('[role="dialog"]').first();
      const dialogCount = await dialog.count();
      if (dialogCount === 0) return [];
      const cards = dialog.locator("section,article,li,tr,[role='row'],[role='group'],[data-testid],div");
      const cardCount = await cards.count();
      const rows: Array<{
        exactNameFound: boolean;
        exactNameSource: "text" | "inputValue" | "textareaValue" | "selectValue" | "ariaLabel" | "placeholder" | "unknown";
        inputValues: string[];
        className?: string;
        rejectedReason?: string;
      }> = [];
      for (let index = 0; index < cardCount; index += 1) {
        const card = cards.nth(index);
        if (!(await card.isVisible().catch(() => false))) continue;
        const hasControl =
          (await card.locator("input,textarea,select,button,[role='button']").count().catch(() => 0)) > 0;
        if (!hasControl) continue;
        const text = ((await card.innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const className = ((await card.getAttribute("class").catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
        const inputNodes = card.locator("input");
        const textareaNodes = card.locator("textarea");
        const selectNodes = card.locator("select");
        const inputValues: string[] = [];
        const textareaValues: string[] = [];
        const selectValues: string[] = [];
        const placeholders: string[] = [];
        const ariaLabels: string[] = [];
        const inputCount = await inputNodes.count();
        for (let i = 0; i < inputCount; i += 1) {
          const node = inputNodes.nth(i);
          inputValues.push(((await node.inputValue().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
          placeholders.push((((await node.getAttribute("placeholder").catch(() => "")) ?? "").replace(/\s+/g, " ").trim()));
          ariaLabels.push((((await node.getAttribute("aria-label").catch(() => "")) ?? "").replace(/\s+/g, " ").trim()));
        }
        const textareaCount = await textareaNodes.count();
        for (let i = 0; i < textareaCount; i += 1) {
          const node = textareaNodes.nth(i);
          textareaValues.push(((await node.inputValue().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
          placeholders.push((((await node.getAttribute("placeholder").catch(() => "")) ?? "").replace(/\s+/g, " ").trim()));
          ariaLabels.push((((await node.getAttribute("aria-label").catch(() => "")) ?? "").replace(/\s+/g, " ").trim()));
        }
        const selectCount = await selectNodes.count();
        for (let i = 0; i < selectCount; i += 1) {
          const node = selectNodes.nth(i);
          selectValues.push(((await node.inputValue().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
          placeholders.push((((await node.getAttribute("placeholder").catch(() => "")) ?? "").replace(/\s+/g, " ").trim()));
          ariaLabels.push((((await node.getAttribute("aria-label").catch(() => "")) ?? "").replace(/\s+/g, " ").trim()));
        }
        let exactNameSource: "text" | "inputValue" | "textareaValue" | "selectValue" | "ariaLabel" | "placeholder" | "unknown" =
          "unknown";
        if (inputValues.some((value) => value.toLowerCase() === normalizedName)) exactNameSource = "inputValue";
        else if (textareaValues.some((value) => value.toLowerCase() === normalizedName)) exactNameSource = "textareaValue";
        else if (selectValues.some((value) => value.toLowerCase() === normalizedName)) exactNameSource = "selectValue";
        else if (ariaLabels.some((value) => value.toLowerCase().includes(normalizedName))) exactNameSource = "ariaLabel";
        else if (placeholders.some((value) => value.toLowerCase().includes(normalizedName))) exactNameSource = "placeholder";
        else if (text.includes(normalizedName)) exactNameSource = "text";
        const payload = `${className} ${text}`.toLowerCase();
        const rejectedReason = /activitycalendarcard|activitycalendarcardblocktitle|daycontainer|daywidth/.test(payload)
          ? "calendar_shell"
          : undefined;
        rows.push({
          exactNameFound: exactNameSource !== "unknown",
          exactNameSource,
          inputValues: [...inputValues, ...textareaValues, ...selectValues].filter(Boolean),
          className: className || undefined,
          rejectedReason,
        });
      }
      return rows;
    };

    // Case 1: exact name only in input value.
    const case1 = await detect(
      `
      <div role="dialog">
        <div class="exercise-card">
          <label>Exercise</label>
          <input value="Glute Bridge" />
          <input value="3" />
          <input value="Reps" />
        </div>
      </div>
      `,
      "Glute Bridge"
    );
    assert(case1.length >= 1, "Case 1: expected at least one candidate in dialog.");
    assert(
      case1.some((entry) => entry.exactNameFound === true && entry.exactNameSource === "inputValue"),
      "Case 1: expected exactNameFound=true with exactNameSource=inputValue."
    );

    // Case 2: calendar card must be rejected and not selected over dialog card.
    const case2 = await detect(
      `
      <div class="activityCalendarCard">
        <span class="activityCalendarCardBlockTitle">Glute Bridge</span>
      </div>
      <div role="dialog">
        <div class="exercise-card">
          <label>Exercise</label>
          <input value="Glute Bridge" />
        </div>
      </div>
      `,
      "Glute Bridge"
    );
    assert(case2.length >= 1, "Case 2: expected at least one dialog-scoped candidate.");
    assert(
      case2.every((entry) => !String(entry.className ?? "").toLowerCase().includes("activitycalendarcard")),
      "Case 2: calendar card must not be part of dialog candidate set."
    );
    assert(
      case2.some((entry) => entry.exactNameFound && entry.rejectedReason === undefined),
      "Case 2: expected at least one non-rejected exact candidate."
    );

    // Case 3: picker/popover open should not block dialog-scoped search.
    const case3 = await detect(
      `
      <div role="presentation" class="MuiPopover-root">
        <div role="option">Glute Bridge</div>
      </div>
      <div role="dialog">
        <div class="exercise-card">
          <label>Exercise</label>
          <input value="Glute Bridge" />
          <button>Add Note</button>
        </div>
      </div>
      `,
      "Glute Bridge"
    );
    assert(case3.length >= 1, "Case 3: expected dialog candidate even when popover exists.");
    assert(case3.some((entry) => entry.exactNameFound), "Case 3: expected exact match inside dialog.");
  } finally {
    await browser.close().catch(() => {});
  }
}

async function run(): Promise<void> {
  assertStrengthWorkoutFieldWriterBrowserScriptIsSafe();
  assertVisualFieldEvidenceBrowserScriptIsSafe();
  const writerScript = readFileSync(STRENGTH_WORKOUT_FIELD_WRITER_BROWSER_SCRIPT_PATH, "utf8");
  assert(!/\b__name\s*\(/.test(writerScript), "Strength field writer browser script must not call bundler __name helper.");
  assert(
    writerScript.includes("function browserStrengthFieldAction"),
    "Strength field writer browser script must define browserStrengthFieldAction."
  );
  const visualScript = readFileSync(VISUAL_FIELD_EVIDENCE_BROWSER_SCRIPT_PATH, "utf8");
  assert(!/\b__name\s*\(/.test(visualScript), "Visual evidence browser script must not call bundler __name helper.");
  assert(
    visualScript.includes("function browserCollectVisualFieldEvidence"),
    "Visual evidence browser script must define browserCollectVisualFieldEvidence."
  );
  const template = loadFixtureTemplate();
  const flatExercises = flattenWorkoutExercises(template);
  const minimalTemplate = parseStrengthWorkoutTemplate(
    JSON.parse(readFileSync(minimalFixturePath, "utf8")) as unknown
  );
  const minimalFlat = flattenWorkoutExercises(minimalTemplate);
  const probeTemplate = parseStrengthWorkoutTemplate(JSON.parse(readFileSync(probeFixturePath, "utf8")) as unknown);
  const probeFlat = flattenWorkoutExercises(probeTemplate);
  const visualProbeTemplate = parseStrengthWorkoutTemplate(
    JSON.parse(readFileSync(visualProbeFixturePath, "utf8")) as unknown
  );
  const visualProbeFlat = flattenWorkoutExercises(visualProbeTemplate);
  const visualRepsNotesProbeTemplate = parseStrengthWorkoutTemplate(
    JSON.parse(readFileSync(visualRepsNotesProbeFixturePath, "utf8")) as unknown
  );
  const visualRepsNotesProbeFlat = flattenWorkoutExercises(visualRepsNotesProbeTemplate);

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
  assert(visualProbeTemplate.id === "visual_field_probe", "Expected visual probe template id.");
  assert(visualProbeTemplate.title === "TEST - Field Visual Probe", "Expected fixed visual probe title.");
  assert(visualProbeFlat.length === 3, `Expected 3 visual probe exercises, got ${visualProbeFlat.length}.`);
  assert(visualProbeFlat[0]?.name === "Glute Bridge", "Expected visual probe first exercise Glute Bridge.");
  assert(visualProbeFlat[1]?.name === "Forearm Plank", "Expected visual probe second exercise Forearm Plank.");
  assert(visualProbeFlat[2]?.name === "Single Leg Calf Raise", "Expected visual probe third exercise Single Leg Calf Raise.");
  assert(
    visualProbeFlat[0]?.coachNote === "TEST NOTE MANUAL CAPTURE Glute Bridge",
    "Expected Glute Bridge manual-capture note."
  );
  assert(
    visualProbeFlat[1]?.coachNote === "TEST NOTE MANUAL CAPTURE Forearm Plank",
    "Expected Forearm Plank manual-capture note."
  );
  assert(
    visualProbeFlat[2]?.coachNote === "TEST NOTE MANUAL CAPTURE Calf Raise",
    "Expected calf raise manual-capture note."
  );
  assert(
    visualRepsNotesProbeTemplate.id === "visual_field_reps_notes_probe",
    "Expected reps-notes probe template id."
  );
  assert(
    visualRepsNotesProbeFlat.length === 2,
    `Expected 2 visual reps-notes probe exercises, got ${visualRepsNotesProbeFlat.length}.`
  );
  assert(
    visualRepsNotesProbeFlat[0]?.name === "Glute Bridge" &&
      visualRepsNotesProbeFlat[1]?.name === "Single Leg Calf Raise",
    "Expected reps-notes probe to include Glute Bridge and Single Leg Calf Raise."
  );
  assert(
    !visualRepsNotesProbeFlat.some((entry) => Boolean(entry.durationSeconds)),
    "Expected reps-notes probe to exclude duration fields."
  );
  await assertVisualFieldEvidenceFixture(visualProbeFlat);
  await assertStrengthFieldWriterFixture();
  await assertDialogScopedCardDetectionFixtures();

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
    runStatus: "completed",
    manualBuilder: false,
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
    visualFieldVerification: {
      beforeSave: {
        fieldsVisible: true,
        notesVisible: true,
        details: [
          {
            name: "Glute Bridge",
            setsVisible: true,
            repsVisible: true,
            durationVisible: true,
            noteVisible: true,
          },
        ],
      },
      afterSave: {
        fieldsVisible: false,
        notesVisible: false,
        details: [
          {
            name: "Glute Bridge",
            setsVisible: false,
            repsVisible: false,
            durationVisible: false,
            noteVisible: false,
          },
        ],
      },
    },
    screenshots: ["reports/strength-builder-create-test-workout/screenshots/dry-run-home.png"],
    warnings: ["Dry-run summary fixture."],
    errors: [],
  };

  const markdown = buildStrengthWorkoutSummaryMarkdown(summary);
  assert(markdown.includes("TEST - Beginner Runner Strength Foundation"), "Expected title in summary markdown.");
  assert(markdown.includes("Missing visible exercises"), "Expected verification section in markdown.");
  assert(markdown.includes("Visual field verification"), "Expected visual verification section in markdown.");
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
  const notRunSummary: StrengthWorkoutRunSummary = {
    ...summary,
    builderOpened: false,
    addBlockButtonFound: false,
    pickerSearchFound: false,
    attemptedExercises: [],
    verification: {
      titleVisible: false,
      expectedExercisesVisible: [],
      missingExercisesVisible: flatExercises.map((exercise) => exercise.name),
      visibleExerciseCount: 0,
      unexpectedExerciseCheck: "No builder detected; no exercise attempts were made; card diagnostics not generated.",
      status: "not_run",
    },
  };
  const notRunMarkdown = buildStrengthWorkoutSummaryMarkdown(notRunSummary);
  assert(notRunMarkdown.includes("No builder detected; no exercise attempts were made; card diagnostics not generated."), "Expected explicit no-builder summary line.");
  assert(notRunMarkdown.includes("not_run"), "Expected not_run verification status in summary markdown.");

  const tpCreateSource = readFileSync(tpCreateScriptPath, "utf8");
  assert(
    !/block\.evaluate\s*\(/.test(tpCreateSource),
    "tp-create-test-strength-workout.ts must not call block.evaluate directly."
  );
  assert(
    !/locator\.evaluate\s*\(/.test(tpCreateSource),
    "tp-create-test-strength-workout.ts must not call locator.evaluate directly."
  );

  const allowedImports = [
    "./lib/strength-workout-ui-writer.ts",
    "./lib/strength-workout-field-writer-scrape.ts",
    "./lib/strength-visual-field-evidence-scrape.ts",
    "playwright",
  ];
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
  console.log(`- visual probe exercises: ${visualProbeFlat.length}`);
  console.log(`- title: ${template.title}`);
}

try {
  await run();
} catch (error) {
  console.error("check-strength-workout-ui-writer failed.");
  console.error(error);
  process.exit(1);
}
