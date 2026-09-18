/**
 * Чек сигнала недели. Ни сети, ни базы — только чистые функции.
 *
 * Главное, что здесь проверяется, — что ОБЕ шкалы ложатся на полосы без дырок.
 * Лестничная даёт RPE 2, 3, 4, 5, 7; лёгкая — 3, 5, 7. Точные сравнения (=5, =7)
 * оставляли «Заметно, но нормально» (RPE 4) без полосы вообще, и сигнал молчал
 * ровно там, где неделя уже тяжёлая.
 *
 *   npx tsx scripts/check-week-signal.ts
 */
import assert from "node:assert/strict";

import {
  buildWeekSignal,
  lastCompletedWeek,
  type CheckinForSignal,
} from "@/features/intervals/loop/week-signal";
import { EFFORT_OPTIONS, SIMPLE_EFFORT_OPTIONS } from "@/features/intervals/loop/effort-scale";

const TODAY = "2026-09-18"; // пятница
const WEEK = lastCompletedWeek(TODAY);
assert.equal(WEEK.start, "2026-09-07", "последняя завершённая неделя начинается в понедельник");
assert.equal(WEEK.end, "2026-09-13", "и кончается в воскресенье перед текущей");

// Текущая неделя в расчёт не идёт: пока она идёт, оценка неполная.
assert.equal(lastCompletedWeek("2026-09-14").start, "2026-09-07", "понедельник считает прошлую неделю");
assert.equal(lastCompletedWeek("2026-09-13").start, "2026-08-31", "воскресенье принадлежит своей неделе");

function checkin(over: Partial<CheckinForSignal> & { id: string }): CheckinForSignal {
  return {
    sessionDate: "2026-09-09",
    effortRpe: 3,
    effortLabel: null,
    pain: false,
    painNote: null,
    ...over,
  };
}

function bandFor(rpe: number): string | null {
  const signal = buildWeekSignal({
    checkins: [checkin({ id: "a", effortRpe: rpe })],
    unansweredCheckinIds: new Set(),
    todayIso: TODAY,
  });
  return signal.volume?.band ?? null;
}

// ── Обе шкалы попадают в полосы, ни одно значение не остаётся без полосы ──────
for (const option of EFFORT_OPTIONS) {
  assert.ok(
    bandFor(option.rpe) !== null,
    `лестничная шкала: «${option.labelRu}» (RPE ${option.rpe}) осталась без полосы`
  );
}
for (const option of SIMPLE_EFFORT_OPTIONS) {
  assert.ok(
    bandFor(option.rpe) !== null,
    `лёгкая шкала: «${option.labelRu}» (RPE ${option.rpe}) осталась без полосы`
  );
}

// Конкретные границы, а не только «что-то вернулось».
assert.equal(bandFor(2), "calm", "«Совсем легко» — не режем");
assert.equal(bandFor(3), "calm", "«Легко» и «Хорошо» — не режем");
assert.equal(bandFor(4), "hold", "«Заметно, но нормально» — держим, а не проваливаемся в дырку");
assert.equal(bandFor(5), "hold", "«Тяжело» лестницы и «Нормально» лёгкой — держим");
assert.equal(bandFor(7), "cut", "«Очень тяжело» и «Тяжело» лёгкой — тормозим рост");

// ── Худший чек-ин недели, а не средний ───────────────────────────────────────
const mixed = buildWeekSignal({
  checkins: [
    checkin({ id: "a", sessionDate: "2026-09-08", effortRpe: 3 }),
    checkin({ id: "b", sessionDate: "2026-09-10", effortRpe: 7, effortLabel: "Очень тяжело" }),
    checkin({ id: "c", sessionDate: "2026-09-12", effortRpe: 3 }),
  ],
  unansweredCheckinIds: new Set(),
  todayIso: TODAY,
});
assert.equal(mixed.volume?.band, "cut", "одна тяжёлая тренировка не должна усредняться в спокойную");
assert.equal(mixed.volume?.worstDate, "2026-09-10");
assert.equal(mixed.volume?.checkinCount, 3);

// ── Чек-ины чужих недель не считаются ────────────────────────────────────────
const otherWeeks = buildWeekSignal({
  checkins: [
    checkin({ id: "past", sessionDate: "2026-09-01", effortRpe: 7 }),
    checkin({ id: "now", sessionDate: "2026-09-16", effortRpe: 7 }),
  ],
  unansweredCheckinIds: new Set(),
  todayIso: TODAY,
});
assert.equal(otherWeeks.volume, null, "ни позапрошлая неделя, ни текущая в расчёт не идут");

// ── Боль: отдельно, без чисел, и только неотвеченная ─────────────────────────
const withPain = buildWeekSignal({
  checkins: [
    checkin({ id: "hurt", sessionDate: "2026-09-10", pain: true, painNote: "тянуло колено", effortRpe: 3 }),
    checkin({ id: "answered", sessionDate: "2026-09-11", pain: true, painNote: "стопа", effortRpe: 3 }),
  ],
  unansweredCheckinIds: new Set(["hurt"]),
  todayIso: TODAY,
});
assert.equal(withPain.painFlags.length, 1, "отвеченный чек-ин с болью больше не висит");
assert.equal(withPain.painFlags[0].checkinId, "hurt");
assert.equal(withPain.painFlags[0].painNote, "тянуло колено");
assert.equal(
  withPain.volume?.band,
  "calm",
  "боль НЕ утяжеляет полосу объёма: она ведёт к разговору, а не к множителю"
);

// Боль вне завершённой недели всё равно поднимается: неотвеченная боль не
// перестаёт быть неотвеченной от того, что неделя кончилась.
const oldPain = buildWeekSignal({
  checkins: [checkin({ id: "old", sessionDate: "2026-08-20", pain: true, effortRpe: 3 })],
  unansweredCheckinIds: new Set(["old"]),
  todayIso: TODAY,
});
assert.equal(oldPain.painFlags.length, 1, "старая неотвеченная боль не теряется");
assert.equal(oldPain.volume, null);

// ── Молчание — не сигнал ─────────────────────────────────────────────────────
const empty = buildWeekSignal({ checkins: [], unansweredCheckinIds: new Set(), todayIso: TODAY });
assert.equal(empty.volume, null, "без чек-инов сигнал не выдумывается");
assert.equal(empty.painFlags.length, 0);

console.log("check:week-signal — все проверки пройдены");
