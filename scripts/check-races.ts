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
  subjectsOf,
  cleanQuotes,
} from "@/app/races/races-logic";
import { canonicalSubject, subjectFromDisplay } from "@/app/races/subjects";
import { eventLink, sameRace, type MatchRow } from "../supabase/functions/race-calendar-sync/match";
import { textDayInRange } from "../supabase/functions/race-calendar-sync/dates";
import { fillRegion, geoKey as edgeGeoKey, subjectFor } from "../supabase/functions/race-calendar-sync/geo";
import { geoKey as botGeoKey } from "@/features/races-bot/core";

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
assert.equal(stripStaleYear('Ночной забег "Laser Night Run" 2026', "2027-09-16"), 'Ночной забег "Laser Night Run"', "пробел перед открывающей кавычкой остаётся");
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
// С 18.10.2026 плашки идут через nbsp: «км» не отрывается от числа (было — обычный пробел).
assert.deepEqual(distPills(ultra), ["42,2-100\u00A0км"], "больше 8 дистанций: диапазон через дефис, «км» неразрывно");
const many = toRace(row({ distances: ["марафон", "полумарафон", "10 км", "5 км", "3 км", "2 км", "1 км"], dist_km: [42.195, 21.0975, 10, 5, 3, 2, 1] }));
assert.deepEqual(distPills(many), ["марафон", "полумарафон", "10\u00A0км", "5\u00A0км", "3\u00A0км", "2\u00A0км", "+1"]);
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
assert.deepEqual(applyFilters(races, { q: "казань", type: "all", dist: "all", region: "" }).map((r) => r.id), ["1", "2"]);
assert.deepEqual(applyFilters(races, { q: "орел", type: "all", dist: "all", region: "" }).map((r) => r.id), ["3"], "ё = е");
assert.deepEqual(applyFilters(races, { q: "озерный", type: "all", dist: "all", region: "" }).map((r) => r.id), ["2"]);
assert.deepEqual(applyFilters(races, { q: "КАЗАНЬ татарстан", type: "trail", dist: "all", region: "" }).map((r) => r.id), ["2"]);
assert.equal(applyFilters(races, { q: "казань", type: "trail", dist: "all", region: "" }, "type").length, 2, "счётчик типа без своего фильтра");

// Адрес.
const f = { q: "Казань", type: "trail" as const, dist: "half" as const, region: "", season: "" };
assert.equal(filtersToSearch(f), "?q=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C&type=trail&dist=half");
assert.deepEqual(filtersFromSearch(filtersToSearch(f)), f, "адрес туда и обратно");
assert.equal(filtersToSearch({ q: "", type: "all", dist: "all", region: "" }), "", "без фильтров адрес чистый");
assert.deepEqual(filtersFromSearch("?type=hack&dist=<x>&q=&season=<b>"), { q: "", type: "all", dist: "all", region: "", season: "" }, "мусор в адресе");

