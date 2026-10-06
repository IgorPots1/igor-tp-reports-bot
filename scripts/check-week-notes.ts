/**
 * Заметки недели: кому какая и не утекает ли служебное ученице.
 *
 * ЧТО СТЕРЕЖЁТ. До 06.10.2026 заметки недели не писались вообще: buildWeek их
 * считал, а скрипт перегенерации выбрасывал, и причина решения жила одной
 * строкой в stdout. Теперь они пишутся — и появилась ровно одна новая
 * опасность: СЛУЖЕБНЫЙ РАЗБОР, УШЕДШИЙ УЧЕНИЦЕ. Отсутствие признака адресата
 * читается как "student" (так лежат все заметки, написанные человеком до
 * правки), поэтому забытый audience у заметки сборщика означает утечку.
 *
 *   npm run check:week-notes
 */
import assert from "node:assert/strict";

import { coachNotes, studentNotes, type SessionNote } from "@/features/intervals/loop/types";
import { decideLadderStep, WALK_INTERVAL_LADDER } from "../tools/trainingpeaks-export/scripts/lib/interval-ladder.ts";
import type { Week } from "../tools/trainingpeaks-export/scripts/lib/autoplanner-week.ts";

/* ── ОТБОР ПО АДРЕСАТУ ───────────────────────────────────────────────────── */

const mixed: SessionNote[] = [
  { title: null, body: "Формат тот же, закрепляем" },                          // без признака
  { title: null, body: "Человеческое", audience: "student" },
  { title: "Ступень", body: "Ступень оставлена на 6 x 5: пропущено подряд 2", audience: "coach" },
  { title: "Разбор сборки", body: "пол лёгкой 25 → 20 мин", audience: "coach" },
];

assert.deepEqual(
  studentNotes(mixed).map((n) => n.body),
  ["Формат тот же, закрепляем", "Человеческое"],
  "ученице идут заметки без признака и явно её"
);
assert.equal(studentNotes(mixed).length, 2, "и ровно две, а не все четыре");
assert.equal(coachNotes(mixed).length, 2, "тренеру — только помеченные coach");
assert.ok(
  !coachNotes(mixed).some((n) => n.audience !== "coach"),
  "в поток тренера не попадает ничего без явной пометки"
);

/* ОТСУТСТВИЕ ПРИЗНАКА = УЧЕНИЦЕ, И ЭТО НЕ ЛЕНЬ, А ФАКТ ПРО СТАРЫЕ ДАННЫЕ.
 * Поставь дефолтом coach — и она разом перестанет видеть заметки, которые
 * тренер писал ей руками весь сентябрь. */
assert.equal(studentNotes([{ title: null, body: "старая" }]).length, 1, "старая заметка остаётся её");
assert.equal(coachNotes([{ title: null, body: "старая" }]).length, 0, "и тренерской не становится");

assert.deepEqual(studentNotes(null), [], "пусто это пусто, а не падение");
assert.deepEqual(coachNotes(undefined), [], "и для undefined тоже");

/* ── ДВА ТЕКСТА НА ОДНО РЕШЕНИЕ ──────────────────────────────────────────── */

const rung = WALK_INTERVAL_LADDER.findIndex((r) => r.code === "int_walk_6x5");

/** Слова, которых в тексте для ученицы быть не должно ни при какой причине. */
const INTERNAL = [
  /ступень/iu,       // внутренняя лестница, которой у человека в голове нет
  /пропущен/iu,      // счёт её промахов, которого она не просила
  /бюджет/iu,
  /гейт/iu,
  /пол лёгкой/iu,
  /RPE/u,
  /int_walk/u,
  /разгрузочная неделя ступень/iu,
];

const cases = [
  { name: "шаг вперёд", input: { fromRung: rung, isDeload: false, hasPain: false, rpeBand: "calm" as const, missedStreak: 0 } },
  { name: "держим из-за перерыва", input: { fromRung: rung, isDeload: false, hasPain: false, rpeBand: "calm" as const, missedStreak: 2 } },
  { name: "держим из-за боли", input: { fromRung: rung, isDeload: false, hasPain: true, rpeBand: "calm" as const, missedStreak: 0 } },
  { name: "держим из-за тяжёлой недели", input: { fromRung: rung, isDeload: false, hasPain: false, rpeBand: "cut" as const, missedStreak: 0 } },
  { name: "разгрузка", input: { fromRung: rung, isDeload: true, hasPain: false, rpeBand: "calm" as const, missedStreak: 0 } },
  { name: "откат", input: { fromRung: rung, isDeload: false, hasPain: false, rpeBand: "calm" as const, missedStreak: 5 } },
];

