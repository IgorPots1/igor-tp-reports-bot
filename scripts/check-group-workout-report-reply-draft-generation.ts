import assert from "node:assert/strict";

import { analyzeGroupWorkoutReport } from "@/features/trainingpeaks/group-workout-report-analyzer";
import {
  matchGroupWorkoutReportWorkoutFromCache,
  type GroupWorkoutReportWorkoutMatchResult,
} from "@/features/trainingpeaks/group-workout-report-matcher";
import {
  buildGroupWorkoutReportDraftSafeClaims,
  buildGroupWorkoutReportReplyDraftContext,
  buildGroupWorkoutReportReplyDraftIdempotencyKey,
} from "@/features/trainingpeaks/group-workout-report-reply-draft-context";
import {
  evaluateGroupWorkoutReportReplyDraftGenerationGate,
  generateGroupWorkoutReportReplyDraft,
} from "@/features/trainingpeaks/group-workout-report-reply-draft-generator";
import type { TrainingPeaksWorkoutCacheRow } from "@/features/trainingpeaks/repository";
import { buildTrainingPeaksCompletedWorkoutSummaryDetails } from "@/features/trainingpeaks/trainingpeaks-completed-workout-summary-reader";

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

function buildContext(input: {
  formality: "ty" | "vy" | "unknown";
  match: GroupWorkoutReportWorkoutMatchResult;
  rows: TrainingPeaksWorkoutCacheRow[];
  reportText: string;
  labels?: string[];
  liveSummary?: ReturnType<typeof buildTrainingPeaksCompletedWorkoutSummaryDetails> | null;
}) {
  const analysis = analyzeGroupWorkoutReport({
    match: input.match,
    plannedWorkout: byId(input.rows, input.match.selectedPlannedWorkoutId),
    completedWorkout: byId(input.rows, input.match.selectedCompletedWorkoutId),
    completedWorkoutSummaryDetails: input.liveSummary ?? null,
    reportText: input.reportText,
    detectedLabels: input.labels ?? [],
  });

  return buildGroupWorkoutReportReplyDraftContext({
    student: {
      id: "student-1",
      studentName: "Test Student",
      telegramFormality: input.formality,
      telegramContextNotes: null,
    },
    sourceMessage: {
      chatId: "-100123",
      messageId: "456",
      messageText: input.reportText,
      messageTimestamp: "2026-06-08T10:00:00.000Z",
    },
    match: input.match,
    plannedWorkout: byId(input.rows, input.match.selectedPlannedWorkoutId),
    completedWorkout: byId(input.rows, input.match.selectedCompletedWorkoutId),
    completedWorkoutSummaryDetails: input.liveSummary ?? null,
    analysis,
    detectedLabels: input.labels ?? [],
  });
}

