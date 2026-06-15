import assert from "node:assert/strict";

import { buildNutritionDayProseFacts } from "@/features/nutrition/combined-message";
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
  // Target 350, actual 233, deficit 117 -> rounded to 10 reads "около 120".
  const withTarget: NutritionDayProseFacts = { ...baseFacts, planTargetNumbers: [350, 117] };
  const ok = validateNutritionDayProse({
    prose: "Под такую работу хотелось бы около 350 г углеводов, у тебя 233 — недобор около 120 г, добавь каши и риса.",
    facts: withTarget,
  });
  assert.ok(!hasError(ok, "number_not_in_facts"), "target 350 / actual 233 / deficit rounded to 120 must pass");
  const bad = validateNutritionDayProse({ prose: "Углеводы 240 под нагрузку, маловато.", facts: withTarget });
  assert.ok(hasError(bad, "number_not_in_facts"), "misstated actual (240 vs 233) still caught");
}

// 2e. Task 4: a real diary fact rounded to a whole number passes, BUT an invented
// number absent from the day's facts is still blocked — both in one test (the
// false-cut fix must not open the door to invented numbers).
{
  const decimalFacts: NutritionDayProseFacts = { ...baseFacts, proteinG: 103.58 };
  const real = validateNutritionDayProse({
    prose: "Белок 104 г — хорошо, но углеводов под нагрузку маловато, добавь каши.",
    facts: decimalFacts,
  });
  assert.ok(!hasError(real, "number_not_in_facts"), "real fact rounded to whole (103.58 -> 104) must pass");
  const invented = validateNutritionDayProse({
    prose: "Углеводов аж 300 г — отлично, так держать.",
    facts: decimalFacts, // carbsG 233, no target near 300
  });
  assert.ok(hasError(invented, "number_not_in_facts"), "invented number (300 vs fact 233) must still block");
}

// 2f. Task 4: rounded plan targets ("около 300", "300–320") for a 280–320 corridor pass.
{
  const banded: NutritionDayProseFacts = { ...baseFacts, planTargetNumbers: [280, 320, 300] };
  for (const prose of [
    "Под такую работу ориентир около 300 г углеводов, у тебя 233 — стоит добавить.",
    "Хорошо бы держать углеводы в районе 300–320 г под нагрузку, сейчас 233 маловато.",
  ]) {
    assert.ok(!hasError(validateNutritionDayProse({ prose, facts: banded }), "number_not_in_facts"), `rounded target must pass: "${prose}"`);
  }
}

// 2g. buildNutritionDayProseFacts adds the band midpoint (rounded to 10) so the
// rounded "около 300" form above is produced for a real 280–320 day item.
{
  const facts = buildNutritionDayProseFacts({
    date: "2026-06-03",
    actual: { kcal: 1900, proteinG: 100, fatG: 55, carbsG: 233, carbsGPerKg: 4.2 },
    nutrition_status: "low_for_load",
    findings: [],
    target: { carbsGMin: 280, carbsGMax: 320 },
  });
  assert.ok((facts.planTargetNumbers ?? []).includes(300), "band midpoint 300 added to plan targets");
}

// 2h. Task 4: non-macro numbers (workout descriptors, dates, %, +steps) must NOT
// be policed as facts — they were the dominant cause of valid days being cut.
{
  const facts: NutritionDayProseFacts = { ...baseFacts, carbsG: 215, proteinG: 133, planTargetNumbers: [280, 320, 300] };
  for (const prose of [
    "Среда — интервалы 7×5 мин: белок 133 г отлично, углеводов 215 г маловато под нагрузку.",
    "Пятница — лёгкий бег 12 км, углеводов 215 г немного не добрала.",
    "Воскресенье — длительная 16.6 км (1:40), углеводов 215 г — мало, добавь +50–60 г.",
    "На следующей длительной 14 июня держи углеводы около 300 г, сейчас 215 — маловато.",
    "Жиры заняли около 41% энергии, углеводов 215 г недобор.",
  ]) {
    assert.ok(
      !hasError(validateNutritionDayProse({ prose, facts }), "number_not_in_facts"),
      `non-macro numbers must not be cut: "${prose}"`
    );
  }
  // ...but an invented macro number in the same prose is still blocked.
  assert.ok(
    hasError(
      validateNutritionDayProse({ prose: "Бег 12 км, а углеводов 400 г — отлично.", facts }),
      "number_not_in_facts"
    ),
    "invented macro (400 vs 215) still blocked even alongside a whitelisted '12 км'"
  );
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

// 3d. Task 4 вариант (б): status_softened catches CONTRADICTION (day-level praise
// on a hard day), not the absence of an undershoot word. Honest undershoot in any
// phrasing passes; per-macro praise alongside it passes; day-level approval blocks.
{
  // Honest undershoot phrasings the old word-list missed must now pass.
  for (const prose of [
    "Углеводов меньше, чем нужно под такую нагрузку.",
    "Белок 133 г — отлично, но углеводов заметно меньше ориентира.",
    "Под длительную не дотянул по углеводам.",
    "Энергия в этот день вышла скромная для такой работы.",
    "160 г углеводов — меньше, чем ориентир, накануне длительной стоит наполнить запасы.",
  ]) {
    assert.ok(
      !hasError(validateNutritionDayProse({ prose, facts: baseFacts }), "status_softened"),
      `honest hard-day undershoot must pass: "${prose}"`
    );
  }
  // Day-level approval / "no change needed" on a hard day must block.
  for (const prose of [
    "Всё хорошо, ничего менять не надо.",
    "День отличный, всё в норме, так держать!",
    "Углеводы и энергия — всё в порядке.",
  ]) {
    assert.ok(
      hasError(validateNutritionDayProse({ prose, facts: baseFacts }), "status_softened"),
      `day-level praise on a hard day must block: "${prose}"`
    );
  }
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
