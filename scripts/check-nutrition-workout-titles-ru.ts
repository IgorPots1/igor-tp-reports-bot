import assert from "node:assert/strict";

import { formatAthleteWorkoutTitleRu, normalizeTrainingType } from "@/features/nutrition/methodology";
import { normalizeMixedScriptHomoglyphs, simplifyAthleteWording } from "@/features/nutrition/telegram-renderer";

// TrainingPeaks activity names arrive in English and used to reach the athlete verbatim:
// «Walking», «Pilates», «Lap Swimming», and combined days like «бег + Pilates». 39 real days
// across 20 athletes carried an English workout name. The model also quoted «HIIT» — not
// because it invented it, but because we handed it the RAW title in its own prompt.
//
// The list below is the one taken from the DATA, not invented. Anything unknown still falls
// through unchanged: a raw name is better than a wrong translation.

// ─── every English name actually seen in the athletes' TrainingPeaks calendars ───
const FROM_TP: Array<[string, string]> = [
  ["Strength", "силовая"],
  ["Running", "бег"],
  ["Padel Racket", "падел"],
  ["Hiit", "силовая"],
  ["Walking", "ходьба"],
  ["Pilates", "пилатес"],
  ["Yoga", "йога"],
  ["Cycling", "велотренировка"],
  ["Lap Swimming", "плавание"],
  ["Open Water Swimming", "плавание на открытой воде"],
  ["Kayaking", "каякинг"],
  ["Elliptical", "эллипс"],
];
for (const [raw, ru] of FROM_TP) {
  assert.equal(formatAthleteWorkoutTitleRu(raw), ru, `«${raw}» must reach the athlete as «${ru}»`);
}

// Open water must be checked BEFORE the generic swim rule, or it collapses to plain «плавание».
assert.notEqual(
  formatAthleteWorkoutTitleRu("Open Water Swimming"),
  formatAthleteWorkoutTitleRu("Lap Swimming"),
  "open water is not the same as the pool"
);

// A name we have never seen falls through UNCHANGED — better raw than wrongly translated.
assert.equal(formatAthleteWorkoutTitleRu("Rowing Machine"), "Rowing Machine", "unknown names are left alone");
// A Russian title is left alone too (the athlete's own wording wins).
assert.equal(formatAthleteWorkoutTitleRu("6 х 3 мин"), "6 х 3 мин", "an interval title is not a name to translate");

// The last Latin left in the labels was the multiplication sign: «8 x 4 мин». The words are
// Russian; only the glyph was foreign. Swapped BETWEEN DIGITS ONLY.
assert.equal(formatAthleteWorkoutTitleRu("8 x 4 мин"), "8 х 4 мин", "the times sign becomes Cyrillic");
assert.equal(formatAthleteWorkoutTitleRu("2 x 800"), "2 х 800");
assert.equal(formatAthleteWorkoutTitleRu("7 x 5 / 2 мин"), "7 х 5 / 2 мин");
assert.equal(formatAthleteWorkoutTitleRu("Rowing x"), "Rowing x", "a lone x is not a multiplication sign");
// …and it must not move the day's type: the classifier reads the RAW title and accepts both.
assert.equal(normalizeTrainingType("other", "8 x 4 мин"), normalizeTrainingType("other", "8 х 4 мин"));

// Combined days: the day label maps EVERY session through this function, so each part must
// translate on its own — «бег + Pilates» and «Lap Swimming + Pilates» were what the athlete saw.
assert.equal(formatAthleteWorkoutTitleRu("Бег"), "бег");
assert.equal(formatAthleteWorkoutTitleRu("Pilates"), "пилатес");

// ─── CLASSIFICATION MUST NOT MOVE. This is a LABEL, nothing else. ───
// normalizeTrainingType runs on the RAW session title, before the day's titles are merged
// through the translator, so it can never see the translation. Pinned because a day silently
// changing type would move its carb corridor and its expenditure.
assert.equal(normalizeTrainingType("other", "Hiit"), "strength", "HIIT is a strength session (no HIIT mode on a watch)");
assert.equal(normalizeTrainingType("other", "HIIT-силовая"), "strength", "…and so is «HIIT-силовая»");
// The exception survives: a REAL interval structure in the title still wins over HIIT.
assert.equal(
  normalizeTrainingType("other", "HIIT 6 х 3 мин"),
  "intervals",
  "a real interval structure beats HIIT — the exception must stay"
);
assert.equal(normalizeTrainingType("other", "Walking"), "cross_training", "«Walking» is still a cross day");
assert.equal(normalizeTrainingType("other", "Lap Swimming"), "cross_training", "«Lap Swimming» is still a cross day");

// ─── the net: if the model writes «HIIT» from memory anyway ───
// ⚠️ THE TRAP: a GLUED separator is a compound word, a spaced dash is PUNCTUATION.
// «Среда - HIIT с утра» must keep its dash — eat it and the sentence loses its predicate.
const NET: Array<[string, string]> = [
  ["Четверг - силовая/HIIT.", "Четверг - силовая."],
  ["Четверг - силовая-HIIT.", "Четверг - силовая."],
  ["Четверг - HIIT-силовая.", "Четверг - силовая."],
  ["Четверг - HIIT/силовая.", "Четверг - силовая."],
  ["Среда - HIIT с утра.", "Среда - силовая с утра."],
  ["Среда - ХИИТ с утра.", "Среда - силовая с утра."],
];
for (const [before, after] of NET) {
  assert.equal(simplifyAthleteWording(before), after, `«${before}» → «${after}»`);
}
assert.match(
  simplifyAthleteWording("Среда - HIIT с утра."),
  /Среда - силовая/,
  "the sentence dash SURVIVES — removing it would strip the predicate"
);

// The homoglyph guard is about GLITCHES, not language: it must still leave brands and units
// alone. Translating an anglicism there would corrupt exactly what it exists to protect.
assert.equal(normalizeMixedScriptHomoglyphs("VO2 и 5 km"), "VO2 и 5 km", "brands and units stay untouched");

console.log("PASS check-nutrition-workout-titles-ru");
