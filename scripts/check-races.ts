/**
 * Календарь стартов /races: логика фильтров, дистанций и пометок.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — «Подтверждён» только при двух и больше источниках. В базе sources всегда
 *     содержит собственный источник старта, и проверка «список не пуст»
 *     поставила бы плашку на каждый старт;
 *   — поиск не зависит от регистра и ё/е, слова ищутся в названии, городе и
 *     регионе;
 *   — фильтры переживают адрес: ?q=&type=&dist= туда и обратно, мусор в
 *     адресе не ломает страницу;
 *   — «21100 м» показывается как «21,1 км», больше 8 дистанций — диапазоном;
 *   — прошедшие старты (по дате конца) не показываются, многодневный старт,
 *     который ещё идёт, показывается.
 *
 *   npm run check:races
 */

import assert from "node:assert/strict";

import {
  applyFilters,
  dateStub,
  displayName,
  stripStaleYear,
  distMatch,
  distPills,
  filtersFromSearch,
  filtersToSearch,
  groupByMonth,
  prepare,
  prettyDist,
  toRace,
  type RaceRow,
} from "@/app/races/races-logic";

const row = (over: Partial<RaceRow>): RaceRow => ({
  id: "x",
  source: "probeg",
  source_url: "https://probeg.org/event/1/",
  name: "Забег",
  date_start: "2026-10-18",
  date_end: "2026-10-18",
  city: "Москва",
  region: "Москва",
  distances: [],
  dist_km: [],
  race_type: "road",
  tags: [],
  site_url: null,
  reg_url: null,
  vk_url: null,
  sources: ["probeg"],
  link_ok: null,
  alt_dates: [],
  checked_note: null,
  ...over,
});

// Длинные тире в названиях при выводе становятся дефисом, данные не меняются.
assert.equal(displayName("XIII марафон «Мучкап – Шапкино» – Любо!"), "XIII марафон «Мучкап - Шапкино» - Любо!");
assert.equal(displayName("Тропа Хийси — Выборг Фаворит"), "Тропа Хийси - Выборг Фаворит");
assert.equal(displayName("Сочи-Марафон 2026"), "Сочи-Марафон 2026", "обычный дефис не трогаем");
assert.equal(toRace(row({ name: "Кросс Питер — Осень 2026" })).name, "Кросс Питер - Осень 2026", "в карточке уже дефис");
// Год из названия, отставший от даты, при выводе убирается (данные не меняются), 12.10.2026.
assert.equal(toRace(row({ name: "Т-Банк Rosa Wild Fest 2026", date_start: "2027-09-03" })).name, "Т-Банк Rosa Wild Fest", "год 2026 при дате 2027 не показываем");
assert.equal(stripStaleYear("Golden Ring Ultra Trail 100 2026", "2027-07-23"), "Golden Ring Ultra Trail 100", "число 100 не год");
assert.equal(stripStaleYear("Марафон-2026 «Белые ночи»", "2027-06-20"), "Марафон «Белые ночи»");
assert.equal(stripStaleYear("Забег (2026)", "2027-01-10"), "Забег");
assert.equal(
  stripStaleYear("87 Пробег-Марафон «Покровские Пруды — Здравствуй Новый Год 2027»", "2026-12-31"),
  "87 Пробег-Марафон «Покровские Пруды — Здравствуй Новый Год 2027»",
  "год позже даты — так задумано, не трогаем",
);
assert.equal(stripStaleYear("Казанский марафон 2027", "2027-05-02"), "Казанский марафон 2027", "год совпадает — не трогаем");
assert.equal(stripStaleYear("2026", "2027-05-02"), "2026", "пустым название не становится");
assert.equal(toRace(row({ region: "Ханты-Мансийский автономный округ — Югра" })).region, "Ханты-Мансийский автономный округ - Югра", "и в регионе");

// Источники.
assert.equal(toRace(row({ sources: ["probeg"] })).nSources, 1, "один источник: это сам старт");
assert.equal(toRace(row({ sources: ["probeg", "marathonec", "where2run"] })).nSources, 3);

// Альтернативные даты: своя дата и повторы отбрасываются.
assert.deepEqual(
  toRace(row({ date_start: "2026-10-25", alt_dates: ["marathonec:2026-10-24", "where2run:2026-10-24", "x:2026-10-25"] })).altDates,
  ["2026-10-24"],
  "альтернативная дата одна, без своей",
);

// Ссылки только http(s).
const bad = toRace(row({ site_url: "javascript:alert(1)", reg_url: "https://reg.example/1", vk_url: "vk.com/x" }));
assert.equal(bad.site, "", "javascript: не ссылка");
assert.equal(bad.vk, "", "без схемы не ссылка");
assert.equal(bad.reg, "https://reg.example/1");
assert.equal(toRace(row({ link_ok: false })).linkBad, true);
assert.equal(toRace(row({ link_ok: null })).linkBad, false, "не проверялся не значит не работает");

