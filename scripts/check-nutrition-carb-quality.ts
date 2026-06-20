import assert from "node:assert/strict";

import { classifyCarbItem, type CarbClass } from "@/features/nutrition/carb-quality";
import { buildNutritionDayProseFacts } from "@/features/nutrition/combined-message";
import {
  validateNutritionDayProse,
  type NutritionDayProseFacts,
} from "@/features/nutrition/telegram-renderer";

function hasError(issues: ReturnType<typeof validateNutritionDayProse>, rule: string): boolean {
  return issues.some((issue) => issue.rule === rule && issue.severity === "error");
}

// Enough carbs to pass the gram gate (≥20 g) so the speed class is what's tested.
const FUEL = 40;

// ── 1. Classifier: fast / slow / neutral / not_carb_base ──────────────────────
{
  const cases: Array<[string, number, CarbClass]> = [
    // наряд test cases
    ["банан", 27, "fast"],
    ["гречка", FUEL, "slow"],
    ["белый рис", FUEL, "neutral"],
    ["борщ", 12, "not_carb_base"], // low carbs → gate
    // обкатка Grushevskaya
    ["лаваш", FUEL, "fast"],
    ["борщ украинский", 9, "not_carb_base"],
    ["банан спелый", 25, "fast"],
    // more fast
    ["булочка с маком", FUEL, "fast"],
    ["белый хлеб", FUEL, "fast"],
    ["печенье овсяное", FUEL, "fast"], // cookie wins over "овсяное" (fast-first)
    ["сок апельсиновый", FUEL, "fast"],
    ["шоколад молочный", FUEL, "fast"],
    ["мёд", FUEL, "fast"],
    ["изюм", FUEL, "fast"],
    // more slow
    ["овсянка на воде", FUEL, "slow"],
    ["геркулес", FUEL, "slow"],
    ["цельнозерновой хлеб", FUEL, "slow"],
    ["бурый рис", FUEL, "slow"],
    ["чечевица", FUEL, "slow"],
    ["перловка", FUEL, "slow"],
    ["гречневая каша", FUEL, "slow"],
    // neutral defaults
    ["картофель отварной", FUEL, "neutral"],
    ["макароны", FUEL, "neutral"],
    ["рис", FUEL, "neutral"],
    ["неведомая еда", FUEL, "neutral"],
    // gram gate dominates regardless of keyword
    ["кусочек белого хлеба", 5, "not_carb_base"],
    ["гречка (ложка на пробу)", 8, "not_carb_base"],
  ];
  for (const [name, carbs, expected] of cases) {
    const actual = classifyCarbItem(name, carbs);
    assert.equal(actual, expected, `classifyCarbItem("${name}", ${carbs}) → ${actual}, ожидалось ${expected}`);
  }
  // Cyrillic boundary sanity (урок забегов): ASCII \b would miss these.
  assert.equal(classifyCarbItem("гречка", FUEL), "slow", "«гречка» должна матчиться (Unicode boundary)");
  assert.equal(classifyCarbItem("овсянка", FUEL), "slow", "«овсянка» должна матчиться");
  // "минут" must NOT trigger the legume "нут" stem (leading boundary).
  assert.equal(classifyCarbItem("через пару минут", FUEL), "neutral", "«минут» не должно матчить нут");
  // "грецкий орех" (walnut) must NOT match "греч".
  assert.equal(classifyCarbItem("грецкий орех", FUEL), "neutral", "«грецкий» (ц) не путать с «греч» (ч)");
}

// ── 2. Guard carb_quality_mismatch ────────────────────────────────────────────
const guardFacts: NutritionDayProseFacts = {
  kcal: 2200,
  proteinG: 100,
  fatG: 60,
  carbsG: 300,
  carbsGPerKg: 4.2,
  proteinGPerKg: 1.5,
  nutritionStatus: null,
  findings: [],
  // Only FAST foods reach the guard list (neutral рис/паста/картофель are a coach
  // idiom under "медленные углеводы" and held on the prompt rule, not the guard).
  carbFastFoods: ["банан", "лаваш"],
};

