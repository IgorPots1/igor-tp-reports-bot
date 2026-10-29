/**
 * Поиск по календарю забегов и «страница города» (наряд 29.10.2026, фидбек «нет ГРУТа, нет
 * Владимирского полумарафона, нет Иваново вообще»). Без сети и базы: строки собраны как в базе.
 *
 *   npm run check:races-search
 */

import assert from "node:assert/strict";

import { applyFilters, NO_FILTERS, toRace, type RaceRow } from "@/app/races/races-logic";
import { toExpected, withGeo } from "@/app/races/expected";
import {
  FEW_CITY_RACES,
  areaRaces,
  inCity,
  expectedCities,
  expectedDateMd,
  parseSearch,
  placeFromQuery,
  placePoint,
  placeSubject,
  publicExpected,
  resolveCity,
  searchExpected,
  searchRaces,
  sortCityExpected,
  type BotRace,
} from "@/features/races-bot/core";
import aliasData from "@/features/race-search/aliases.json";
import { ALIASES, aliasesFor, matchesQuery, queryWords, searchText, toCyrillic, toLatin } from "@/features/race-search/search";

const TODAY = "2026-10-29";

function row(id: string, name: string, date: string, city: string, region: string, lat: number | null = null, lon: number | null = null, type = "road"): RaceRow {
  return {
    id, source: id.split(":")[0], source_url: "", name, date_start: date, date_end: null, city, region, distances: ["21,1 км"], dist_km: [21.1],
    race_type: type, tags: [], site_url: null, reg_url: null, vk_url: null, sources: [], link_ok: true, alt_dates: [], checked_note: null,
    subject: region, lat, lon,
  } as RaceRow;
}

// Живые строки календаря на 29.10.2026 (имена, даты и точки как в базе).
const GRUT = toRace({ ...row("probeg:83015", "Golden Ring Ultra Trail 100 2026", "2027-07-23", "Суздаль", "Владимирская область", 56.42, 40.44, "trail"), distances: ["100 км", "50 км"], dist_km: [100, 50] });
const METEOR = toRace(row("myrace:2106", "VI Метеоритный GRUT «Путь к Олимпу» /Grand Race Universe Trail/", "2027-07-31", "Чебаркуль", "Челябинская область", 54.98, 60.37));
const YAR = toRace(row("probeg:85416", "XIV Ярославский полумарафон «Золотое кольцо»", "2027-09-05", "Ярославль", "Ярославская область", 57.63, 39.87));
const KOSTROMA = toRace(row("probeg:85411", "XI Костромской полумарафон «Здорово, Кострома»", "2027-06-12", "Кострома", "Костромская область", 57.77, 40.93));
const PUSHKIN = toRace(row("manual:100-i-peterburgskii-marafon-pushkin-peterburg-2027", "100-й Петербургский Марафон. Пушкин - Петербург", "2027-09-05", "Санкт-Петербург", "Санкт-Петербург", 59.94, 30.31));
const ZABEG_UFA = toRace(row("probeg:84124", "Всероссийский полумарафон «ЗаБег.РФ» (Уфа)", "2027-05-22", "Уфа", "Республика Башкортостан", 54.73, 55.95));
const CRIMEA = toRace(row("marathonec:67363", "Крымский марафон", "2026-11-15", "Симферополь", "Республика Крым", 44.95, 34.1));
const RACES = [GRUT, METEOR, YAR, KOSTROMA, PUSHKIN, ZABEG_UFA, CRIMEA] as BotRace[];

const geo = new Map([
  ["иваново, ", { key: "иваново, ", lat: 56.9957, lon: 40.9812, subject: "Ивановская область" }],
  ["владимир, владимирская область", { key: "владимир, владимирская область", lat: 56.129, lon: 40.407, subject: "Владимирская область" }],
]);
function exp(id: string, name: string, city: string, region: string, last: string, finishers: number | null) {
  return withGeo(
    toExpected({ id, name, city, region, race_type: "road", distances: ["21,1 км"], last_month: Number(last.slice(5, 7)), last_date: last, last_url: "https://probeg.org/", site_url: null, last_finishers: finishers }),
    geo,
  );
}
const VLAD_HALF = exp("probeg:71724", "X Владимирский полумарафон «Золотые ворота»", "Владимир", "Владимирская область", "2026-08-16", 1907);
const VLAD_SMALL = exp("probeg:1", "Пробег «Лыбедь»", "Владимир", "Владимирская область", "2026-05-09", 120);
const VLAD_SMALL2 = exp("probeg:2", "Зимний кросс", "Владимир", "Владимирская область", "2026-02-15", null);
const IVANOVO_HOUR = exp("probeg:83865", "XX открытый часовой легкоатлетический пробег", "Иваново", "Ивановская область", "2026-09-19", 40);
const EXPECTED = [VLAD_HALF, VLAD_SMALL, VLAD_SMALL2, IVANOVO_HOUR];

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