// Дистанции.
assert.equal(prettyDist("21100 м (Long) (+300м)"), "21,1 км");
assert.equal(prettyDist("29050 м (Шёлковый путь)"), "29,1 км");
assert.equal(prettyDist("800 м"), "800 м", "меньше километра остаётся в метрах");
assert.equal(prettyDist("марафон (старт 10-00)"), "марафон");
const ultra = toRace(
  row({
    distances: ["100 км", "93400 м", "87300 м", "80850 м", "74400 м", "68 км", "61500 м", "55 км", "марафон"],
    dist_km: [100, 93.4, 87.3, 80.85, 74.4, 68, 61.5, 55, 42.195],
  }),
);
assert.deepEqual(distPills(ultra), ["42,2-100 км"], "больше 8 дистанций: диапазон через дефис");
const many = toRace(row({ distances: ["марафон", "полумарафон", "10 км", "5 км", "3 км", "2 км", "1 км"], dist_km: [42.195, 21.0975, 10, 5, 3, 2, 1] }));
assert.deepEqual(distPills(many), ["марафон", "полумарафон", "10 км", "5 км", "3 км", "2 км", "+1"]);
assert.ok(distPills(toRace(row({ distances: ["скандинавская ходьба 5 км", "5 км"] }))).every((p) => !/ходьб/.test(p)), "ходьба не плашка");

// Фильтр дистанций по dist_km и тегам.
const half = toRace(row({ dist_km: [21.0975] }));
assert.ok(distMatch(half, "half") && !distMatch(half, "marathon") && !distMatch(half, "short"));
assert.ok(distMatch(toRace(row({ tags: ["marathon"] })), "marathon"), "марафон по тегу без километров");
assert.ok(distMatch(toRace(row({ dist_km: [10] })), "10") && distMatch(toRace(row({ dist_km: [5] })), "short"));
assert.ok(distMatch(toRace(row({ dist_km: [50] })), "ultra"));

// Поиск: регистр и ё/е.
const races = [
  toRace(row({ id: "1", name: "Казанский марафон", city: "Казань", region: "Республика Татарстан", race_type: "road", dist_km: [42.195] })),
  toRace(row({ id: "2", name: "Трейл «Озёрный»", city: "Казань", region: "Республика Татарстан", race_type: "trail", dist_km: [21] })),
  toRace(row({ id: "3", name: "Ночной забег", city: "Орёл", region: "Орловская область", race_type: "road", dist_km: [10] })),
];
assert.deepEqual(applyFilters(races, { q: "казань", type: "all", dist: "all" }).map((r) => r.id), ["1", "2"]);
assert.deepEqual(applyFilters(races, { q: "орел", type: "all", dist: "all" }).map((r) => r.id), ["3"], "ё = е");
assert.deepEqual(applyFilters(races, { q: "озерный", type: "all", dist: "all" }).map((r) => r.id), ["2"]);
assert.deepEqual(applyFilters(races, { q: "КАЗАНЬ татарстан", type: "trail", dist: "all" }).map((r) => r.id), ["2"]);
assert.equal(applyFilters(races, { q: "казань", type: "trail", dist: "all" }, "type").length, 2, "счётчик типа без своего фильтра");

// Адрес.
const f = { q: "Казань", type: "trail" as const, dist: "half" as const };
assert.equal(filtersToSearch(f), "?q=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C&type=trail&dist=half");
assert.deepEqual(filtersFromSearch(filtersToSearch(f)), f, "адрес туда и обратно");
assert.equal(filtersToSearch({ q: "", type: "all", dist: "all" }), "", "без фильтров адрес чистый");
assert.deepEqual(filtersFromSearch("?type=hack&dist=<x>&q="), { q: "", type: "all", dist: "all" }, "мусор в адресе");

// Прошедшие и многодневные; сортировка и месяцы.
const prep = prepare(
  [
    row({ id: "past", date_start: "2026-10-05", date_end: "2026-10-05" }),
    row({ id: "running", date_start: "2026-10-09", date_end: "2026-10-12" }),
    row({ id: "b", name: "Б", date_start: "2026-11-01", date_end: null }),
    row({ id: "a", name: "А", date_start: "2026-11-01", date_end: null }),
  ],
  "2026-10-11",
);
assert.deepEqual(prep.map((r) => r.id), ["running", "a", "b"], "прошедший скрыт, идущий виден, порядок дата+имя");
assert.deepEqual(groupByMonth(prep).map((m) => `${m.name} ${m.year}:${m.races.length}`), ["Октябрь 2026:1", "Ноябрь 2026:2"]);

// Корешок даты: дефис, а не длинное тире.
assert.deepEqual(dateStub(toRace(row({ date_start: "2026-10-30", date_end: "2026-11-01" }))), {
  day: "30",
  tail: "-1.11",
  wd: "пт-вс",
  weekend: false,
});
assert.equal(dateStub(toRace(row({ date_start: "2026-10-18" }))).weekend, true, "воскресенье выделено");

console.log("check:races ok");
