import assert from "node:assert/strict";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";

function buildMockContext(overrides?: Partial<NutritionStudentContext>): NutritionStudentContext {
  return {
    studentName: "Надя",
    studentSlug: "nadezhda",
    studentUuid: "student-nadya",
    resolvedCommunicationProfile: {
      formality: "ty",
      formalitySource: "manual",
      tone: "neutral",
      preferredGreeting: "Надя, привет!",
      notes: null,
      conflictFlags: [],
    },
    communicationProfilePromptLines: [],
    telegramContextNotes: "female",
    coachMemoryItems: [],
    nutritionContextItems: [],
    weightLogs: [],
    currentWeightKg: 56,
    nutritionGoal: null,
    coachContextRu: null,
    athleteReportSignals: [],
    manualMacroRows: [
      { day: "2026-06-01", weekday: "пн", kcal: 1850, proteinG: 108, fatG: 58, carbsG: 210, confidence: 1, notes: null },
      { day: "2026-06-02", weekday: "вт", kcal: 1820, proteinG: 102, fatG: 56, carbsG: 195, confidence: 1, notes: null },
      { day: "2026-06-03", weekday: "ср", kcal: 2250, proteinG: 112, fatG: 62, carbsG: 255, confidence: 1, notes: null },
      { day: "2026-06-04", weekday: "чт", kcal: 1730, proteinG: 101, fatG: 52, carbsG: 165, confidence: 1, notes: null },
      { day: "2026-06-05", weekday: "пт", kcal: 1470, proteinG: 104, fatG: 48, carbsG: 115, confidence: 1, notes: null },
      { day: "2026-06-06", weekday: "сб", kcal: 1600, proteinG: 103, fatG: 50, carbsG: 135, confidence: 1, notes: null },
      { day: "2026-06-07", weekday: "вс", kcal: 1520, proteinG: 109, fatG: 46, carbsG: 122, confidence: 1, notes: null },
    ],
    dataQuality: {
      parsedDays: 7,
      lowConfidenceDays: 0,
      // hasResolvedDates:false forces forceNeedsReview, so generation uses the
      // DETERMINISTIC fallback draft instead of attempting the model. Without a
      // live model key the model path is correctly HELD (Task 3: awaiting_generation,
      // draft = null), so this is how we exercise + assert fallback draft quality.
      hasResolvedDates: false,
      unrealisticRows: 0,
      duplicateDays: [],
      qualityFlags: [],
    },
    reportStatus: "ready_for_analysis",
    tpPastWeek: {
      periodFrom: "2026-06-01",
      periodTo: "2026-06-07",
      cacheStatus: "ok",
      cacheStatusNote: "ok",
      totalSessions: 6,
      plannedSessions: 6,
      completedSessions: 6,
      runningSessions: 5,
      longRun: { date: "2026-06-07", title: "Длительная 100 мин", durationHours: 1.67, distanceKm: 17 },
      keyWorkouts: [
        { date: "2026-06-03", title: "Интервалы 7х5 мин", type: "run", confidence: "high" },
        { date: "2026-06-07", title: "Длительная 100 мин", type: "run", confidence: "high" },
      ],
      workouts: [
        {
          date: "2026-06-03",
          title: "Интервалы 7х5 мин",
          status: "completed",
          type: "run",
          description: "7x5 min",
          coachComments: null,
          plannedText: null,
        },
        {
          date: "2026-06-07",
          title: "Длительная 100 мин",
          status: "completed",
          type: "run",
          description: "Лёгкая длительная, питание во время не указано",
          coachComments: null,
          plannedText: null,
        },
      ],
    },
    tpNextWeek: {
      periodFrom: "2026-06-08",
      periodTo: "2026-06-14",
      cacheStatus: "empty",
      cacheStatusNote: "empty",
      totalSessions: 0,
      plannedSessions: 0,
      completedSessions: 0,
      runningSessions: 0,
      longRun: null,
      keyWorkouts: [],
      workouts: [],
    },
    ...overrides,
  };
}

