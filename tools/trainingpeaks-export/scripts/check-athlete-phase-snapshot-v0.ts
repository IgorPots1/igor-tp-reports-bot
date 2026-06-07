import assert from "node:assert/strict";

import {
  detectTrainingPhaseV0,
  extractOperationalHealthFlags,
  PHASE_DETECTOR_SAFETY_MARKERS,
  type PhaseDetectorInput,
} from "./lib/training-phase-detector-v0.ts";
import type { WorkoutDiagnosticRow } from "./lib/recent-workout-quality-diagnostic.ts";
import type { TrainingPeaksStudentOperationalSignal } from "../../../src/features/trainingpeaks/repository.ts";

function baseInput(overrides: Partial<PhaseDetectorInput> = {}): PhaseDetectorInput {
  return {
    week_start: "2026-06-08",
    name: "Test Athlete",
    athlete_id: 123,
    student_id: "student-uuid",
    workouts: [],
    operational_signals: [],
    baseline: {
      confidence: "medium",
      needs_review: false,
      frequency_cap: 4,
      quality_count_cap: 1,
      recent_4w_frequency: 3,
      context_flags: [],
    },
    race_context: { candidates: [] },
    schedule_constrained: false,
    ...overrides,
  };
}

function mockQualityWorkout(input: {
  date: string;
  type: WorkoutDiagnosticRow["estimated_quality_type"];
  title?: string;
  repeatCount?: number;
  workDuration?: string;
}): WorkoutDiagnosticRow {
  return {
    date: input.date,
    title: input.title ?? "Quality session",
    duration_minutes: 55,
    distance_km: 10,
    status: "completed",
    workout_type: "Run",
    is_planned: false,
    is_completed: true,
    source_flags: {
      paired_planned_and_completed: false,
      completed_only: true,
      planned_only: false,
    },
    notes_excerpt: null,
    estimated_quality_type: input.type,
    estimated_structure:
      input.repeatCount && input.workDuration ? `${input.repeatCount} x ${input.workDuration}` : null,
    confidence: "high",
    flags: ["quality_like"],
    training_family: "vo2_short_candidate",
    quality_like: true,
    interval_structure:
      input.repeatCount && input.workDuration
        ? {
            repeat_count: input.repeatCount,
            work_duration: input.workDuration,
            recovery_duration: "1 min",
            quality_family: input.type === "vo2max_intervals" ? "vo2max_intervals" : null,
            raw_pattern: `${input.repeatCount}x${input.workDuration}`,
          }
        : null,
    trainingpeaks_workout_id: Math.floor(Math.random() * 100000),
  };
}

function mockIllnessSignal(active: boolean): TrainingPeaksStudentOperationalSignal {
  return {
    id: "signal-1",
    studentId: "student-uuid",
    signalType: active ? "health_issue_started" : "health_issue_improving",
    status: "active",
    lifecycleState: active ? "active_problem" : "monitoring_after_return",
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: false,
    sourceType: "test",
    sourceObservationId: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: { health_state: active ? "sick" : "improving" },
    confidence: 0.9,
    validFrom: null,
    validUntil: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  };
}

function testActiveIllnessDoesNotRecommendNormalTraining(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      operational_signals: [mockIllnessSignal(true)],
    }),
  );
  assert.equal(snapshot.flags.active_illness, true);
  assert.equal(snapshot.flags.manual_review_required, true);
  assert.match(snapshot.recommendation.summary, /illness/i);
  assert.equal(snapshot.recommendation.do_not_do.includes("normal_training_load"), true);
  assert.equal(snapshot.recommendation.do_not_do.includes("intervals"), true);
}

function testRecentIllnessRecommendsOneNonIntervalWeek(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      operational_signals: [mockIllnessSignal(false)],
    }),
  );
  assert.equal(snapshot.flags.illness_return_week, true);
  assert.match(snapshot.recommendation.summary, /one week without intervals/i);
  assert.equal(snapshot.recommendation.do_not_do.includes("intervals"), true);
  assert.match(snapshot.recommendation.suggested_next_step, /one week|this week/i);
  assert.doesNotMatch(snapshot.recommendation.suggested_next_step, /two weeks|two easy-only weeks/i);
}

