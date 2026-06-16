import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Наряд 2 (свой режим): a coach-controlled per-student flag replaces the hardcoded
// surname check for "don't treat calories/fat as a problem" (layer A: tone only,
// no number override). Verified statically end-to-end.

const root = process.cwd();
const repo = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");
const context = readFileSync(join(root, "src/features/nutrition/context.ts"), "utf8");
const draft = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const page = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20260616130000_add_nutrition_own_regime.sql"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

// 1. Migration adds the column.
assert.match(migration, /add column if not exists own_regime boolean not null default false/, "migration adds own_regime");

// 2. Repository: type + row + map + upsert (preserve-on-undefined like other optional cols).
assert.match(repo, /ownRegime: boolean;/, "profile type has ownRegime");
assert.match(repo, /own_regime: boolean \| null;/, "row type has own_regime");
assert.match(repo, /ownRegime: row\.own_regime === true/, "map reads own_regime");
assert.match(repo, /own_regime: input\.ownRegime === undefined \? undefined : input\.ownRegime/, "upsert preserves own_regime when omitted");

// 3. The hardcoded surname override is GONE; fat override is driven by the flag.
assert.doesNotMatch(context, /NUTRITION_FAT_COACH_ONLY_STUDENT_NAMES/, "hardcoded surname list must be removed");
assert.doesNotMatch(context, /\/polyakova\/i/, "no hardcoded polyakova fat override");
assert.match(context, /export function applyNutritionFatPolicyOverrides<[\s\S]*?>\(\s*ownRegime: boolean/, "fat override takes the ownRegime flag");
assert.match(context, /applyNutritionFatPolicyOverrides\(\s*essentials\.profile\?\.ownRegime \?\? false/, "context drives fat override from the flag");
assert.match(context, /ownRegime: essentials\.profile\?\.ownRegime \?\? false/, "context carries ownRegime");

// 4. Generation: flag in facts + prompt rule (layer A — tone, not numbers).
assert.match(draft, /own_regime: input\.context\.ownRegime/, "facts carry own_regime");
assert.match(draft, /СВОЙ РЕЖИМ \(student\.own_regime=true\)/, "prompt has the own-regime rule");
assert.match(draft, /НЕ оценивай калорийность и жир как проблему/, "own-regime rule must suppress calorie/fat criticism");
assert.match(draft, /Это НЕ снимает safety/, "own-regime must not bypass safety");

// 5. UI + action wiring.
assert.match(actions, /ownRegime: parseBoolean\(getOptionalFormValue\(formData, "ownRegime"\), false\)/, "save action reads ownRegime");
assert.match(page, /name="ownRegime"/, "profile form exposes the own-regime checkbox");
assert.match(page, /Свой режим питания — не оценивать калорийность\/жир как проблему/, "checkbox is labeled");

assert.match(packageJson, /check:nutrition-own-regime/, "package.json registers this check");

console.log("PASS check-nutrition-own-regime");
