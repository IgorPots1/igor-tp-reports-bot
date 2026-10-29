/**
 * Источник runc.run (Беговое сообщество) в race-calendar-sync — разбор без сети (наряд 29.10.2026).
 * Образцы — куски живой вёрстки на 29.10.2026.
 *
 *   npm run check:races-runc
 */

import assert from "node:assert/strict";

import { labelStart, parseRuncEvent, parseRuncMenu, runcCity } from "../supabase/functions/race-calendar-sync/runc";
import { robotHealth, ROBOTS } from "./races-manual";

const item = (label: string, host: string, name: string) =>
  `<div class="responsive-left-runs-menu__item"> <div class="responsive-left-runs-menu__item-label">${label}</div> <a href="https://${host}.runc.run/" class="responsive-left-runs-menu__item-link">${name}</a> </div>`;
const MENU = `<div class="responsive-left-runs-menu"><div class="responsive-left-runs-menu__item"><a href="https://results.runc.run/" class="race-results-link">Результаты</a></div>
${item("25 апреля", "kids", "Детский забег")}
${item("25-26 апреля", "moscowhalf", "Московский полумарафон")}
${item("4 июля", "wnmarathon", "СБЕРПРАЙМ МАРАФОН &laquo;БЕЛЫЕ НОЧИ&raquo;")}
${item("26-27 сентября", "moscowmarathon", "СберПрайм Московский Марафон")}
${item("26-27 сентября", "moscowmarathon", "СберПрайм Московский Марафон")}
</div>`;

assert.deepEqual(
  parseRuncMenu(MENU).map((m) => [m.host, m.name, m.label]),
  [
    ["moscowhalf", "Московский полумарафон", "25-26 апреля"],
    ["wnmarathon", "СБЕРПРАЙМ МАРАФОН «БЕЛЫЕ НОЧИ»", "4 июля"],
    ["moscowmarathon", "СберПрайм Московский Марафон", "26-27 сентября"],
  ],
  "детский забег и результаты — мимо, повтор поддомена — один раз",
);
assert.deepEqual(parseRuncMenu("<html>English layout</html>"), [], "английская вёрстка без меню — пусто (робот тогда падает с ошибкой)");

assert.deepEqual(labelStart("21-22 февраля"), [21, 2]);
assert.deepEqual(labelStart("5 апреля"), [5, 4]);

const MM = `<div class="hero"><div class="date">26 сентября - 27 сентября 2026</div><h1>СберПрайм Московский Марафон</h1><div>42,2 км</div><div>эстафета</div></div>
<p>Претензии принимаются с 12:00 28 сентября 2026 года</p>`;
assert.deepEqual(parseRuncEvent(MM, "26-27 сентября"), { date_start: "2026-09-26", date_end: "2026-09-27", distances: ["42,2 км"] });

// Весенний кросс 29.10.2026: выше шапки стояло «22 февраля 2026» (сроки чего-то другого), и первая дата с
// годом давала 22.02. Берётся та, что совпала с подписью меню («11 апреля»).
const FASTDOG = `<p>Регистрация открыта с 22 февраля 2026</p><div class="hero">11 апреля 2026</div><h1>Кросс «Быстрый пёс»</h1><div>2 км</div>`;
assert.deepEqual(parseRuncEvent(FASTDOG, "11 апреля"), { date_start: "2026-04-11", date_end: "2026-04-11", distances: ["2 км"] });
assert.equal(parseRuncEvent(FASTDOG, "12 апреля"), null, "нет даты под подпись меню — не угадываем");

assert.deepEqual(parseRuncEvent("<div>30 декабря - 2 января 2027</div><div>5 км</div>", "30 декабря - 2 января"), {
  date_start: "2026-12-30",
  date_end: "2027-01-02",
  distances: ["5 км"],
}, "через Новый год — начало в прошлом году");

assert.equal(runcCity("wnmarathon"), "Санкт-Петербург");
assert.equal(runcCity("spbhalf"), "Санкт-Петербург");
assert.equal(runcCity("moscowmarathon"), "Москва");

// Шлюз знает робота (агент не вносит его старты вручную), а зимний ноль строк — не тревога.
assert.equal(ROBOTS.runc, "https://runc.run");
const run = (rows: number) => ({ started_at: "2026-11-02T22:25:00Z", stats: { sources: ["runc", "otime"], runc: { rows, new: 0, removed: 0 }, otime: { rows, new: 0, removed: 0 } }, error: null });
const health = robotHealth(["runc", "otime"], [run(0)], "2026-11-03");
assert.equal(health.find((h) => h.robot === "runc")!.alert, null, "runc: 0 предстоящих между сезонами — норма");
assert.equal(health.find((h) => h.robot === "otime")!.alert, "0 строк", "у обычного робота 0 строк по-прежнему тревога");
const broken = robotHealth(["runc"], [{ ...run(0), stats: { sources: ["runc"], runc: "error: runc.run: меню событий не разобрано (сменилась вёрстка?)" } }], "2026-11-03");
assert.match(broken[0].alert ?? "", /меню событий не разобрано/, "сломанная вёрстка — тревога");

// Повисший прогон (стадия начата, итога нет) — тревога, а не «сезонный ноль». 29.10.2026 первый прогон runc
// упал по пределу функции: runc.run не отвечает адресам облака, и строка прогона осталась без итога.
const hung = robotHealth(["runc"], [{ started_at: "2026-11-01T22:25:00Z", stats: { stage: "scrape", sources: ["runc"] }, error: null }], "2026-11-02");
assert.match(hung[0].alert ?? "", /прогон не завершился/, "зависший прогон — тревога");

console.log("check:races-runc ok");