const site = (q: string) => applyFilters(RACES, { ...NO_FILTERS, q }).map((r) => r.id);
const bot = (q: string) => searchRaces(RACES, parseSearch(q)).map((r) => r.id);

check("п.1: «грут», «ГРУТ», «golden ring», «Грут Суздаль» находят probeg:83015 — на сайте/в мини-приложении и в боте", () => {
  for (const q of ["грут", "ГРУТ", "golden ring", "Golden Ring", "Грут Суздаль", "голден ринг", "золотое кольцо ультра трейл"]) {
    assert.ok(site(q).includes("probeg:83015"), `сайт: «${q}»`);
    assert.ok(bot(q).includes("probeg:83015"), `бот: «${q}»`);
  }
});

check("п.1: «GRUT» находит оба — ГРУТ по народному названию и Метеоритный GRUT по своему", () => {
  assert.deepEqual(site("GRUT").sort(), ["myrace:2106", "probeg:83015"]);
});

check("п.1: народное название не цепляет чужое: «грут» не находит Ярославский «Золотое кольцо»", () => {
  assert.ok(!site("грут").includes("probeg:85416"));
  assert.ok(site("золотое кольцо").includes("probeg:85416"), "а по своему названию — находит");
});

check("п.1: тире любой длины — «пушкин-петербург» находит «Пушкин - Петербург»", () => {
  assert.ok(site("пушкин-петербург").includes(PUSHKIN.id));
  assert.ok(aliasesFor("99-й пробег «Пушкин–Санкт-Петербург»").includes("пушкинран"));
});

check("п.1: транслит в обе стороны", () => {
  assert.equal(toLatin("суздаль"), "suzdal");
  assert.equal(toCyrillic("golden ring"), "голден ринг");
  assert.ok(site("suzdal").includes("probeg:83015"), "латиницей — кириллический город");
});

check("п.1: короткое слово — только с начала слова («сим» не находит посреди слова, «уфа» находит город)", () => {
  assert.ok(matchesQuery(searchText("Крымский марафон", "Симферополь"), queryWords("сим")), "Симферополь начинается с «сим»");
  assert.ok(!matchesQuery(searchText("Забег Максимум", "Тверь"), queryWords("сим")), "«сим» посреди слова — нет");
  assert.ok(site("уфа").includes("probeg:84124"), "«ЗаБег.РФ»(Уфа): скобки и точки не мешают");
  assert.ok(site("забег.рф").includes("probeg:84124"));
});