// Области (наряд 12.10.2026): субъект одним написанием, фильтр «Вся Тверская область», город-область.
{
  const tv = toRace(row({ id: "t1", city: "Тверь", region: "Тверь", subject: "Тверская область", lat: 56.86, lon: 35.91 }));
  const st = toRace(row({ id: "t2", city: "Старица", region: "Тверская область", subject: null }));
  const owl = toRace(row({ id: "t3", city: "Тверская область", region: "Тверская область" }));
  const kz = toRace(row({ id: "k1", city: "Казань", region: "Республика Татарстан", subject: "Республика Татарстан" }));
  assert.equal(tv.subject, "Тверская область", "субъект из race_calendar");
  assert.equal(st.subject, "Тверская область", "без точки — из написания региона");
  assert.deepEqual(tv.geo, { lat: 56.86, lon: 35.91 });
  assert.equal(owl.noCity, true);
  assert.equal(owl.city, "", "«Тверская область» в поле города — не город");
  assert.equal(owl.subject, "Тверская область");
  const all = [tv, st, owl, kz];
  assert.deepEqual(applyFilters(all, { q: "", type: "all", dist: "all", region: "Тверская область" }).map((r) => r.id), ["t1", "t2", "t3"], "Вся Тверская область");
  assert.deepEqual(applyFilters(all, { q: "старица", type: "all", dist: "all", region: "" }).map((r) => r.id), ["t2"], "городок по-прежнему находится поиском");
  assert.deepEqual(subjectsOf(all), [{ subject: "Тверская область", n: 3 }, { subject: "Республика Татарстан", n: 1 }]);
  const fr = { q: "", type: "all" as const, dist: "all" as const, region: "Тверская область", season: "ve27" };
  assert.deepEqual(filtersFromSearch(filtersToSearch(fr)), fr, "область в адресе туда и обратно");
  assert.equal(canonicalSubject("Тверская обл"), "Тверская область");
  assert.equal(canonicalSubject("респ Татарстан"), "Республика Татарстан");
  assert.equal(canonicalSubject("Удмуртия"), "Удмуртская Республика");
  assert.equal(canonicalSubject("Тверская"), "Тверская область", "голое прилагательное orgeo");
  assert.equal(canonicalSubject("Тверь"), null, "город — не субъект");
  assert.equal(canonicalSubject("Москва"), "Москва");
  assert.equal(subjectFromDisplay("Зура, Игринский район, Удмуртия, Приволжский федеральный округ, Россия"), "Удмуртская Республика");
  assert.equal(subjectFromDisplay("Тверь, городской округ Тверь, Тверская область, Центральный федеральный округ, Россия"), "Тверская область");
}

// Пустой регион — субъектом из race_geo (робот и шлюз), city не меняется.
{
  const rows = [
    { key: "тверь, тверь", city: "Тверь", subject: "Тверская область" },
    { key: "тверь, тверская область", city: "Тверь", subject: "Тверская область" },
    { key: "кировск, мурманская область", city: "Кировск", subject: "Мурманская область" },
    { key: "кировск, ленинградская область", city: "Кировск", subject: "Ленинградская область" },
  ];
  assert.equal(edgeGeoKey("Тверь ", "Тверская  Область"), botGeoKey("Тверь ", "Тверская  Область"), "ключ робота = ключ бота");
  assert.equal(subjectFor(rows, "Тверь", ""), "Тверская область", "по городу, если субъект у него один");
  assert.equal(subjectFor(rows, "Кировск", ""), null, "одноимённые в разных областях — не угадываем");
  assert.equal(subjectFor(rows, "Кировск", "Мурманская область"), "Мурманская область", "точный ключ");
  assert.deepEqual(fillRegion({ city: "Тверь", region: "" }, rows), { city: "Тверь", region: "Тверская область" });
  assert.deepEqual(fillRegion({ city: "Тверь", region: "Тверь" }, rows), { city: "Тверь", region: "Тверь" }, "непустой регион не трогаем");
  assert.deepEqual(fillRegion({ city: "Нигдеград", region: null }, rows), { city: "Нигдеград", region: null }, "не узнан — как есть");
}

// Вложенные кавычки из источников (13.10.2026): только в показе.
assert.equal(cleanQuotes("Забег ««Moscow Drift Cross»»"), "Забег «Moscow Drift Cross»");
assert.equal(cleanQuotes('Ночной трейл «"Грязная утка"»'), "Ночной трейл «Грязная утка»");
assert.equal(cleanQuotes('Пробег ""Осень""'), 'Пробег "Осень"');
assert.equal(cleanQuotes("Трейл «Краски осени»"), "Трейл «Краски осени»", "обычные не трогаем");
assert.equal(toRace(row({ name: "Забег ««Moscow Drift Cross»»" })).name, "Забег «Moscow Drift Cross»");

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

