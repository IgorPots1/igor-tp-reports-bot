// Weekly-summary phrase rotation (layer 2). Pure — no DB, no model, no env.
//   npx tsx scripts/check-nutrition-weekly-summary-variety.ts
//
// Locks in the three properties the rotation MUST keep:
//   1. Deterministic — the same week always renders the same text. A Math.random() here would
//      make re-renders of one week disagree and would silently break every check-* that asserts
//      on summary text, so this is the load-bearing invariant.
//   2. Two CONSECUTIVE weeks never reuse a phrase in the same slot — that was the actual
//      complaint («ученица читает то же самое 3-4 недели подряд»).
//   3. Rotation changes WORDING ONLY — never the claim. A clean week must never be handed a
//      problem framing by any variant, and the week-over-week trend line must stay inside its
//      noise band.
import assert from "node:assert/strict";

import { buildNutritionWeeklySummary } from "@/features/nutrition/narrative-composer";

type SummaryInput = Parameters<typeof buildNutritionWeeklySummary>[0];
type Day = SummaryInput["days"][number];

const ROLES = ["easy_run", "key_interval", "rest", "easy_run", "rest", "long_run", "rest"] as const;

function week(weekFrom: string, options?: { carbsStatus?: string; energyIssueDays?: number }): Day[] {
  const base = Date.parse(`${weekFrom}T00:00:00Z`);
  let energyLeft = options?.energyIssueDays ?? 0;
  return ROLES.map((role, i) => {
    const loadDay = role !== "rest";
    const energyIssue = loadDay && energyLeft > 0 ? (energyLeft -= 1, true) : false;
    return {
      date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
      trainingType: loadDay ? "run" : "rest",
      trainingLabel: loadDay ? "бег" : "отдых",
      nutritionStatus: energyIssue ? "low_for_load" : "adequate",
      findings: energyIssue ? ["below_load_energy_floor"] : ["protein_sufficient"],
      macro: {
        proteinStatus: "ok",
        fatStatus: "low",
        fatPercentStatus: null,
        fatG: 50,
        fatPercentEnergy: null,
        carbsStatus: loadDay ? (options?.carbsStatus ?? "ok") : "ok",
        carbsG: 300,
        carbsGPerKg: null,
      },
      hasEnergyIssue: energyIssue,
      roleInfo: { role, isKey: role === "key_interval" || role === "long_run", reason: "check" },
    };
  }) as unknown as Day[];
}

const build = (weekFrom: string, extra?: Partial<SummaryInput>, opts?: Parameters<typeof week>[1]) =>
  buildNutritionWeeklySummary({
    days: week(weekFrom, opts),
    proteinSufficient: true,
    weekSeed: weekFrom,
    ...extra,
  });

const sentences = (text: string) => text.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);

// 1. Deterministic.
assert.equal(build("2026-07-06"), build("2026-07-06"), "same week must always render the same text");
assert.notEqual(
  build("2026-07-06"),
  build("2026-07-13"),
  "different weeks must not render identical text on identical data"
);

// 2. No phrase repeats between consecutive weeks. The key-workouts sentence is excluded: it names
// the actual workouts, so an identical training week legitimately repeats it.
const WEEKS = [
  "2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25",
  "2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22",
];
const texts = WEEKS.map((w) => build(w));
for (let i = 1; i < texts.length; i += 1) {
  const previous = new Set(sentences(texts[i - 1] ?? ""));
  const repeated = sentences(texts[i] ?? "").filter((s) => previous.has(s) && !s.startsWith("Ключев"));
  assert.equal(
    repeated.length,
    0,
    `consecutive weeks ${WEEKS[i - 1]} → ${WEEKS[i]} reuse a phrase: ${repeated.join(" | ")}`
  );
}

// 3a. Wording rotates, the claim does not: a clean week never gets a problem framing, whatever
// variant it draws.
for (const weekFrom of WEEKS) {
  const text = build(weekFrom);
  assert.doesNotMatch(text, /пустым|пустыми|низкими|недобирал|просад|не хватило|маловато/i, `clean week ${weekFrom} must not be framed as a problem`);
  assert.match(text, /Неделя вышла ровной|Неделя собралась хорошо|Ровная неделя/, `clean week ${weekFrom} must get the positive headline`);
}

// 3b. A week with a real shortfall still says so, in every variant it can draw.
for (const weekFrom of WEEKS) {
  const oneOff = build(weekFrom, undefined, { energyIssueDays: 1 });
  assert.match(oneOff, /Неделя держалась ровно|Неделя в целом собрана|Почти вся неделя ровная/, `single off-day week ${weekFrom} must keep the singular framing`);
  assert.doesNotMatch(oneOff, /дни с нагрузкой .{0,40}(пустым|низким)/i, "one off-day must never be worded as «дни»");

  const pattern = build(weekFrom, undefined, { energyIssueDays: 3 });
  assert.match(pattern, /Главный паттерн недели|Паттерн недели|Главное за неделю/, `3 off-days in ${weekFrom} must trigger the pattern headline`);
}

// 3c. Week-over-week trend: named outside the noise band, silent inside it.
const TREND_UP = /подтянулись|сдвиг вверх|стали выше/;
const TREND_DOWN = /просели|сдвиг вниз|стали ниже/;
const TREND_ANY = /подтянулись|просели|сдвиг вверх|сдвиг вниз|стали выше|стали ниже/;
assert.match(build("2026-07-06", { carbsWeekOverWeekDeltaG: 35 }), TREND_UP, "+35 g must be named as a rise");
assert.match(build("2026-07-06", { carbsWeekOverWeekDeltaG: -35 }), TREND_DOWN, "-35 g must be named as a drop");
assert.doesNotMatch(build("2026-07-06", { carbsWeekOverWeekDeltaG: 10 }), TREND_ANY, "+10 g is logging noise, not a shift");
assert.doesNotMatch(build("2026-07-06", { carbsWeekOverWeekDeltaG: null }), TREND_ANY, "no prior week → no trend line");
assert.doesNotMatch(build("2026-07-06"), TREND_ANY, "absent delta → no trend line");

// 4. Without a seed the summary falls back to variant 0 — the pre-rotation wording.
const unseeded = buildNutritionWeeklySummary({ days: week("2026-07-06"), proteinSufficient: true });
assert.match(unseeded, /Неделя вышла ровной: дни с нагрузкой закрыты и по энергии, и по углеводам\./);
assert.match(unseeded, /Белок в среднем держится хорошо, это не главный вопрос недели\./);

console.log("PASS check-nutrition-weekly-summary-variety");
