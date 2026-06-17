import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Coach-initiated, per-report safety override: a hard safety block can be
// consciously released by the coach for ONE report. The athlete text is then
// generated but MUST honestly flag the dangerous low-kcal days; the global
// threshold is untouched, safety_flags.blocked stays true (honest record), and
// the result is needs_review (never auto-sent).

const root = process.cwd();
const draft = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
const admin = readFileSync(join(root, "src/features/nutrition/admin.ts"), "utf8");
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const page = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

// 1. Generation honours the override but keeps the truth.
assert.match(draft, /coachSafetyOverride\?: boolean/, "generateNutritionWeeklyAnalysis accepts coachSafetyOverride");
assert.match(draft, /const overrideActive = Boolean\(input\.coachSafetyOverride\) && safety\.blocked/, "override only when actually blocked");
assert.match(draft, /const effectiveBlocked = safety\.blocked && !overrideActive/, "effectiveBlocked drives gating");
assert.match(draft, /blocked: safety\.blocked,\s*\n\s*coach_override: overrideActive,/, "returned safety_flags keep blocked=true + expose coach_override");
// Status: override → needs_review, never blocked_safety.
assert.match(draft, /const status = effectiveBlocked\s*\n\s*\? "blocked_safety"\s*\n\s*: overrideActive \|\|/, "override → needs_review, not blocked_safety");
// The honest danger prompt rule.
assert.match(draft, /COACH-OVERRIDE БЛОКА \(safety_flags\.coach_override=true\)/, "prompt rule for coach override");
assert.match(draft, /опасно для здоровья и восстановления — так держать нельзя/, "override text honestly flags the danger");
assert.match(draft, /override_low_kcal_days/, "the dangerous low-kcal days are passed to the model");

// 2. Admin threads it + maps status without ever calling it blocked when overridden.
assert.match(admin, /coachSafetyOverride: input\.coachSafetyOverride/, "admin passes coachSafetyOverride to generation");
assert.match(admin, /const blockedHard = generated\.safety_flags\.blocked && !generated\.safety_flags\.coach_override/, "blockedHard excludes the override");
assert.match(admin, /coach safety override applied/, "override is logged");

// 3. Action reads the explicit coach flag.
assert.match(actions, /coachSafetyOverride: parseBoolean\(getOptionalFormValue\(formData, "coachSafetyOverride"\), false\)/, "action reads coachSafetyOverride");

// 4. UI: explicit, confirmed override button, only in the blocked-safety state.
assert.match(page, /name="coachSafetyOverride" value="true"/, "override button submits the explicit flag");
assert.match(page, /Выпустить с пояснением \(override\)/, "override button labeled");
assert.match(page, /ConfirmSubmitButton[\s\S]*?confirmMessage="Выпустить разбор поверх блока безопасности/, "override requires confirmation");

assert.match(packageJson, /check:nutrition-safety-override/, "package.json registers this check");

console.log("PASS check-nutrition-safety-override");
