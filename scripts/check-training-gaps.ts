/**
 * Перерывы, выполнение и пустая неделя.
 *
 * ЧТО СТЕРЕЖЁТ. Три числа в генераторе были захардкожены так, что перерыв в
 * беге был ему невидим: notRunningWeeks = 0, complianceRatio = null,
 * hasActiveIllness = false. Плюс неделя без отметок давала volume: null, то
 * есть «данных нет» — ровно то же, что неделя, которую человеку не назначали.
 *
 * ГЛАВНАЯ ОПАСНОСТЬ НОВОГО КОДА — МЕРИТЬ ПЕРЕРЫВ В ДНЯХ. У живой ученицы
 * настоящие промежутки между пробежками 3, 3 и 4 дня: порог «четыре дня без
 * бега» срабатывал бы на её ОБЫЧНОМ ритме и держал ступень всегда. Проверка
 * держит это первым же утверждением.
 *
 *   npm run check:training-gaps
 */
import assert from "node:assert/strict";

import {
  NOT_RUNNING_RATIO,
  actualWeeklyMedian,
  daysSinceLastRun,
  missedPlannedStreak,
  weekCompliance,
  type WeekFact,
} from "@/features/intervals/loop/training-gaps";
import { buildWeekSignal } from "@/features/intervals/loop/week-signal";
import type { Pause } from "@/features/intervals/loop/pause";

/* ── КОПИЯ ПОРОГА НЕ РАСХОДИТСЯ С РОСТЕРОМ ───────────────────────────────────
 * src из tools не импортирует, поэтому порог «фактически не тренируется»
 * существует в двух местах. Копия, за которой никто не следит, живёт верной
 * ровно до первой правки оригинала — поэтому равенство проверяется здесь. */
const roster = await import("../tools/trainingpeaks-export/scripts/lib/autoplanner-context.ts");
assert.equal(
  NOT_RUNNING_RATIO,
  roster.NOT_RUNNING_RATIO,
  `порог «не бегает» разошёлся: в приложении ${NOT_RUNNING_RATIO}, у ростера ${roster.NOT_RUNNING_RATIO}`
);

/* ── ПЕРЕРЫВ МЕРИТСЯ В ПЛАНОВЫХ ТРЕНИРОВКАХ, НЕ В ДНЯХ ───────────────────── */

// Её настоящий ритм: пробежки 20, 23, 26, 30 сентября — промежутки 3, 3, 4 дня.
const herRuns = ["2026-09-20", "2026-09-23", "2026-09-26", "2026-09-30"];
// План недели 28.09: среда (отрезки), пятница (лёгкая), воскресенье (длительная).
const herPlanned = [
  "2026-09-16", "2026-09-18", "2026-09-20",
  "2026-09-23", "2026-09-25", "2026-09-27",
  "2026-09-30", "2026-10-02", "2026-10-04",
];

assert.equal(
  daysSinceLastRun({ runDates: herRuns, asOfIso: "2026-09-30" }),
  4,
  "между 26 и 30 сентября четыре дня — и это её НОРМА, а не перерыв"
);
assert.equal(
  missedPlannedStreak({
    plannedDates: herPlanned,
    runDates: herRuns,
    checkinDates: ["2026-09-20", "2026-09-23", "2026-09-26", "2026-09-30"],
    asOfIso: "2026-10-01",
  }),
  0,
  "те же четыре дня в пропусках НЕ числятся: 30 сентября она пробежала по плану"
);

// А вот болезнь 1–5 октября: пропущены 02.10 и 04.10.
assert.equal(
  missedPlannedStreak({
    plannedDates: herPlanned,
    runDates: herRuns,
    checkinDates: ["2026-09-20", "2026-09-23", "2026-09-26", "2026-09-30"],
    asOfIso: "2026-10-06",
  }),
  2,
  "болезнь даёт два пропущенных плановых подряд — вот это перерыв"
);

// Серия обрывается на первом ЗАКРЫТОМ дне, а не суммирует историю.
assert.equal(
  missedPlannedStreak({
    plannedDates: ["2026-09-16", "2026-09-18", "2026-09-20", "2026-09-23"],
    runDates: ["2026-09-20"],
    checkinDates: [],
    asOfIso: "2026-09-24",
  }),
  1,
  "один пропуск после закрытого дня: 16 и 18 сентября в серию не попадают"
);

// Отметка без пробежки тоже закрывает день: человек мог бежать и не записать цифры.
assert.equal(
  missedPlannedStreak({
    plannedDates: ["2026-10-02", "2026-10-04"],
    runDates: [],
    checkinDates: ["2026-10-04"],
    asOfIso: "2026-10-06",
  }),
  0,
  "отметка закрывает день без строки активности"
);

// Никогда не бегал — не «давно не бегал».
assert.equal(
  daysSinceLastRun({ runDates: [], asOfIso: "2026-10-06" }),
  null,
  "без пробежек возвращается null, а не большое число: иначе новичку откатят ступень, которой нет"
);

/* ── ВЫПОЛНЕНИЕ: НОЛЬ ТОЛЬКО ТАМ, ГДЕ ПЛАНА НЕТ ─────────────────────────── */

