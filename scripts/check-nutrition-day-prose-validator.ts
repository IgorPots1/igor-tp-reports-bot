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

// 2d. Target + deficit coaching numbers (эталон style) must pass when provided
// as facts; a misstated actual intake is still caught.
{
  const withTarget: NutritionDayProseFacts = { ...baseFacts, planTargetNumbers: [350, 117] };
  const ok = validateNutritionDayProse({
    prose: "Под такую работу хотелось бы около 350 г углеводов, у тебя 233 — недобор около 100 г, добавь каши и риса.",
    facts: withTarget,
  });
  assert.ok(!hasError(ok, "number_not_in_facts"), "target ~350 / actual 233 / deficit ~100 must pass");
  const bad = validateNutritionDayProse({ prose: "Углеводы 240 под нагрузку, маловато.", facts: withTarget });
  assert.ok(hasError(bad, "number_not_in_facts"), "misstated actual (240 vs 233) still caught");
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

// 3b2. Honest undershoot phrasings that the marker set must recognize.
for (const prose of [
  "Уровень энергии оказался на нижней границе.",
  "Углеводов недостаточно для подготовки.",
  "Энергия и углеводы низкие для такого дня.",
  "Питание требует улучшения, особенно по углеводам.",
]) {
  const issues = validateNutritionDayProse({ prose, facts: baseFacts });
  assert.ok(!hasError(issues, "status_softened"), `undershoot phrasing must pass: "${prose}"`);
}

// 3b3. More honest undershoot phrasings the model actually uses.
for (const prose of [
  "День получился чуть пустоватым по общей энергии.",
  "Общей углеводной плотности не хватило под нагрузку.",
]) {
  const issues = validateNutritionDayProse({ prose, facts: baseFacts });
  assert.ok(!hasError(issues, "status_softened"), `undershoot phrasing must pass: "${prose}"`);
}

// 3b4. Amber-only energy availability on a rest day is a soft screen — a calm
// "в целом ок" must NOT be flagged as softened.
{
  const amberRest: NutritionDayProseFacts = {
    kcal: 2002,
    proteinG: 77,
    fatG: 87,
    carbsG: 227,
    carbsGPerKg: 3.66,
    proteinGPerKg: 1.24,
    nutritionStatus: "below_energy_availability",
    findings: ["limited_training_context", "protein_borderline", "ea_amber_screen"],
  };
  const issues = validateNutritionDayProse({
    prose: "Под день отдыха питание выглядит спокойно, в целом ок.",
    facts: amberRest,
  });
  assert.ok(!hasError(issues, "status_softened"), "amber-only rest day must not require undershoot");
}

// 3b5. But red EA (or low-carbs-for-load) is still hard and must be honest.
{
  const redDay: NutritionDayProseFacts = {
    kcal: 1877,
    proteinG: 61,
    fatG: 55,
    carbsG: 295,
    carbsGPerKg: 4.76,
    proteinGPerKg: 0.98,
    nutritionStatus: "below_energy_availability",
    findings: ["protein_low", "ea_red_screen"],
  };
  assert.ok(
    hasError(validateNutritionDayProse({ prose: "Отличный день, всё супер!", facts: redDay }), "status_softened"),
    "red EA day with no undershoot must be flagged"
  );
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
