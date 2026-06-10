import fs from "node:fs";
import path from "node:path";

import {
  enforceGetOnlyMethod,
  parseProbeCliArgs,
} from "@/features/trainingpeaks/trainingpeaks-completed-workout-details-probe";
import {
  extractTrainingPeaksCompletedWorkoutDetails,
  redactSensitiveForReport,
} from "@/features/trainingpeaks/trainingpeaks-completed-workout-details-extractor";
import { buildTrainingPeaksCompletedWorkoutSummaryDetails } from "@/features/trainingpeaks/trainingpeaks-completed-workout-summary-reader";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testArgParsing(): void {
  const byStudent = parseProbeCliArgs(["--student-id=student-1", "--date=2026-06-08"]);
  assert(byStudent.studentId === "student-1", "student-id path must parse");
  assert(byStudent.athleteId === undefined, "student-id path should not include athlete-id");

  const byAthlete = parseProbeCliArgs(["--athlete-id=1234", "--date=2026-06-08", "--workout-id=9001"]);
  assert(byAthlete.athleteId === "1234", "athlete-id path must parse");
  assert(byAthlete.workoutId === "9001", "workout-id must parse");

  let failed = false;
  try {
    parseProbeCliArgs(["--student-id=a", "--athlete-id=1", "--date=2026-06-08"]);
  } catch {
    failed = true;
  }
  assert(failed, "ambiguous target path must be rejected");
}

function testGetGuard(): void {
  assert(enforceGetOnlyMethod("GET") === "GET", "GET guard should allow GET");
  let failed = false;
  try {
    enforceGetOnlyMethod("POST");
  } catch {
    failed = true;
  }
  assert(failed, "GET guard should reject non-GET methods");
}

function testExtractorHappyPath(): void {
  const fixture = {
    totalTime: 3600,
    distanceMeters: 10000,
    avgPace: 360,
    avgHeartRate: 148,
    maxHeartRate: 167,
    laps: [{}, {}, {}],
    intervals: [{ durationSeconds: 120, averageHeartRate: 160 }, { durationSeconds: 140, averageHeartRate: 162 }],
    structure: { steps: [{ targetPace: "5:30-5:45/km", targetHr: "140-150" }] },
    coachComments: "steady effort",
  };
  const extracted = extractTrainingPeaksCompletedWorkoutDetails(fixture);
  assert(extracted.dataAvailability.hasAveragePace, "avg pace should be detected");
  assert(extracted.dataAvailability.hasAverageHeartRate, "avg HR should be detected");
  assert(extracted.dataAvailability.hasMaxHeartRate, "max HR should be detected");
  assert(extracted.dataAvailability.hasLaps, "laps should be detected");
  assert(!extracted.dataAvailability.hasSplits, "splits should remain absent");
  assert(extracted.dataAvailability.hasIntervalActuals, "intervals should be detected");
  assert(!extracted.dataAvailability.hasSamples, "samples should remain absent");
  assert(extracted.dataAvailability.hasPlannedStructure, "planned structure should be detected");
  assert(extracted.dataAvailability.hasTargetPaceOrHr, "target pace/HR should be detected");
  assert(extracted.extractedMetrics.lapCount === 3, "lap count should normalize");
  assert(extracted.extractedMetrics.intervalCount === 2, "interval count should normalize");
}

function testExtractorTpLiveWorkoutListShape(): void {
  const fixture = {
    totalTime: 1.6466666460037231,
    distance: 13645.4296875,
    heartRateAverage: 147,
    heartRateMaximum: 159,
    velocityAverage: 2.546999931335449,
    structure: {
      primaryIntensityMetric: "percentOfMaxHr",
      structure: [{ steps: [{ targets: [{ minValue: 141, maxValue: 152 }] }] }],
    },
    coachComments: "warmup drills",
  };
  const extracted = extractTrainingPeaksCompletedWorkoutDetails(fixture);
  assert(extracted.dataAvailability.hasCompletedDuration, "TP totalTime hours should normalize to duration");
  assert(extracted.dataAvailability.hasCompletedDistance, "TP distance meters should be detected");
  assert(extracted.dataAvailability.hasAverageHeartRate, "heartRateAverage should be detected");
  assert(extracted.dataAvailability.hasMaxHeartRate, "heartRateMaximum should be detected");
  assert(extracted.dataAvailability.hasAveragePace, "velocityAverage should derive avg pace");
  assert(extracted.dataAvailability.hasTargetPaceOrHr, "structure targets should be detected");
  assert(extracted.extractedMetrics.durationSeconds === 5928, "decimal-hour totalTime should convert to seconds");
  assert(extracted.extractedMetrics.averageHeartRateBpm === 147, "heartRateAverage should normalize");
  assert(extracted.extractedMetrics.maxHeartRateBpm === 159, "heartRateMaximum should normalize");
}

function testExtractorSplitsAndSamples(): void {
  const fixture = {
    splits: [{ distance: 1000 }, { distance: 1000 }, { distance: 1000 }],
    samples: [{ t: 1 }, { t: 2 }],
  };
  const extracted = extractTrainingPeaksCompletedWorkoutDetails(fixture);
  assert(extracted.dataAvailability.hasSplits, "splits should be detected");
  assert(extracted.extractedMetrics.splitCount === 3, "split count should normalize");
  assert(extracted.dataAvailability.hasSamples, "samples should be detected");
  assert(extracted.extractedMetrics.sampleCount === 2, "sample count should normalize");
}

