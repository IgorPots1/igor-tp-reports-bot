import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { applyNutritionCoachEdits } from "@/features/nutrition/combined-message";
import { parseNutritionCoachEdits } from "@/features/nutrition/repository";
import type { NutritionCoachEdits, NutritionWeeklyAnalysis } from "@/features/nutrition/repository";

// Coach edits live in the coach_edits OVERLAY, deliberately OUTSIDE nutrition_summary.
//
// Why this check exists: a regeneration upserts nutrition_summary wholesale, so an edit
// stored inside it was destroyed silently and without a trace — it happened for real
// (Ponomareva, 2026-07-10: an agent's generation run overwrote the coach's edit minutes
// after he saved it, and the preview honestly showed the model text back).
//
// Two things are pinned here: the merge behaviour, and the STRUCTURAL invariant that
// regeneration cannot touch the overlay. Break either and coach edits start dying again.

function buildReview(input: {
  prose: Record<string, string>;
  coachEdits: NutritionCoachEdits | null;
  focus?: string;
  opening?: string;
}): NutritionWeeklyAnalysis {
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
      one_focus: { statement_ru: input.focus ?? "фокус от модели" },
      athlete_opening_note_ru: input.opening ?? "открытие от модели",
      daily_analysis: Object.entries(input.prose).map(([date, prose]) => ({
        date,
        athlete_prose: prose,
        // The stored day also carries an embedded canonical copy, and the normalizer reads
        // `source.athlete_prose ?? item.athlete_prose` — the embed WINS when it has the field.
        canonicalDailyAnalysis: { date, athlete_prose: prose },
      })),
    },
    safetyFlags: {},
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: null,
    athleteMessageDraft: null,
    coachEdits: input.coachEdits,
    archivedAt: null,
    createdAt: "2026-07-13T10:00:00Z",
    updatedAt: "2026-07-13T10:00:00Z",
  };
}

const days = (review: NutritionWeeklyAnalysis) =>
  (review.nutritionSummary.daily_analysis as Array<Record<string, unknown>>).reduce<Record<string, unknown>>(
    (acc, day) => {
      acc[String(day.date)] = day;
      return acc;
    },
    {}
  );

// ─── the merge ───
const MODEL = { "2026-07-10": "Пятница - модельный текст.", "2026-07-11": "Суббота - модельный текст." };

const edited = applyNutritionCoachEdits(
  buildReview({ prose: MODEL, coachEdits: { day_prose: { "2026-07-10": "Пятница - правка тренера." } } })
);
assert.equal(days(edited)["2026-07-10"].athlete_prose, "Пятница - правка тренера.", "overlay wins for the edited day");
assert.equal(days(edited)["2026-07-11"].athlete_prose, MODEL["2026-07-11"], "an untouched day keeps the model text");

// The embedded canonical copy must carry the coach's text too — the normalizer prefers the
// embed, so writing only the outer field would let a stale model line shadow the edit.
const embedded = days(edited)["2026-07-10"].canonicalDailyAnalysis as Record<string, unknown>;
assert.equal(embedded.athlete_prose, "Пятница - правка тренера.", "the embedded canonical copy is overlaid too");

// ─── absence of a key IS the flag: no edited_by_coach field exists anywhere ───
const untouched = buildReview({ prose: MODEL, coachEdits: null });
assert.equal(
  applyNutritionCoachEdits(untouched),
  untouched,
  "no overlay → the very same object comes back (no clone, no change)"
);
const partial = applyNutritionCoachEdits(buildReview({ prose: MODEL, coachEdits: { day_prose: {} } }));
assert.equal(days(partial)["2026-07-10"].athlete_prose, MODEL["2026-07-10"], "an empty overlay changes nothing");

