/**
 * Наряд 2: suspect-дни не текут в недельный итог.
 *
 * Счётчики недельной сводки (carbsBorderlineLoadDays / fatLowOrBorderlineDays и
 * производный carbsLowOrBorderlineLoadDays) росли по ЛЮБОМУ строковому статусу —
 * исключения по suspect / relevance="low_confidence" не было. Итог мог сказать
 * «дни низкие по углеводам» про день, чей дневник просто не распознался.
 *
 * Фильтр стоит в ОДНОМ месте (buildNutritionWeeklySummary), поэтому обе точки входа —
 * сводка тренера и сообщение ученице — закрыты им сразу.
 */
import assert from "node:assert/strict";

import {
  buildNutritionWeeklySummary,
  isNutritionDayJudgeable,
  type NutritionWeeklySummaryDayFact,
} from "@/features/nutrition/narrative-composer";

function day(input: {
  date: string;
  role: "rest" | "key_interval" | "long_run";
  carbsStatus: string | null;
  fatStatus?: string | null;
  nutritionStatus?: string | null;
  relevance?: string | null;
  label?: string;
}): NutritionWeeklySummaryDayFact {
  return {
    date: input.date,
    trainingType: input.role === "rest" ? "rest" : input.role === "long_run" ? "long_run" : "intervals",
    trainingLabel: input.label ?? (input.role === "rest" ? "день отдыха" : "бег"),
    nutritionStatus: input.nutritionStatus ?? "adequate",
    relevance: input.relevance ?? null,
    findings: [],
    macro: {
      proteinStatus: "ok",
      fatStatus: input.fatStatus ?? "ok",
      fatPercentStatus: null,
      fatG: 60,
      fatPercentEnergy: 28,
      carbsStatus: input.carbsStatus,
      carbsG: 250,
      carbsGPerKg: 4.2,
    },
    hasEnergyIssue: false,
    roleInfo: {
      role: input.role,
      isKey: input.role !== "rest",
      reason: "fixture",
    },
  } as unknown as NutritionWeeklySummaryDayFact;
}

// ── 1. Предикат ────────────────────────────────────────────────────────────────────
assert.equal(isNutritionDayJudgeable({ nutritionStatus: "adequate", relevance: "key" }), true);
assert.equal(isNutritionDayJudgeable({ nutritionStatus: "suspect", relevance: "key" }), false);
assert.equal(isNutritionDayJudgeable({ nutritionStatus: "adequate", relevance: "low_confidence" }), false);
// Старые разборы без relevance ведут себя как раньше — день оценим.
assert.equal(isNutritionDayJudgeable({ nutritionStatus: "adequate" }), true);

// ── 2. Случай Пономарёвой: suspect-день БЕЗ статуса и С статусом дают один итог ────
// В её сохранённой строке (7243d863) suspect-дни лежат без углеводного статуса, поэтому
// итог и до правки был чистым. Смоделированы оба варианта: правка обязана сделать их
// неразличимыми — иначе «чисто» держалось на случайности данных, а не на правиле.
const baseWeek = [
  day({ date: "2026-07-20", role: "rest", carbsStatus: "ok" }),
  day({ date: "2026-07-21", role: "key_interval", carbsStatus: "ok", label: "интервалы 6×5 мин" }),
  day({ date: "2026-07-22", role: "rest", carbsStatus: "ok" }),
  day({ date: "2026-07-26", role: "long_run", carbsStatus: "ok", label: "длительная 17 км" }),
];

const suspectWithoutStatus = [
  ...baseWeek,
  day({ date: "2026-07-23", role: "key_interval", carbsStatus: null, nutritionStatus: "suspect", relevance: "low_confidence" }),
];
const suspectWithStatus = [
  ...baseWeek,
  day({
    date: "2026-07-23",
    role: "key_interval",
    carbsStatus: "low",
    fatStatus: "low",
    nutritionStatus: "suspect",
    relevance: "low_confidence",
  }),
];

const summaryWithout = buildNutritionWeeklySummary({ days: suspectWithoutStatus, weekSeed: "2026-07-20" });
const summaryWith = buildNutritionWeeklySummary({ days: suspectWithStatus, weekSeed: "2026-07-20" });
assert.equal(
  summaryWith,
  summaryWithout,
  "suspect-день со статусом и без обязан давать ОДИН И ТОТ ЖЕ недельный итог"
);

// ── 3. Оценимый день с теми же цифрами итог менять ОБЯЗАН ─────────────────────────
// Иначе фильтр отрезал бы не suspect, а вообще все проблемные дни.
const judgeableLow = [
  ...baseWeek,
  day({ date: "2026-07-23", role: "key_interval", carbsStatus: "low", fatStatus: "low", relevance: "key" }),
];
const summaryJudgeable = buildNutritionWeeklySummary({ days: judgeableLow, weekSeed: "2026-07-20" });
assert.notEqual(
  summaryJudgeable,
  summaryWithout,
  "оценимый низкоуглеводный день обязан влиять на итог — фильтр только для suspect"
);

// ── 4. Ключевые тренировки недели не тянут suspect-день (наряд 2.3) ───────────────
const suspectKeyWorkout = [
  ...baseWeek,
  day({
    date: "2026-07-24",
    role: "key_interval",
    carbsStatus: null,
    nutritionStatus: "suspect",
    relevance: "low_confidence",
    label: "темпо 8 км",
  }),
];
const summaryWithSuspectKey = buildNutritionWeeklySummary({ days: suspectKeyWorkout, weekSeed: "2026-07-20" });
assert.ok(
  !summaryWithSuspectKey.includes("темпо 8 км"),
  "suspect-день не должен попадать в перечисление ключевых тренировок недели"
);
assert.ok(
  summaryWithSuspectKey.includes("длительная 17 км") || summaryWithSuspectKey.includes("интервалы"),
  "оценимые ключевые тренировки в итоге остаются"
);

console.log("PASS check-nutrition-suspect-days-excluded");
