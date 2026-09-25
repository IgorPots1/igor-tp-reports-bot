/**
 * Чек разбора формы отчёта. Ни сети, ни базы — только чистые функции.
 *
 * Случай, с которого чек начался (19.09.2026): ученица написала в поле темпа
 * «812», имея в виду 8:12, потому что на числовой клавиатуре двоеточия нет.
 * Форма не принимала и не объясняла, у какого поля беда. Отчёт не ушёл вообще:
 * в intervals_checkins на тот момент было НОЛЬ строк.
 *
 *   npx tsx scripts/check-manual-entry-parse.ts
 */
import assert from "node:assert/strict";

import {
  describeDurationRu,
  durationAlternativeRu,
  durationTextRu,
  paceTextRu,
  parseDistanceKm,
  parseDurationMinutes,
  parseHeartrate,
  parsePaceSecPerKm,
} from "@/features/intervals/loop/manual-entry-parse";

function value(result: ReturnType<typeof parsePaceSecPerKm>): number | null {
  assert.equal(result.ok, true, result.ok ? "" : `ожидали разбор, получили отказ: ${result.errorRu}`);
  return result.ok ? result.value : null;
}

function rejects(result: ReturnType<typeof parsePaceSecPerKm>, why: string): void {
  assert.equal(result.ok, false, `«${why}» должно было отлететь, но разобралось`);
}

// ── ТЕМП: четыре записи одного и того же ────────────────────────────────────
// Главный случай. 812 — это то, что человек РЕАЛЬНО напечатал.
assert.equal(value(parsePaceSecPerKm("8:12")), 492, "8:12 — восемь двенадцать");
assert.equal(value(parsePaceSecPerKm("812")), 492, "812 на числовой клавиатуре — те же 8:12");
assert.equal(value(parsePaceSecPerKm("8.12")), 492, "точка вместо двоеточия");
assert.equal(value(parsePaceSecPerKm("8,12")), 492, "запятая — русский разделитель, не ошибка");
assert.equal(value(parsePaceSecPerKm(" 8:12 ")), 492, "пробелы по краям не мешают");
assert.equal(value(parsePaceSecPerKm("8:12/км")), 492, "единицы дописывать можно");
assert.equal(value(parsePaceSecPerKm("500")), 300, "500 — это 5:00");
assert.equal(value(parsePaceSecPerKm("8")), 480, "одна цифра — ровно минуты, 8:00");
assert.equal(value(parsePaceSecPerKm("10:30")), 630, "двузначные минуты");
assert.equal(value(parsePaceSecPerKm("1030")), 630, "двузначные минуты без разделителя");
assert.equal(value(parsePaceSecPerKm("")), null, "пустое поле — это не ошибка, темп необязателен");

rejects(parsePaceSecPerKm("8:75"), "8:75");
rejects(parsePaceSecPerKm("875"), "875");
rejects(parsePaceSecPerKm("1:30"), "1:30 — быстрее двух минут на километр не бегают");
rejects(parsePaceSecPerKm("20:00"), "20:00 — медленнее пятнадцати не ждём");
rejects(parsePaceSecPerKm("быстро"), "слова");

// ── ВРЕМЯ: 1:05 и 65 — одно и то же ─────────────────────────────────────────
assert.equal(value(parseDurationMinutes("65")), 65);
assert.equal(value(parseDurationMinutes("1:05")), 65, "час пять");
assert.equal(value(parseDurationMinutes("1.05")), 65, "точка вместо двоеточия");
assert.equal(value(parseDurationMinutes("1,05")), 65, "запятая вместо двоеточия");
assert.equal(value(parseDurationMinutes("1ч05")), 65, "буква ч");
assert.equal(value(parseDurationMinutes("40мин")), 40, "единицы дописывать можно");
assert.equal(value(parseDurationMinutes("8")), 8, "восемь минут — ровно восемь");
assert.equal(value(parseDurationMinutes("")), null, "пусто — проверку делает форма, не разбор");

// ГОЛОЕ ТРЁХЗНАЧНОЕ — ЭТО МИНУТЫ, А НЕ ЧАС С МИНУТАМИ. Полтора часа бега
// обычное дело, и «105» обязано остаться ста пятью минутами.
assert.equal(value(parseDurationMinutes("105")), 105, "105 — это 105 минут, а не 1:05");