function testVo2RecentHistoryClassifiedAsVo2Block(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [
        mockQualityWorkout({
          date: "2026-06-04",
          type: "vo2max_intervals",
          title: "20 x 1 min",
          repeatCount: 20,
          workDuration: "1 min",
        }),
      ],
    }),
  );
  assert.equal(snapshot.detected_context, "vo2_block");
}

function testThresholdControlledRequiresManualReview(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [
        mockQualityWorkout({
          date: "2026-06-04",
          type: "controlled_sub_threshold",
          title: "3 x 6 controlled",
          repeatCount: 3,
          workDuration: "6 min",
        }),
      ],
    }),
  );
  assert.equal(snapshot.detected_context, "threshold_or_controlled_block");
  assert.equal(snapshot.flags.manual_review_required, true);
  assert.match(snapshot.recommendation.summary, /does not auto-select/i);
}

function testPossibleDeloadIsFlagOnly(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [
        mockQualityWorkout({ date: "2026-05-18", type: "vo2max_intervals", repeatCount: 20, workDuration: "1 min" }),
        mockQualityWorkout({ date: "2026-05-25", type: "vo2max_intervals", repeatCount: 20, workDuration: "1 min" }),
        mockQualityWorkout({ date: "2026-06-01", type: "vo2max_intervals", repeatCount: 20, workDuration: "1 min" }),
        mockQualityWorkout({ date: "2026-06-04", type: "vo2max_intervals", repeatCount: 20, workDuration: "1 min" }),
      ],
    }),
  );
  assert.equal(snapshot.flags.possible_deload_recommended, true);
  assert.match(snapshot.recommendation.summary, /Do not auto-insert/i);
  assert.equal(snapshot.recommendation.do_not_do.includes("auto_insert_deload_week"), true);
  assert.equal(snapshot.recommendation.do_not_do.includes("auto_deload_insertion"), true);
}

function testUnclearRaceContextRequiresManualReview(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      race_context: {
        candidates: [
          {
            date: "2026-06-20",
            estimated_distance: "unknown",
            confidence: "low",
            event_name: "Possible race",
          },
        ],
      },
    }),
  );
  assert.equal(snapshot.flags.race_context_needs_confirmation, true);
  assert.equal(snapshot.flags.manual_review_required, true);
}

function testMarathonSpecificRequiresReview(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      race_context: {
        candidates: [
          {
            date: "2026-09-20",
            estimated_distance: "marathon",
            confidence: "high",
            event_name: "City Marathon",
          },
        ],
      },
    }),
  );
  assert.equal(snapshot.flags.marathon_specific_requires_review, true);
  assert.equal(snapshot.flags.manual_review_required, true);
}

function testLowDataAthleteManualReviewOrLowConfidence(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [],
      baseline: {
        confidence: "low",
        needs_review: true,
        frequency_cap: null,
        quality_count_cap: null,
        recent_4w_frequency: null,
        context_flags: [],
      },
    }),
  );
  assert.equal(snapshot.detected_context, "manual_review_unknown");
  assert.equal(snapshot.confidence, "low");
  assert.equal(snapshot.flags.manual_review_required, true);
}

function testSafetyMarkers(): void {
  assert.equal(PHASE_DETECTOR_SAFETY_MARKERS.mode, "read_only");
  assert.equal(PHASE_DETECTOR_SAFETY_MARKERS.no_db_writes, true);
  assert.equal(PHASE_DETECTOR_SAFETY_MARKERS.no_plan_generation, true);
}

function testExtractOperationalHealthFlags(): void {
  const flags = extractOperationalHealthFlags([mockIllnessSignal(true)]);
  assert.equal(flags.has_active_illness, true);
}

function main(): void {
  testActiveIllnessDoesNotRecommendNormalTraining();
  testRecentIllnessRecommendsOneNonIntervalWeek();
  testVo2RecentHistoryClassifiedAsVo2Block();
  testThresholdControlledRequiresManualReview();
  testPossibleDeloadIsFlagOnly();
  testUnclearRaceContextRequiresManualReview();
  testMarathonSpecificRequiresReview();
  testLowDataAthleteManualReviewOrLowConfidence();
  testSafetyMarkers();
  testExtractOperationalHealthFlags();
  console.log("check-athlete-phase-snapshot-v0: all checks passed");
}

main();