// 2a. fast item called "медленный" → flagged
{
  const issues = validateNutritionDayProse({
    prose: "Банан — это медленные углеводы, хороший выбор перед сном.",
    facts: guardFacts,
  });
  assert.ok(hasError(issues, "carb_quality_mismatch"), "«банан — медленные углеводы» должно ловиться");
}

// 2b. listing a fast item among "медленные" → flagged
{
  const issues = validateNutritionDayProse({
    prose: "Добавь медленные углеводы: лаваш, рис, картофель.",
    facts: guardFacts,
  });
  assert.ok(hasError(issues, "carb_quality_mismatch"), "лаваш в списке «медленные» должно ловиться");
}

// 2c. a genuinely slow item NOT in the guard list, called медленный → passes
{
  const issues = validateNutritionDayProse({
    prose: "Гречка — это медленные углеводы, отличная база.",
    facts: guardFacts,
  });
  assert.ok(!hasError(issues, "carb_quality_mismatch"), "«гречка — медленная» должна проходить (slow)");
}

// 2d. timing phrase "быстрые углеводы перед стартом" → NOT policed
{
  const issues = validateNutritionDayProse({
    prose: "Перед стартом нужны лёгкие быстрые углеводы — банан или тост.",
    facts: guardFacts,
  });
  assert.ok(!hasError(issues, "carb_quality_mismatch"), "timing «быстрые углеводы» не должно ловиться");
}

// 2e. contrastive sentence (fast item correctly called fast) → NOT flagged
{
  const issues = validateNutritionDayProse({
    prose: "Гречка медленная, а банан быстрый — разные углеводы.",
    facts: guardFacts,
  });
  assert.ok(!hasError(issues, "carb_quality_mismatch"), "контраст «а банан быстрый» не должно ловиться");
}

// 2f. no guard list → no false positives
{
  const issues = validateNutritionDayProse({
    prose: "Медленные углеводы держи вокруг тренировок.",
    facts: { ...guardFacts, carbFastFoods: [] },
  });
  assert.ok(!hasError(issues, "carb_quality_mismatch"), "без guard-списка свободное «медленные» не ловится");
}

// 2g. neutral idiom ("медленные углеводы - рис, паста, картофель") → NOT policed.
//     Real day_prose false-cut 4/9 when neutral was guarded (урок #1); fast-only fixes it.
{
  const issues = validateNutritionDayProse({
    prose: "Медленные углеводы - рис, гречка, паста, картофель, хлеб - в каждом приёме.",
    facts: guardFacts, // рис/паста/картофель are neutral → not in carbFastFoods
  });
  assert.ok(!hasError(issues, "carb_quality_mismatch"), "neutral рис/паста/картофель как «медленные» — идиома, не ловить");
}

// ── 3. End-to-end: facts builder → guard names from items_notable ─────────────
{
  const facts = buildNutritionDayProseFacts({
    actual: { kcal: 2200, proteinG: 100, fatG: 60, carbsG: 300, carbsGPerKg: 4.2 },
    nutrition_status: null,
    findings: [],
    items_notable: {
      carb_foods: [
        { name: "банан", carb_class: "fast" },
        { name: "гречка", carb_class: "slow" },
        { name: "картофель", carb_class: "neutral" },
      ],
      by_section: {
        breakfast: [{ name: "лаваш", fat_contributor: false, carb_contributor: true, carb_class: "fast" }],
      },
    },
  });
  const names = facts.carbFastFoods ?? [];
  assert.ok(names.includes("банан"), "fast «банан» должен попасть в guard-список");
  assert.ok(names.includes("лаваш"), "fast «лаваш» из by_section должен попасть в guard-список");
  assert.ok(!names.includes("картофель"), "neutral «картофель» НЕ в guard-списке (идиома, держим на промпте)");
  assert.ok(!names.includes("гречка"), "slow «гречка» НЕ должна попадать в guard-список");
}

console.log("check-nutrition-carb-quality: OK");