// Её настоящие недели: план против факта.
const herWeeks: WeekFact[] = [
  { weekStart: "2026-09-14", plannedMin: 121, actualMin: 62, runs: 1 },
  { weekStart: "2026-09-21", plannedMin: 112, actualMin: 158, runs: 2 },
  { weekStart: "2026-09-28", plannedMin: 189, actualMin: 64, runs: 1 },
];
const c = weekCompliance(herWeeks);
assert.equal(c.rolling4wPlannedMin, 422, "план сложен по неделям, у которых он был");
assert.equal(c.rolling4wActualMin, 284, "факт сложен по тем же неделям");
assert.ok(
  c.complianceRatio !== null && Math.abs(c.complianceRatio - 284 / 422) < 1e-9,
  `выполнение считается, а не остаётся null: ${c.complianceRatio}`
);
assert.equal(
  c.notRunningWeeks,
  1,
  "подряд «не бегает» одна неделя: 28.09 ниже 40%, а 21.09 выше порога и серию рвёт"
);
assert.equal(c.lastWeekPlannedMinutes, 189, "последняя плановая неделя названа верно");

// Неделя без плана не «не выполнена» — её не назначали, и делить на ноль нельзя.
const withUnplanned = weekCompliance([
  { weekStart: "2026-09-07", plannedMin: 0, actualMin: 0, runs: 0 },
  ...herWeeks,
]);
assert.equal(
  withUnplanned.notRunningWeeks,
  1,
  "неделя без плана серию не продолжает и не рвёт"
);
assert.equal(withUnplanned.rolling4wPlannedMin, 422, "и в сумму плана не входит");

// Три провальные недели подряд — порог ростера сработает.
const threeBad = weekCompliance([
  { weekStart: "2026-09-14", plannedMin: 120, actualMin: 20, runs: 1 },
  { weekStart: "2026-09-21", plannedMin: 120, actualMin: 0, runs: 0 },
  { weekStart: "2026-09-28", plannedMin: 120, actualMin: 30, runs: 1 },
]);
assert.equal(threeBad.notRunningWeeks, 3, "три недели ниже 40% подряд считаются тремя");

assert.equal(
  actualWeeklyMedian(herWeeks),
  64,
  "медиана факта 64 мин/нед — против 185 в её анкете; от анкетного числа считались тир и форма недели"
);

/* ── ПУСТАЯ НЕДЕЛЯ ВИДНА ПУСТОЙ, А НЕ «ДАННЫХ НЕТ» ──────────────────────── */

const noCheckins = { checkins: [], unansweredCheckinIds: new Set<string>() };

// Неделя 28.09 была в плане и не состоялась (смотрим из 06.10 — завершённая).
const empty = buildWeekSignal({
  ...noCheckins,
  todayIso: "2026-10-06",
  plannedDates: ["2026-09-30", "2026-10-02", "2026-10-04"],
  runDates: [],
});
assert.ok(empty.emptyWeek !== null, "пустая неделя больше не молчит");
assert.equal(empty.emptyWeek?.plannedSessions, 3, "сказано, сколько тренировок стояло");
assert.equal(empty.emptyWeek?.pausedDays, 0, "без паузы это просто пропажа");
assert.ok(/ни одной пробежки/u.test(empty.emptyWeek?.headlineRu ?? ""), "и названа прямо");
assert.equal(empty.volume, null, "полосы объёма у пустой недели нет и быть не может: RPE неоткуда взять");

// НЕДЕЛИ НЕ НАЗНАЧАЛИ — это НЕ пустая неделя, и путать их нельзя.
const notPlanned = buildWeekSignal({
  ...noCheckins,
  todayIso: "2026-10-06",
  plannedDates: [],
  runDates: [],
});
assert.equal(
  notPlanned.emptyWeek,
  null,
  "без плана пропуска нет: человека нельзя винить в том, чего ему не назначали"
);

// ВЫЗОВ, КОТОРЫЙ ПЛАН НЕ ПЕРЕДАЛ, получает null, а не догадку.
const noInput = buildWeekSignal({ ...noCheckins, todayIso: "2026-10-06" });
assert.equal(noInput.emptyWeek, null, "без переданных плановых дней признак не ставится наугад");

// НЕДЕЛЯ ЦЕЛИКОМ НА ПАУЗЕ: факт тот же, тон другой.
const pausedWeek: Pause[] = [
  { id: "p", startedOn: "2026-09-28", endedOn: "2026-10-04", reason: "насморк" },
];
const paused = buildWeekSignal({
  ...noCheckins,
  todayIso: "2026-10-06",
  plannedDates: ["2026-09-30", "2026-10-02", "2026-10-04"],
  runDates: [],
  pauses: pausedWeek,
});
assert.ok(paused.emptyWeek !== null, "неделя на паузе тоже ВИДНА: для прогрессии она пуста");
assert.equal(paused.emptyWeek?.fullyPaused, true, "и помечена как полностью закрытая паузой");
assert.equal(paused.emptyWeek?.pausedDays, 7, "все семь дней внутри паузы");
assert.ok(
  !/не состоялась|ни одной пробежки/u.test(paused.emptyWeek?.headlineRu ?? ""),
  "но упрёка в тексте нет: человека остановил тренер, а не он пропал"
);

// Частичная пауза: середина между двумя.
const partly = buildWeekSignal({
  ...noCheckins,
  todayIso: "2026-10-06",
  plannedDates: ["2026-09-30", "2026-10-02", "2026-10-04"],
  runDates: [],
  pauses: [{ id: "p", startedOn: "2026-10-01", endedOn: "2026-10-05", reason: "насморк" }],
});
assert.equal(partly.emptyWeek?.fullyPaused, false, "неделя закрыта паузой не вся");
assert.equal(partly.emptyWeek?.pausedDays, 4, "внутри недели 28.09–04.10 под паузой четыре дня");

// Ни одного тире в текстах для глаз тренера.
for (const signal of [empty, paused, partly]) {
  const text = `${signal.emptyWeek?.headlineRu ?? ""} ${signal.emptyWeek?.adviceRu ?? ""}`;
  assert.ok(!/—|–/u.test(text), `тире в тексте: ${text}`);
}

console.log("check:training-gaps — все проверки пройдены");
