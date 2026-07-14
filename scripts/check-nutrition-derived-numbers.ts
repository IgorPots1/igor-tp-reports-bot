import assert from "node:assert/strict";

import { buildNutritionDayProseFacts } from "@/features/nutrition/combined-message";
import { validateNutritionDayProse } from "@/features/nutrition/telegram-renderer";

// The prose validator kills a whole day when it finds a number that is not a fact of that day.
// That is the right instinct — an invented gram figure reaches a real athlete — but it was also
// killing prose that was CORRECT, and the day fell to the dry deterministic comment:
//
//   «под 8 интервалов по 4 минуты углеводов маловато»  → 8 was policed as an invented macro
//   «13-километровый бег»                              → the scrub knew «км», not «километровый»
//   «при ориентире около 300 г — недобор примерно 125» → 300−175, arithmetic the model must do
//   «картофель дал 64 г углеводов»                     → a real macro of a real item of her diary
//
// Measured on 293 real days across 20 athletes: 22 rejections, of which 11 were of this kind.
// Every fix below allows only numbers the CODE already knows. Invented numbers still die.

const buildDay = (over: Record<string, unknown> = {}) => ({
  date: "2026-07-09",
  training_label: "8 х 4 мин",
  actual_kcal: 1800,
  protein_g: 90,
  fat_g: 60,
  carbs_g: 175,
  nutrition_status: "low_carbs",
  findings: [],
  target: { carbsGMin: 295, carbsGMax: 305, kcalTarget: 2000 },
  items_notable: {
    by_section: {
      dinner: [{ name: "Boiled Potato", carbs_g: 64, fat_g: 1, protein_g: 3, kcal: 280 }],
    },
  },
  ...over,
});

const verdict = (prose: string, day: Record<string, unknown> = buildDay()) =>
  validateNutritionDayProse({ prose, facts: buildNutritionDayProseFacts(day) }).filter((i) => i.severity === "error");

// ─── 1. the difference the model computes from the ROUNDED orientation it just quoted ───
// The corridor is 295–305 → the model says «около 300» and subtracts from THAT: 300 − 175 = 125.
// The RAW difference (300 − 175 = 125 via mid, but 295 − 175 = 120) never rounds to 125 — 120 is
// already a multiple of 5 and 10 — so the day died for arithmetic that is correct.
assert.equal(verdict("Углеводы 175 г при ориентире около 300 г - недобор примерно 125 г.").length, 0, "the real gap passes");

// …and an invented gap still dies. 500 is not the distance to any real bound.
assert.ok(
  verdict("Углеводы 175 г при ориентире около 300 г - недобор примерно 500 г.").length > 0,
  "an invented gap is still refused — the guard is not loosened, only made honest"
);

// ─── 2. the session's own numbers, read off the CODE-OWNED training label ───
assert.equal(verdict("Под 8 интервалов по 4 минуты углеводов маловато.").length, 0, "the interval count passes");
// The count is POLICED, not scrubbed: she ran 8, not 12. Saying 12 is a lie about her own training.
assert.ok(verdict("Под 12 интервалов по 4 минуты углеводов маловато.").length > 0, "a wrong interval count is refused");

// «километр…» does not start with «км» — it starts with «ки». The abbreviation and the spelled-out
// word share no prefix, so «12 км» was scrubbed and «13-километровый» was not.
assert.equal(verdict("После 13-километрового бега углеводов было мало.").length, 0, "a spelled-out distance passes");
assert.equal(verdict("Почти 10-километровым бегом день закрыт.").length, 0, "…in the adjective form too");

// ─── 3. per-item macros: her own diary, her own products ───
assert.equal(verdict("Картофель дал 64 г углеводов - но этого мало.").length, 0, "a real item macro passes");
assert.ok(verdict("Картофель дал 190 г углеводов.").length > 0, "an invented item macro is still refused");
// The rounding the model actually writes («около 65») is allowed; a distant number is not.
assert.equal(verdict("Картофель дал около 65 г углеводов.").length, 0, "the display rounding of an item macro passes");

// ─── 4. INVENTED ORIENTATIONS STAY REFUSED (coach's decision, 2026-07-14) ───
// «хотелось бы около 90 г», «ориентир 360–400 г» — the model making up a target. If it wants to
// name a goal it must use the real one: we already give it the corridor and kcalTarget. Otherwise
// it starts inventing orientations, and the athlete cannot tell them from the methodology.
assert.ok(verdict("Белок 90 г - маловато, хотелось бы около 145 г.").length > 0, "an invented target is refused");
// …while the day's REAL orientation passes, exactly as before.
assert.equal(verdict("Ориентир по углеводам 295-305 г, ты ниже.").length, 0, "the real corridor still passes");
assert.equal(verdict("Ориентир дня около 2000 ккал.").length, 0, "the real energy target still passes");

// ─── 5. a ±1 g ROUNDING SLIP on a diary macro is still HER number ───
// The model read 106.42 g of protein and wrote «белок 107 г» — rounded the wrong way by 0.58 g,
// and the whole day fell to the dry comment. The cost is absurdly out of proportion to the harm.
const roundingDay = buildDay({ protein_g: 106.42, carbs_g: 307.39, actual_kcal: 2088 });
assert.equal(verdict("Белок 107 г - закрыт хорошо.", roundingDay).length, 0, "a ±1 rounding slip passes");
assert.equal(verdict("Белок 106 г - закрыт хорошо.", roundingDay).length, 0, "…and so does the correct rounding");

// The slack is anchored to HER macros — it is a tolerance, not a licence to invent.
assert.ok(verdict("Белок 190 г - отлично.", roundingDay).length > 0, "an invented macro is still refused");
assert.ok(
  verdict("Белок 109 г - закрыт хорошо.", roundingDay).length > 0,
  "the slack is ±1, not ±3 — a number that far from any real macro still dies"
);

console.log("PASS check-nutrition-derived-numbers");
