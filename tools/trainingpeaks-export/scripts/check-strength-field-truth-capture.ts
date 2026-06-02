import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_DURATION_SECONDS,
  REQUIRED_SAVE_CONFIRMATION,
  SAFE_ATHLETE_URL,
  SAFE_DATE,
  TARGET_EXERCISE_NAMES,
  TARGET_VALUE_TOKENS,
  buildCheckpointPlan,
  buildHelpText,
  buildRunSummaryMarkdown,
  deriveVerdict,
  parseTruthCaptureArgs,
  type DomCaptureArtifact,
  type TruthCaptureLog,
} from "./lib/strength-field-truth-capture.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeControl(overrides: Partial<DomCaptureArtifact["valueSignalControls"][number]> = {}) {
  return {
    index: 0,
    tag: "input",
    type: "text",
    value: "2",
    placeholder: "Sets",
    ariaLabel: "Sets",
    title: undefined,
    nearbyText: "Sets",
    labelText: "Sets",
    rect: { x: 10, y: 10, width: 90, height: 24 },
    parentChain: [{ depth: 0, tag: "input" }],
    ...overrides,
  };
}

function buildDomArtifact(checkpoint: string, overrides: Partial<DomCaptureArtifact> = {}): DomCaptureArtifact {
  return {
    checkpoint,
    url: `${SAFE_ATHLETE_URL}?date=${SAFE_DATE}`,
    timestamp: "2026-06-02T09:30:00.000Z",
    targetExerciseNames: TARGET_EXERCISE_NAMES,
    dialogFound: true,
    dialogs: [
      {
        index: 0,
        rect: { x: 0, y: 0, width: 800, height: 600 },
        textSample: ["New Strength Builder", "Glute Bridge", "Sets", "Reps"],
        inputs: [makeControl(), makeControl({ index: 1, value: "15", placeholder: "Reps", ariaLabel: "Reps", nearbyText: "Reps", labelText: "Reps" })],
        textareas: [],
        buttons: [makeControl({ tag: "button", type: "button", value: "Coach Notes", placeholder: undefined, ariaLabel: "Coach Notes" })],
        exactExerciseNameOccurrences: [
          {
            name: "Glute Bridge",
            source: "text",
            value: "Glute Bridge",
            rect: { x: 0, y: 0, width: 120, height: 20 },
            parentChain: [{ depth: 0, tag: "div" }],
            nearbyInputs: [makeControl(), makeControl({ index: 1, value: "15", placeholder: "Reps" })],
            nearbyButtons: [makeControl({ tag: "button", type: "button", value: "Coach Notes" })],
          },
        ],
        exactValueTokenOccurrences: [
          {
            name: "2",
            source: "inputValue",
            value: "2",
            rect: { x: 10, y: 10, width: 90, height: 24 },
            parentChain: [{ depth: 0, tag: "input" }],
            nearbyInputs: [makeControl()],
            nearbyButtons: [],
          },
        ],
        possibleExerciseCards: [
          {
            exactName: "Glute Bridge",
            evidenceSource: "text",
            rect: { x: 0, y: 0, width: 200, height: 120 },
            textSample: ["Glute Bridge", "Sets", "Reps"],
            inputValues: ["2", "15"],
            controls: [makeControl(), makeControl({ index: 1, value: "15", placeholder: "Reps" })],
            parentChain: [{ depth: 0, tag: "div" }],
          },
        ],
      },
    ],
    activeElement: {
      tag: "input",
      type: "text",
      value: "2",
      placeholder: "Sets",
      ariaLabel: "Sets",
      rect: { x: 10, y: 10, width: 90, height: 24 },
      parentChain: [{ depth: 0, tag: "input" }],
    },
    focusedControl: makeControl(),
    valueSignalControls: [makeControl(), makeControl({ index: 1, value: "15", placeholder: "Reps" })],
    ...overrides,
  };
}