// --- Склейка дублей между источниками (supabase/functions/race-calendar-sync/match.ts), наряд 12.10.2026.
// Каждый случай - живая пара из базы. «Было» - что делала прежняя логика.
{
  const r = (source: string, name: string, date: string, city: string, region = "", location: string | null = city, race_type = "trail"): MatchRow =>
    ({ id: `${source}:${name}`, source, name, date_start: date, date_end: date, city, region, location, race_type });
  const no = (p: MatchRow, s: MatchRow, why: string) => assert.equal(sameRace(p, s), 0, why);
  const yes = (p: MatchRow, s: MatchRow, why: string) => assert.notEqual(sameRace(p, s), 0, why);

  // Ложные склейки. Было: склеивались.
  no(r("probeg", "83 Пробег-Марафон «Покровские Пруды»", "2026-10-18", "Москва", "Москва", "Москва", "road"),
    r("russiarunning", "Забег-полумарафон \"Покровское-Стрешнево\"", "2026-10-18", "Москва", "Москва", "Москва", "road"),
    "общие первые буквы «покров» - не одно слово, и у каждого своё («пруды» / «стрешнево»)");
  no(r("probeg", "Кросс лыжников МГУ памяти А.А.Карпова", "2026-10-18", "Красногорск", "Московская область", "Московская область, Красногорск", "road"),
    r("russiarunning", "КРОСС ЛЫЖНИКОВ", "2026-10-18", "Гатчина", "Ленинградская область", "Ленинградская область, Гатчина", "road"),
    "разные регионы - разные старты, хоть слово и совпало (защита «разные места» пропускала по одному слову)");
  no(r("probeg", "Забег «Семья на спорте»", "2026-10-24", "Сысоевка", "Нижегородская область", "Нижегородская область, Богородский район, д. Сысоевка"),
    r("russiarunning", "трейл \"Окская тропа\" 2026 - ночной забег", "2026-10-24", "Сысоевка", "Нижегородская область"),
    "один день, одна деревня, но названия ни в одном значимом слове не совпали");
  no(r("probeg", "84 Пробег-Марафон «Покровские Пруды — День Народного Единства 2026»", "2026-11-04", "Москва", "Москва", "Москва", "road"),
    r("russiarunning", "ДЕНЬ НАРОДНОГО ЕДИНСТВА", "2026-10-31", "Москва", "Москва", "Москва", "road"),
    "разные даты по одному празднику в названии - не склейка (было k2)");
  no(r("probeg", "26-й традиционный «Осенний кросс МАИ»", "2026-11-04", "Москва", "Москва", "Москва", "road"),
    r("russiarunning", "Мама, Я Бегу!! (Осенний забег)", "2026-10-31", "Москва", "Москва", "Москва", "road"),
    "разные даты по общему слову «осенний» - не склейка (было k2 через транслитерацию)");
  no(r("manual", "Краснознаменский полумарафон", "2026-10-17", "Краснознаменск", "Калининградская область", "Калининградская область, Краснознаменск", "road"),
    r("orgeo", "Чемпионат и Первенство Краснодарского края по триатлону (дуатлон-кросс)", "2026-10-16", "Новороссийск", "Краснодарский край", "Краснодарский, Новороссийск", "tri"),
    "«краснодарского» и «краснознаменский» - разные слова и разные регионы");
  no(r("probeg", "Забег «Снежный»", "2026-12-06", "Томск", "", "Томск"),
    r("where2run", "СНЕЖНАЯ СЕМЕРКА", "2026-12-06", "Красноярск", "", "Красноярск", "road"),
    "«снежный» и «снежная» в разных городах - не один старт");
  no(r("probeg", "Осенний кросс", "2026-10-18", "Талдом", "Московская область", "Московская область, Талдом", "road"),
    r("orgeo", "Осенний кросс", "2026-10-18", "Североморск", "Мурманская область", "Мурманская, Североморск", "road"),
    "общее название в разных местах");

  // Настоящие дубли. Должны склеиваться.
  yes(r("probeg", "Трейл «Вьюнок»", "2026-09-13", "Гарболово", "Ленинградская область", "Ленинградская область, Гарболово"),
    r("orgeo", "Вьюнок трейл", "2026-09-13", "Куйвози", "Ленинградская область", "Ленинградская, Всеволожский, Куйвози"),
    "Вьюнок: один старт, места подписаны по-разному");
  yes(r("probeg", "X горный забег «Карстовый трейл»", "2026-10-24", "Стерлитамак", "Республика Башкортостан", "Республика Башкортостан, Стерлитамак"),
    r("marathonec", "Карстовый трейл", "2026-10-24", "Ишеево", "", "Ишеево"), "Карстовый");
  yes(r("probeg", "Трейл «Рубеж»", "2026-10-24", "Медынь", "Калужская область", "Калужская область, Медынь"),
    r("marathonec", "Трейл «Рубеж»", "2026-10-24", "Ильинское", "", "Ильинское"), "Рубеж (marathonec пишет соседнее село)");
  yes(r("probeg", "Трейл «Рубеж»", "2026-10-24", "Медынь", "Калужская область", "Калужская область, Медынь"),
    r("otime", "ТРЕЙЛ РУБЕЖ", "2026-10-24", "Медынь", "Калужская область", "Калужская область, г. Медынь"), "Рубеж (o-time)");
  yes(r("manual", "VOLYN' ULTRA TRAIL 2027", "2027-01-23", "Волынь (загородный отель)", "Псковская область", "Псковская область, Волынь (загородный отель)"),
    r("otime", "ВОЛЫНЬ УЛЬТРА ТРЕЙЛ 2027", "2027-01-23", "Камено", "Псковская область", "Псковская область, Куньинский р-н, д.Камено"),
    "ВОЛЫНЬ = VOLYN' (значимые слова сравниваются и в транслитерации)");
  yes(r("manual", "VOLYN' ULTRA TRAIL 2027", "2027-01-23", "Волынь (загородный отель)", "Псковская область", null),
    r("otime", "ВОЛЫНЬ УЛЬТРА ТРЕЙЛ 2027", "2027-01-23", "Камено", "Псковская область", "Псковская область, Куньинский р-н, д.Камено"),
    "ВОЛЫНЬ = VOLYN' и без location у ручной строки (12.10 склейка их не видела)");
  yes(r("probeg", "Mad Fox Ultra Pure Intention", "2026-12-18", "Переславль-Залесский", "Ярославская область", "Ярославская область, Переславль-Залесский"),
    r("otime", "Бешеная Лиса Ультра", "2026-12-18", "Переславль-Залесский", "Ярославская область", "Ярославская область, г. Переславль-Залесский"),
    "перевод названия на другой алфавит - не «разные слова»");
  yes(r("probeg", "45-й Традиционный забег «Жуков трейл», посвящённый 130-й годовщине со дня рождения Маршала Г. К. Жукова.", "2026-11-28", "Жуков", "Калужская область", "Калужская область, Жуков"),
    r("marathonec", "Иммерсивный Жуков трейл", "2026-11-28", "Стрелковка", "", "Стрелковка"), "Жуков = Жукова (окончание)");
  yes(r("probeg", "Ночной забег с фонариками", "2027-03-27", "Красноярск", "Красноярск", "Красноярск", "road"),
    r("where2run", "Ночной забег Красноярск", "2027-03-27", "Красноярск", "", "Красноярск", "road"), "город в названии - не «своё» слово");
  yes(r("probeg", "Легкоатлетический кросс «Максима Кросс классик»", "2026-10-18", "Горки Сухаревские", "Московская область", "Московская область, Дмитровский район, д. Горки Сухаревские", "road"),
    r("regplace", "Максима Кросс классик", "2026-10-18", "Дмитровский район (Московская область)", "", "Дмитровский район (Московская область)", "road"),
    "регион из «… (Московская область)» - «московская», а не «дмитровский»");
  // Общая ссылка на конкретное событие (наряд 12.10.2026): один старт при любых названиях.
  {
    const rr = "https://reg.russiarunning.com/event/TreylfestZmeyka2026";
    const zmeyka = { ...r("probeg", "Забег «Змейка Трейл»", "2026-11-07", "Минеральные Воды", "Ставропольский край", "Ставропольский край, Минеральные Воды"), site_url: "https://key-run.ru/", reg_url: rr };
    for (const src of ["marathonec", "where2run", "russiarunning"])
      assert.equal(sameRace(zmeyka, { ...r(src, src === "russiarunning" ? "Трейлфест МинВоды 2026" : "Трейлфест «МинВоды»", "2026-11-07", "Минеральные Воды"), reg_url: `${rr}?utm_source=x` }), 1,
        `Трейлфест МинВоды (${src}) = Змейка Трейл: одна регистрация (было: разные названия, не склеивались)`);
    // общая страница организатора или паблик - не событие: два разных старта одного организатора в соседние дни
    const a1 = { ...r("probeg", "Осенний трейл «Бештау»", "2026-11-07", "Пятигорск", "Ставропольский край"), site_url: "https://key-run.ru/" };
    const b1 = { ...r("marathonec", "Забег «Машук»", "2026-11-08", "Пятигорск"), site_url: "https://www.key-run.ru", reg_url: "https://vk.com/keyrun" };
    no(a1, b1, "общая страница организатора (голый домен) и паблик ВК не делают старты одним");
    assert.equal(eventLink("https://www.Reg.Place/events/abc/?utm_source=vk"), "reg.place/events/abc");
    assert.equal(eventLink("https://orgeo.ru"), null);
    assert.equal(eventLink("https://iron-star.com/event/"), null, "страница календаря без id - не событие");
    assert.equal(eventLink("https://vk.com/event/123"), null);
    // даты дальше дня - не склеиваем даже по общей ссылке (перенос или следующее проведение)
    no(zmeyka, { ...r("marathonec", "Трейлфест «МинВоды»", "2026-11-10", "Минеральные Воды"), reg_url: rr }, "та же ссылка, но через 3 дня");
  }
  assert.equal(sameRace(r("probeg", "Трейл-забег «O-Trail. FerrumFest»", "2026-10-18", "Железноводск", "Ставропольский край", "Ставропольский край, Железноводск"),
    r("marathonec", "О-Трейл Феррум Фест", "2026-10-17", "Железноводск", "", "Железноводск")), 2, "FerrumFest: разные даты, но то же имя в транслитерации - k2");
}

