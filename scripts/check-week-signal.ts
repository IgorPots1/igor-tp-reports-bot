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

// ── Боль: отдельно, без чисел ────────────────────────────────────────────────
//
// ГЛАВНОЕ, ЧТО СТЕРЕЖЁТ ЭТОТ КУСОК [23.09.2026]: ОТВЕТ НЕ ЗАКРЫВАЕТ ВОПРОС.
// Раньше сигнал гас от любого написанного текста, и 23.09 это сработало против
// тренера: он отправил ученице три вопроса про пятку, сигнал пропал, а ответа
// не было ещё трое суток.
const withPain = buildWeekSignal({
  checkins: [
    checkin({ id: "hurt", sessionDate: "2026-09-10", pain: true, painNote: "тянуло колено", effortRpe: 3 }),
    checkin({ id: "answered", sessionDate: "2026-09-11", pain: true, painNote: "стопа", effortRpe: 3 }),
  ],
  unansweredCheckinIds: new Set(["hurt"]),
  todayIso: TODAY,
});
assert.equal(withPain.painFlags.length, 2, "ответ тренера НЕ гасит сигнал: оба чек-ина на месте");
assert.equal(withPain.painFlags[0].checkinId, "answered", "новее — выше");
assert.equal(withPain.painFlags[0].state, "answered_waiting", "по нему написано, ждём её");
assert.equal(withPain.painFlags[1].checkinId, "hurt");
assert.equal(withPain.painFlags[1].state, "waiting_answer", "по нему не написано ничего");
assert.equal(withPain.painFlags[1].painNote, "тянуло колено");
assert.equal(
  withPain.volume?.band,
  "calm",
  "боль НЕ утяжеляет полосу объёма: она ведёт к разговору, а не к множителю"
);

// Гасит рука тренера.
const resolved = buildWeekSignal({
  checkins: [
    checkin({
      id: "hurt",
      sessionDate: "2026-09-10",
      pain: true,
      effortRpe: 3,
      painResolvedAt: "2026-09-12T10:00:00Z",
    }),
  ],
  unansweredCheckinIds: new Set(["hurt"]),
  todayIso: TODAY,
});
assert.equal(resolved.painFlags.length, 0, "«разобрался» гасит даже неотвеченный чек-ин");

// Гасит следующий чек-ин БЕЗ боли: человек сам опроверг тревогу своим отчётом.
const painThenFine = buildWeekSignal({
  checkins: [
    checkin({ id: "hurt", sessionDate: "2026-09-10", pain: true, effortRpe: 3 }),
    checkin({ id: "fine", sessionDate: "2026-09-12", pain: false, effortRpe: 3 }),
  ],
  unansweredCheckinIds: new Set(["hurt", "fine"]),
  todayIso: TODAY,
});
assert.equal(painThenFine.painFlags.length, 0, "следующий отчёт без боли снимает сигнал");

// А вот чек-ин без боли ДО больного ничего не снимает: порядок важен.
const fineThenPain = buildWeekSignal({
  checkins: [
    checkin({ id: "fine", sessionDate: "2026-09-08", pain: false, effortRpe: 3 }),
    checkin({ id: "hurt", sessionDate: "2026-09-10", pain: true, effortRpe: 3 }),
  ],
  unansweredCheckinIds: new Set(["hurt", "fine"]),
  todayIso: TODAY,
});
assert.equal(fineThenPain.painFlags.length, 1, "прошлая спокойная тренировка не отменяет сегодняшнюю боль");

// Боль дважды подряд — не теряется НИ ОДНА. Это ровно тот случай, ради
// которого сигнал и живёт дольше одного ответа.
const painTwice = buildWeekSignal({
  checkins: [
    checkin({ id: "first", sessionDate: "2026-09-10", pain: true, effortRpe: 3 }),
    checkin({ id: "second", sessionDate: "2026-09-12", pain: true, effortRpe: 3 }),
  ],
  unansweredCheckinIds: new Set(),
  todayIso: TODAY,
});
assert.equal(painTwice.painFlags.length, 2, "второй больной чек-ин не гасит первый");
assert.equal(painTwice.painFlags[0].state, "answered_waiting");

// Боль вне завершённой недели всё равно поднимается: открытая боль не
// перестаёт быть открытой от того, что неделя кончилась.
const oldPain = buildWeekSignal({
  checkins: [checkin({ id: "old", sessionDate: "2026-08-20", pain: true, effortRpe: 3 })],
  unansweredCheckinIds: new Set(["old"]),
  todayIso: TODAY,
});
assert.equal(oldPain.painFlags.length, 1, "старая открытая боль не теряется");
assert.equal(oldPain.volume, null);