async function run(): Promise<void> {
  const helpText = buildHelpText();
  assert(helpText.includes("TrainingPeaks Strength Field Truth Capture"), "Help text title missing.");
  assert(helpText.includes(REQUIRED_SAVE_CONFIRMATION), "Help text must mention save confirmation.");

  const parsed = parseTruthCaptureArgs([
    "--athlete-url",
    SAFE_ATHLETE_URL,
    "--date",
    SAFE_DATE,
    "--headed",
    "--manual",
    "--duration",
    String(DEFAULT_DURATION_SECONDS),
  ]);
  assert(parsed.athleteUrl === SAFE_ATHLETE_URL, "Expected safe athlete URL.");
  assert(parsed.date === SAFE_DATE, "Expected safe date.");
  assert(parsed.manual === true, "Expected manual=true.");
  assert(parsed.headless === false, "Expected headed mode.");

  const withSave = parseTruthCaptureArgs([
    "--athlete-url",
    SAFE_ATHLETE_URL,
    "--date",
    SAFE_DATE,
    "--headless",
    "--manual",
    "--allow-save-capture",
  ]);
  assert(withSave.allowSaveCapture === true, "Expected allowSaveCapture=true.");
  assert(withSave.headless === true, "Expected headless=true.");

  const checkpoints = buildCheckpointPlan(false);
  assert(checkpoints.length === 6, `Expected 6 checkpoints without save capture, got ${checkpoints.length}.`);
  const saveCheckpoints = buildCheckpointPlan(true);
  assert(saveCheckpoints.length === 7, `Expected 7 checkpoints with save capture, got ${saveCheckpoints.length}.`);
  assert(saveCheckpoints[6]?.id === "checkpoint-07-after-save", "Expected after-save checkpoint.");

  const domArtifacts = [
    buildDomArtifact("checkpoint-03-glute-sets-reps-set"),
    buildDomArtifact("checkpoint-04-glute-note-set", {
      dialogs: [
        {
          ...buildDomArtifact("checkpoint-04-glute-note-set").dialogs[0],
          textareas: [
            makeControl({
              tag: "textarea",
              type: "textarea",
              value: "TEST NOTE MANUAL CAPTURE Glute Bridge",
              placeholder: "Coach Notes",
              ariaLabel: "Coach Notes",
              nearbyText: "Coach Notes",
              labelText: "Coach Notes",
            }),
          ],
        },
      ],
    }),
    buildDomArtifact("checkpoint-05-plank-duration-set", {
      dialogs: [
        {
          ...buildDomArtifact("checkpoint-05-plank-duration-set").dialogs[0],
          inputs: [
            makeControl({ value: "3", placeholder: "Sets", ariaLabel: "Sets", nearbyText: "Sets" }),
            makeControl({
              index: 1,
              value: "30 sec",
              placeholder: "Duration",
              ariaLabel: "Duration",
              nearbyText: "Duration",
              labelText: "Duration",
            }),
          ],
          exactExerciseNameOccurrences: [
            {
              name: "Forearm Plank",
              source: "text",
              value: "Forearm Plank",
              rect: { x: 0, y: 0, width: 120, height: 20 },
              parentChain: [{ depth: 0, tag: "div" }],
              nearbyInputs: [
                makeControl({ value: "3", placeholder: "Sets" }),
                makeControl({ index: 1, value: "30 sec", placeholder: "Duration", ariaLabel: "Duration" }),
              ],
              nearbyButtons: [],
            },
          ],
          exactValueTokenOccurrences: [
            {
              name: "30",
              source: "inputValue",
              value: "30 sec",
              rect: { x: 0, y: 0, width: 120, height: 20 },
              parentChain: [{ depth: 0, tag: "div" }],
              nearbyInputs: [
                makeControl({ value: "3", placeholder: "Sets" }),
                makeControl({ index: 1, value: "30 sec", placeholder: "Duration", ariaLabel: "Duration" }),
              ],
              nearbyButtons: [],
            },
          ],
          possibleExerciseCards: [
            {
              exactName: "Forearm Plank",
              evidenceSource: "text",
              rect: { x: 0, y: 120, width: 200, height: 120 },
              textSample: ["Forearm Plank", "Duration"],
              inputValues: ["3", "30 sec"],
              controls: [
                makeControl({ value: "3", placeholder: "Sets" }),
                makeControl({ index: 1, value: "30 sec", placeholder: "Duration", ariaLabel: "Duration" }),
              ],
              parentChain: [{ depth: 0, tag: "div" }],
            },
          ],
        },
      ],
    }),
  ];

  const log: TruthCaptureLog = {
    runAt: "2026-06-02T09:30:00.000Z",
    runDir: "reports/strength-field-truth-capture/20260602-113000",
    athleteUrlRedacted: SAFE_ATHLETE_URL.replace("/3102415", "/<ATHLETE_ID>"),
    date: SAFE_DATE,
    manual: true,
    allowSaveCapture: false,
    finishedReason: "completed_all_checkpoints",
    liveCaptureRan: true,
    checkpoints: [
      {
        id: "checkpoint-03-glute-sets-reps-set",
        prompt: "Checkpoint 3",
        startedAt: "2026-06-02T09:30:00.000Z",
        completedAt: "2026-06-02T09:31:00.000Z",
        action: "captured",
        required: true,
        optional: false,
        dialogFound: true,
        exerciseOccurrenceCount: 2,
        inputControlCount: 2,
        networkEventCount: 1,
        screenshotPath: "reports/strength-field-truth-capture/20260602-113000/screenshots/checkpoint-03-glute-sets-reps-set.png",
        domPath: "reports/strength-field-truth-capture/20260602-113000/dom/checkpoint-03-glute-sets-reps-set.json",
      },
      {
        id: "checkpoint-04-glute-note-set",
        prompt: "Checkpoint 4",
        startedAt: "2026-06-02T09:31:00.000Z",
        completedAt: "2026-06-02T09:32:00.000Z",
        action: "captured",
        required: true,
        optional: false,
        dialogFound: true,
        exerciseOccurrenceCount: 1,
        inputControlCount: 3,
        networkEventCount: 1,
      },
      {
        id: "checkpoint-05-plank-duration-set",
        prompt: "Checkpoint 5",
        startedAt: "2026-06-02T09:32:00.000Z",
        completedAt: "2026-06-02T09:33:00.000Z",
        action: "captured",
        required: false,
        optional: true,
        dialogFound: true,
        exerciseOccurrenceCount: 2,
        inputControlCount: 2,
        networkEventCount: 1,
      },
    ],
    screenshots: ["reports/strength-field-truth-capture/20260602-113000/screenshots/checkpoint-03-glute-sets-reps-set.png"],
    domArtifacts: ["reports/strength-field-truth-capture/20260602-113000/dom/checkpoint-03-glute-sets-reps-set.json"],
    networkEventsPath: "reports/strength-field-truth-capture/20260602-113000/network/network-events.json",
    networkEventCount: 1,
    networkEvents: [
      {
        checkpoint: "checkpoint-03-glute-sets-reps-set",
        timestamp: "2026-06-02T09:31:00.000Z",
        method: "GET",
        urlRedacted: "https://tpapi.trainingpeaks.com/fitness/v6/workouts/<WORKOUT_ID>",
        resourceType: "fetch",
        status: 200,
        responseJsonShape: { type: "object" },
        headersRedacted: true,
      },
    ],
    verdict: "continue_ui_writer_with_exact_selectors",
    notes: [],
    errors: [],
  };

  const verdict = deriveVerdict(log, domArtifacts);
  assert(verdict === "continue_ui_writer_with_exact_selectors", `Expected UI verdict, got ${verdict}.`);
  const summary = buildRunSummaryMarkdown({ ...log, verdict }, domArtifacts);
  assert(summary.includes("VERDICT: continue_ui_writer_with_exact_selectors"), "Expected continue_ui_writer verdict in summary.");
  assert(summary.includes("Sets: tag=input"), "Expected sets control details in summary.");
  assert(summary.includes("Coach notes"), "Expected coach notes section.");
  assert(summary.includes("Finished reason: completed_all_checkpoints"), "Expected finished reason in summary.");
  assert(summary.includes("## Checkpoints"), "Expected checkpoint section in summary.");

  const networkVerdict = deriveVerdict(
    {
      ...log,
      allowSaveCapture: true,
      finishedReason: "completed_all_checkpoints",
      networkEvents: [
        ...log.networkEvents,
        {
          checkpoint: "checkpoint-07-after-save",
          timestamp: "2026-06-02T09:40:00.000Z",
          method: "PUT",
          urlRedacted: "https://tpapi.trainingpeaks.com/fitness/v6/workouts/<WORKOUT_ID>",
          resourceType: "fetch",
          status: 200,
          requestPostDataShape: { type: "object", keys: ["structure", "workoutId"] },
          responseJsonShape: { type: "object" },
          headersRedacted: true,
        },
      ],
      networkEventCount: 2,
    },
    domArtifacts
  );
  assert(networkVerdict === "pivot_to_network_payload_writer", `Expected network verdict, got ${networkVerdict}.`);

  const incompleteVerdict = deriveVerdict(
    {
      ...log,
      checkpoints: log.checkpoints.slice(0, 1),
    },
    domArtifacts.slice(0, 1)
  );
  assert(incompleteVerdict === "capture_incomplete", `Expected incomplete verdict, got ${incompleteVerdict}.`);

  let badArgsFailed = false;
  try {
    parseTruthCaptureArgs(["--athlete-url", "https://app.trainingpeaks.com/#calendar/athletes/123", "--date", SAFE_DATE, "--headed", "--manual"]);
  } catch {
    badArgsFailed = true;
  }
  assert(badArgsFailed, "Expected unsafe athlete URL to fail.");

  const source = readFileSync(path.join(__dirname, "tp-capture-strength-field-truth.ts"), "utf8");
  assert(!source.includes(".click(") || source.includes("Do NOT"), "Capture script should not automate UI clicking beyond browser startup.");

  console.log("check-strength-field-truth-capture: ok");
  console.log(`- safe athlete: ${SAFE_ATHLETE_URL}`);
  console.log(`- safe date: ${SAFE_DATE}`);
  console.log(`- checkpoints: ${checkpoints.length}/${saveCheckpoints.length}`);
  console.log(`- tokens: ${TARGET_VALUE_TOKENS.join(", ")}`);
}

try {
  await run();
} catch (error) {
  console.error("check-strength-field-truth-capture failed.");
  console.error(error);
  process.exit(1);
}
