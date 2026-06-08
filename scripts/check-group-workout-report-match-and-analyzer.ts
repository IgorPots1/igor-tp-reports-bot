import assert from "node:assert/strict";

import { analyzeGroupWorkoutReport } from "@/features/trainingpeaks/group-workout-report-analyzer";
import {
  extractGroupWorkoutReportReferenceDate,
  matchGroupWorkoutReportWorkoutFromCache,
  type GroupWorkoutReportWorkoutMatchResult,
} from "@/features/trainingpeaks/group-workout-report-matcher";
import type { TrainingPeaksWorkoutCacheRow } from "@/features/trainingpeaks/repository";

function makeWorkout(input: Partial<TrainingPeaksWorkoutCacheRow> & {
  workoutId: number;
  date: string;
  title?: string;
}): TrainingPeaksWorkoutCacheRow {
  return {
    id: `row-${input.workoutId}`,
    studentId: input.studentId ?? "student-1",
    studentName: input.studentName ?? "Student One",
    trainingPeaksAthleteId: input.trainingPeaksAthleteId ?? 10101,
    trainingPeaksWorkoutId: input.workoutId,
    workoutDate: input.date,
    title: input.title ?? "Easy run",
    sportOrTypeCode: input.sportOrTypeCode ?? "run",
    workoutTypeValueId: input.workoutTypeValueId ?? 3,
    workoutSubTypeId: input.workoutSubTypeId ?? null,
    isPlanned: input.isPlanned ?? false,
    isCompleted: input.isCompleted ?? false,
    plannedTimeRaw: input.plannedTimeRaw ?? null,
    completedTimeRaw: input.completedTimeRaw ?? null,
    plannedDistanceRaw: input.plannedDistanceRaw ?? null,
    completedDistanceRaw: input.completedDistanceRaw ?? null,
    complianceDurationPercent: input.complianceDurationPercent ?? null,
    complianceDistancePercent: input.complianceDistancePercent ?? null,
    startTimePlanned: input.startTimePlanned ?? null,
    startTime: input.startTime ?? null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    orderOnDay: input.orderOnDay ?? null,
    scannedAt: input.scannedAt ?? "2026-06-08T00:00:00.000Z",
    scanJobId: input.scanJobId ?? null,
    normalizationWarnings: input.normalizationWarnings ?? [],
    sourceSnapshot: input.sourceSnapshot ?? {},
    createdAt: input.createdAt ?? "2026-06-08T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-08T00:00:00.000Z",
  };
}

function byId(rows: TrainingPeaksWorkoutCacheRow[], id: string | null): TrainingPeaksWorkoutCacheRow | null {
  if (!id) {
    return null;
  }
  return rows.find((row) => String(row.trainingPeaksWorkoutId) === id) ?? null;
}

function analyze(
  rows: TrainingPeaksWorkoutCacheRow[],
  match: GroupWorkoutReportWorkoutMatchResult,
  reportText: string,
  labels: string[] = []
) {
  return analyzeGroupWorkoutReport({
    match,
    plannedWorkout: byId(rows, match.selectedPlannedWorkoutId),
    completedWorkout: byId(rows, match.selectedCompletedWorkoutId),
    reportText,
    detectedLabels: labels,
  });
}