// ── Молчание — не сигнал ─────────────────────────────────────────────────────
const empty = buildWeekSignal({ checkins: [], unansweredCheckinIds: new Set(), todayIso: TODAY });
assert.equal(empty.volume, null, "без чек-инов сигнал не выдумывается");
assert.equal(empty.painFlags.length, 0);

console.log("check:week-signal — все проверки пройдены");

// ── НЕДЕЛЬНАЯ ФОРМА В СИГНАЛЕ [20.09.2026] ──────────────────────────────────
//
// Форма отвечает на то, чего в отметках по тренировкам не видно: успел ли
// человек по графику и не накопилась ли усталость.
{
  const report = (over: Partial<{ scheduleCode: string; wellbeingCode: string; commentText: string | null }>) => [
    {
      weekStart: WEEK.start,
      scheduleCode: "all_done",
      wellbeingCode: "normal",
      commentText: null,
      ...over,
    },
  ];
  const calmCheckins = [checkin({ id: "a", sessionDate: "2026-09-09", effortRpe: 3 })];

  // УСТАЛОСТЬ ПОДНИМАЕТ ПОЛОСУ. По отметкам неделя спокойная, а человек выжат.
  const tired = buildWeekSignal({
    checkins: calmCheckins,
    unansweredCheckinIds: new Set(),
    todayIso: TODAY,
    weeklyReports: report({ wellbeingCode: "tired" }),
  });
  assert.equal(tired.volume?.band, "hold", "усталость обязана поднять спокойную полосу до «держим»");
  assert.ok(
    tired.volume?.headlineRu.includes("усталость"),
    "тренер должен видеть, что полосу подняли его слова, а не RPE"
  );

  // СВЕЖЕСТЬ НЕ ОПУСКАЕТ. Человек оценивает самочувствие, а не нагрузку.
  const freshAfterHard = buildWeekSignal({
    checkins: [checkin({ id: "b", sessionDate: "2026-09-10", effortRpe: 7 })],
    unansweredCheckinIds: new Set(),
    todayIso: TODAY,
    weeklyReports: report({ wellbeingCode: "fresh" }),
  });
  assert.equal(freshAfterHard.volume?.band, "cut", "бодрость не отменяет уже увиденную тяжёлую неделю");

  // НЕДЕЛЯ НЕ СОСТОЯЛАСЬ — СОВЕТА ПРО ОБЪЁМ НЕТ ВООБЩЕ.
  const almostNone = buildWeekSignal({
    checkins: calmCheckins,
    unansweredCheckinIds: new Set(),
    todayIso: TODAY,
    weeklyReports: report({ scheduleCode: "almost_none" }),
  });
  assert.equal(almostNone.weekly?.needsTalk, true);
  assert.ok(
    almostNone.volume?.adviceRu.includes("Сначала разговор"),
    "по двум отметкам из шести дней объём не советуют"
  );

  // ФОРМА ЗА ЧУЖУЮ НЕДЕЛЮ НЕ БЕРЁТСЯ.
  const otherWeek = buildWeekSignal({
    checkins: calmCheckins,
    unansweredCheckinIds: new Set(),
    todayIso: TODAY,
    weeklyReports: [{ weekStart: "2026-09-14", scheduleCode: "almost_none", wellbeingCode: "tired", commentText: null }],
  });
  assert.equal(otherWeek.weekly, null, "слова про одну неделю не приписываем другой");
  assert.equal(otherWeek.volume?.band, "calm", "и полосу они не двигают");

  // БЕЗ ФОРМЫ ВСЁ КАК БЫЛО.
  const noReport = buildWeekSignal({
    checkins: calmCheckins,
    unansweredCheckinIds: new Set(),
    todayIso: TODAY,
  });
  assert.equal(noReport.weekly, null);
  assert.equal(noReport.volume?.band, "calm");
}

// ── КОГДА ПОКАЗЫВАТЬ ФОРМУ ───────────────────────────────────────────────────
{
  const { reportedWeekStart } = await import("@/features/intervals/loop/weekly-report");
  assert.equal(reportedWeekStart("2026-09-20"), "2026-09-14", "воскресенье: неделя, которая кончается сегодня");
  assert.equal(reportedWeekStart("2026-09-21"), "2026-09-14", "понедельник: неделя, которая кончилась вчера");
  assert.equal(reportedWeekStart("2026-09-22"), null, "во вторник уже поздно");
  assert.equal(reportedWeekStart("2026-09-17"), null, "в середине недели спрашивать нечего");
}
