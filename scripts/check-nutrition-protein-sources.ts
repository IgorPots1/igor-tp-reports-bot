import assert from "node:assert/strict";

import { pickProteinAdviceSources } from "@/features/nutrition/draft-generator";
import { getNutritionDayProteinAdviceMismatches } from "@/features/nutrition/combined-message";
import type { NutritionFoodItem } from "@/features/nutrition/context";
import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";

// The reserve protein list (яйца, творог, рыба) is abstract advice the athlete never asked for.
// Real case: Selezneva, 2026-07-11 — her diary held «Блинчики с Курицей и Сыром» (23 г белка) and
// «Куриные Сердечки» (10 г), items_notable knew both, and the prose still said «яйцо к завтраку,
// протеиновый йогурт к ужину» — products she never ate that day. A prompt instruction alone did
// not fix this (verified empirically): a real regeneration with only a prose instruction still
// reached for the reserve list. This is the deterministic fix: code computes the answer
// (protein_advice_sources), the model only phrases it — "код считает, модель пишет".

const item = (name: string, proteinG: number, section: NutritionFoodItem["section"] = "lunch"): NutritionFoodItem => ({
  name,
  section,
  kcal: null,
  fatG: null,
  carbsG: null,
  proteinG,
});

// ─── pickProteinAdviceSources: selection, ranking, dedup ───
const selezneva = [
  item("SPAR Блинчики с Курицей и Сыром", 23, "lunch"),
  item("Чистая Линия Мороженое", 0, "snack"), // not a protein source at all
  item("Глобус Гурмэ Сердечки Куриные Жареные", 10, "dinner"),
  item("Ермолино Колбаса Варёная", 4, "dinner"), // below the protein-contributor floor
];
const sources = pickProteinAdviceSources(selezneva);
assert.equal(sources.length, 2, "only real protein-contributor items are picked");
assert.equal(sources[0].name, "SPAR Блинчики с Курицей и Сыром", "ranked by protein_g descending");
assert.equal(sources[0].protein_g, 23);
assert.equal(sources[1].name, "Глобус Гурмэ Сердечки Куриные Жареные");
assert.equal(sources[1].section, "dinner");

// Deduped by normalized name, capped at 4, and an empty diary yields an empty list — not a
// crash and not an invented source.
assert.equal(pickProteinAdviceSources([item("Курица", 20), item("курица  ", 25)]).length, 1, "deduped");
assert.equal(pickProteinAdviceSources([]).length, 0, "no items → no sources, not an error");
assert.equal(
  pickProteinAdviceSources(Array.from({ length: 10 }, (_, i) => item(`Курица ${i}`, 20 + i))).length,
  4,
  "capped at 4 — a short, scannable list, not a wall of names"
);

// ─── the guard: fires ONLY when advice + real sources + none referenced ───
function buildReviewWithDay(prose: string, adviceSources: Array<{ name: string; protein_g: number; section: string | null }>): NutritionWeeklyAnalysis {
  return {
    id: "analysis-1",
    studentId: "student-1",
    reportId: null,
    weekFrom: "2026-07-06",
    weekTo: "2026-07-12",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {},
    nutritionSummary: {
      daily_analysis: [
        {
          date: "2026-07-11",
          weekday_ru: "суббота",
          training_type: "rest",
          training_label: "день отдыха",
          actual_kcal: 1600,
          protein_g: 61,
          fat_g: 60,
          carbs_g: 200,
          nutrition_status: "ok",
          findings: [],
          athlete_prose: prose,
          items_notable: { protein_advice_sources: adviceSources },
          canonicalDailyAnalysis: { date: "2026-07-11", athlete_prose: prose },
        },
      ],
    },
    safetyFlags: {},
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: null,
    athleteMessageDraft: null,
    coachEdits: null,
    archivedAt: null,
    createdAt: "2026-07-13T10:00:00Z",
    updatedAt: "2026-07-13T10:00:00Z",
  };
}

const SOURCES = [{ name: "Блинчики с Курицей и Сыром", protein_g: 23, section: "lunch" }];

// The exact real failure: advises protein, real sources existed, named neither.
const ignored = buildReviewWithDay(
  "Белок 61 г — это очень мало. Даже небольшие добавки работают: яйцо к завтраку, протеиновый йогурт к ужину.",
  SOURCES
);
assert.equal(getNutritionDayProteinAdviceMismatches(ignored).length, 1, "ignoring a real source is flagged");

// The fixed behaviour: the prose DOES reference her source (paraphrased — the model need not
// quote the label verbatim) → no flag. Matched on a word stem, not an exact string.
const referenced = buildReviewWithDay(
  "Белок 61 г ниже нормы. Куриного было маловато — в следующий раз возьми порцию побольше.",
  SOURCES
);
assert.equal(getNutritionDayProteinAdviceMismatches(referenced).length, 0, "a paraphrased reference does not fire");

// No accusation without evidence: an empty protein_advice_sources means the code found nothing
// to compare against, so the day is never flagged — even if the advice looks generic.
const noEvidence = buildReviewWithDay("Белок маловат, добавь яйцо или творог.", []);
assert.equal(getNutritionDayProteinAdviceMismatches(noEvidence).length, 0, "empty sources → never flagged");

// Not every day is about protein: a day that never advises adding protein is never flagged,
// regardless of what her diary held.
const noAdvice = buildReviewWithDay("Белок 130 г — отлично, закрыт с запасом.", SOURCES);
assert.equal(getNutritionDayProteinAdviceMismatches(noAdvice).length, 0, "no protein advice → nothing to check");

// This is a WARNING, never a rejection: the flagged day's prose is UNCHANGED, not swapped for a
// deterministic fallback — the athlete gets the exact text the coach reviews.
const [mismatch] = getNutritionDayProteinAdviceMismatches(ignored);
assert.ok(mismatch.prose.includes("яйцо к завтраку"), "the shipped prose is untouched by the flag");

console.log("PASS check-nutrition-protein-sources");
