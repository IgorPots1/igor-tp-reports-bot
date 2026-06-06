import assert from "node:assert/strict";

import {
  getQualityWorkoutCatalogEntry,
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

function main(): void {
  testAnnaRecent20x1SelectsVo2_10x2();
  testWriterMissingIntentWouldBlock();
  testControlledSubThresholdDisallows63Default();
  testVo210x2Total55();
  console.log("[tp-plan-quality-methodology-checks-v0] all checks passed");
}

main();
