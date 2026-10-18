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
import { clean, distLabel, fieldCount, fullDetails, MIN_FIELDS, type FullRow } from "@/features/race-details/full";

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

// Найдено на живых данных 15.10.2026 (строка «Важное» уже была в бою):
//   — «Змейка»: «открыта; свободно 143; ходьба — лимит исчерпан» давало «мест нет». Теперь «мест нет»
//     только когда регистрация не открыта; исчерпанная одна дистанция — не «мест нет»;
//   — «Вологда»: тире внутри скобки резало строку в «номера ЭКСПО (адрес»;
//   — детские 12:00 растягивали промежуток старта взрослых.
{
  const reg = (value: string) => ({ distance: null, field: "registration_status", value, checked_at: "2026-10-15" });
  assert.equal(importantLine([reg("открыта онлайн до 31.10; свободно: ZT12 143, ZT7 182, ZT3 89; ходьба — лимит исчерпан")]), null, "одна исчерпанная дистанция — не «мест нет»");
  assert.equal(importantLine([reg("лимит исчерпан на всех дистанциях")]), "Важное: мест нет (на 15.10)");
  assert.equal(importantLine([reg("лимит исчерпан: свободно 0 из 300")]), "Важное: мест нет (на 15.10)", "«свободно 0» — мест нет");
  const pick = importantLine([d(null, "packet_pickup", "ЭКСПО (адрес — не позднее 20.11), в день забега с 08:00")])!;
  assert.equal(pick, "Важное: номера ЭКСПО, в день забега с 08:00");
  assert.doesNotMatch(pick, /\([^)]*$/, "незакрытой скобки нет");
  assert.equal(
    importantLine([d(21.1, "start_time", "06.12, 10:00"), d(5, "start_time", "06.12, 10:00"), d(1, "start_time", "05.12, 12:00 (детские 1 км и 500 м)")]),
    "Важное: старт 10:00", "детские не растягивают промежуток",
  );
}

// Время старта без времени (18.10.2026, проверка бота): было «старт 21 км», «старт 5», «старт 18.10: 15-17 лет
// и 18+» — обрезок текста. Теперь без ЧЧ:ММ части «старт» нет вовсе, остальное на месте.
assert.equal(importantLine([d(21, "start_time", "21 км"), d(null, "packet_pickup", "сб 12:00–20:00")]), "Важное: номера сб 12:00–20:00");
assert.equal(importantLine([d(null, "start_time", "18.10: 15-17 лет и 18+")]), null);
assert.equal(importantLine([d(null, "start_time", "1-й часовой забег в 10:00")]), "Важное: старт 10:00");