check("п.1: таблица народных названий — 50 строк, у каждой источник и цель", () => {
  const entries = (aliasData as { entries: { aliases: string[]; targets: string[]; source: string }[] }).entries;
  assert.equal(entries.length, 50);
  for (const e of entries) {
    assert.ok(e.aliases.length && e.targets.length, JSON.stringify(e));
    assert.match(e.source, /^https?:\/\//, `источник: ${e.aliases[0]}`);
  }
  assert.ok(ALIASES.some((e) => e.aliases.includes("мм")) && ALIASES.some((e) => e.aliases.includes("мпм")), "ММ и МПМ из наряда");
});

check("п.2: год в названии при показе — пять живых случаев на 29.10.2026, в базе имя не меняется", () => {
  // Срезается год РАНЬШЕ года даты старта (ошибочный прошлогодний):
  assert.equal(GRUT.name, "Golden Ring Ultra Trail 100");
  assert.equal(toRace(row("probeg:84536", "Т-Банк Rosa Wild Fest 2026", "2027-09-03", "Красная поляна", "Краснодарский край")).name, "Т-Банк Rosa Wild Fest");
  assert.equal(toRace(row("russiarunning:x", 'Ночной забег "Laser Night Run" 2026', "2027-09-16", "Екатеринбург", "Свердловская область")).name, 'Ночной забег "Laser Night Run"');
  // Год ПОЗЖЕ даты — часть названия, его не трогаем (правило «любой несовпадающий» испортило бы оба):
  assert.equal(toRace(row("probeg:86287", "Легкоатлетический забег «Забег 2030»", "2027-08-07", "Москва", "Москва")).name, "Легкоатлетический забег «Забег 2030»");
  assert.equal(
    toRace(row("probeg:85629", "87 Пробег-Марафон «Покровские Пруды — Здравствуй Новый Год 2027»", "2026-12-31", "Москва", "Москва")).name,
    "87 Пробег-Марафон «Покровские Пруды - Здравствуй Новый Год 2027»",
  );
});

check("п.3: «Владимир» — город (своих стартов нет), ожидаемые развёрнуты: крупный первым, потом по дате", () => {
  const cities = [...new Set([...RACES.map((r) => r.city), ...expectedCities(EXPECTED)])];
  const place = placeFromQuery("Владимир", cities);
  assert.equal(place, "Владимир");
  const own = RACES.filter((r) => r.city === place);
  assert.ok(own.length < FEW_CITY_RACES);
  const pub = EXPECTED.filter((e) => e.city === place).map(publicExpected);
  const sorted = sortCityExpected(pub, (e) => e.big, (e) => expectedDateMd(e.md, TODAY)).map((e) => e.id);
  assert.deepEqual(sorted, ["probeg:71724", "probeg:2", "probeg:1"], "1907 финишёров — первым; дальше февраль 2027 раньше мая 2027");
  const half = pub.find((e) => e.id === "probeg:71724")!;
  assert.deepEqual([half.big, half.lastYear, expectedDateMd(half.md, TODAY)], [true, 2026, "2027-08-16"], "плашка: «дата 2027 ещё не объявлена, в 2026 было 16 августа»");
  assert.ok(!("lastUrl" in half) && !("finishers" in half), "ссылки и числа финишёров в HTML нет");
});

check("п.3: «владимир» как город — не вся область по слову в регионе", () => {
  const place = placeFromQuery("владимир", ["Суздаль", "Владимир"]);
  assert.equal(place, "Владимир");
  assert.equal(placeFromQuery("Влади", ["Владимир"]), null, "недописанное — не страница города");
});

check("п.4: «Иваново» — нет своих стартов: ожидаемые города, точка по race_geo, рядом в 150 км Суздаль и Кострома", () => {
  assert.deepEqual(IVANOVO_HOUR.geo, { lat: 56.9957, lon: 40.9812 }, "точка по запасному ключу «иваново, »");
  const point = placePoint(RACES, EXPECTED, "Иваново");
  assert.ok(point);
  assert.equal(placeSubject(RACES, EXPECTED, "Иваново"), "Ивановская область");
  const near = areaRaces(RACES, "Иваново", [], [], point, "Ивановская область").items.map((x) => `${x.race.city} ${x.km}`);
  assert.deepEqual(near, ["Суздаль 72", "Кострома 86", "Ярославль 97"]);
});

check("п.4: бот узнаёт город только с ожидаемыми («Иваново»), без «Не нашёл город»", () => {
  assert.equal(resolveCity(RACES, "Иваново").city, null, "без ожидаемых — не узнаёт (как было)");
  assert.equal(resolveCity(RACES, "иваново", expectedCities(EXPECTED)).city, "Иваново");
  assert.equal(resolveCity(RACES, "Иванова", expectedCities(EXPECTED)).city, "Иваново", "опечатка");
});

check("п.1: ожидаемые ищутся тем же поиском («владимирский полумарафон»)", () => {
  assert.deepEqual(searchExpected(EXPECTED, parseSearch("владимирский полумарафон")).map((e) => e.id), ["probeg:71724"]);
});

check("«во Владимире», «в Волгограде», «в городе Иваново»", () => {
  assert.equal(inCity("Владимир"), "во Владимире");
  assert.equal(inCity("Всеволожск"), "во Всеволожске");
  assert.equal(inCity("Волгоград"), "в Волгограде");
  assert.equal(inCity("Тверь"), "в Твери");
  assert.equal(inCity("Иваново"), "в городе Иваново");
});

if (failures) {
  console.error(`\n${failures} проверок упало`);
  process.exit(1);
}
console.log("\ncheck:races-search — всё зелёное");
