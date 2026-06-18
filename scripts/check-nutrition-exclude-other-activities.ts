import assert from "node:assert/strict";

import { isNutritionExcludedOtherActivity } from "@/features/nutrition/context";

// Часть Ю: when a student's profile flag exclude_other_activities is on, the
// nutrition week-context drops TP "Other"/"Custom" activities before anything else
// sees them (buildNutritionTrainingPeaksWeekContext) — so they affect neither
// expenditure (Part Б summation) nor the review text. A day left with no other
// session then reads as a normal rest day.
//
// The discriminator must key on the RAW TP type, not the activity classifier's
// family: her 2-hour sessions are TP-typed "Other" but may be TITLED "Силовая",
// and the classifier lets a strength title win (→ family "strength"). So a
// strength-titled, Other-typed session MUST still be excluded.

type W = { title: string | null; sportOrTypeCode: string | null; workoutTypeValueId: number | null; workoutSubTypeId: number | null };
const ex = (w: W) => isNutritionExcludedOtherActivity(w);

const otherTypedStrengthTitle: W = { title: "Силовая 2ч", sportOrTypeCode: "Other", workoutTypeValueId: null, workoutSubTypeId: null };
const otherNeutralTitle: W = { title: "Тренировка", sportOrTypeCode: "Other", workoutTypeValueId: null, workoutSubTypeId: null };
const customTyped: W = { title: "Реабилитация", sportOrTypeCode: "Custom", workoutTypeValueId: null, workoutSubTypeId: null };
const easyRun: W = { title: "Лёгкий бег 5 км", sportOrTypeCode: "Run", workoutTypeValueId: null, workoutSubTypeId: null };
const realStrength: W = { title: "Strength", sportOrTypeCode: "Strength", workoutTypeValueId: 9, workoutSubTypeId: null };

// 1. Excluded: TP type Other/Custom — even when the title says "Силовая".
assert.equal(ex(otherTypedStrengthTitle), true, "TP-тип Other + тайтл «Силовая» → исключается (тайтл не обманывает)");
assert.equal(ex(otherNeutralTitle), true, "TP-тип Other, нейтральный тайтл → исключается");
assert.equal(ex(customTyped), true, "TP-тип Custom → исключается");

// 2. Kept: real run / real strength (not Other-typed) — Part Б summation unchanged.
assert.equal(ex(easyRun), false, "бег НЕ исключается (остаётся, считается)");
assert.equal(ex(realStrength), false, "настоящая силовая (type Strength) НЕ исключается");

// 2bis. Юлия, флаг ON: беговая сессия с НЕСТАНДАРТНЫМ тайтлом (type Run) → НЕ под
//       дискриминатор other → остаётся в расходе и тексте.
const runWeirdTitle: W = { title: "Утренняя движуха по парку", sportOrTypeCode: "Run", workoutTypeValueId: null, workoutSubTypeId: null };
assert.equal(ex(runWeirdTitle), false, "бег с нестандартным тайтлом (type Run) → НЕ исключается, остаётся");
assert.deepEqual([runWeirdTitle].filter((w) => !ex(w)).map((w) => w.title), ["Утренняя движуха по парку"], "бег остаётся после фильтра при флаге ON");

// 3. "минут"/слова с "other" внутри не должны ложно матчить (граница).
assert.equal(ex({ title: "Brotherhood run", sportOrTypeCode: "Run", workoutTypeValueId: null, workoutSubTypeId: null }), false, "«Brotherhood» не матчит other (граница слова)");

// 4. The filter semantics: run + Other day → only run; only-Other day → empty → rest.
const day = [easyRun, otherTypedStrengthTitle];
const kept = day.filter((w) => !ex(w));
assert.deepEqual(kept.map((w) => w.title), ["Лёгкий бег 5 км"], "бег+Other → остаётся только бег");
const onlyOther = [otherTypedStrengthTitle, customTyped].filter((w) => !ex(w));
assert.equal(onlyOther.length, 0, "день только-Other → пусто → rest/maintenance");

console.log("check-nutrition-exclude-other-activities: OK");