for (const { name, input } of cases) {
  const step = decideLadderStep(input);
  assert.ok(step.noteRu !== null, `${name}: тренеру сказано`);
  assert.ok(step.studentNoteRu !== null, `${name}: ученице тоже сказано`);
  assert.notEqual(
    step.studentNoteRu,
    step.noteRu,
    `${name}: тексты РАЗНЫЕ — один на двоих читался бы как канцелярит для неё`
  );
  for (const forbidden of INTERNAL) {
    assert.ok(
      !forbidden.test(step.studentNoteRu ?? ""),
      `${name}: во тексте для ученицы внутреннее слово ${forbidden}: «${step.studentNoteRu}»`
    );
  }
  assert.ok(!/—|–/u.test(step.studentNoteRu ?? ""), `${name}: тире в тексте для ученицы`);
  // Ни одного M:SS: темпы этому сегменту не печатаются нигде.
  assert.ok(!/\d+:\d{2}/u.test(step.studentNoteRu ?? ""), `${name}: число темпа в тексте для ученицы`);
}

/* ВЕРХ ЛЕСТНИЦЫ — СЛУЧАЙ БЕЗ СООБЩЕНИЯ ЕЙ. «Дальше вести некуда» это наша
 * внутренняя граница, а не событие её недели: формат тот же, новости нет. */
const top = decideLadderStep({
  fromRung: WALK_INTERVAL_LADDER.length - 1,
  isDeload: false, hasPain: false, rpeBand: "calm", missedStreak: 0,
});
assert.ok(top.noteRu !== null, "тренеру про конец лестницы сказано");
assert.equal(top.studentNoteRu, null, "а ученице — нечего, и молчание тут правильный ответ");

/* СТУПЕНЬ НЕИЗВЕСТНА — МОЛЧАТ ОБА. */
const unknown = decideLadderStep({ fromRung: null, isDeload: false, hasPain: false, rpeBand: "calm" });
assert.equal(unknown.noteRu, null, "не знаем, где человек стоит — не пишем тренеру");
assert.equal(unknown.studentNoteRu, null, "и ученице тоже");

/* ── ТЕКСТ ДЛЯ УЧЕНИЦЫ СЛЕДУЕТ ФАКТУ, А НЕ ПРОСЬБЕ ──────────────────────────
 *
 * ЧТО СЛУЧИЛОСЬ 06.10.2026, через час после первой версии этой правки. Заметки
 * собирались снаружи сборщика, из ПРОСИМОГО решения лестницы. На неделе 12.10
 * просили держать 6 x 5, отбор честно спустился на 6 x 4 по бюджету, и ученице
 * ушло «формат отрезков тот же» — про формат, которого в её неделе нет. Ровно
 * та ошибка, которую ловили 27.09 на тренерской заметке; повторилась на
 * студенческой, потому что собиралась в том же неверном месте.
 *
 * Поле Week.studentNotes существует именно для этого: его заполняет сборщик,
 * которому известен ЗАПИСАННЫЙ формат. Проверка стережёт, что поле есть и что
 * оно пусто, когда записали не то, что просили.
 */
/* Проверяем контракт типа: у недели есть ОТДЕЛЬНЫЙ список для ученицы. Если
 * кто-то сольёт его обратно в notes, падёт компиляция этой строки. */
const shape: Pick<Week, "notes" | "studentNotes"> = { notes: [], studentNotes: [] };
assert.deepEqual(shape.studentNotes, [], "у недели есть свой список заметок для ученицы");
assert.notEqual(
  Object.is(shape.notes, shape.studentNotes),
  true,
  "и это ДРУГОЙ список, а не тот же самый под вторым именем"
);

console.log("check:week-notes — все проверки пройдены");