// --- День старта из текста события при диапазоне в списке (orgeo, наряд 12.10.2026) ---
// orgeo «17-18.10.2026», в тексте «18 октября 2026 года пройдёт…» — старт 18.10 (федерация так же).
{
  const page = "Алексей 17-18 октября 2026 Тверь, Гришкино. Чемпионат … дуатлон-кросс 18 октября 2026 года пройдёт Чемпионат и первенство Тверской области";
  assert.equal(textDayInRange(page, "2026-10-17", "2026-10-18"), "2026-10-18");
  assert.equal(textDayInRange("Старт 18 октября 2026 года состоится в 11:00", "2026-10-17", "2026-10-18"), "2026-10-18");
  assert.equal(textDayInRange("Регистрация открыта до 17 октября 2026 года.", "2026-10-17", "2026-10-18"), null, "срок регистрации — не день старта");
  assert.equal(textDayInRange("17 октября 2026 года пройдёт регистрация, 18 октября 2026 года пройдёт старт", "2026-10-17", "2026-10-18"), null, "два дня — неоднозначно, остаётся диапазон");
  assert.equal(textDayInRange("5 ноября 2026 года пройдёт", "2026-10-17", "2026-10-18"), null, "день вне диапазона — нет");
  assert.equal(textDayInRange("18 октября 2026 года пройдёт", "2026-10-18", "2026-10-18"), null, "один день в списке — текст не нужен");
  assert.equal(textDayInRange("1 мая 2027 г. состоится забег", "2027-04-30", "2027-05-02"), "2027-05-01");
}

console.log("check:races ok");
