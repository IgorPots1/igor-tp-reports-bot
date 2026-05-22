import process from "node:process";

import {
  VDOT_STYLE_CONFIG_VERSION,
  VDOT_STYLE_DEFAULT_RIEGEL_EXPONENT,
  VDOT_STYLE_STALENESS_THRESHOLD_DAYS,
  VDOT_STYLE_STANDARD_DISTANCES,
  VDOT_STYLE_TEN_K_PACE_MULTIPLIERS,
  VDOT_STYLE_VERDICT_THRESHOLDS,
} from "./lib/vdot-style/constants.ts";
import { classifySegmentPace } from "./lib/vdot-style/classify.ts";
import { equivalentRaceTimes } from "./lib/vdot-style/equivalency.ts";
import { formatDurationFromSeconds } from "./lib/race-distance.ts";
import { trainingZonesFromAnchor } from "./lib/vdot-style/zones.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApprox(
  actual: number,
  expected: number,
  tolerance: number,
  label: string,
): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} +/- ${tolerance}, got ${actual}.`);
  }
}

function formatPace(secondsPerKm: number): string {
  const totalSeconds = Math.round(secondsPerKm);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

function hasThresholdishClassification(result: {
  zone: string;
  boundary_label?: string;
}): boolean {
  return result.zone === "threshold" ||
    result.boundary_label === "interval/threshold" ||
    result.boundary_label === "threshold/marathon";
}

function hasIntervalishClassification(result: {
  zone: string;
  boundary_label?: string;
}): boolean {
  return result.zone === "interval" ||
    result.boundary_label === "interval/threshold" ||
    result.boundary_label === "repetition/interval";
}

function hasThresholdOrUpperIntervalClassification(result: {
  zone: string;
  boundary_label?: string;
}): boolean {
  return hasThresholdishClassification(result) ||
    result.zone === "interval" ||
    result.boundary_label === "repetition/interval";
}

function runTatianaFixture(): void {
  const anchorDistanceMeters = VDOT_STYLE_STANDARD_DISTANCES["10k"];
  const anchorTimeSeconds = 49 * 60 + 30;

  const equivalents = equivalentRaceTimes(anchorDistanceMeters, anchorTimeSeconds);
  const zones = trainingZonesFromAnchor(anchorDistanceMeters, anchorTimeSeconds);

  assertApprox(
    equivalents["10k"].pace_seconds_per_km,
    297,
    0.1,
    "Tatiana equivalent 10K pace",
  );

  const sixByFive = classifySegmentPace(297, zones.zones);
  assert(
    hasIntervalishClassification(sixByFive),
    "Tatiana 6x5 min at 4:57/km should classify as interval-ish.",
  );
  assert(
    sixByFive.distance_supported.includes("10k"),
    "Tatiana 6x5 min should support 10K-oriented work.",
  );

  const fourByTen = classifySegmentPace(311, zones.zones);
  assert(
    hasThresholdishClassification(fourByTen),
    "Tatiana 4x10 at 5:11/km should classify as threshold-ish.",
  );

  const twoByTwentyFive = classifySegmentPace(302, zones.zones);
  assert(
    hasThresholdishClassification(twoByTwentyFive) || hasIntervalishClassification(twoByTwentyFive),
    "Tatiana 2x25 at 5:02/km should sit near the threshold/interval edge.",
  );

  console.log(
    `[tatiana] 10k anchor ${formatDurationFromSeconds(anchorTimeSeconds)} -> eq10k ${formatPace(equivalents["10k"].pace_seconds_per_km)}`,
  );
  console.log(
    `[tatiana] 4:57/km=${sixByFive.boundary_label ?? sixByFive.zone}, 5:11/km=${fourByTen.boundary_label ?? fourByTen.zone}, 5:02/km=${twoByTwentyFive.boundary_label ?? twoByTwentyFive.zone}`,
  );
}

function runAnnaFixture(): void {
  const anchorDistanceMeters = VDOT_STYLE_STANDARD_DISTANCES.half;
  const anchorTimeSeconds = 2 * 3600 + 2 * 60 + 22;

  const equivalents = equivalentRaceTimes(anchorDistanceMeters, anchorTimeSeconds);
  const zones = trainingZonesFromAnchor(anchorDistanceMeters, anchorTimeSeconds);

  assertApprox(
    anchorTimeSeconds / (anchorDistanceMeters / 1000),
    348,
    1,
    "Anna anchor half pace",
  );

  const thresholdBlockA = classifySegmentPace(328, zones.zones);
  const thresholdBlockB = classifySegmentPace(335, zones.zones);

  assert(
    hasThresholdOrUpperIntervalClassification(thresholdBlockA),
    "Anna 5:28/km threshold block should stay in the upper interval/threshold band, not easy.",
  );
  assert(
    hasThresholdishClassification(thresholdBlockB),
    "Anna 5:35/km threshold block should be threshold-ish or threshold/interval boundary.",
  );
  assert(
    thresholdBlockA.zone !== "easy" && thresholdBlockB.zone !== "easy",
    "Anna threshold blocks must not classify as easy.",
  );

  console.log(
    `[anna] half anchor ${formatDurationFromSeconds(anchorTimeSeconds)} (${formatPace(anchorTimeSeconds / (anchorDistanceMeters / 1000))}) -> eq10k ${formatPace(equivalents["10k"].pace_seconds_per_km)}`,
  );
  console.log(
    `[anna] 5:28/km=${thresholdBlockA.boundary_label ?? thresholdBlockA.zone}, 5:35/km=${thresholdBlockB.boundary_label ?? thresholdBlockB.zone}`,
  );
}

function runOlgaOldAnchorFixture(): void {
  const anchorDistanceMeters = VDOT_STYLE_STANDARD_DISTANCES["10k"];
  const anchorTimeSeconds = 62 * 60 + 33;
  const zones = trainingZonesFromAnchor(anchorDistanceMeters, anchorTimeSeconds);

  const segment = classifySegmentPace(346, zones.zones);

  assert(
    segment.zone === "interval" ||
      segment.zone === "repetition" ||
      segment.boundary_label === "interval/threshold" ||
      segment.boundary_label === "repetition/interval",
    "Olga 5:46/km vs old 6:14/km 10K anchor should classify as faster than threshold / interval-ish.",
  );

  console.log(
    `[olga-old] 10k anchor ${formatDurationFromSeconds(anchorTimeSeconds)} -> 5:46/km=${segment.boundary_label ?? segment.zone}`,
  );
}

function runOlgaTrainingImpliedFixture(): void {
  const candidateAnchors = [
    { label: "59:30", seconds: 59 * 60 + 30 },
    { label: "60:00", seconds: 60 * 60 },
  ];

  for (const candidate of candidateAnchors) {
    const zones = trainingZonesFromAnchor(
      VDOT_STYLE_STANDARD_DISTANCES["10k"],
      candidate.seconds,
    );
    const segment = classifySegmentPace(346, zones.zones);

    assert(
      segment.zone === "interval" || segment.boundary_label === "interval/threshold",
      `Olga 5:46/km vs training-implied ${candidate.label} anchor should move into interval/threshold territory.`,
    );

    console.log(
      `[olga-training] 10k anchor ${candidate.label} -> 5:46/km=${segment.boundary_label ?? segment.zone}`,
    );
  }
}

function runConstantChecks(): void {
  assert(
    VDOT_STYLE_CONFIG_VERSION === "vdot-style.v1",
    "Unexpected VDOT-style config version.",
  );
  assertApprox(
    VDOT_STYLE_DEFAULT_RIEGEL_EXPONENT,
    1.06,
    0,
    "Unexpected default Riegel exponent",
  );
  assert(
    VDOT_STYLE_STANDARD_DISTANCES["15k"] === 15000,
    "15K distance constant must be 15000 meters.",
  );
  assert(
    VDOT_STYLE_STALENESS_THRESHOLD_DAYS === 120,
    "Staleness threshold must remain 120 days.",
  );
  assertApprox(
    VDOT_STYLE_VERDICT_THRESHOLDS.agree_max_pct,
    0.02,
    0,
    "agree threshold",
  );
  assertApprox(
    VDOT_STYLE_VERDICT_THRESHOLDS.mild_disagree_max_pct,
    0.05,
    0,
    "mild disagree threshold",
  );
  assert(
    VDOT_STYLE_TEN_K_PACE_MULTIPLIERS.easy.max_pct >
      VDOT_STYLE_TEN_K_PACE_MULTIPLIERS.easy.min_pct,
    "Easy zone multiplier range must be ordered.",
  );
}

function run(): void {
  runConstantChecks();
  runTatianaFixture();
  runAnnaFixture();
  runOlgaOldAnchorFixture();
  runOlgaTrainingImpliedFixture();
  console.log("[check-vdot-style] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-vdot-style] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
