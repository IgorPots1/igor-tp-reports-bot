/**
 * Ожидаемые старты (supabase/functions/race-calendar-sync/expected.ts): разбор прошедших
 * стартов probeg, ключ названия без года и номера, «следующее проведение» (годовщина через год
 * или два ±60 дней, тот же город и тип, название похоже в обе стороны, та же разновидность серии),
 * отсев стадиона, детского и не бегового; фильтр «только плавание» (match.ts, общий с шлюзом).
 *
 *   npm run check:races-expected
 */

import assert from "node:assert/strict";

import { toExpected } from "@/app/races/expected";

import {
  buildExpected,
  findNextEdition,
  keyTokens,
  nameKey,
  nameScore,
  nearAnniversary,
  parsePastProbeg,
  splitPlace,
  weekDiff,
  weekWindows,
  type PastRace,
} from "../supabase/functions/race-calendar-sync/expected";
import { isSwimOnly } from "../supabase/functions/race-calendar-sync/match";

// Строка таблицы probeg для прошедшего старта (как на сайте 12.10.2026): оценка рядом с названием
// не должна попадать в имя.
const html = `<table><tr><td class="text-right">4</td><td class="text-right"><a href="/event/67222/">12.10.2025</a></td><td><a href="/event/67222/">VII Трейл «По тропам Симбирского марафона»</a><span class="pull-right">4.8, число оценивших - 22 (подробнее)</span></td><td><a href="/races/city/2711/">Ульяновск</a></td><td class="text-right"><a href="/race/1/">12 км</a><br/><a href="/race/2/">5 км</a><br/><a href="/race/3/">500 м (дети)</a></td><td class="text-center"> 74 <br/> 43 <br/> (всего: 203) </td><td class="text-right"><a href="https://vk.com/simbirskiimarathon"><img/></a><br/><a href="https://new.myfinish.info/8080">Протокол</a></td></tr></table>`;
const [row] = parsePastProbeg(html);
assert.equal(row.sid, "67222");
assert.equal(row.date, "2025-10-12");
assert.equal(row.name, "VII Трейл «По тропам Симбирского марафона»", "без оценки probeg");
assert.equal(row.city, "Ульяновск");
assert.deepEqual(row.distances, ["12 км", "5 км", "500 м (дети)"]);
assert.equal(row.finishers, 203);
assert.equal(row.vk, "https://vk.com/simbirskiimarathon");

// Ключ: без года, римских и порядковых номеров и служебных слов.
assert.equal(nameKey("XIII Казанский марафон 2026"), nameKey("XIV Казанский марафон 2027"));
assert.equal(nameKey("47-й Сормовский осенний пробег"), nameKey("48-й Сормовский осенний пробег"));
assert.deepEqual([...keyTokens("Забег «Чистый спорт» 2025")], ["чистый", "спорт"]);

// Неделя года: разница по кругу (конец декабря и начало января рядом).
assert.equal(weekDiff("2025-10-12", "2026-10-11"), 0);
assert.ok(weekDiff("2025-12-28", "2027-01-03") <= 1, "через Новый год — соседние недели");
assert.ok(weekDiff("2025-10-12", "2026-11-15") > 2, "через месяц — не та неделя");

const future = [
  { id: "probeg:9001", name: "VIII Трейл «По тропам Симбирского марафона»", date_start: "2026-10-18", city: "Ульяновск", region: null },
  { id: "probeg:9002", name: "Трейл «По тропам Симбирского марафона»", date_start: "2026-12-20", city: "Ульяновск", region: null },
  { id: "probeg:9003", name: "Казанский марафон", date_start: "2027-05-02", city: "Казань", region: null },
];
// 9002 — то же название через 14 месяцев: за окном годовщины ±60 дней.
assert.equal(findNextEdition({ name: row.name, city: row.city, date: row.date }, future)?.id, "probeg:9001", "годовщина через год");
assert.equal(findNextEdition({ name: row.name, city: row.city, date: row.date }, future.filter((f) => f.id !== "probeg:9001")), null, "через 14 месяцев — не следующее проведение");
assert.equal(findNextEdition({ name: row.name, city: "Самара", date: row.date }, future), null, "другой город — не оно");
assert.equal(findNextEdition({ name: "Ночной забег", city: "Ульяновск", date: row.date }, future), null, "другое название — не оно");
assert.equal(findNextEdition({ name: "XIII Казанский марафон", city: "Казань", date: "2026-05-03" }, future)?.id, "probeg:9003");