// ─── focus and opening ride the same overlay ───
const withHeader = applyNutritionCoachEdits(
  buildReview({
    prose: MODEL,
    coachEdits: { one_focus_statement_ru: "фокус тренера", athlete_opening_note_ru: "открытие тренера" },
  })
);
assert.equal(
  (withHeader.nutritionSummary.one_focus as Record<string, unknown>).statement_ru,
  "фокус тренера",
  "the focus line is overlaid"
);
assert.equal(withHeader.nutritionSummary.athlete_opening_note_ru, "открытие тренера", "the opening note is overlaid");

// ─── idempotent: entry points may apply it defensively without coordinating ───
const once = applyNutritionCoachEdits(
  buildReview({ prose: MODEL, coachEdits: { day_prose: { "2026-07-10": "правка" } } })
);
assert.deepEqual(applyNutritionCoachEdits(once).nutritionSummary, once.nutritionSummary, "applying twice is a no-op");

// ─── the model's text is never mutated in place ───
const original = buildReview({ prose: MODEL, coachEdits: { day_prose: { "2026-07-10": "правка" } } });
applyNutritionCoachEdits(original);
assert.equal(
  days(original)["2026-07-10"].athlete_prose,
  MODEL["2026-07-10"],
  "the stored review is left untouched — the merge returns a copy"
);

// ─── the overlay survives a regeneration: same coachEdits, brand-new summary ───
const regenerated = applyNutritionCoachEdits(
  buildReview({
    prose: { "2026-07-10": "Пятница - СВЕЖИЙ текст после перегенерации." },
    coachEdits: { day_prose: { "2026-07-10": "Пятница - правка тренера." } },
  })
);
assert.equal(
  days(regenerated)["2026-07-10"].athlete_prose,
  "Пятница - правка тренера.",
  "a regeneration rewrites athlete_prose, and the coach's edit still wins — the whole point"
);

// ─── the parser tolerates the column before AND after the migration ───
assert.deepEqual(parseNutritionCoachEdits({ day_prose: { "2026-07-10": "x" } }), { day_prose: { "2026-07-10": "x" } });
assert.deepEqual(
  parseNutritionCoachEdits('{"day_prose":{"2026-07-10":"x"}}'),
  { day_prose: { "2026-07-10": "x" } },
  "still a text column (code shipped before the migration) → parsed, not crashed"
);
assert.equal(parseNutritionCoachEdits(null), null);
assert.equal(parseNutritionCoachEdits(""), null);
assert.equal(parseNutritionCoachEdits("не json"), null, "garbage degrades to no-overlay, never to a throw");
assert.equal(parseNutritionCoachEdits({ day_prose: { "2026-07-10": "   " } }), null, "a blank override is no override");

// ─── STRUCTURAL: regeneration must not be able to touch the overlay ───
const repositorySource = readFileSync(join(process.cwd(), "src/features/nutrition/repository.ts"), "utf8");

const upsertBlock = repositorySource.slice(
  repositorySource.indexOf("export async function createNutritionWeeklyAnalysis"),
  repositorySource.indexOf("export async function createNutritionWeeklyAnalysis") + 2000
);
assert.ok(
  !/coach_edits/.test(upsertBlock),
  "createNutritionWeeklyAnalysis must NOT send coach_edits: it upserts on (student_id, week_from, week_to), so any " +
    "column it sends is overwritten on regeneration. Sending coach_edits — even as null — destroys every coach edit."
);

const updateBlock = repositorySource.slice(
  repositorySource.indexOf("export async function updateNutritionReviewProse"),
  repositorySource.indexOf("export async function updateNutritionReviewProse") + 3000
);
assert.ok(
  /\.update\(\{ coach_edits:/.test(updateBlock),
  "updateNutritionReviewProse must write the OVERLAY column"
);
assert.ok(
  !/nutrition_summary:/.test(updateBlock),
  "updateNutritionReviewProse must NOT write nutrition_summary — that is the blob regeneration overwrites"
);

console.log("PASS check-nutrition-coach-edits-overlay");
