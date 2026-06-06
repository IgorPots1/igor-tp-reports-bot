import assert from "node:assert/strict";

import {
  getQualityWorkoutCatalogEntry,
  getNextProgressionCandidates,
  getPreferredRecovery,
  isDefaultRecoveryValid,
  isRecoveryAllowed,
  qualityStructureTotalMinutes,
  selectQualityMethodologyV0,
  validateQualityStructureForIntent,
} from "./lib/plan-quality-methodology-catalog.ts";

function testAnnaRecent20x1SelectsVo2_10x2(): void {
  const selected = selectQualityMethodologyV0({
    quality_count_cap: 1,
    planned_run_count: 3,
    has_active_illness_or_injury: false,
    has_race_context: false,
    recent_quality_diagnostic_available: true,
    found_20x1_candidate: true,
  });
  assert.equal(selected.selected, true);
  if (selected.selected) {
    assert.equal(selected.intent, "vo2max_intervals");
    assert.equal(selected.workout_key, "vo2_10x2");
    assert.notEqual(selected.intent, "controlled_sub_threshold");
    assert.notEqual(selected.workout_key, "controlled_3x6");
  }
}

function testWriterMissingIntentWouldBlock(): void {
  const selected = selectQualityMethodologyV0({
    quality_count_cap: 1,
    planned_run_count: 3,
    has_active_illness_or_injury: false,
    has_race_context: false,
    recent_quality_diagnostic_available: false,
    found_20x1_candidate: false,
  });
  assert.equal(selected.selected, false);
  assert.equal(selected.reason, "draft_needs_quality_intent");
}

function testControlledSubThresholdDisallows63Default(): void {
  const entry = getQualityWorkoutCatalogEntry("controlled_3x6");
  const validation = validateQualityStructureForIntent({
    intent: entry.intent,
    workout_key: entry.key,
    structure: entry.structure,
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, "controlled_sub_threshold_6x3_not_allowed_as_v0_default");
}

function testVo210x2Total55(): void {
  const entry = getQualityWorkoutCatalogEntry("vo2_10x2");
  assert.equal(qualityStructureTotalMinutes(entry.structure), 55);
  assert.equal(entry.structure.total_minutes, 55);
}

function testVo2RecoveryRules(): void {
  assert.equal(isRecoveryAllowed("vo2max_intervals", 1, 1), true);
  assert.equal(isDefaultRecoveryValid("vo2max_intervals", 1, 1), true);

  assert.equal(isRecoveryAllowed("vo2max_intervals", 1.5, 1.5), true);
  assert.equal(isDefaultRecoveryValid("vo2max_intervals", 1.5, 1.5), true);

  assert.equal(getPreferredRecovery("vo2max_intervals", 2), 1.5);
  assert.equal(isDefaultRecoveryValid("vo2max_intervals", 2, 1.5), true);
  assert.equal(isRecoveryAllowed("vo2max_intervals", 2, 2), true);

  assert.equal(isRecoveryAllowed("vo2max_intervals", 3, 2), true);
  assert.equal(isDefaultRecoveryValid("vo2max_intervals", 3, 2), true);

  assert.equal(isRecoveryAllowed("vo2max_intervals", 4, 3), true);
  assert.equal(isDefaultRecoveryValid("vo2max_intervals", 4, 3), true);
}

function testBelowThresholdRecoveryRules(): void {
  assert.equal(isRecoveryAllowed("controlled_sub_threshold", 4, 1.5), true);
  assert.equal(isDefaultRecoveryValid("controlled_sub_threshold", 4, 1.5), true);
  assert.equal(getPreferredRecovery("controlled_sub_threshold", 6), 1.5);
  assert.equal(getPreferredRecovery("controlled_sub_threshold", 6, "beginner_cautious"), 2);
  assert.equal(isRecoveryAllowed("controlled_sub_threshold", 6, 2), true);
  assert.equal(isDefaultRecoveryValid("controlled_sub_threshold", 6, 3), false);
}

function testThresholdTempoRecoveryRules(): void {
  assert.equal(getPreferredRecovery("threshold_tempo", 5), 2);
  assert.equal(getPreferredRecovery("threshold_tempo", 8), 2);
  assert.equal(isRecoveryAllowed("threshold_tempo", 9, 2), true);
  assert.equal(isRecoveryAllowed("threshold_tempo", 9, 2.5), true);
  assert.equal(isDefaultRecoveryValid("threshold_tempo", 9, 3), false);
}

function testVo2ProgressionRules(): void {
  const candidates = getNextProgressionCandidates("20x1", {
    workout_completed: true,
    rpe: "moderate",
    coach_review_blocker: false,
    strong_fatigue_or_injury_signal: false,
  });
  assert.equal(candidates.progression_family, "vo2_short_to_long_intervals");
  assert.equal(candidates.decision, "progress");
  assert.equal(candidates.next_preferred_keys.includes("vo2_10x2"), true);
  assert.equal(candidates.next_preferred_keys.includes("controlled_3x6"), false);

  const vo2FamilyEntries = ["vo2_15x400", "vo2_20x90sec"] as const;
  for (const key of vo2FamilyEntries) {
    const entry = getQualityWorkoutCatalogEntry(key);
    assert.equal(entry.progression_family, "vo2_short_to_long_intervals");
  }
}

function testWriterGuardSignals(): void {
  const missingIntentSelection = selectQualityMethodologyV0({
    quality_count_cap: 1,
    planned_run_count: 3,
    has_active_illness_or_injury: false,
    has_race_context: false,
    recent_quality_diagnostic_available: false,
    found_20x1_candidate: false,
  });
  assert.equal(missingIntentSelection.selected, false);
  assert.equal(missingIntentSelection.reason, "draft_needs_quality_intent");

  const badControlled = {
    ...getQualityWorkoutCatalogEntry("controlled_3x6"),
    structure: {
      ...getQualityWorkoutCatalogEntry("controlled_3x6").structure,
      repeats: {
        repeat_count: 3,
        work_minutes: 6,
        recovery_minutes: 3,
        work_label: "controlled_sub_threshold",
        recovery_label: "easy_jog",
      },
    },
  };
  const badValidation = validateQualityStructureForIntent({
    intent: badControlled.intent,
    workout_key: badControlled.key,
    structure: badControlled.structure,
  });
  assert.equal(badValidation.ok, false);
}

function main(): void {
  testAnnaRecent20x1SelectsVo2_10x2();
  testWriterMissingIntentWouldBlock();
  testControlledSubThresholdDisallows63Default();
  testVo210x2Total55();
  testVo2RecoveryRules();
  testBelowThresholdRecoveryRules();
  testThresholdTempoRecoveryRules();
  testVo2ProgressionRules();
  testWriterGuardSignals();
  console.log("[tp-plan-quality-methodology-checks-v0] all checks passed");
}

main();