function run(): void {
  const messageDateUnix = Date.parse("2026-06-08T10:00:00.000Z") / 1000;
  const baseRows: TrainingPeaksWorkoutCacheRow[] = [
    makeWorkout({
      workoutId: 1001,
      date: "2026-06-08",
      title: "Easy run 45",
      isCompleted: true,
      completedTimeRaw: 45 * 60,
      complianceDurationPercent: 100,
    }),
  ];

  {
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "сегодня легкий бег 45 минут, ок",
      messageDateUnixSeconds: messageDateUnix,
      workouts: baseRows,
    });
    assert.equal(match.status, "matched");
    assert.equal(match.confidence, "high");
    const result = analyze(baseRows, match, "все ок");
    assert.equal(result.executionStatus, "good");
  }

  {
    const ref = extractGroupWorkoutReportReferenceDate({
      messageText: "вчера был бег 40 минут",
      messageDateUnixSeconds: messageDateUnix,
    });
    assert.equal(ref.policy, "text_yesterday");
    assert.equal(ref.referenceDate, "2026-06-07");
  }

  {
    const ref = extractGroupWorkoutReportReferenceDate({
      messageText: "позавчера был бег",
      messageDateUnixSeconds: messageDateUnix,
    });
    assert.equal(ref.policy, "text_day_before_yesterday");
    assert.equal(ref.referenceDate, "2026-06-06");
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 2001,
        date: "2026-06-08",
        title: "Easy run planned",
        isPlanned: true,
        plannedTimeRaw: 50 * 60,
      }),
      makeWorkout({
        workoutId: 2002,
        date: "2026-06-08",
        title: "Easy run completed",
        isCompleted: true,
        completedTimeRaw: 50 * 60,
        complianceDurationPercent: 100,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "бег сделал",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    assert.equal(match.status, "matched");
    assert.equal(match.confidence, "high");
    assert.equal(match.selectedPlannedWorkoutId, "2001");
    assert.equal(match.selectedCompletedWorkoutId, "2002");
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 3001,
        date: "2026-06-08",
        title: "Planned run",
        isPlanned: true,
        plannedTimeRaw: 40 * 60,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "сегодня тренировка",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    assert.equal(match.status, "not_found");
    assert.equal(match.confidence, "low");
    const result = analyze(rows, match, "не успел");
    assert.equal(result.executionStatus, "missed_or_not_completed");
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 4001,
        date: "2026-06-08",
        title: "Morning run",
        isCompleted: true,
        completedTimeRaw: 25 * 60,
      }),
      makeWorkout({
        workoutId: 4002,
        date: "2026-06-08",
        title: "Evening run",
        isCompleted: true,
        completedTimeRaw: 35 * 60,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "сделал бег",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    assert.equal(match.status, "ambiguous");
    assert.equal(match.candidateWorkoutIds.length, 2);
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 5001,
        date: "2026-06-12",
        title: "future run",
        isCompleted: true,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "бег",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    assert.equal(match.status, "not_found");
    assert.equal(match.confidence, "low");
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 6001,
        date: "2026-06-08",
        title: "Long run 90",
        isCompleted: true,
        completedTimeRaw: 90 * 60,
        complianceDurationPercent: 100,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "длит сегодня",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    const result = analyze(rows, match, "длительный");
    assert.equal(result.workoutType, "long_run");
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 7001,
        date: "2026-06-08",
        title: "Interval 8x400",
        isCompleted: true,
        completedTimeRaw: 60 * 60,
        complianceDurationPercent: 100,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "интервалы",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    const result = analyze(rows, match, "сделал интервалы");
    assert.equal(result.workoutType, "quality_interval");
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 8001,
        date: "2026-06-08",
        title: "ПАНО tempo",
        isCompleted: true,
        completedTimeRaw: 60 * 60,
        complianceDurationPercent: 100,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "пано сделал",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    const result = analyze(rows, match, "пано");
    assert.equal(result.workoutType, "tempo_controlled");
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 9001,
        date: "2026-06-08",
        title: "easy run",
        isCompleted: true,
        completedTimeRaw: 70 * 60,
        complianceDurationPercent: 120,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "бег",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    const result = analyze(rows, match, "переборщил");
    assert.equal(result.executionStatus, "over_plan");
    assert.equal(result.riskFlags.includes("duration_over_plan"), true);
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 10001,
        date: "2026-06-08",
        title: "easy run",
        isCompleted: true,
        completedTimeRaw: 40 * 60,
        complianceDurationPercent: 100,
        sourceSnapshot: { description: "simple workout" },
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "бег",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    const result = analyze(rows, match, "норм");
    assert.equal(result.dataAvailability.hasAverageHeartRate, false);
    assert.equal(result.dataAvailability.hasAveragePace, false);
    assert.equal(
      result.unavailableDataNotes.some((note) => note.includes("average heart rate")),
      true
    );
    assert.equal(result.unavailableDataNotes.some((note) => note.includes("average pace")), true);
  }

  {
    const rows = [
      makeWorkout({
        workoutId: 11001,
        date: "2026-06-08",
        title: "easy run",
        isCompleted: true,
        completedTimeRaw: 40 * 60,
        complianceDurationPercent: 100,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "ахилл тянет после бега",
      messageDateUnixSeconds: messageDateUnix,
      workouts: rows,
    });
    const result = analyze(rows, match, "ахилл тянет", ["pain_or_health"]);
    assert.equal(result.riskFlags.includes("pain_or_health_signal_in_report"), true);
  }

  console.log("[check-group-workout-report-match-analyzer] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-group-workout-report-match-analyzer] FAIL");
  console.error(error);
  process.exitCode = 1;
}