// Следующее проведение из живого календаря (15.10.2026: 1577 ожидаемых, ни одного announced).
// Сопоставление этих шести пар было верным и раньше; не объявлялись они потому, что стадия прошла
// один раз (12.10, 11:39) до того, как строки появились в календаре (14:43 и 15:18), а «Хепо»
// 17.10.2026 к следующему прогону 18.10 выпал бы из выборки «с сегодняшнего дня» (index.ts).
const live = [
  { id: "otime:26112", name: "Хепо кросс-поход", date_start: "2026-10-17", city: "Токсово", region: "Ленинградская область", race_type: "trail" },
  { id: "otime:27011", name: "Мста Трейл", date_start: "2027-08-07", city: "Боровичи", region: "Новгородская область", race_type: "trail" },
  { id: "manual:baikal-ice-trail-2027", name: "Baikal Ice Trail", date_start: "2027-02-27", city: "Старая Ангасолка", region: "Иркутская область", race_type: "trail" },
  { id: "manual:nordman-pskovskii-marafon-2027", name: "NORDMAN Псковский Марафон 2027", date_start: "2027-04-25", city: "Псков", region: "Псковская область", race_type: "road" },
  { id: "manual:zhenskaya-semerka-2027", name: "Женская семерка", date_start: "2027-07-11", city: "Красноярск", region: "Красноярский край", race_type: "road" },
  { id: "manual:urban-trail-2026", name: "URBAN TRAIL 2026", date_start: "2026-11-15", city: "Екатеринбург", region: "Свердловская область", race_type: "trail" },
  { id: "probeg:84854", name: "Трейл «DAB Vertical Summer Night»", date_start: "2027-07-15", city: "Москва", region: "Москва", race_type: "trail" },
  { id: "ironstar:завидово-2027-08-28", name: "IRONSTAR Завидово", date_start: "2027-08-28", city: "Завидово", region: "Тверская область", race_type: "tri" },
];
const pairs: [string, string, string, string, string][] = [
  ["Хепо кросс-поход", "Токсово", "2025-10-11", "trail", "otime:26112"],
  ["Забег «Мста Трейл»", "Боровичи", "2026-08-08", "trail", "otime:27011"],
  ["Трейл «Baikal Ice Trail»", "Старая Ангасолка", "2026-02-28", "trail", "manual:baikal-ice-trail-2027"],
  ["Nordman Псковский марафон", "Псков", "2026-04-26", "road", "manual:nordman-pskovskii-marafon-2027"],
  ["Женский забег «Женская семерка»", "Красноярск", "2026-07-12", "road", "manual:zhenskaya-semerka-2027"],
  ["Забег «Urban Trail»", "Екатеринбург", "2025-11-09", "trail", "manual:urban-trail-2026"],
];
for (const [name, city, date, race_type, want] of pairs) {
  assert.equal(findNextEdition({ name, city, date, race_type }, live)?.id, want, `${name} → ${want}`);
}
// «Мста Трейл» через два года — тоже следующее проведение (пропущенный год).
assert.equal(findNextEdition({ name: "Забег «Мста Трейл»", city: "Боровичи", date: "2025-08-09", race_type: "trail" }, live)?.id, "otime:27011", "через два года");
// Ложные: другой старт серии и общий топоним. Раньше «Завидово» целиком входил в «IRONSTAR Завидово»
// (доля от меньшего ключа), а «Summer» — в «Summer Night»; теперь название сверяется в обе стороны
// и разновидность серии (ночной, летний…) должна совпасть.
assert.equal(findNextEdition({ name: "Трейл «DAB Vertical Summer»", city: "Москва", date: "2026-08-16", race_type: "trail" }, live), null, "Summer ≠ Summer Night");
assert.equal(findNextEdition({ name: "Трейл «DAB Vertical Summer»", city: "Москва", date: "2026-08-16" }, live), null, "и без типа");
assert.equal(findNextEdition({ name: "Трейл «Завидово»", city: "Завидово", date: "2026-10-03", race_type: "trail" }, live), null, "Трейл Завидово ≠ IRONSTAR Завидово");
assert.equal(findNextEdition({ name: "Трейл «Завидово»", city: "Завидово", date: "2026-10-03" }, live), null, "и без типа");
assert.ok(nameScore("Трейл «Завидово»", "IRONSTAR Завидово") < 0.75 && nameScore("DAB Vertical Summer", "DAB Vertical Summer Night") < 1);
// Далеко от годовщины: тот же «Хепо», но в календаре в марте — не следующее проведение.
assert.equal(findNextEdition({ name: "Хепо кросс-поход", city: "Токсово", date: "2025-10-11", race_type: "trail" }, [{ ...live[0], date_start: "2027-03-20" }]), null, "далеко от годовщины");
assert.ok(!nearAnniversary("2025-10-11", "2026-07-01") && nearAnniversary("2025-10-11", "2026-12-05") && !nearAnniversary("2025-10-11", "2026-12-15"));
// Город строго (без него не объявляем), тип при известных обоих.
assert.equal(findNextEdition({ name: "Хепо кросс-поход", city: "", date: "2025-10-11" }, live), null, "без города — не объявляем");
assert.equal(findNextEdition({ name: "Хепо кросс-поход", city: "Токсово", date: "2025-10-11", race_type: "road" }, live), null, "другой тип");

