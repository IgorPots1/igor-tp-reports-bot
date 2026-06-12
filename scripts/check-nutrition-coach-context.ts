import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import {
  NUTRITION_COACH_CONTEXT_RU_MAX_LENGTH,
  normalizeNutritionCoachContextRu,
} from "@/features/nutrition/repository";

const root = process.cwd();
const coachContextFixture = "недавно подняли объём, после болезни, нужен мягкий тон";

function buildMockContext(overrides?: Partial<NutritionStudentContext>): NutritionStudentContext {
  return {
    studentName: "Анна",
    studentSlug: "anna",
    studentUuid: "student-anna",
    resolvedCommunicationProfile: {
      formality: "ty",
      formalitySource: "manual",
      tone: "neutral",
      preferredGreeting: null,
      notes: null,
      conflictFlags: [],
    },
    communicationProfilePromptLines: [],
    telegramContextNotes: null,
    coachMemoryItems: [],
    nutritionContextItems: [],
    weightLogs: [],
    currentWeightKg: 58,
    nutritionGoal: "поддержка энергии на объёме",
    coachContextRu: coachContextFixture,
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
      hasResolvedDates: true,
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
      keyWorkouts: [{ date: "2026-06-03", title: "Интервалы 7х5 мин", type: "run", confidence: "high" }],
      workouts: [
        {
          date: "2026-06-03",
          title: "Интервалы 7х5 мин",
          status: "completed",
          type: "run",
          description: null,
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
  assert.equal(normalizeNutritionCoachContextRu("  "), null, "empty coach context -> null");
  assert.equal(normalizeNutritionCoachContextRu("  мягкий тон  "), "мягкий тон", "coach context trims whitespace");
  assert.throws(
    () => normalizeNutritionCoachContextRu("x".repeat(NUTRITION_COACH_CONTEXT_RU_MAX_LENGTH + 1)),
    /не может быть длиннее/
  );

  const generated = await generateNutritionWeeklyAnalysis({ context: buildMockContext() });
  assert.equal(generated.athlete_report_signals.length, 0);
  const athleteDraft = generated.athlete_message_draft ?? "";
  assert.doesNotMatch(athleteDraft, /недавно подняли объём/i, "coach context must not be quoted verbatim to athlete");
  assert.doesNotMatch(athleteDraft, /после болезни/i, "coach context must not be quoted verbatim to athlete");

  const draftGenerator = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
  assert.match(draftGenerator, /coach_context_ru/, "facts payload must include coach_context_ru");
  assert.match(draftGenerator, /nutrition_goal/, "facts payload must include nutrition_goal");
  assert.match(draftGenerator, /coach_memory/, "facts payload must include coach memory summaries");

  const contextBuilder = readFileSync(join(root, "src/features/nutrition/context.ts"), "utf8");
  assert.match(contextBuilder, /coachContextRu/, "student context must expose coachContextRu");

  const repository = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");
  assert.match(repository, /coach_context_ru/, "repository must map coach_context_ru");

  const migration = readFileSync(
    join(root, "supabase/migrations/20260612120000_add_nutrition_coach_context_ru.sql"),
    "utf8"
  );
  assert.match(migration, /coach_context_ru/, "migration must add coach_context_ru column");

  const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
  assert.match(studentPage, /Контекст для разбора питания/, "UI must show coach context label");
  assert.match(studentPage, /1–3 предложения для AI/, "UI must show coach context help");
  assert.match(studentPage, /saveNutritionCoachContextAction/, "UI must wire coach context save action");

  const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
  assert.match(actions, /saveNutritionCoachContextAction/, "actions must expose coach context save");

  console.log("PASS check-nutrition-coach-context");
}

void run();