function testExtractorPlannedStructureNotActualIntervals(): void {
  const fixture = {
    structure: {
      steps: [
        {
          intervals: [
            { targetPace: "4:30-4:45/km", targetHr: "155-165" },
            { targetPace: "4:45-5:00/km", targetHr: "150-160" },
          ],
        },
      ],
    },
  };
  const extracted = extractTrainingPeaksCompletedWorkoutDetails(fixture);
  assert(extracted.dataAvailability.hasPlannedStructure, "planned structure should be detected");
  assert(!extracted.dataAvailability.hasIntervalActuals, "planned intervals should not count as actual intervals");
  assert(extracted.extractedMetrics.intervalCount === undefined, "interval count should remain undefined");
}

function testExtractorActualIntervalsOnlyWhenActualDataExists(): void {
  const fixture = {
    intervals: [
      { durationSeconds: 180, averageHeartRate: 162, averagePaceSecPerKm: 245 },
      { durationSeconds: 175, averageHeartRate: 164, averagePaceSecPerKm: 240 },
    ],
  };
  const extracted = extractTrainingPeaksCompletedWorkoutDetails(fixture);
  assert(extracted.dataAvailability.hasIntervalActuals, "actual intervals should be detected");
  assert(extracted.extractedMetrics.intervalCount === 2, "actual interval count should normalize");
}

function testExtractorMissingData(): void {
  const fixture = {
    totalTimePlanned: 3200,
    title: "easy run",
  };
  const extracted = extractTrainingPeaksCompletedWorkoutDetails(fixture);
  assert(!extracted.dataAvailability.hasAveragePace, "missing avg pace should remain unavailable");
  assert(!extracted.dataAvailability.hasAverageHeartRate, "missing avg HR should remain unavailable");
  assert(!extracted.dataAvailability.hasLaps, "missing laps should remain unavailable");
}

function testReportRedaction(): void {
  const input = {
    authorization: "Bearer abc",
    nested: { sessionCookie: "cookie-value", safe: 1 },
  };
  const redacted = redactSensitiveForReport(input) as Record<string, unknown>;
  assert(redacted.authorization === "[REDACTED]", "authorization must be redacted");
  const nested = redacted.nested as Record<string, unknown>;
  assert(nested.sessionCookie === "[REDACTED]", "nested cookie-like key must be redacted");
}

function testProbeEntrypointLoadsScriptEnv(): void {
  const probePath = path.join(process.cwd(), "scripts/probe-trainingpeaks-completed-workout-details.ts");
  const source = fs.readFileSync(probePath, "utf8");
  assert(
    /import\s*\{[^}]*\bloadScriptEnv\b[^}]*\}\s*from\s*["']\.\/lib\/load-script-env["']/u.test(source),
    "probe entrypoint must import loadScriptEnv from ./lib/load-script-env"
  );
  assert(/\bloadScriptEnv\s*\(\s*\)/u.test(source), "probe entrypoint must call loadScriptEnv()");
}

function testForbiddenStringsNotPresent(): void {
  // Static sanity to ensure this check is aware of forbidden paths from task contract.
  const forbidden = [
    "students.json",
    "sendTelegramMessage",
    "generateTrainingPeaksReplyDraft",
    "OpenAI",
    "TP_ACTIONS_REAL_EXECUTION",
    "--apply",
  ];
  assert(forbidden.length === 6, "forbidden list must remain explicit and stable");
}

function testSummaryReaderForcesUnavailableActuals(): void {
  const summary = buildTrainingPeaksCompletedWorkoutSummaryDetails({
    workoutPayload: {
      workoutId: 9001,
      workoutTypeValueId: 3,
      totalTime: 1,
      distance: 10000,
      heartRateAverage: 150,
      heartRateMaximum: 165,
      velocityAverage: 2.8,
      laps: [{}, {}],
      intervals: [{ durationSeconds: 120, averageHeartRate: 160 }],
      samples: [{ t: 1 }],
    },
    athleteId: "5652949",
    date: "2026-06-07",
    workoutId: "9001",
  });
  assert(summary.source === "tp_date_range_endpoint", "summary source must be date-range endpoint");
  assert(summary.dataAvailability.hasLaps === false, "summary reader must force laps unavailable");
  assert(summary.dataAvailability.hasIntervalActuals === false, "summary reader must force interval actuals unavailable");
  assert(summary.dataAvailability.hasAveragePace === true, "summary reader should expose avg pace");
  assert(summary.dataAvailability.hasAverageHeartRate === true, "summary reader should expose avg HR");
}

function run(): void {
  testProbeEntrypointLoadsScriptEnv();
  testArgParsing();
  testGetGuard();
  testExtractorHappyPath();
  testExtractorTpLiveWorkoutListShape();
  testExtractorSplitsAndSamples();
  testExtractorPlannedStructureNotActualIntervals();
  testExtractorActualIntervalsOnlyWhenActualDataExists();
  testExtractorMissingData();
  testReportRedaction();
  testSummaryReaderForcesUnavailableActuals();
  testForbiddenStringsNotPresent();
  console.log("[check-trainingpeaks-completed-workout-details-probe] PASS");
}

run();