rejects(parseDurationMinutes("1:70"), "1:70");
rejects(parseDurationMinutes("0"), "ноль минут");
rejects(parseDurationMinutes("700"), "почти двенадцать часов");
rejects(parseDurationMinutes("долго"), "слова");

// ── ДИСТАНЦИЯ: запятая — норма ──────────────────────────────────────────────
assert.equal(value(parseDistanceKm("6.5")), 6.5);
assert.equal(value(parseDistanceKm("6,5")), 6.5, "русская запятая");
assert.equal(value(parseDistanceKm("6")), 6);
assert.equal(value(parseDistanceKm("6,5км")), 6.5, "единицы дописывать можно");
assert.equal(value(parseDistanceKm("")), null);
rejects(parseDistanceKm("0"), "ноль километров");
rejects(parseDistanceKm("500"), "пятьсот километров");
rejects(parseDistanceKm("далеко"), "слова");

// ── ПУЛЬС ───────────────────────────────────────────────────────────────────
assert.equal(value(parseHeartrate("148")), 148);
assert.equal(value(parseHeartrate("148уд")), 148);
assert.equal(value(parseHeartrate("")), null);
rejects(parseHeartrate("12"), "пульс 12");
rejects(parseHeartrate("300"), "пульс 300");

// ── ОБРАТНЫЙ ПОКАЗ: человек должен увидеть, КАК его поняли ──────────────────
assert.equal(paceTextRu(492), "8:12");
assert.equal(paceTextRu(300), "5:00");
assert.equal(durationTextRu(65), "1 ч 05 мин");
assert.equal(durationTextRu(40), "40 мин");

// ── ТЕКСТЫ ОШИБОК ГОВОРЯТ, ЧТО ДЕЛАТЬ ───────────────────────────────────────
// Ошибка без подсказки — это та же пустая кнопка, только словами.
const paceError = parsePaceSecPerKm("875");
assert.equal(paceError.ok, false);
if (!paceError.ok) {
  assert.ok(paceError.errorRu.includes("812") || paceError.errorRu.includes("8:12"),
    "ошибка темпа обязана показать пример правильной записи");
}

console.log("check:manual-entry-parse — все проверки пройдены");

// ── ПРЕДПРОСМОТР: «понял как …» ──────────────────────────────────────────────
//
// ЖИВОЙ СЛУЧАЙ 23.09.2026. Ученица пробежала час шесть и написала «106».
// Разбор честно понял сто шесть минут, и это всплыло только через два дня.
// Правило осталось прежним (см. комментарий в parseDurationMinutes), но теперь
// форма показывает, КАК поняла, и называет второе прочтение.

assert.equal(describeDurationRu(106), "1 ч 46 мин", "вот что она увидела бы у поля");
assert.equal(describeDurationRu(66), "1 ч 6 мин");
assert.equal(describeDurationRu(40), "40 мин", "меньше часа — без часов");
assert.equal(describeDurationRu(120), "2 ч", "ровные часы — без «0 мин»");
assert.equal(describeDurationRu(60), "1 ч");

assert.equal(
  durationAlternativeRu("106"),
  "Если это 1 час 6 мин, напишите 1:06",
  "у трёхзначного называем второе прочтение"
);
assert.equal(durationAlternativeRu("245"), "Если это 2 часа 45 мин, напишите 2:45");
assert.equal(durationAlternativeRu("66"), null, "у двузначного двусмысленности нет");
assert.equal(durationAlternativeRu("160"), null, "«час шестьдесят» не бывает");
assert.equal(durationAlternativeRu("1:06"), null, "разделитель уже всё сказал");
assert.equal(durationAlternativeRu("40"), null);

// ПРОБЕЛ МЕЖДУ ЦИФРАМИ — РАЗДЕЛИТЕЛЬ. Трёхзначное число с пробелом посередине
// не пишет никто.
assert.deepEqual(parseDurationMinutes("1 06"), { ok: true, value: 66 });
assert.deepEqual(parseDurationMinutes("1 30"), { ok: true, value: 90 });
assert.deepEqual(parseDurationMinutes("40 мин"), { ok: true, value: 40 }, "суффикс не сломался");
assert.deepEqual(parseDurationMinutes("106"), { ok: true, value: 106 }, "правило голого числа НЕ менялось");

console.log("check:manual-entry-parse — предпросмотр проверен");
