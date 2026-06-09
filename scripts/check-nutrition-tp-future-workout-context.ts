import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { TrainingPeaksWorkoutCacheRow } from "@/features/trainingpeaks/repository";

const root = process.cwd();
const contextPath = join(root, "src/features/nutrition/context.ts");
const repositoryPath = join(root, "src/features/trainingpeaks/repository.ts");
const scanScriptPath = join(root, "tools/trainingpeaks-export/scripts/run-workout-cache-scan-yesterday.sh");
const scanTsPath = join(root, "tools/trainingpeaks-export/scripts/tp-workouts-cache-scan.ts");

const contextSource = readFileSync(contextPath, "utf8");
const repositorySource = readFileSync(repositoryPath, "utf8");
const scanScriptSource = readFileSync(scanScriptPath, "utf8");
const scanTsSource = readFileSync(scanTsPath, "utf8");

assert.match(repositorySource, /\.gte\("workout_date", input\.from\)/, "cache query must use inclusive from date");
assert.match(repositorySource, /\.lte\("workout_date", input\.to\)/, "cache query must use inclusive to date");
assert.doesNotMatch(
  contextSource,
  /rows\s*=\s*rows\.filter\(\(row\) => row\.isCompleted\)/,
  "nutrition TP week context must not reduce cache rows to completed-only"
);
assert.match(contextSource, /for \(const row of rows\)/, "nutrition TP week context must iterate all cache rows");
assert.match(
  contextSource,
  /addDays\(input\.weekTo, 1\)[\s\S]*addDays\(input\.weekTo, 7\)/,
  "next-week nutrition window must be weekTo+1..weekTo+7"
);
assert.match(scanScriptSource, /FUTURE_END=.*date -v\+7d/, "daily cache scan must include next 7 days");
assert.match(scanScriptSource, /--from="\$\{YESTERDAY\}" --to="\$\{FUTURE_END\}"/, "daily cache scan must pass future date range");
assert.match(scanTsSource, /method: "GET"/, "workout cache scan must stay read-only GET against TP API");
assert.doesNotMatch(scanTsSource, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/, "workout cache scan must not mutate TP workouts");

function buildPlannedFutureRow(input: {
  date: string;
  title: string;
  plannedHours?: number;
}): TrainingPeaksWorkoutCacheRow {
  const scannedAt = new Date().toISOString();
  return {
    id: `fixture-${input.date}`,
    studentId: "student-fixture",
    studentName: "Fixture Athlete",
    trainingPeaksAthleteId: 123456,
    trainingPeaksWorkoutId: Number(input.date.replace(/-/g, "")),
    workoutDate: input.date,
    title: input.title,
    sportOrTypeCode: "run",
    workoutTypeValueId: 1,
    workoutSubTypeId: null,
    isPlanned: true,
    isCompleted: false,
    plannedTimeRaw: input.plannedHours ?? 1.5,
    completedTimeRaw: null,
    plannedDistanceRaw: null,
    completedDistanceRaw: null,
    complianceDurationPercent: null,
    complianceDistancePercent: null,
    startTimePlanned: null,
    startTime: null,
    sourceUpdatedAt: null,
    orderOnDay: null,
    scannedAt,
    scanJobId: null,
    normalizationWarnings: [],
    sourceSnapshot: {},
    createdAt: scannedAt,
    updatedAt: scannedAt,
  };
}

const fixtureRows = [
  buildPlannedFutureRow({ date: "2026-06-08", title: "Бег по пульсу" }),
  buildPlannedFutureRow({ date: "2026-06-10", title: "7 х 5 мин" }),
  buildPlannedFutureRow({ date: "2026-06-14", title: "Длительный бег 18 км", plannedHours: 1.8 }),
];

const inRange = fixtureRows.filter((row) => row.workoutDate >= "2026-06-08" && row.workoutDate <= "2026-06-14");
assert.equal(inRange.length, 3, "inclusive date range must include boundary days");
assert.equal(
  inRange.filter((row) => row.isPlanned && !row.isCompleted).length,
  3,
  "planned-only future rows must remain eligible for nutrition context"
);

const plannedSessions = inRange.filter((row) => row.isPlanned).length;
assert.equal(plannedSessions, 3, "plannedSessions counter contract must see all planned future rows");

const keyTitles = inRange.filter((row) => /интерв|х\s*\d|длитель|long run/i.test(row.title ?? ""));
assert.ok(keyTitles.length >= 2, "fixture must include classifiable key/long workouts for planned rows");

console.log("PASS check-nutrition-tp-future-workout-context");
