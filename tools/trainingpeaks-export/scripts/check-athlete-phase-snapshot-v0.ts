import assert from "node:assert/strict";

import {
  detectTrainingPhaseV0,
  extractOperationalHealthFlags,
  hasStrongVo2IntensityEvidence,
  isAmbiguous3MinPattern,
  isEasyOrLightWorkout,
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
  notes?: string | null;
  repeatCount?: number;
  workDuration?: string;
  confidence?: WorkoutDiagnosticRow["confidence"];
  qualityLike?: boolean;
  trainingFamily?: WorkoutDiagnosticRow["training_family"];
}): WorkoutDiagnosticRow {
  const qualityLike = input.qualityLike ?? true;
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
    notes_excerpt: input.notes ?? null,
    estimated_quality_type: input.type,
    estimated_structure:
      input.repeatCount && input.workDuration ? `${input.repeatCount} x ${input.workDuration}` : null,
    confidence: input.confidence ?? "high",
    flags: qualityLike ? ["quality_like"] : [],
    training_family: input.trainingFamily ?? "vo2_short_candidate",
    quality_like: qualityLike,
    interval_structure:
      input.repeatCount && input.workDuration
        ? {
            repeat_count: input.repeatCount,
            work_duration: input.workDuration,
            recovery_duration: "1 min",
            quality_family: input.type === "vo2max_intervals" ? "vo2max_intervals" : "short_intervals",
            raw_pattern: `${input.repeatCount}x${input.workDuration}`,
          }
        : null,
    trainingpeaks_workout_id: Math.floor(Math.random() * 100000),
  };
}

