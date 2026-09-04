import process from "node:process";

import {
  PROVEN_SINGLE_LEG_CALF_RAISE,
  renderStrengthWorkoutPayload,
  type StrengthExerciseRecord,
  type StrengthWorkoutDefinition,
} from "./lib/strength-workout-renderer.ts";

/**
 * Pins the strength renderer to the one StructuredStrength body that was
 * actually accepted by api.peakswaresb.com/rx/activity/v1/workouts/save
 * (tp-probe-strength-create-save.ts, workout id 22291958). Offline, no network.
 */

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Deterministic ids so the rendered body can be compared field by field. */
function makeIdFactory(): () => string {
  let counter = 0;
  return () => `id-${++counter}`;
}

function expectThrows(run: () => unknown, fragment: string, message: string): void {
  try {
    run();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert(text.includes(fragment), `${message}: expected error containing "${fragment}", got "${text}"`);
    return;
  }
  throw new Error(`${message}: expected a throw, got none`);
}

function checkMatchesProvenProbeBody(): void {
  const definition: StrengthWorkoutDefinition = {
    athleteId: 3102415,
    prescribedDate: "2026-12-31",
    title: "PROBE TP STRENGTH SAVE — DO NOT USE",
    instructions: "PR1_STRENGTH_SAVE_PROBE",
    blocks: [{ exercise: PROVEN_SINGLE_LEG_CALF_RAISE, sets: [{ RepsPerSide: "12" }] }],
  };

  const payload = renderStrengthWorkoutPayload(definition, { idFactory: makeIdFactory() });

  // Executor contract: it supplies workoutType + calendarId, we must not.
  assert(!("workoutType" in payload), "renderer must not set workoutType (executor adds it)");
  assert(!("calendarId" in payload), "renderer must not set calendarId (executor derives it from athleteId)");
  assertEqual(payload.athleteId, 3102415, "athleteId");
  assertEqual(payload.prescribedDate, "2026-12-31", "prescribedDate");
  assertEqual(payload.instructions, "PR1_STRENGTH_SAVE_PROBE", "instructions");

  assertEqual(payload.blocks.length, 1, "blocks length");
  const block = payload.blocks[0];
  assertEqual(block.blockType, "SingleExercise", "blockType");
  assertEqual(block.title, "Single Leg Calf Raise", "block title");
  assertEqual(block.coachNotes, null, "block coachNotes");
  assertEqual(block.isComplete, false, "block isComplete");
  assertEqual(block.compliancePercent, 0, "block compliancePercent");
  assertEqual(block.parameters.length, 0, "block parameters must be empty");

  const prescription = block.prescriptions[0];
  assertEqual(prescription.exercise.id, "26", "exercise id");
  assertEqual(prescription.exercise.ownerId, 2000301, "exercise ownerId");
  assertEqual(prescription.exercise.title, "Single Leg Calf Raise", "exercise title");
  assertEqual(prescription.exercise.videoUrl, "https://youtu.be/jRB58gIRAyU", "exercise videoUrl");
  assertEqual(prescription.exercise.instructions, null, "exercise instructions");
  assertEqual(prescription.exercise.canEdit, false, "exercise canEdit");

  // Library-local parameter id is "0", NOT a UUID — this tripped the probe.
  assertEqual(prescription.exercise.parameters.length, 1, "exercise parameters length");
  assertEqual(prescription.exercise.parameters[0].parameter, "RepsPerSide", "exercise parameter name");
  assertEqual(prescription.exercise.parameters[0].title, "Reps/side", "exercise parameter title");
  assertEqual(prescription.exercise.parameters[0].id, "0", "exercise parameter id must be \"0\"");
  assertEqual(prescription.exercise.parameters[0].unit.unit, "Reps", "exercise parameter unit");

  // Prescription-level copy uses generated ids instead.
  assertEqual(prescription.parameters.length, 1, "prescription parameters length");
  assert(
    prescription.parameters[0].id !== "0",
    "prescription-level parameter id must be generated, not the library-local \"0\""
  );

  assertEqual(prescription.sets.length, 1, "sets length");
  const set = prescription.sets[0];
  assertEqual(set.isComplete, false, "set isComplete");
  assertEqual(set.setOrigin, "Prescribed", "set setOrigin");
  assertEqual(set.parameterValues.length, 1, "parameterValues length");
  assertEqual(set.parameterValues[0].parameter, "RepsPerSide", "parameterValue parameter");
  assertEqual(set.parameterValues[0].inputFormat, "Integer", "parameterValue inputFormat");
  assertEqual(set.parameterValues[0].prescribedValue, "12", "parameterValue prescribedValue");
  assertEqual(set.parameterValues[0].executedValue, null, "parameterValue executedValue");

  assertEqual(prescription.setSummaryTemplate, "{RepsPerSide} Reps/side", "setSummaryTemplate");
  assertEqual(prescription.coachNotes, null, "prescription coachNotes");

  assertEqual(payload.snapshot.totalBlocks, 1, "snapshot totalBlocks");
  assertEqual(payload.snapshot.totalSets, 1, "snapshot totalSets");
  assertEqual(payload.snapshot.totalPrescriptions, 1, "snapshot totalPrescriptions");
  assertEqual(payload.snapshot.completedSets, 0, "snapshot completedSets");

  assertEqual(payload.isHidden, false, "isHidden must be false or the workout vanishes from the plan");
  assertEqual(payload.isLocked, false, "isLocked");
  assertEqual(payload.rpe, null, "rpe");
  assertEqual(payload.feel, null, "feel");
}