async function run(): Promise<void> {
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

  const goodMatch = matchGroupWorkoutReportWorkoutFromCache({
    messageText: "сегодня легкий бег 45 минут, ок",
    messageDateUnixSeconds: messageDateUnix,
    workouts: baseRows,
  });

  {
    const context = buildContext({
      formality: "ty",
      match: goodMatch,
      rows: baseRows,
      reportText: "сегодня легкий бег 45 минут, ок",
    });
    assert.match(context.communication.instruction, /«ты»/u);
  }

  {
    const context = buildContext({
      formality: "vy",
      match: goodMatch,
      rows: baseRows,
      reportText: "сегодня легкий бег 45 минут, ок",
    });
    assert.match(context.communication.instruction, /«вы»/u);
  }

  {
    const context = buildContext({
      formality: "unknown",
      match: goodMatch,
      rows: baseRows,
      reportText: "сегодня легкий бег 45 минут, ок",
    });
    assert.match(context.communication.instruction, /нейтраль/u);
  }

  {
    const liveSummary = buildTrainingPeaksCompletedWorkoutSummaryDetails({
      workoutPayload: {
        workoutId: 1001,
        workoutTypeValueId: 3,
        totalTime: 0.75,
        distance: 8000,
        heartRateAverage: 145,
        heartRateMaximum: 162,
        velocityAverage: 3.7,
      },
      athleteId: "10101",
      date: "2026-06-08",
      workoutId: "1001",
    });
    const context = buildContext({
      formality: "ty",
      match: goodMatch,
      rows: baseRows,
      reportText: "пробежал нормально",
      liveSummary,
    });
    assert.ok(context.analysis.allowedClaims.includes("duration"));
    assert.ok(context.analysis.allowedClaims.includes("distance"));
    assert.ok(context.analysis.allowedClaims.includes("average pace"));
    assert.ok(context.analysis.allowedClaims.includes("average HR"));
    assert.ok(context.analysis.allowedClaims.includes("max HR"));
  }

  {
    const context = buildContext({
      formality: "ty",
      match: goodMatch,
      rows: baseRows,
      reportText: "все ок",
    });
    for (const forbidden of ["laps", "splits", "interval actuals"]) {
      assert.ok(context.analysis.forbiddenClaims.includes(forbidden));
    }
  }

  {
    const intervalRows = [
      makeWorkout({
        workoutId: 2001,
        date: "2026-06-08",
        title: "Интервал 6x800",
        isPlanned: true,
        isCompleted: true,
        plannedTimeRaw: 60 * 60,
        completedTimeRaw: 58 * 60,
        complianceDurationPercent: 97,
        sourceSnapshot: { structure: { steps: [{ repeat: 6 }] } },
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "интервалы сделал",
      messageDateUnixSeconds: messageDateUnix,
      workouts: intervalRows,
    });
    const context = buildContext({
      formality: "ty",
      match,
      rows: intervalRows,
      reportText: "интервалы сделал",
    });
    assert.ok(
      context.analysis.forbiddenClaims.some((claim) => claim.includes("interval repeat-level"))
    );
    const claims = buildGroupWorkoutReportDraftSafeClaims(
      analyzeGroupWorkoutReport({
        match,
        plannedWorkout: byId(intervalRows, match.selectedPlannedWorkoutId),
        completedWorkout: byId(intervalRows, match.selectedCompletedWorkoutId),
        reportText: "интервалы сделал",
      })
    );
    assert.ok(claims.forbiddenClaims.some((claim) => claim.includes("interval repeat-level")));
  }

  {
    const context = buildContext({
      formality: "ty",
      match: goodMatch,
      rows: baseRows,
      reportText: "болит колено после пробежки",
      labels: ["pain_or_health"],
    });
    assert.match(context.analysis.recommendationForDraft, /самочувств/i);
    assert.match(context.analysis.recommendationForDraft, /не начинай/i);
    const gate = evaluateGroupWorkoutReportReplyDraftGenerationGate({ context });
    assert.equal(gate, null);
  }

  {
    const ambiguousRows = [
      makeWorkout({
        workoutId: 3001,
        date: "2026-06-08",
        title: "Easy run A",
        isCompleted: true,
        completedTimeRaw: 40 * 60,
      }),
      makeWorkout({
        workoutId: 3002,
        date: "2026-06-08",
        title: "Easy run B",
        isCompleted: true,
        completedTimeRaw: 42 * 60,
      }),
    ];
    const match = matchGroupWorkoutReportWorkoutFromCache({
      messageText: "пробежал сегодня",
      messageDateUnixSeconds: messageDateUnix,
      workouts: ambiguousRows,
    });
    assert.equal(match.status, "ambiguous");
    const context = buildContext({
      formality: "ty",
      match,
      rows: ambiguousRows,
      reportText: "пробежал сегодня",
    });
    const gate = evaluateGroupWorkoutReportReplyDraftGenerationGate({ context });
    assert.equal(gate?.status, "blocked");
    assert.equal(gate?.reason, "match_not_confident");
  }

  {
    const match: GroupWorkoutReportWorkoutMatchResult = {
      status: "not_found",
      confidence: "low",
      referenceDate: "2026-06-08",
      referenceDatePolicy: "message_date",
      selectedPlannedWorkoutId: null,
      selectedCompletedWorkoutId: null,
      candidateWorkoutIds: [],
      reasons: ["no candidates"],
      warnings: [],
    };
    const context = buildContext({
      formality: "ty",
      match,
      rows: [],
      reportText: "пробежал сегодня",
    });
    const gate = evaluateGroupWorkoutReportReplyDraftGenerationGate({ context });
    assert.equal(gate?.status, "blocked");
    assert.equal(gate?.reason, "match_not_confident");
  }

  {
    const context = buildContext({
      formality: "ty",
      match: goodMatch,
      rows: baseRows,
      reportText: "все ок",
    });
    assert.match(context.promptContext, /публичн/i);
    assert.match(context.promptContext, /группов/i);
    assert.doesNotMatch(context.promptContext, /Bearer/u);
    assert.doesNotMatch(context.promptContext, /Authorization/u);
  }

  {
    const key = buildGroupWorkoutReportReplyDraftIdempotencyKey({
      sourceChatId: "-100123",
      sourceMessageId: "456",
    });
    assert.equal(key, "group_workout_report:-100123:456");
  }

  {
    const context = buildContext({
      formality: "ty",
      match: goodMatch,
      rows: baseRows,
      reportText: "все ок",
    });
    const result = await generateGroupWorkoutReportReplyDraft({
      context,
      generateDraft: async () => ({ ok: true, draftText: "Ок, принял отчёт." }),
    });
    assert.equal(result.status, "generated");
    if (result.status === "generated") {
      assert.equal(result.draftText, "Ок, принял отчёт.");
    }
  }

  console.log("[check-group-workout-report-reply-draft-generation] PASS");
}

run().catch((error) => {
  console.error("[check-group-workout-report-reply-draft-generation] FAIL", error);
  process.exitCode = 1;
});
