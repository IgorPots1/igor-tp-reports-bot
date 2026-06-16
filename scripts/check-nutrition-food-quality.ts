import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const packageJson = readFileSync(join(root, "package.json"), "utf8");
assert.match(packageJson, /check:nutrition-food-quality/, "package.json registers this check");

console.log("PASS check-nutrition-food-quality");
