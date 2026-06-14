import assert from "node:assert/strict";

import {
  validateNutritionDayProse,
  type NutritionDayProseFacts,
} from "@/features/nutrition/telegram-renderer";

function hasError(
  issues: ReturnType<typeof validateNutritionDayProse>,
  rule: string
): boolean {
  return issues.some((issue) => issue.rule === rule && issue.severity === "error");
}

const baseFacts: NutritionDayProseFacts = {
  kcal: 1754,
  proteinG: 92,
  fatG: 48,
  carbsG: 233,
  carbsGPerKg: 4.2,
  proteinGPerKg: 1.7,
  nutritionStatus: "low_for_load",
  findings: [],
};

// 1. number_not_in_facts: prose claims a carb number that is not a fact (233 -> 240).
{
  const issues = validateNutritionDayProse({
    prose: "Под нагрузку углеводов маловато, у тебя углеводы 240.",
    facts: baseFacts,
  });
  assert.ok(hasError(issues, "number_not_in_facts"), "240 not in facts must be flagged");
}

// 2. A number that IS a fact (carbs 233) passes the number check.
{
  const issues = validateNutritionDayProse({
    prose: "Углеводов 233 для такой нагрузки маловато, добавь немного.",
    facts: baseFacts,
  });
  assert.ok(!hasError(issues, "number_not_in_facts"), "233 is a fact and must pass");
}

// 2b. Rounded display form of kcal (1754 -> 1750) is allowed.
{
  const issues = validateNutritionDayProse({
    prose: "Около 1750 за день, под нагрузку этого мало, стоит добавить.",
    facts: baseFacts,
  });
  assert.ok(!hasError(issues, "number_not_in_facts"), "rounded kcal (nearest 50) must pass");
}

// 2c. Percentages are whitelisted.
{
  const issues = validateNutritionDayProse({
    prose: "Жиры закрывают почти 30% энергии, но углеводов маловато под нагрузку.",
    facts: baseFacts,
  });
  assert.ok(!hasError(issues, "number_not_in_facts"), "percentages must be whitelisted");
}

// 3. status_softened: hard day but prose has no undershoot marker.
{
  const issues = validateNutritionDayProse({
    prose: "Отличный день, всё в порядке, так держать!",
    facts: baseFacts,
  });
  assert.ok(hasError(issues, "status_softened"), "softened hard day must be flagged");
}

// 3b. Hard day WITH an undershoot marker passes the status check.
{
  const issues = validateNutritionDayProse({
    prose: "В целом неплохо, но углеводов под нагрузку маловато, давай чуть добавим.",
    facts: baseFacts,
  });
  assert.ok(!hasError(issues, "status_softened"), "honest hard-day prose must pass");
}

// 3c. Hard status detected via findings (not status string) is also enforced.
{
  const issues = validateNutritionDayProse({
    prose: "День прошёл хорошо, ничего не меняем.",
    facts: { ...baseFacts, nutritionStatus: "adequate", findings: ["ea_red_screen"] },
  });
  assert.ok(hasError(issues, "status_softened"), "hard finding must enforce undershoot marker");
}

// 4. Clean prose for a steady day (no numbers, no hard status) passes entirely.
{
  const steadyFacts: NutritionDayProseFacts = {
    kcal: 1734,
    proteinG: 88,
    fatG: 43,
    carbsG: 248,
    carbsGPerKg: 4.5,
    proteinGPerKg: 1.6,
    nutritionStatus: "rest_ok",
    findings: [],
  };
  const issues = validateNutritionDayProse({
    prose: "Под день отдыха картина ровная, здесь ничего менять не надо.",
    facts: steadyFacts,
  });
  assert.equal(issues.length, 0, "clean steady-day prose must produce no issues");
}

console.log("PASS check-nutrition-day-prose-validator");
