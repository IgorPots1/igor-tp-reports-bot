/**
 * Выжимка по стартам (scripts/race-details-load.ts): что пишется в race_details. Без сети и базы.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — в базу только известные поля (список совпадает с check-констрейнтом миграции);
 *   — старт, которого нет в календаре, и пустые значения отбрасываются с причиной;
 *   — одно значение на (старт, дистанция, поле): повтор склеивается, а не теряется;
 *   — значение не длиннее 400 знаков (как в констрейнте).
 *
 *   npm run check:race-details
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
const sql = readFileSync("supabase/migrations/20261106000000_race_details.sql", "utf8");
const inSql = [...(sql.match(/field in \(([\s\S]*?)\)\)/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
assert.deepEqual(inSql, [...DETAIL_FIELDS]);

console.log("check:race-details ok");