// Только плавание: не беговой старт (робот okRace и шлюз races-manual). Бег рядом — остаётся.
for (const n of ["X-WATERS Урал 2027", "X-WATERS МСК Руза 2027", "Х-WATERS Москва", "Заплыв через Волгу", "Кубок по плаванию на открытой воде", "Open Water Swim Cup", "Swim Fest Байкал"]) {
  assert.ok(isSwimOnly(n), `«${n}» — только плавание`);
}
assert.ok(isSwimOnly("Кубок Байкала", ["1 км заплыв", "3 км заплыв"]), "по дистанциям");
// Было: X-WATERS снимался по названию серии даже с акватлоном в дистанциях. Отменено тренером 15.10.2026:
// акватлон — это бег, такой старт остаётся (как триатлон); снимается только чистое плавание.
assert.ok(!isSwimOnly("X-WATERS Урал 2027", ["акватлон 2,5 + 1 + 2,5 км"]), "X-WATERS с акватлоном остаётся");
assert.ok(isSwimOnly("X-WATERS Урал 2027", ["заплыв 3 км", "заплыв 10 км"]), "X-WATERS только с заплывами — снимается");
assert.ok(!isSwimOnly("Altai3race OLYMPIC 2027", ["плавание 1,5 км", "вело 40 км", "бег 10 км"]), "триатлон по дистанциям — с бегом");
for (const n of ["Кижи Run&Swim 5.0", "SwimRun Карелия", "Триатлон IRONSTAR Завидово", "Акватлон «Волжский»", "Aquathlon Cup", "Заплыв и забег «Ладога»", "Трейл «Завидово»", "Ночной забег", "Ironlady и Manstar Завидово"]) {
  assert.ok(!isSwimOnly(n), `«${n}» — с бегом, остаётся`);
}

const past: PastRace[] = [
  row,
  { sid: "1", date: "2026-05-03", name: "XIII Казанский марафон", city: "Казань", distances: ["42,2 км"], finishers: 9000, vk: null, site: null },
  { sid: "2", date: "2026-06-20", name: "Ночной забег", city: "Москва", distances: ["10 км"], finishers: 21000, vk: null, site: "https://night.run" },
  { sid: "3", date: "2026-02-01", name: "Первенство по лёгкой атлетике в манеже", city: "Москва", distances: ["60 м"], finishers: 100, vk: null, site: null },
  { sid: "4", date: "2026-03-01", name: "Детский забег «Малыш»", city: "Тверь", distances: ["500 м"], finishers: 50, vk: null, site: null },
  { sid: "5", date: "2025-11-30", name: "Ночной забег", city: "Москва", distances: ["10 км"], finishers: 900, vk: null, site: null },
];
const { expected, announced } = buildExpected(past, future);
assert.deepEqual(announced.map((a) => a.id).sort(), ["probeg:1", "probeg:67222"], "уже объявленные не ожидаются");
assert.deepEqual(expected.map((e) => e.id), ["probeg:2"], "стадион и детский отсеяны, повтор берётся по свежему проведению");
assert.equal(expected[0].last_month, 6);
assert.equal(expected[0].site_url, "https://night.run");
assert.equal(expected[0].last_url, "https://probeg.org/event/2/");

assert.equal(weekWindows("2025-10-01", "2025-10-20").length, 3);
assert.deepEqual(weekWindows("2025-10-01", "2025-10-20")[2], ["2025-10-15", "2025-10-20"]);

// Место: регион и город раздельно (иначе «Приморский край, Владивосток» не находился по городу).
assert.deepEqual(splitPlace("Приморский край, Владивосток"), { city: "Владивосток", region: "Приморский край" });
assert.deepEqual(splitPlace("г. Санкт-Петербург, Пушкин"), { city: "Санкт-Петербург", region: "Санкт-Петербург" });
assert.deepEqual(splitPlace("Республика Татарстан, Лаишевский район, с. Сокуры"), { city: "Сокуры", region: "Республика Татарстан" });
assert.deepEqual(splitPlace("Ульяновск"), { city: "Ульяновск", region: null });

// Ожидаемый старт показывается без года прошлого проведения (данные не меняются).
const exRow = { id: "probeg:1", name: "Осенний марафон 2025", city: "Пермь", region: null, race_type: "road", distances: ["42,2 км"], last_month: 10, last_date: "2025-10-12", last_url: "https://probeg.org/event/1/", site_url: null };
assert.equal(toExpected(exRow).name, "Осенний марафон", "год прошлого проведения не показываем");
assert.equal(toExpected({ ...exRow, name: "Осенний марафон 2026", last_date: "2025-10-12" }).name, "Осенний марафон 2026", "год вперёд не трогаем");

console.log("check:races-expected ok");
