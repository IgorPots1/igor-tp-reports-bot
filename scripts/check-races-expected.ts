/**
 * Ожидаемые старты (supabase/functions/race-calendar-sync/expected.ts): разбор прошедших
 * стартов probeg, ключ названия без года и номера, «следующее проведение» по неделе года ±2,
 * городу и названию, отсев стадиона, детского и не бегового.
 *
 *   npm run check:races-expected
 */

import assert from "node:assert/strict";

import {
  buildExpected,
  findNextEdition,
  keyTokens,
  nameKey,
  parsePastProbeg,
  splitPlace,
  weekDiff,
  weekWindows,
  type PastRace,
} from "../supabase/functions/race-calendar-sync/expected";

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
assert.equal(findNextEdition({ name: row.name, city: row.city, date: row.date }, future)?.id, "probeg:9001", "та же неделя через год");
assert.equal(findNextEdition({ name: row.name, city: "Самара", date: row.date }, future), null, "другой город — не оно");
assert.equal(findNextEdition({ name: "Ночной забег", city: "Ульяновск", date: row.date }, future), null, "другое название — не оно");
assert.equal(findNextEdition({ name: "XIII Казанский марафон", city: "Казань", date: "2026-05-03" }, future)?.id, "probeg:9003");

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

console.log("check:races-expected ok");
