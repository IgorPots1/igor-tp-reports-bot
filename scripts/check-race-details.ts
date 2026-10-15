/**
 * Выжимка по стартам (scripts/race-details-load.ts): что пишется в race_details. Без сети и базы.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — в базу только известные поля (список совпадает с check-констрейнтом миграции);
 *   — старт, которого нет в календаре, и пустые значения отбрасываются с причиной;
 *   — одно значение на (старт, дистанция, поле): повтор склеивается, а не теряется;
 *   — значение не длиннее 400 знаков (как в констрейнте);
 *   — блок «Важное»: коротко (до MAX_LINE), без длинного тире, «нет данных» не показывается,
 *     «мест нет / регистрация закрыта» не отбрасывается при обрезке, лимит — только длительность.
 *
 *   npm run check:race-details
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { importantLine, MAX_LINE } from "@/features/race-details/important";

import { DETAIL_FIELDS, toRows } from "./race-details-load";

const known = new Set(["probeg:1", "probeg:2"]);
const { rows, rejected } = toRows(
  [
    {
      race_id: "probeg:1",
      checked_at: "2026-10-15",
      fields: [
        { distance: 21.1, field: "start_time", value: "9:00", source_url: "https://a" },
        { distance: 21.1, field: "start_time", value: "волна 2 в 9:15", source_url: "https://a" },
        { distance: null, field: "packet_pickup", value: "  сб 12:00–20:00,   ТЦ  ", source_url: "https://b" },
        { distance: null, field: "weather", value: "солнце", source_url: null },
        { distance: null, field: "cutoff", value: "   ", source_url: null },
        { distance: null, field: "track", value: "x".repeat(500), source_url: null },
      ],
    },
    { race_id: "probeg:999", checked_at: "2026-10-15", fields: [{ distance: null, field: "cutoff", value: "3 ч", source_url: null }] },
    { race_id: "probeg:2", checked_at: "15.10.2026", fields: [] },
  ],
  known,
);
assert.equal(rows.length, 3);
assert.equal(rows.find((r) => r.field === "start_time")?.value, "9:00; волна 2 в 9:15", "повтор склеен, не потерян");
assert.equal(rows.find((r) => r.field === "packet_pickup")?.value, "сб 12:00–20:00, ТЦ", "пробелы схлопнуты");
assert.equal(rows.find((r) => r.field === "track")?.value.length, 400, "обрезка до 400");
assert.ok(rejected.some((x) => /поле «weather»/.test(x)));
assert.ok(rejected.some((x) => /cutoff: пустое/.test(x)));
assert.ok(rejected.some((x) => /probeg:999: старта нет/.test(x)));
assert.ok(rejected.some((x) => /probeg:2: дата проверки/.test(x)));

// Список полей совпадает с check-констрейнтом миграции: иначе upsert упадёт на живой базе.
const sql = readFileSync("supabase/migrations/20261015120000_race_details.sql", "utf8");
const inSql = [...(sql.match(/field in \(([\s\S]*?)\)\)/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
assert.deepEqual(inSql, [...DETAIL_FIELDS]);

// Блок «Важное» (15.10.2026)
const d = (distance: number | null, field: string, value: string) => ({ distance, field, value });
assert.equal(
  importantLine([d(null, "start_time", "9:00"), d(null, "waves", "волны по 15 минут"), d(null, "packet_pickup", "сб 12:00–20:00, ТЦ «Галерея»"), d(21.1, "cutoff", "3 ч")]),
  "Важное: старт 9:00, волны по 15 минут, номера сб 12:00–20:00, ТЦ «Галерея», лимит 3 ч",
);
assert.equal(
  importantLine([d(42.2, "start_time", "09:00 (регистрация 08:00)"), d(21.1, "start_time", "11:00"), d(42.2, "cutoff", "6 ч"), d(21.1, "cutoff", "3 ч")]),
  "Важное: старт 9:00–11:00 по дистанциям, лимит 6 ч на 42,2 км",
  "несколько дистанций: промежуток времени и лимит самой длинной",
);
assert.equal(importantLine([d(null, "start_time", "нет данных"), d(null, "packet_pickup", "нет данных")]), null, "нечего сказать — блока нет");
assert.equal(importantLine([d(null, "cutoff", "ПП1 13,5 км — 15:10; финиш 19:00")]), null, "лимит не длительностью — не показываем");
// Было: «Важное: мест нет» без даты. Отменено условием Игоря 15.10.2026: статус регистрации меняется,
// а еженедельного обновления пока нет — без даты проверки он читается как сегодняшний факт. Теперь
// статус ВСЕГДА с датой проверки, а без даты не показывается вовсе (а не показывается «как есть»).
const reg = (value: string, checked_at?: string) => ({ distance: null, field: "registration_status", value, checked_at });
assert.equal(importantLine([reg("закрыта — лимит участников исчерпан", "2026-10-15")]), "Важное: мест нет (на 15.10)");
assert.equal(importantLine([reg("регистрация закрыта", "2026-10-09")]), "Важное: регистрация закрыта (на 09.10)");
assert.equal(importantLine([reg("закрыта — лимит участников исчерпан")]), null, "без даты проверки статус не показываем");
assert.equal(
  importantLine([reg("лимит исчерпан на 10 км", "2026-10-02"), reg("лимит исчерпан на 21,1 км", "2026-10-15")]),
  "Важное: мест нет (на 15.10)",
  "дата — самая поздняя проверка",
);
const long = importantLine([
  d(null, "start_time", "10:30"), d(null, "waves", "старт волнами по 5 минут по заявленному результату"),
  d(null, "packet_pickup", "5.11 12:00–20:00, 6–7.11 10:00–20:00, МЦ «Гатчина», ул. Соборная, 10, второй этаж, зал Б"),
  d(21.1, "cutoff", "2 ч 30 мин"), reg("лимит исчерпан на всех дистанциях", "2026-10-15"),
])!;
assert.ok(long.length <= MAX_LINE + 20, `длина ${long.length}`);
assert.match(long, /мест нет \(на 15\.10\)$/, "о закрытой регистрации — всегда и с датой, даже при обрезке");
assert.doesNotMatch(long, /—/, "без длинного тире");

console.log("check:race-details ok");