async function run(): Promise<void> {
  const generated = await generateNutritionWeeklyAnalysis({ context: buildMockContext() });
  assert.ok(Array.isArray(generated.daily_analysis), "daily_analysis must exist");
  assert.ok(Array.isArray(generated.training_nutrition_links), "training_nutrition_links must exist");
  const canonicalDay = generated.daily_analysis.find((day) => day.date === "2026-06-07");
  assert.ok(canonicalDay && typeof canonicalDay.canonicalDailyAnalysis === "object", "canonical daily facts must be present");
  const canonicalPayload = canonicalDay?.canonicalDailyAnalysis as Record<string, unknown>;
  assert.equal(typeof canonicalPayload.weekdayRu, "string");
  assert.equal(typeof canonicalPayload.dateLabel, "string");
  assert.equal(typeof canonicalPayload.nutritionStatus, "string");
  assert.equal(typeof (canonicalPayload.energyAvailability as Record<string, unknown>).eaZone, "string");
  assert.equal(generated.one_focus.category, "energy_availability");
  assert.equal(generated.methodology_signals.protein_sufficient, true);

  const athleteDraft = generated.athlete_message_draft ?? "";
  assert.match(
    athleteDraft,
    /🔹\s+[А-Яа-яЁё]+\s+\(\d{2}\.\d{2}\)\s+—\s+.+\n~\d+\s*ккал\s*·\s*белок\s*\d+\s*г\s*·\s*жиры\s*\d+\s*г\s*·\s*углеводы\s*\d+\s*г/i,
    "athlete draft should contain canonical day blocks"
  );
  assert.match(athleteDraft, /Надя|надя/i, "athlete draft should mention athlete name");
  assert.match(athleteDraft.toLowerCase(), /интервал|длитель/, "athlete draft should mention key sessions");
  assert.match(athleteDraft.toLowerCase(), /белк/, "athlete draft should mention protein status");
  assert.match(athleteDraft.toLowerCase(), /углевод|энерги/, "athlete draft should explain carbs/energy relevance");
  assert.match(athleteDraft, /\d+\s*ккал|\d+\s*г\s*углевод/, "athlete draft should include day-level numbers when fallback is used");
  assert.match(athleteDraft, /\d{2}\.\d{2}/, "athlete draft should include day-level dates when fallback is used");
  assert.match(athleteDraft.toLowerCase(), /постеп|не\s+резк|небольш/, "athlete draft should recommend gradual step");
  assert.doesNotMatch(athleteDraft, /[A-Za-z]{3,}/, "athlete draft should avoid English");
  assert.doesNotMatch(athleteDraft, /\*\*|---|```/, "athlete draft should stay plain Telegram text");
  assert.doesNotMatch(
    athleteDraft.toLowerCase(),
    /red-s|reds|lea|дефицит энергии|анемия|расстройств/,
    "athlete draft must avoid diagnostic language"
  );
  assert.doesNotMatch(
    athleteDraft.toLowerCase(),
    /похуд|сбросить вес|урезать калори|меньше есть|дефицит калорий/,
    "athlete draft must avoid restrictive language"
  );
  assert.doesNotMatch(
    athleteDraft.toLowerCase(),
    /вызвало|из-за этого точно|именно поэтому/,
    "athlete draft must avoid deterministic causality claims"
  );
  assert.doesNotMatch(
    athleteDraft.toLowerCase(),
    /до тренировки|во время тренировки|после тренировки|гель|гели|тайминг/,
    "day-by-day section should avoid intra-day fueling detail"
  );
  assert.doesNotMatch(athleteDraft.toLowerCase(), /\blong_run_underfueling\b|\bsmall_step\b|\bparsed_days\b/, "athlete draft should avoid enum labels");
  assert.doesNotMatch(athleteDraft.toLowerCase(), /главный\s+фокус.*главный\s+фокус/, "athlete draft should avoid repeated focus phrase");
  assert.doesNotMatch(athleteDraft.toLowerCase(), /день\s+самой\s+работы/, "athlete draft should avoid robotic phrase");
  assert.doesNotMatch(
    athleteDraft.toLowerCase(),
    /\b[1-9]\s*[-–]\s*[1-9]\s*г\/кг\b|\b[1-9]\s+до\s+[1-9]\s*г\/кг\b/,
    "athlete draft should avoid strict g/kg range targets"
  );

  const coachSummary = generated.coach_summary_text.toLowerCase();
  assert.match(coachSummary, /белок|норм|хорош/, "coach summary should include what was okay");
  assert.match(coachSummary, /углевод|энерги|ограничител|лимитер/, "coach summary should include what was not okay");
  assert.match(coachSummary, /фокус|следующ/, "coach summary should include one focus");
  assert.match(coachSummary, /следующ.*(пуст|empty|огранич)/, "coach summary should include next-week TP limitation");

  const hardSafety = buildMockContext({
    telegramContextNotes: "есть риск рпп",
    manualMacroRows: buildMockContext().manualMacroRows.map((row) => ({ ...row, kcal: 1150, carbsG: 70 })),
  });
  const generatedHardSafety = await generateNutritionWeeklyAnalysis({ context: hardSafety });
  // Coach decision (Igor): safety signals no longer hard-block — the week generates
  // like any other (status is never blocked_safety; signals become an honest note).
  assert.notEqual(generatedHardSafety.status, "blocked_safety", "no hard safety block anymore");
  assert.equal(generatedHardSafety.safety_flags.blocked, false, "safety.blocked is false under the new policy");

  const withCoachContext = buildMockContext({
    coachContextRu: "недавно подняли объём, после болезни, нужен мягкий тон",
    nutritionGoal: "поддержка энергии на объёме",
    coachMemoryItems: [
      {
        id: "m1",
        studentId: "student-nadya",
        memoryType: "race_or_goal",
        summaryText: "Готовится к полумарафону в августе",
        structured: {},
        source: "coach_manual",
        confidence: 1,
        validFrom: null,
        validUntil: null,
        isActive: true,
        supersededBy: null,
        sourceObservationId: null,
        sourceMessagePreview: null,
        firstSeenAt: "2026-06-01T00:00:00.000Z",
        lastSeenAt: "2026-06-01T00:00:00.000Z",
        metadata: {},
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  });
  const generatedWithCoachContext = await generateNutritionWeeklyAnalysis({ context: withCoachContext });
  assert.ok(Array.isArray(generatedWithCoachContext.athlete_report_signals));
  assert.doesNotMatch(
    generatedWithCoachContext.athlete_message_draft ?? "",
    /недавно подняли объём/i,
    "coach context must not be quoted verbatim in athlete draft"
  );

  const noApiKey = await generateNutritionWeeklyAnalysis({ context: buildMockContext() });
  if (!process.env.OPENAI_API_KEY?.trim()) {
    assert.equal(noApiKey.generation_mode, "fallback", "fallback mode should be explicit when AI unavailable");
  }

  const shadow = generated.nutrition_summary.interpretation_shadow;
  assert.ok(shadow && typeof shadow === "object", "review generation must persist interpretation_shadow metadata");
  assert.equal(shadow.version, "nutrition_interpretation_v1");
  assert.ok(["ai", "fallback", "disabled"].includes(shadow.mode), "shadow mode must be explicit");
  assert.ok(Array.isArray(shadow.issues), "shadow issues must be persisted");

  console.log("PASS check-nutrition-ai-review-quality");
}

void run();
