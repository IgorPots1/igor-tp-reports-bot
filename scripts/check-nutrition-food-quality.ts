import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computePreWorkoutCarbsFromDiary } from "@/features/nutrition/draft-generator";

// Наряд 1 (quality of food): advice must distinguish carb QUALITY by principle
// (praise whole sources, never call sweets/baking/alcohol "good"), and suggest
// INCREASING an already-eaten whole-carb portion rather than blindly "add more".
// Both are prompt principles in the review generator — verified statically so the
// rule can't silently regress (behaviour is shown by the live checkpoint).

const root = process.cwd();
const draft = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");

// --- Carb-quality principle (цель 2) -----------------------------------------
assert.match(draft, /КАЧЕСТВО УГЛЕВОДОВ — это ПРИНЦИП/, "quality must be a principle, not a finite list");
// Praises whole sources.
for (const whole of ["крупы", "рис", "картофель", "паста", "бобовые", "овощи"]) {
  assert.ok(draft.includes(whole), `quality rule must name whole source: ${whole}`);
}
// Refuses to praise refined/sweet/alcohol sources even when they add carbs.
for (const refined of ["кондитерку", "мороженое", "конфеты", "халву", "газировку", "фастфуд", "алкоголь/пиво"]) {
  assert.ok(draft.includes(refined), `quality rule must cover refined source: ${refined}`);
}
assert.match(draft, /ДАЖЕ если они дали много углеводов/, "refined carbs must not be praised even when they hit the number");
// Supportive, not shaming.
assert.match(draft, /НЕ стыдящий[\s\S]*НЕ упрекай/, "tone must be supportive, never shaming");
assert.match(draft, /лучше взять из крупы\/риса\/фрукта/, "may gently suggest replacement, not scold");

// --- Advice-from-real-food principle (цель 1) --------------------------------
assert.match(draft, /СОВЕТ ОТ РЕАЛЬНОЙ ЕДЫ/, "advice must be grounded in what was actually eaten");
assert.match(draft, /УВЕЛИЧИТЬ ПОРЦИЮ того, что уже ел/, "must advise increasing an already-eaten portion");
assert.match(draft, /НЕ «добавь кашу», когда каша уже есть/, "must not suggest adding food that is already present");
assert.match(draft, /Новый продукт предлагай ТОЛЬКО если подходящего цельного источника в дне не было/, "new food only when the category is absent");

// The legacy free-naming rule was aligned to "increase or add", not just "add".
assert.match(draft, /увеличь порцию каши\/риса, что уже была, или добавь, если её не было/, "legacy carb-naming rule aligned to increase-or-add");

// --- Grushevskaya Пункт 2: drop "крахмалистое" for natural language -----------
assert.match(draft, /«крахмалистый\/крахмалистое\/крахмалистые\/крахмал» НЕ использовать НИГДЕ/, "must ban крахмалистый everywhere");
assert.match(draft, /медленные углеводы/, "use медленные углеводы with examples instead");

// --- Grushevskaya Пункт 3: low-carb fruit/berry is not a carb source ----------
assert.match(draft, /КОЛИЧЕСТВО углеводов, не «фрукт=углевод»/, "distinguish carbs by quantity, not fruit=carb");
assert.match(draft, /черешня, клубника/, "names low-carb berries as NOT a carb source under load");

// --- Grushevskaya v2 Пункт 1: крахмалистое banned EVERYWHERE -------------------
assert.match(draft, /«крахмалистый\/крахмалистое\/крахмалистые\/крахмал» НЕ использовать НИГДЕ/, "крахмалист banned in every field");

// --- Grushevskaya v2 Пункт 3: pre-workout carbs from the diary (PDF), by load --
assert.match(draft, /ОЦЕНКА ПРЕДТРЕНИРОВОЧНОЙ ЕДЫ \(pre_workout/, "prompt assesses pre-workout food by its carbs vs load");
assert.match(draft, /pre_workout: computePreWorkoutCarbsFromDiary/, "pre_workout attached to day facts");
assert.match(
  readFileSync(join(root, "src/features/nutrition/combined-message.ts"), "utf8"),
  /preWorkoutCarbs/,
  "pre-workout carbs whitelisted for the day-prose number gate"
);
// Numbers come ONLY from the diary: the words give the link, the diary gives grams.
const pre = computePreWorkoutCarbsFromDiary(
  "Среда перед интервалами было nature valley батончик и печенье мюсли. После язык чипсы",
  [
    { name: "Nature Valley Oats & Honey", carbsG: 29.6 } as never,
    { name: "Любятово Печенье Мюсли с Клюквой", carbsG: 18.9 } as never,
    { name: "Язык Говяжий Отварной", carbsG: 0.78 } as never,
  ],
  "intervals",
  60
);
assert.ok(pre && pre.carbs_g === 49, "pre-workout carbs summed from matched diary items (~49 g, from PDF)");
assert.equal(pre!.adequacy, "medium", "49 g / 60 kg before intervals → medium (0.8 g/kg)");
assert.ok(pre!.foods.some((f) => /Nature Valley/i.test(f)) && pre!.foods.some((f) => /Печенье Мюсли/i.test(f)), "matched the pre-workout foods");
assert.ok(!pre!.foods.some((f) => /Язык/i.test(f)), "post-workout food (after 'после') excluded");
// Timing is picked up from the words when present.
const preTimed = computePreWorkoutCarbsFromDiary(
  "перед интервалами за 30 минут банан",
  [{ name: "Банан", carbsG: 27 } as never],
  "intervals",
  60
);
assert.match(preTimed?.timing ?? "", /30 мин/, "pre-workout timing parsed from the words");
// No pre-workout marker → no estimate (no invented numbers).
assert.equal(
  computePreWorkoutCarbsFromDiary("просто ела гречку весь день", [{ name: "Гречка", carbsG: 60 } as never], "rest", 60),
  null,
  "without a pre-workout mention, no pre_workout estimate"
);
// Delivery is qualitative: the prompt must NOT force a gram number.
assert.match(draft, /Подавай КАЧЕСТВЕННО, БЕЗ грамм-числа/, "pre-workout delivery is qualitative (no forced number)");
// Heavy/fatty pre-workout food is flagged for comfort (not shaming).
const preHeavy = computePreWorkoutCarbsFromDiary(
  "перед интервалами пицца и батончик",
  [
    { name: "Пицца 4 сыра", carbsG: 38, fatG: 30 } as never,
    { name: "Батончик", carbsG: 20, fatG: 5 } as never,
  ],
  "intervals",
  60
);
assert.ok(preHeavy?.heavy_foods.some((f) => /Пицца/i.test(f)), "fatty pre-workout food flagged as heavy");
assert.ok(!preHeavy?.heavy_foods.some((f) => /Батончик/i.test(f)), "light item not flagged heavy");
assert.match(draft, /pre_workout\.heavy_foods/, "prompt addresses heavy pre-workout food (comfort, not shaming)");

const packageJson = readFileSync(join(root, "package.json"), "utf8");
assert.match(packageJson, /check:nutrition-food-quality/, "package.json registers this check");

console.log("PASS check-nutrition-food-quality");