function checkSnapshotCountsAcrossBlocks(): void {
  const duration: StrengthExerciseRecord = {
    id: "999",
    ownerId: 2000301,
    title: "Arm Climb",
    videoUrl: null,
    instructions: null,
    parameters: [
      {
        parameter: "Duration",
        title: "Duration",
        unit: { title: "Duration", abbreviation: "", unit: "Duration" },
        category: "Duration",
        inputFormat: "Duration",
      },
    ],
  };

  const payload = renderStrengthWorkoutPayload(
    {
      athleteId: 5488703,
      prescribedDate: "2026-09-05",
      title: "Силовая",
      blocks: [
        { exercise: PROVEN_SINGLE_LEG_CALF_RAISE, sets: [{ RepsPerSide: "20" }, { RepsPerSide: "20" }, { RepsPerSide: "20" }] },
        { exercise: duration, coachNotes: "держим корпус", sets: [{ Duration: "00:50" }, { Duration: "00:50" }] },
      ],
    },
    { idFactory: makeIdFactory() }
  );

  assertEqual(payload.snapshot.totalBlocks, 2, "multi-block snapshot totalBlocks");
  assertEqual(payload.snapshot.totalPrescriptions, 2, "multi-block snapshot totalPrescriptions");
  assertEqual(payload.snapshot.totalSets, 5, "multi-block snapshot totalSets (3 + 2)");
  assertEqual(payload.blocks[1].coachNotes, "держим корпус", "per-block coach note is preserved");
  assertEqual(
    payload.blocks[1].prescriptions[0].sets[0].parameterValues[0].inputFormat,
    "Duration",
    "harvested inputFormat is forwarded verbatim"
  );
  assertEqual(
    payload.blocks[1].prescriptions[0].setSummaryTemplate,
    "{Duration} Duration",
    "setSummaryTemplate follows the exercise parameters"
  );
}

function checkValidationGuards(): void {
  const base: StrengthWorkoutDefinition = {
    athleteId: 5488703,
    prescribedDate: "2026-09-05",
    title: "Силовая",
    blocks: [{ exercise: PROVEN_SINGLE_LEG_CALF_RAISE, sets: [{ RepsPerSide: "20" }] }],
  };

  expectThrows(
    () => renderStrengthWorkoutPayload({ ...base, blocks: [] }),
    "at least one block",
    "empty blocks must be rejected"
  );
  expectThrows(
    () => renderStrengthWorkoutPayload({ ...base, prescribedDate: "05.09.2026" }),
    "YYYY-MM-DD",
    "bad date format must be rejected"
  );
  expectThrows(
    () => renderStrengthWorkoutPayload({ ...base, athleteId: 0 }),
    "athleteId",
    "missing athleteId must be rejected"
  );
  expectThrows(
    () =>
      renderStrengthWorkoutPayload({
        ...base,
        blocks: [{ exercise: PROVEN_SINGLE_LEG_CALF_RAISE, sets: [] }],
      }),
    "no sets",
    "a block without sets must be rejected"
  );
  // Typo-proofing: prescribing a parameter the exercise does not declare would
  // silently produce a set TP cannot render.
  expectThrows(
    () =>
      renderStrengthWorkoutPayload({
        ...base,
        blocks: [{ exercise: PROVEN_SINGLE_LEG_CALF_RAISE, sets: [{ Reps: "20" }] }],
      }),
    "which the exercise does not declare",
    "unknown parameter name must be rejected"
  );
  expectThrows(
    () =>
      renderStrengthWorkoutPayload({
        ...base,
        blocks: [
          {
            exercise: { ...PROVEN_SINGLE_LEG_CALF_RAISE, id: "" },
            sets: [{ RepsPerSide: "20" }],
          },
        ],
      }),
    "exercise id",
    "a block without a TP exercise id must be rejected"
  );
}

function main(): void {
  const checks: Array<[string, () => void]> = [
    ["matches the live-proven /save probe body", checkMatchesProvenProbeBody],
    ["snapshot counts across blocks and sets", checkSnapshotCountsAcrossBlocks],
    ["validation guards", checkValidationGuards],
  ];

  for (const [name, run] of checks) {
    run();
    console.log(`ok — ${name}`);
  }

  console.log(`\ncheck-strength-workout-renderer: ${checks.length}/${checks.length} passed.`);
}

try {
  main();
} catch (error) {
  console.error("check-strength-workout-renderer FAILED.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
