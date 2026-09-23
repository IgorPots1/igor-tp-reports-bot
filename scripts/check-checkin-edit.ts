/**
 * Правка чек-ина и окно открытой тренировки.
 *
 * ЧТО СТЕРЕЖЁТ. Три вещи, каждая из которых уже стоила данных:
 *   — отметиться можно было один раз, ошибку в цифре исправить нечем;
 *   — вчерашняя неотмеченная тренировка пропадала с экрана совсем;
 *   — повторная отправка тех же ответов не должна выглядеть как «передумал».
 *
 *   npm run check:checkin-edit
 */

import assert from "node:assert/strict";

import {
  OPEN_PAST_DAYS,
  describeEditRu,
  diffCheckin,
  editNeedsCoachEye,
  isSessionOpen,
  type CheckinSnapshot,
} from "@/features/intervals/loop/checkin-edit";

const TODAY = "2026-09-23"; // среда

// ── Окно ─────────────────────────────────────────────────────────────────────
assert.equal(isSessionOpen({ sessionDate: "2026-09-23", todayIso: TODAY }), true, "сегодняшняя открыта");
assert.equal(isSessionOpen({ sessionDate: "2026-09-22", todayIso: TODAY }), true, "вчерашняя открыта");
assert.equal(isSessionOpen({ sessionDate: "2026-09-20", todayIso: TODAY }), true, "на границе окна ещё открыта");
assert.equal(isSessionOpen({ sessionDate: "2026-09-19", todayIso: TODAY }), false, "за окном закрыта");
assert.equal(OPEN_PAST_DAYS, 3, "окно названо числом, а не разбросано по коду");

// БУДУЩЕЕ ЗАКРЫТО ВСЕГДА: отметиться о том, чего не было, нельзя.
assert.equal(isSessionOpen({ sessionDate: "2026-09-24", todayIso: TODAY }), false, "завтрашняя закрыта");
assert.equal(isSessionOpen({ sessionDate: "2026-10-01", todayIso: TODAY }), false, "будущая закрыта");

// Окно живёт в днях, а не в часах: переход через месяц ничего не ломает.
assert.equal(isSessionOpen({ sessionDate: "2026-08-31", todayIso: "2026-09-02" }), true, "через границу месяца");

// ── Что считается правкой ────────────────────────────────────────────────────
const base: CheckinSnapshot = { effortRpe: 5, effortLabel: "Нормально", pain: false, commentText: "бежала ровно" };

assert.deepEqual(diffCheckin(base, base), [], "те же ответы — не правка");
assert.deepEqual(
  diffCheckin(base, { ...base, commentText: "  бежала ровно  " }),
  [],
  "пробелы по краям комментария не считаются правкой"
);
assert.deepEqual(
  diffCheckin(base, { ...base, effortLabel: "Нормально " }),
  [],
  "усилие сравнивается по RPE, а не по подписи: шкала у человека может смениться"
);

assert.deepEqual(diffCheckin(base, { ...base, pain: true }), ["pain"]);
assert.deepEqual(diffCheckin(base, { ...base, effortRpe: 7, effortLabel: "Тяжело" }), ["effort"]);
assert.deepEqual(diffCheckin(base, { ...base, commentText: "болела пятка" }), ["comment"]);
assert.deepEqual(
  diffCheckin(base, { effortRpe: 7, effortLabel: "Тяжело", pain: true, commentText: "болела пятка" }),
  ["effort", "pain", "comment"],
  "за одну отправку можно поправить всё сразу"
);

// Комментарий из пустого в текст — тоже правка.
assert.deepEqual(
  diffCheckin({ ...base, commentText: null }, { ...base, commentText: "добавила словами" }),
  ["comment"]
);

// ── Что тренер обязан увидеть ────────────────────────────────────────────────
assert.equal(editNeedsCoachEye(["pain"]), true);
assert.equal(editNeedsCoachEye(["effort"]), true);
assert.equal(editNeedsCoachEye(["comment"]), false, "запятая в комментарии не стоит заметности");
assert.equal(editNeedsCoachEye(["comment", "pain"]), true);
assert.equal(editNeedsCoachEye([]), false);

// ── Как это читается на карточке ─────────────────────────────────────────────
assert.equal(
  describeEditRu({
    editedAt: "2026-09-23T20:00:00Z",
    changed: ["pain"],
    effortLabelBefore: null,
    effortLabelAfter: null,
    painBefore: true,
    painAfter: false,
  }),
  "боль: было «что-то беспокоило», стало «всё спокойно»"
);

assert.equal(
  describeEditRu({
    editedAt: "2026-09-23T20:00:00Z",
    changed: ["effort", "pain"],
    effortLabelBefore: "Тяжело",
    effortLabelAfter: "Нормально",
    painBefore: false,
    painAfter: true,
  }),
  "усилие: было «Тяжело», стало «Нормально» · боль: было «всё спокойно», стало «что-то беспокоило»"
);

console.log("check:checkin-edit — все проверки пройдены");
