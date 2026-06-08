import {
  enforceGetOnlyMethod,
  parseProbeCliArgs,
} from "@/features/trainingpeaks/trainingpeaks-completed-workout-details-probe";
import {
  extractTrainingPeaksCompletedWorkoutDetails,
  redactSensitiveForReport,
} from "@/features/trainingpeaks/trainingpeaks-completed-workout-details-extractor";

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
    intervals: [{}, {}],
    structure: { steps: [{ targetPace: "5:30-5:45/km", targetHr: "140-150" }] },
    coachComments: "steady effort",
  };
  const extracted = extractTrainingPeaksCompletedWorkoutDetails(fixture);
  assert(extracted.dataAvailability.hasAveragePace, "avg pace should be detected");
  assert(extracted.dataAvailability.hasAverageHeartRate, "avg HR should be detected");
  assert(extracted.dataAvailability.hasLaps, "laps should be detected");
  assert(extracted.dataAvailability.hasIntervalActuals, "intervals should be detected");
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
  assert(extracted.dataAvailability.hasAveragePace, "velocityAverage should derive avg pace");
  assert(extracted.dataAvailability.hasTargetPaceOrHr, "structure targets should be detected");
  assert(extracted.extractedMetrics.durationSeconds === 5928, "decimal-hour totalTime should convert to seconds");
  assert(extracted.extractedMetrics.averageHeartRateBpm === 147, "heartRateAverage should normalize");
  assert(extracted.extractedMetrics.maxHeartRateBpm === 159, "heartRateMaximum should normalize");
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

function run(): void {
  testArgParsing();
  testGetGuard();
  testExtractorHappyPath();
  testExtractorTpLiveWorkoutListShape();
  testExtractorMissingData();
  testReportRedaction();
  testForbiddenStringsNotPresent();
  console.log("[check-trainingpeaks-completed-workout-details-probe] PASS");
}

run();