function easyRuns(count: number): WorkoutDiagnosticRow[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-05-${String(28 - index).padStart(2, "0")}`,
    title: "Easy run",
    duration_minutes: 40,
    distance_km: 7,
    status: "completed" as const,
    workout_type: "Run",
    is_planned: false,
    is_completed: true,
    source_flags: {
      paired_planned_and_completed: false,
      completed_only: true,
      planned_only: false,
    },
    notes_excerpt: null,
    estimated_quality_type: "easy" as const,
    estimated_structure: null,
    confidence: "medium" as const,
    flags: [],
    training_family: "easy" as const,
    quality_like: false,
    interval_structure: null,
    trainingpeaks_workout_id: 2000 + index,
  }));
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

function testBaselineNeedsReviewOnlyIsInfo(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: easyRuns(8),
      baseline: {
        confidence: "medium",
        needs_review: true,
        frequency_cap: 4,
        quality_count_cap: 1,
        recent_4w_frequency: 3,
        context_flags: [],
      },
    }),
  );
  assert.equal(snapshot.review_level, "info");
  assert.equal(snapshot.flags.manual_review_required, false);
  assert.equal(snapshot.review_reasons.includes("baseline_needs_review"), true);
}

function testActiveIllnessIsHardBlock(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      operational_signals: [mockIllnessSignal(true)],
    }),
  );
  assert.equal(snapshot.flags.active_illness, true);
  assert.equal(snapshot.review_level, "hard_block");
  assert.equal(snapshot.flags.manual_review_required, true);
  assert.match(snapshot.recommendation.summary, /illness/i);
  assert.equal(snapshot.recommendation.do_not_do.includes("normal_training_load"), true);
  assert.equal(snapshot.recommendation.do_not_do.includes("intervals"), true);
}

function testReturnAfterIllnessIsCoachReview(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      operational_signals: [mockIllnessSignal(false)],
    }),
  );
  assert.equal(snapshot.flags.illness_return_week, true);
  assert.equal(snapshot.review_level, "coach_review");
  assert.equal(snapshot.flags.manual_review_required, true);
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

function testVo2KnownProgressionCleanAthleteCanBeNoneOrInfo(): void {
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
  assert.ok(snapshot.review_level === "none" || snapshot.review_level === "info");

  const withBaselineCaveat = detectTrainingPhaseV0(
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
      baseline: {
        confidence: "medium",
        needs_review: true,
        frequency_cap: 4,
        quality_count_cap: 1,
        recent_4w_frequency: 3,
        context_flags: [],
      },
    }),
  );
  assert.equal(withBaselineCaveat.review_level, "info");
  assert.equal(withBaselineCaveat.flags.manual_review_required, false);
}

function testThresholdControlledIsCoachReview(): void {
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
  assert.equal(snapshot.review_level, "coach_review");
  assert.equal(snapshot.flags.manual_review_required, true);
  assert.match(snapshot.recommendation.summary, /does not auto-select/i);
}

function testVo2UnknownKeyIsCoachReview(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [
        mockQualityWorkout({
          date: "2026-06-04",
          type: "vo2max_intervals",
          title: "Custom odd intervals",
          repeatCount: 9,
          workDuration: "45 sec",
        }),
      ],
    }),
  );
  assert.equal(snapshot.flags.quality_progression_unknown, true);
  assert.equal(snapshot.review_level, "coach_review");
}

function testPossibleDeloadFromConsecutiveQualityWeeksIsCoachReview(): void {
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
  assert.equal(snapshot.review_level, "coach_review");
  assert.match(snapshot.recommendation.summary, /Do not auto-insert/i);
  assert.equal(snapshot.recommendation.do_not_do.includes("auto_insert_deload_week"), true);
  assert.equal(snapshot.recommendation.do_not_do.includes("auto_deload_insertion"), true);
}

function testNonConsecutiveQualityWeeksDoNotTriggerDeload(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [
        mockQualityWorkout({ date: "2026-05-12", type: "vo2max_intervals", repeatCount: 20, workDuration: "1 min" }),
        mockQualityWorkout({ date: "2026-05-26", type: "vo2max_intervals", repeatCount: 20, workDuration: "1 min" }),
        mockQualityWorkout({ date: "2026-06-04", type: "vo2max_intervals", repeatCount: 20, workDuration: "1 min" }),
      ],
    }),
  );
  assert.equal(snapshot.flags.possible_deload_recommended, false);
  assert.equal(snapshot.review_reasons.includes("possible_deload_recommended"), false);
}

function testLegkiyBegMustNotClassifyAsVo2(): void {
  const workout = mockQualityWorkout({
    date: "2026-06-04",
    type: "short_intervals",
    title: "Легкий бег",
    repeatCount: 6,
    workDuration: "3 min",
  });
  assert.equal(isEasyOrLightWorkout(workout), true);

  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [workout],
    }),
  );
  assert.notEqual(snapshot.detected_context, "vo2_block");
}

function testAmbiguous5x3MustNotAutoMapToVo2(): void {
  const workout = mockQualityWorkout({
    date: "2026-06-04",
    type: "short_intervals",
    title: "5 x 3 min",
    repeatCount: 5,
    workDuration: "3 min",
    trainingFamily: "threshold_subthreshold_intervals",
  });
  assert.equal(isAmbiguous3MinPattern(workout), true);
  assert.equal(hasStrongVo2IntensityEvidence(workout), false);

  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [workout],
      baseline: {
        confidence: "medium",
        needs_review: false,
        frequency_cap: 3,
        quality_count_cap: 1,
        recent_4w_frequency: 1.5,
        context_flags: [],
      },
    }),
  );
  assert.notEqual(snapshot.detected_context, "vo2_block");
  assert.equal(snapshot.flags.quality_progression_unknown, true);
}

function testAmbiguous6x3WithoutIntensityEvidenceMustNotBeConfidentVo2(): void {
  const workout = mockQualityWorkout({
    date: "2026-06-04",
    type: "short_intervals",
    title: "6 x 3 min",
    repeatCount: 6,
    workDuration: "3 min",
  });
  assert.equal(isAmbiguous3MinPattern(workout), true);
  assert.equal(hasStrongVo2IntensityEvidence(workout), false);

  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [workout],
      baseline: {
        confidence: "medium",
        needs_review: false,
        frequency_cap: 3,
        quality_count_cap: 1,
        recent_4w_frequency: 1.5,
        context_flags: [],
      },
    }),
  );
  assert.notEqual(snapshot.detected_context, "vo2_block");
  assert.equal(snapshot.flags.quality_progression_unknown, true);
  assert.equal(snapshot.review_level, "coach_review");
}

function testUnclearRaceContextRequiresCoachReview(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: easyRuns(8),
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
  assert.equal(snapshot.review_level, "coach_review");
  assert.equal(snapshot.flags.manual_review_required, true);
}

function testRace10kInOneWeekTriggersTaperCoachReview(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: easyRuns(8),
      race_context: {
        candidates: [
          {
            date: "2026-06-14",
            estimated_distance: "10k",
            confidence: "high",
            event_name: "City 10K",
          },
        ],
      },
    }),
  );
  assert.equal(snapshot.detected_context, "taper_context");
  assert.equal(snapshot.review_level, "coach_review");
  assert.equal(snapshot.race_context.upcoming_race_detected, true);
  assert.equal(snapshot.race_context.weeks_to_next_race, 1);
}

function testMarathonInTwelveWeeksIsRaceSpecificCoachReview(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: easyRuns(8),
      race_context: {
        candidates: [
          {
            date: "2026-08-31",
            estimated_distance: "marathon",
            confidence: "high",
            event_name: "Autumn Marathon",
          },
        ],
      },
    }),
  );
  assert.equal(snapshot.detected_context, "race_specific_context");
  assert.equal(snapshot.review_level, "coach_review");
  assert.equal(snapshot.flags.marathon_specific_requires_review, true);
}

function testMultipleUpcomingRacesRequireConfirmation(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: easyRuns(8),
      race_context: {
        candidates: [
          { date: "2026-07-20", estimated_distance: "10k", confidence: "high", event_name: "10K A" },
          { date: "2026-08-17", estimated_distance: "half", confidence: "medium", event_name: "Half B" },
        ],
      },
    }),
  );
  assert.equal(snapshot.race_context.upcoming_races_count, 2);
  assert.equal(snapshot.flags.race_context_needs_confirmation, true);
  assert.equal(snapshot.review_level, "coach_review");
}

function testRaceOutsidePlanningWindowKeepsExistingContextWithRaceInfo(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [mockQualityWorkout({ date: "2026-06-04", type: "controlled_sub_threshold", repeatCount: 3, workDuration: "8 min" })],
      race_context: {
        candidates: [
          { date: "2027-01-10", estimated_distance: "marathon", confidence: "high", event_name: "Far Marathon" },
        ],
      },
    }),
  );
  assert.equal(snapshot.detected_context, "threshold_or_controlled_block");
  assert.equal(snapshot.race_context.upcoming_race_detected, true);
  assert.equal(snapshot.race_context.next_race_date, "2027-01-10");
}

function testNoRaceInputKeepsBaselineBehavior(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [mockQualityWorkout({ date: "2026-06-04", type: "controlled_sub_threshold", repeatCount: 3, workDuration: "8 min" })],
      race_context: { candidates: [] },
    }),
  );
  assert.equal(snapshot.detected_context, "threshold_or_controlled_block");
  assert.equal(snapshot.race_context.upcoming_race_detected, false);
}

function testMarathonSpecificRequiresCoachReview(): void {
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: easyRuns(8),
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
  assert.equal(snapshot.review_level, "coach_review");
  assert.equal(snapshot.flags.manual_review_required, true);
}

function testLowDataAthleteIsHardBlock(): void {
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
  assert.equal(snapshot.review_level, "hard_block");
  assert.equal(snapshot.flags.manual_review_required, true);
  assert.equal(snapshot.data_visibility_status, "no_completed_data");
}

function testDemianLike6x3StaysConservativeWithoutVo2Intent(): void {
  const workout = mockQualityWorkout({
    date: "2026-06-04",
    type: "short_intervals",
    title: "6 x 3 min near ПАНО",
    notes: "tempo upper threshold session near ПАНО",
    repeatCount: 6,
    workDuration: "3 min",
    trainingFamily: "threshold_subthreshold_intervals",
  });
  const snapshot = detectTrainingPhaseV0(
    baseInput({
      workouts: [workout],
      baseline: {
        confidence: "medium",
        needs_review: false,
        frequency_cap: 5,
        quality_count_cap: 2,
        recent_4w_frequency: 4,
        context_flags: [],
      },
    }),
  );
  assert.notEqual(snapshot.detected_context, "vo2_block");
  assert.equal(snapshot.review_level, "coach_review");
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
  testBaselineNeedsReviewOnlyIsInfo();
  testActiveIllnessIsHardBlock();
  testReturnAfterIllnessIsCoachReview();
  testVo2RecentHistoryClassifiedAsVo2Block();
  testVo2KnownProgressionCleanAthleteCanBeNoneOrInfo();
  testThresholdControlledIsCoachReview();
  testVo2UnknownKeyIsCoachReview();
  testPossibleDeloadFromConsecutiveQualityWeeksIsCoachReview();
  testNonConsecutiveQualityWeeksDoNotTriggerDeload();
  testLegkiyBegMustNotClassifyAsVo2();
  testAmbiguous5x3MustNotAutoMapToVo2();
  testAmbiguous6x3WithoutIntensityEvidenceMustNotBeConfidentVo2();
  testRace10kInOneWeekTriggersTaperCoachReview();
  testMarathonInTwelveWeeksIsRaceSpecificCoachReview();
  testMultipleUpcomingRacesRequireConfirmation();
  testRaceOutsidePlanningWindowKeepsExistingContextWithRaceInfo();
  testNoRaceInputKeepsBaselineBehavior();
  testUnclearRaceContextRequiresCoachReview();
  testMarathonSpecificRequiresCoachReview();
  testLowDataAthleteIsHardBlock();
  testDemianLike6x3StaysConservativeWithoutVo2Intent();
  testSafetyMarkers();
  testExtractOperationalHealthFlags();
  console.log("check-athlete-phase-snapshot-v0: all checks passed");
}

main();