// «Всё о старте» (вариант Б, 15.10.2026): разделы по порядку, пустые не показываются, «нет данных» нигде.
{
  const SRC = "https://reg.topliga.ru/event/SochiMarafon2026";
  const r = (distance: number | null, field: string, value: string, source_url = SRC): FullRow => ({ distance, field, value, source_url, checked_at: "2026-10-15" });
  const sochi = [
    r(null, "aid_stations", "пункты питания на трассе и на финише (км не указаны)"),
    r(null, "baggage", "камеры хранения в стартовом городке с 6:00 01.11"),
    r(null, "changing_rooms", "раздевалки в стартовом городке с 6:00 01.11"),
    r(null, "cutoff", "42,2 км — 6 ч; 21,1 км — 3 ч; 10 км — 1,5 ч; 5 км — 1 ч; закрытие трассы 13:30"),
    r(null, "finish_place", "там же, у Зимнего театра; круг 10 км (+94 м), марафон — 4 круга"),
    r(null, "packet_pickup", "Зимний театр: 30.10 10:00–20:00, 31.10 7:00–20:00; иногородним можно в день старта"),
    r(null, "registration_status", "открыта до 31.10/01.11"),
    r(null, "start_place", "Сочи, стартовый городок у Зимнего театра (~200 м от моря)"),
    r(1, "start_time", "31.10: Детская элита 9:00; Детская миля 9:10"),
    r(5, "start_time", "01.11 7:40 (и северная ходьба)"),
    r(10, "start_time", "01.11 9:30"),
    r(21.0975, "start_time", "01.11 9:00"),
    r(42.195, "start_time", "01.11 7:30"),
    r(null, "waves", "нет данных", "https://x.ru"),
    r(null, "next_price_increase", "нет данных", "https://x.ru"),
  ];
  const d = fullDetails(sochi, "2026-11-01");
  assert.deepEqual(d.sections.map((x) => x.key), ["start", "where", "pickup", "cutoff", "onsite", "registration"], "порядок; без трека раздела «Трасса» нет");
  const start = d.sections[0];
  assert.equal(start.title, "Старт 1 ноября");
  assert.deepEqual(start.times, [
    { label: "42,2 км", time: "7:30" }, { label: "5 км", time: "7:40" }, { label: "21,1 км", time: "9:00" }, { label: "10 км", time: "9:30" },
  ], "по времени, столбиком");
  assert.deepEqual(start.lines, ["Детские: 31.10: Детская элита 9:00. Детская миля 9:10."], "детские одной строкой ниже");
  assert.deepEqual(d.sections[1].lines, ["Сочи, стартовый городок у Зимнего театра (~200 м от моря).", "Финиш там же."]);
  assert.deepEqual(d.sections[3].lines, ["42,2 км 6 ч, 21,1 км 3 ч, 10 км 1,5 ч, 5 км 1 ч.", "Закрытие трассы 13:30."]);
  assert.deepEqual(d.sections[5].lines, ["Открыта до 31.10/01.11 (на 15.10)."], "статус с датой проверки");
  assert.deepEqual(d.source, { url: SRC, checked: "2026-10-15" }, "источник — самая частая ссылка, не ссылка «нет данных»");
  assert.ok(!JSON.stringify(d).includes("нет данных"), "«нет данных» нигде");
  assert.equal(fieldCount(sochi), 9, "«нет данных» в счёт полей не идёт");
  // С разбором трассы раздел «Трасса» есть даже без текста; трек — своим текстом.
  assert.ok(fullDetails(sochi, "2026-11-01", true).sections.some((x) => x.key === "track"));
  // Лимиты по дистанциям (Змейка): у детского — только закрытие трасс.
  const z = fullDetails([
    r(1, "cutoff", "1 ч (детский); закрытие всех трасс 16:00"), r(3.5, "cutoff", "3 ч"), r(7, "cutoff", "4 ч"), r(12, "cutoff", "4 ч"),
    r(12, "start_time", "12:00 (ZT12, 14 км, вместе с ZT7; проверка снаряжения 11:45)"), r(7, "start_time", "12:00 (ZT7, 9,5 км)"),
    r(3.5, "start_time", "12:30 (ZT3)"), r(1, "start_time", "11:00 (детский 1,4 км); северная ходьба 4 км — 10:30"),
  ], "2026-11-07");
  assert.deepEqual(z.sections.find((x) => x.key === "cutoff")!.lines, ["12 км 4 ч, 7 км 4 ч, 3,5 км 3 ч.", "Закрытие всех трасс 16:00."]);
  assert.deepEqual(z.sections[0].times, [{ label: "12 км", time: "12:00" }, { label: "7 км", time: "12:00" }, { label: "3,5 км", time: "12:30" }]);
  // Нет времени — «время уточняется», а не «нет данных»; 2,027 км — «2027 м».
  const v = fullDetails([r(2.027, "start_time", "06.12, 10:00"), r(10, "start_time", "06.12, время на russiarunning не указано")], "2026-12-06");
  assert.deepEqual(v.sections[0].times, [{ label: "2027 м", time: "10:00" }, { label: "10 км", time: "время уточняется" }]);
  assert.equal(v.sections[0].title, "Старт 6 декабря", "день — по взрослым дистанциям, не по первому дню фестиваля");
  const vol = fullDetails([r(null, "aid_stations", "10 км: 4 и 7 км; 21,1 км: 4, 7, 10, 14, 17 км; чай на финише")], "2026-12-05");
  assert.match(vol.sections[0].lines[0], /^Питание: 10 км: 4 и 7 км/, "подпись, если текст не начинается с неё");
  assert.equal(fullDetails([r(null, "changing_rooms", "тёплые раздевалки есть")], "2026-12-05").sections[0].lines[0], "Тёплые раздевалки есть.", "без «Раздевалки: тёплые раздевалки»");
  assert.equal(distLabel(42.195), "42,2 км");
  // Наши пометки и координаты наружу не идут.
  assert.equal(clean("ЭКСПО, «06.12 12:00–20:00» (видимо, опечатка, вероятно 05.12); с 08:00"), "ЭКСПО, «06.12 12:00–20:00»; с 08:00");
  assert.equal(clean("гора Змейка, площадка (44.169284, 43.118247)"), "гора Змейка, площадка");
  assert.equal(MIN_FIELDS, 3);
  assert.equal(fullDetails([], "2026-11-01").sections.length, 0, "нет данных — нет разделов");
}

console.log("check:race-details ok");
