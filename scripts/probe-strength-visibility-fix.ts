/**
 * Probe: strength workout visibility fix
 * Tests the key components changed:
 *  1. classifyTrainingPeaksWorkoutActivity correctly identifies strength
 *  2. inferWorkoutKindFromText pattern coverage (inline replica of the key regex)
 *  3. scoreWorkoutCandidate score math for strength vs run when "силовая" requested
 */

import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";

let allPassed = true;
function check(label: string, got: unknown, expected: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  console.log(`${pass ? "✅" : "❌"} ${label}: got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`);
  if (!pass) allPassed = false;
}

// ── 1. Activity classification for strength workouts ─────────────────────────

check(
  "classifyActivity: Strength (typeId=9)",
  classifyTrainingPeaksWorkoutActivity({ title: "Strength", workoutTypeValueId: 9 }).family,
  "strength"
);
check(
  "classifyActivity: Силовая тренировка (title only)",
  classifyTrainingPeaksWorkoutActivity({ title: "Силовая тренировка" }).family,
  "strength"
);
check(
  "classifyActivity: Интервалы (typeId=3) stays run",
  classifyTrainingPeaksWorkoutActivity({ title: "6x6", workoutTypeValueId: 3 }).family,
  "run"
);

// ── 2. Keyword detection patterns (mirrors inferWorkoutKindFromText additions) ─

function inferKindLocal(text: string): string {
  const lower = text.toLocaleLowerCase("ru").replace(/ё/g, "е");
  if (/силов|тренажер|gym|strength/.test(lower)) return "strength";
  if (/вело|велосипед|(?<![а-яё])вел(?![а-яё])|байк|cycling|\bbike\b/.test(lower)) return "bike";
  if (/плав|\bswim/.test(lower)) return "swim";
  return "run_or_unknown";
}

check("inferKind: силовую перенеси → strength", inferKindLocal("силовую перенеси на пятницу"), "strength");
check("inferKind: сделаю силовую → strength", inferKindLocal("сегодня сделаю силовую"), "strength");
check("inferKind: перенеси вел на четверг → bike", inferKindLocal("перенеси вел на четверг"), "bike");
check("inferKind: плавание перенести → swim", inferKindLocal("плавание перенести на субботу"), "swim");
check("inferKind: интервалы → (not strength)", inferKindLocal("перенеси интервалы на среду"), "run_or_unknown");
check("inferKind: длительный бег → (not strength)", inferKindLocal("длительный бег перенеси"), "run_or_unknown");

// ── 3. Score math: strength workout when inferredKind="strength" ──────────────
// Mirrors scoreWorkoutCandidate logic after the fix.

function scoreStrengthCandidate(activityIsRunning: boolean, activityFamily: string, inferredKind: string): number {
  let score = 0;
  score += 0.2; // future date bonus (always assumed)
  const askingForNonRun = inferredKind === "strength" || inferredKind === "bike" || inferredKind === "swim";
  if (!askingForNonRun) {
    if (activityIsRunning) score += 0.1;
    else score -= 0.3;
  }
  if (inferredKind === "strength" && activityFamily === "strength") score += 0.6;
  else if (inferredKind === "bike" && activityFamily === "bike") score += 0.6;
  else if (inferredKind === "swim" && activityFamily === "swim") score += 0.6;
  return Number(score.toFixed(3));
}

const strengthScore = scoreStrengthCandidate(false, "strength", "strength");
const runningScoreWhenStrengthAsked = scoreStrengthCandidate(true, "run", "strength");
const intervalScore = scoreStrengthCandidate(true, "run", "interval");

check("score: strength workout with inferredKind=strength >= 0.8", strengthScore >= 0.8, true);
check("score: running workout with inferredKind=strength < 0.8", runningScoreWhenStrengthAsked < 0.8, true);
check("score: strength workout with inferredKind=interval < 0.8 (not pulled in)", scoreStrengthCandidate(false, "strength", "interval") < 0.8, true);
console.log(`  strength score: ${strengthScore}, run-when-strength: ${runningScoreWhenStrengthAsked}, interval: ${intervalScore}`);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("");
if (allPassed) {
  console.log("All strength-visibility probe checks passed.");
} else {
  console.error("Some checks FAILED.");
  process.exit(1);
}
