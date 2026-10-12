/**
 * Шлюз ручных стартов (scripts/races-manual.ts): правила, которые еженедельный
 * агент не может обойти, потому что они в коде.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — дубль по правилу тренера: дата ±2 дня И (похожее название ИЛИ тот же
 *     город и тип). Дата в 3 дня уже не дубль;
 *   — окно: от сегодня до 31.12 следующего года;
 *   — insert без source_url, с чужим race_type или тегом, онлайн, детский,
 *     абонемент, кемп, велогонка отклоняются;
 *   — update только ручных строк и только разрешённых полей; status через
 *     update не меняется (убрать можно только командой remove с причиной);
 *   — реестр источников не принимает сайты, которые собирает робот;
 *     dead перепроверяется раз в 90 дней.
 *
 *   npm run check:races-manual
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  dateText,
  CITIES_PER_WEEK,
  dueCities,
  dueSources,
  findDuplicate,
  findVisibleTwin,
  inWindow,
  isTwin,
  markCities,
  isAutoCollected,
  manualId,
  meaningfulMatch,
  meaningfulTokens,
  mergeSources,
  normalizeRegistry,
  promoteSources,
  robotCandidates,
  robotHealth,
  ROBOTS,
  sourceMatches,
  tierAlert,
  placesDiffer,
  slimVkCommunityPosts,
  VK_METHODS,
  VK_MIN_INTERVAL_MS,
  VK_SEARCH_WORDS,
  isVkRaceCandidate,
  vkQueriesForCity,
  vkSweepYear,
  nameSimilar,
  validateInsert,
  validateSuggestionVerdict,
  validateUpdate,
  weeklySummary,
  type CalendarRow,
  type RaceInsert,
  type Source,
} from "./races-manual";

const TODAY = "2026-10-11";

// Похожесть названий.
assert.ok(nameSimilar("Кросс «Лисья гора»", "Лисья Гора - кросс 2026"));
assert.ok(nameSimilar("100-й Петербургский Марафон. Пушкин - Петербург", "Марафон «Пушкин — Петербург»"));
assert.ok(!nameSimilar("Новогодний забег", "Рождественский забег"), "общие служебные слова не делают похожими");
assert.ok(!nameSimilar("Забег", "Пробег"), "без значимых слов не похожи");

// Дубль: дата ±2 И (имя ИЛИ город+тип).
const cal: CalendarRow[] = [
  { id: "probeg:1", name: "Казанский марафон", date_start: "2027-05-02", date_end: null, city: "Казань", race_type: "road" },
  { id: "orgeo:2", name: "Кубок области", date_start: "2027-06-10", date_end: null, city: "Тверь", race_type: "tri" },
  { id: "probeg:3", name: "Забег «Лужники»", date_start: "2027-07-10", date_end: null, city: "Москва", race_type: "road" },
  { id: "probeg:4", name: "Белые ночи", date_start: "2027-07-10", date_end: null, city: "Санкт-Петербург", race_type: "road" },
];
const ins = (o: Partial<RaceInsert>) => ({ name: "X", date_start: "2027-05-02", city: "Пермь", race_type: "road", ...o });
assert.equal(findDuplicate(ins({ name: "Казанский марафон 2027", date_start: "2027-05-04" }), cal)?.id, "probeg:1", "имя, +2 дня");
assert.equal(findDuplicate(ins({ name: "Казанский марафон", date_start: "2027-05-05" }), cal), null, "3 дня уже не дубль");
assert.equal(findDuplicate(ins({ name: "Совсем другое", city: "Тверь", race_type: "tri", date_start: "2027-06-11" }), cal)?.id, "orgeo:2", "город и тип");
assert.equal(findDuplicate(ins({ name: "Совсем другое", city: "Тверь", race_type: "road", date_start: "2027-06-11" }), cal), null, "город тот, тип другой");
// Было: «тот же город и тип ±2 дня» срабатывало везде, и в Москве разные старты одних выходных
// склеивались в дубль (ложные отказы шлюза). С 12.10.2026 правило только для небольших городов,
// как sameRace в edge-функции; в крупных дубль только по названию.
assert.equal(findDuplicate(ins({ name: "Совсем другое", city: "Москва", race_type: "road", date_start: "2027-07-11" }), cal), null, "Москва: город и тип — не дубль");
assert.equal(findDuplicate(ins({ name: "Совсем другое", city: "Санкт-Петербург", race_type: "road", date_start: "2027-07-10" }), cal), null, "Петербург: город и тип — не дубль");
assert.equal(findDuplicate(ins({ name: "Забег Лужники 2027", city: "Москва", race_type: "road", date_start: "2027-07-11" }), cal)?.id, "probeg:3", "Москва: по названию дубль ловится");

// Двойник в основном потоке (снятие ручной строки): строже дубля при вставке.
// Три ложных совпадения от 11.10.2026 держим как запрет: другой город и одно общее слово.
const tw = (name: string, city: string, date = "2026-10-11") => ({ name, city, date_start: date });
assert.ok(isTwin(tw("ОСЕНЬ трейл", "Зеленая Поляна"), tw("ОСЕНЬ трейл", "Зеленая Поляна")), "тот же старт");
assert.ok(isTwin(tw("Осенний кросс", "Запрудня"), tw("Осенний кросс", "Запрудня")), "тот же город");
assert.ok(!isTwin(tw("Осенний кросс", "Запрудня"), tw("Первенство ЗАТО г. Североморск по бегу «Осенний кросс»", "Североморск")));
assert.ok(!isTwin(tw("Новогодний дуатлон-кросс", "Красноярск", "2026-12-31"), tw("Новогодний хоровод", "Обнинск", "2026-12-31")));
assert.ok(!isTwin(tw("РОЖДЕСТВЕНСКИЙ ЗАБЕГ", "Москва", "2027-01-07"), tw("Пробег «Рождественский забег-2027»", "Ростов-на-Дону", "2027-01-07")));
assert.ok(isTwin(tw("100-й Петербургский Марафон. Пушкин - Петербург", "Санкт-Петербург", "2027-09-05"), tw("Марафон «Пушкин - Петербург»", "Пушкин", "2027-09-05")), "два общих слова без города");
assert.ok(!isTwin(tw("ОСЕНЬ трейл", "Зеленая Поляна"), tw("ОСЕНЬ трейл", "Зеленая Поляна", "2026-10-12")), "другой день");

// Двойник только среди видимых во view строк под чужим id. 11.10.2026 ручную
// строку сняли из-за двойника, которого робот склеил с другим стартом, и старт
// пропал с сайта. Видимость теперь условие: в view склеенной строки нет, значит
// и двойника нет. Сама ручная строка двойником себе не считается.
const view = [
  { id: "manual:osen-treil-2026", name: "ОСЕНЬ трейл", date_start: "2026-10-11", city: "Зеленая Поляна" },
  { id: "probeg:85636", name: "Первенство ЗАТО г. Североморск по бегу «Осенний кросс»", date_start: "2026-10-11", city: "Североморск" },
];
assert.equal(findVisibleTwin(tw("ОСЕНЬ трейл", "Зеленая Поляна"), view), null, "склеенного двойника во view нет, ручную не трогаем");
assert.equal(findVisibleTwin(tw("ОСЕНЬ трейл", "Зеленая Поляна"), [...view, { id: "myrace:2152", name: "ОСЕНЬ трейл", date_start: "2026-10-11", city: "Зеленая Поляна" }])?.id, "myrace:2152", "видимый двойник снимает");

// Окно.
assert.ok(inWindow("2026-10-11", TODAY) && inWindow("2027-12-31", TODAY));
assert.ok(!inWindow("2026-10-10", TODAY) && !inWindow("2028-01-01", TODAY));

// Валидация вставки.
const good: RaceInsert = {
  name: "Трейл «Аргамак»", date_start: "2027-05-30", city: "Аргамач-Пальна", race_type: "trail",
  source_url: "https://reg.russiarunning.com/event/argamak2027", tags: ["fest"], dist_km: [20, 7],
};
assert.deepEqual(validateInsert(good, TODAY), []);
assert.ok(validateInsert({ ...good, source_url: "" }, TODAY).length, "без подтверждения нельзя");
assert.ok(validateInsert({ ...good, race_type: "bike" }, TODAY).length);
assert.ok(validateInsert({ ...good, tags: ["kids"] }, TODAY).length);
for (const bad of ["Онлайн-забег", "Детский забег", "Беговой кемп", "Абонемент", "Велогонка"]) {
  assert.ok(validateInsert({ ...good, name: bad }, TODAY).length, `«${bad}» отклоняется`);
}

// Update: только ручные, только разрешённые поля, status нельзя.
assert.deepEqual(validateUpdate({ id: "manual:x-2027", reason: "перенос", date_start: "2027-06-01" }, TODAY), []);
assert.ok(validateUpdate({ id: "probeg:1", reason: "x", date_start: "2027-06-01" }, TODAY).length, "не ручная строка");
assert.ok(validateUpdate({ id: "manual:x", reason: "x", status: "active" } as never, TODAY).length, "status через update нельзя");
assert.ok(validateUpdate({ id: "manual:x", reason: "x", source: "probeg" } as never, TODAY).length, "source менять нельзя");
assert.ok(validateUpdate({ id: "manual:x", reason: "" }, TODAY).length, "без причины нельзя");

// Формат id и даты.
assert.equal(manualId("АРГАМАК ТРЕЙЛ 2027", "2027-05-30"), "manual:argamak-treil-2027");
assert.equal(manualId("Игры ЭкстримКрым", "2027-07-23"), "manual:igry-ekstrimkrym-2027");
assert.equal(dateText("2027-07-23", "2027-07-25"), "23-25.07.2027");
assert.equal(dateText("2027-05-30", "2027-05-30"), "30.05.2027");

// Реестр.
assert.ok(isAutoCollected("https://probeg.org/event/1/") && isAutoCollected("https://www.reg.place/x") && !isAutoCollected("https://reg.russiarunning.com/event/x"));
assert.ok(isAutoCollected("https://reg.o-time.ru/race/26646"), "o-time собирает робот (наряд 12.10.2026): агент по нему не ходит");
assert.ok(isAutoCollected("https://heroleague.ru/race") && isAutoCollected("https://xn--80acghh.xn--p1ai/Тверь"), "Лигу Героев и забег.рф собирает робот heroleague");
const reg: Source[] = [];
const m1 = mergeSources(reg, [{ url: "https://x-waters.com/events/ural/", kind: "series" }, { url: "https://probeg.org/event/5/" }], TODAY);
assert.equal(m1.added.length, 1);
assert.equal(m1.rejected.length, 1, "автосбор отклонён");
assert.equal(m1.reg[0].tier, "B", "X-Waters - серия, уровень B");
assert.equal(m1.reg[0].status, "ok");
const m2 = mergeSources(m1.reg, [{ url: "https://x-waters.com/events/ural", status: "dead", note: "404" }], "2026-10-18");
assert.equal(m2.added.length, 0, "тот же сайт без слэша не дубль");
assert.equal(m2.reg[0].status, "dead");
assert.equal(dueSources(m2.reg, "2026-12-01").length, 0, "dead раньше 90 дней не обходим");
assert.equal(dueSources(m2.reg, "2027-01-17").length, 1, "dead через 90 дней перепроверяем");
assert.equal(mergeSources([], [{ url: "https://site.example/", status: "blocked" }], TODAY).reg[0].next_check, "2027-01-09", "blocked тоже раз в 90 дней (TODAY + 90)");

// Уровни (наряд 12.10.2026). БЫЛО: dueSources отдавал агенту ВСЕ active каждую неделю (228 сайтов,
// большинство одного старта). Отменено: B каждую неделю, C раз в месяц (каждую неделю за 3 месяца до
// прошлогодней даты), A никогда. Держим и «когда идти», и «когда НЕ идти» — иначе C снова поедут еженедельно.
{
  const one = (tier: "B" | "C", last: string) => mergeSources([], [{ url: `https://${tier}.example/`, tier, last_checked: last }], last).reg;
  assert.equal(dueSources(one("B", "2026-10-12"), "2026-10-18").length, 0, "B через 6 дней ещё рано");
  assert.equal(dueSources(one("B", "2026-10-12"), "2026-10-19").length, 1, "B через неделю");
  assert.equal(dueSources(one("C", "2026-10-12"), "2026-10-19").length, 0, "C через неделю НЕ обходим");
  assert.equal(dueSources(one("C", "2026-10-12"), "2026-11-10").length, 0, "C через 29 дней ещё рано");
  assert.equal(dueSources(one("C", "2026-10-12"), "2026-11-11").length, 1, "C через месяц");
  assert.equal(dueSources(one("C", "2026-10-12"), "2026-10-19", new Set(["c.example"])).length, 1, "C у прошлогодней даты - каждую неделю");
  const legacy = normalizeRegistry([
    { url: "https://a.example/", kind: "organizer", status: "active" as never, last_checked: "2026-10-12" },
    { url: "https://b.example/", kind: "calendar", status: "js_only" as never, last_checked: "2026-10-12" },
    { url: "https://c.example/", kind: "calendar", status: "mirror" as never, note: "копия probeg" },
    { url: "https://reg.o-time.ru/calendar", kind: "calendar", status: "active" as never },
  ]);
  assert.deepEqual(legacy.slice(0, 3).map((s) => `${s.tier}/${s.status}`), ["C/ok", "B/ok", "B/dead"], "старые статусы: active и js_only -> ok, mirror -> dead");
  assert.match(legacy[2].note, /^зеркало/);
  assert.ok(!legacy.some((s) => s.url === "https://reg.o-time.ru/calendar" && s.tier !== "A"), "старая запись агента по сайту робота уходит");
  assert.deepEqual(legacy.filter((s) => s.tier === "A").map((s) => s.robot).sort(), Object.keys(ROBOTS).sort(), "у каждого робота одна запись A");
  assert.equal(dueSources(legacy, "2027-06-01").filter((s) => s.tier === "A").length, 0, "A агент не обходит никогда");
}
assert.ok(sourceMatches("https://vk.com/rltrail", "https://vk.ru/rltrail?w=wall-1_2"), "vk.ru и vk.com - один паблик");
assert.ok(!sourceMatches("https://vk.com/rl", "https://vk.com/rltrail"), "паблик по пути целиком, не по началу имени");
assert.ok(sourceMatches("https://startrail.ru/", "https://startrail.ru/lwtrail") && !sourceMatches("https://startrail.ru/", "https://startrail.ru.evil/x"));
assert.ok(!sourceMatches("https://reg.russiarunning.com/event/A", "https://reg.russiarunning.com/event/B"), "страница события на площадке - не вся площадка");

// Робот (A) по race_sync_runs: тревога на ошибку, ноль, падение больше 50 %, долгую тишину; новичок - не тревога.
{
  const run = (day: string, robot: string, st: unknown) => ({ started_at: `${day}T22:07:00Z`, stats: { stage: "scrape", sources: [robot], [robot]: st }, error: null });
  const h = robotHealth(["probeg", "orgeo", "where2run", "myrace", "regplace", "otime"], [
    run("2026-10-11", "probeg", { rows: 397, new: 2 }), run("2026-10-04", "probeg", { rows: 390, new: 1 }),
    run("2026-10-11", "orgeo", "error: 503"),
    run("2026-10-11", "where2run", { rows: 0, new: 0 }),
    run("2026-10-11", "myrace", { rows: 14, new: 0 }), run("2026-10-04", "myrace", { rows: 31, new: 0 }),
    run("2026-09-27", "regplace", { rows: 12, new: 0 }),
  ], "2026-10-12");
  assert.deepEqual(h.map((x) => x.alert === null ? "ok" : x.alert.split(":")[0].split(" ")[0]), ["ok", "ошибка", "0", "строк", "не", "ok"]);
  assert.equal(h[0].new, 2);
  assert.equal(h[5].ranAt, null, "otime до деплоя: не тревога, а «ещё не собирался»");
}

// Повышение C→B от 5 новых за 30 дней; кандидат в робота - один раз.
{
  const r = mergeSources([], [{ url: "https://five.example/", kind: "organizer" }, { url: "https://four.example/", kind: "organizer" }], TODAY).reg;
  const up = promoteSources(r, new Map([["five.example", 5], ["four.example", 4]]), TODAY);
  assert.deepEqual(up.map((s) => s.url), ["https://five.example/"]);
  assert.equal(r[1].tier, "C", "4 новых - не повышаем");
  r[0].races_found_total = 10;
  assert.equal(robotCandidates(r, TODAY).length, 1);
  assert.equal(robotCandidates(r, "2026-10-19").length, 0, "кандидат в робота пишется Игорю один раз");
  // Свой порог (решение Игоря 12.10.2026): goldenultra и др. - не раньше 25 стартов; blocked - никогда.
  const own = mergeSources([], [{ url: "https://own.example/", kind: "series" }, { url: "https://rr.example/", kind: "calendar", status: "blocked" }], TODAY).reg;
  own[0].races_found_total = 24; own[0].robot_candidate_min = 25;
  own[1].races_found_total = 140;
  assert.equal(robotCandidates(own, TODAY).length, 0, "24 из 25 - рано; blocked с 140 - никогда");
  own[0].races_found_total = 25;
  assert.equal(robotCandidates(own, TODAY).length, 1);
  const alert = tierAlert({ byTier: { A: 0, B: 0, C: 0, fishing: 0 }, robots: [{ robot: "orgeo", rows: null, new: null, prevRows: null, ranAt: "2026-10-11", alert: "0 строк" }], promoted: up, candidates: [], broken: [] });
  assert.match(alert || "", /робот orgeo: 0 строк/);
  assert.match(alert || "", /повышен C→B: https:\/\/five\.example\//);
  assert.equal(tierAlert({ byTier: { A: 3, B: 1, C: 0, fishing: 2 }, robots: [], promoted: [], candidates: [], broken: [] }), null, "без событий не пишем");
}

// Заявки с сайта: вердикт агента проверяется до записи.
const uuid = "0b7f2a8e-3c1d-4e5f-9a6b-7c8d9e0f1a2b";
assert.equal(validateSuggestionVerdict({ id: uuid, status: "rejected", note: "онлайн-забег" }), null);
assert.ok(validateSuggestionVerdict({ id: uuid, status: "added", note: "есть" }), "added без insert нельзя");
assert.ok(validateSuggestionVerdict({ id: uuid, status: "rejected", note: " " }), "без причины нельзя");
assert.ok(validateSuggestionVerdict({ id: "manual:x", status: "rejected", note: "x" }), "id заявки только uuid");
assert.ok(validateSuggestionVerdict({ id: uuid, status: "new" as never, note: "x" }), "вернуть в new нельзя");

// Точки обхода: никогда не проверенные первыми, дальше самые давние; круг без пропусков.
const pts = [
  { name: "Казань", region: "", kind: "city" as const, last_searched: "2026-10-04" },
  { name: "Кандалакша", region: "", kind: "spot" as const, last_searched: null },
  { name: "Москва", region: "", kind: "city" as const, last_searched: "2026-09-27" },
];
assert.deepEqual(dueCities(pts, 2).map((c) => c.name), ["Кандалакша", "Москва"]);
assert.equal(markCities(pts, ["кандалакша", "Москва", "Нет такого"], "2026-10-11"), 2, "регистр не важен, чужое имя не помечается");
assert.deepEqual(dueCities(pts, 1).map((c) => c.name), ["Казань"], "после отметки следующей идёт самая давняя");
// Было 25 точек в неделю (наряд), стало 35: при 208 точках 25 давали круг ~8 недель.
// Держим главное свойство, а не число: полный круг не длиннее 6 недель.
const seedCount = (JSON.parse(readFileSync("scripts/races-cities.json", "utf8")) as unknown[]).length;
assert.ok(Math.ceil(seedCount / CITIES_PER_WEEK) <= 6, `круг ${Math.ceil(seedCount / CITIES_PER_WEEK)} недель при ${seedCount} точках и ${CITIES_PER_WEEK} в неделю`);

// Итог недели в ops-log.
const sum = weeklySummary({
  apply: true,
  today: TODAY,
  proposal: { checked: ["manual:a"], candidates: [{ url: "https://cal.example/list", races: 40, dated_with_year: true }], queries: ["триатлон Казань 2027"] },
  out: [
    { kind: "added", id: "manual:t-2027", text: "...", link: "https://t.example", tri: true },
    { kind: "removed", id: "manual:b-2026", text: "появился в основном потоке: probeg:9" },
  ],
  merged: { added: [], changed: [], rejected: [] },
  activeTotal: 12,
});
assert.match(sum, /добавлено 1 \(из них триатлонов 1\)/);
// Было «всего active 12»: статуса active больше нет (ok/dead/blocked, 12.10.2026), считаем живые B и C.
assert.match(sum, /всего в работе \(ok, B и C\) 12/);
assert.match(sum, /Кандидаты в автосбор:\n- https:\/\/cal\.example\/list: около 40 стартов/);
assert.ok(!/[—–]/.test(sum), "без длинных тире");
assert.match(sum, /Заявки с сайта: разобрано 0/);
assert.match(sum, /ВК: не искали/);

// --- ВК (наряд 12.10): только открытые сообщества, без данных людей, лимит 3 запроса в секунду.
// groups.search сервисному ключу недоступен (15 Access denied) — его нет в списке методов.
assert.ok(!VK_METHODS.has("groups.search") && VK_METHODS.has("newsfeed.search") && VK_METHODS.has("wall.get"));
assert.ok(VK_MIN_INTERVAL_MS >= 334, "не чаще 3 запросов в секунду");
assert.deepEqual(vkQueriesForCity("Казань", 2027).slice(0, 2), ["трейл Казань 2027", "забег Казань 2027"]);
assert.equal(VK_SEARCH_WORDS.length, 8);
assert.ok(VK_SEARCH_WORDS.includes("акватлон") && VK_SEARCH_WORDS.includes("скайраннинг"));
{
  const posts = [
    { id: 1, owner_id: -100, from_id: -100, date: 1797638400, text: "Трейл 13 марта 2027", signer_id: 555 },
    { id: 2, owner_id: 777, from_id: 777, date: 1797638400, text: "я бегу трейл" }, // человек
    { id: 3, owner_id: -200, from_id: -200, date: 1797638400, text: "закрытая группа" },
    { id: 4, owner_id: -100, from_id: 888, date: 1797638400, text: "пост участника на стене" },
  ];
  const groups = [
    { id: 100, name: "Aurora Trail", screen_name: "auroratrail", is_closed: 0 },
    { id: 200, name: "Закрытый клуб", screen_name: "closed", is_closed: 1 },
  ];
  const feed = slimVkCommunityPosts(posts, groups);
  assert.deepEqual(feed.map((p) => p.url), ["https://vk.com/wall-100_1", "https://vk.com/wall-100_4"], "люди и закрытые группы отброшены");
  assert.deepEqual(Object.keys(feed[0]).sort(), ["date", "group", "group_url", "text", "url"], "ни автора, ни подписи");
  assert.ok(!JSON.stringify(feed).includes("555") && !JSON.stringify(feed).includes("777"));
  const wall = slimVkCommunityPosts(posts, groups, { fromGroupOnly: true });
  assert.deepEqual(wall.map((p) => p.url), ["https://vk.com/wall-100_1"], "на стене — только посты самой группы");
}

// --- дубль между разными местами: только по значимым словам (как sameRace в edge-функции
// race-calendar-sync, 12.10.2026). Было: одного общего слова хватало — «Лесландия. Night» в Мяглово
// и «DAB Vertical Autumn Night» в Москве шлюз назвал дублем из-за «night», а «Осенний кросс» в
// Талдоме и в Североморске — из-за «осенний». Теперь общие слова (сезон, ночной, старт, забег,
// трейл, кросс, фестиваль, кубок, этап, серия, city run…) между разными местами не считаются.
{
  const cal: CalendarRow[] = [
    { id: "probeg:75797", name: "Трейл «Лесландия. Night»", date_start: "2026-11-28", date_end: "2026-11-28", city: "Мяглово", region: "Ленинградская область", race_type: "trail" },
    { id: "probeg:9001", name: "ВьюнОк Трейл | GoodTrail", date_start: "2027-05-15", date_end: "2027-05-15", city: "Куйвози", region: "", race_type: "trail" },
    { id: "probeg:9002", name: "Первенство ЗАТО г. Североморск по бегу «Осенний кросс»", date_start: "2026-10-18", date_end: "2026-10-18", city: "Североморск", region: "Мурманская область", race_type: "trail" },
  ];
  const at = (name: string, city: string, date: string, region = "") =>
    ({ name, date_start: date, date_end: date, city, region, race_type: "trail" }) as unknown as RaceInsert;
  assert.ok(!meaningfulMatch("Лесландия. Night", "DAB Vertical Autumn Night"), "общий только «night»");
  assert.deepEqual([...meaningfulTokens("DAB Vertical Autumn Night")].sort(), ["dab", "vertical"]);
  assert.ok(placesDiffer({ city: "Москва", region: "Москва" }, { city: "Мяглово", region: "Ленинградская область" }));
  assert.ok(!placesDiffer({ city: "Гарболово", region: "Ленинградская область" }, { city: "Куйвози", region: "Ленинградская область" }), "тот же регион");
  assert.ok(!placesDiffer({ city: "Пушкин", region: null }, { city: "", region: null }), "место неизвестно — правило молчит");
  assert.equal(findDuplicate(at("DAB Vertical Autumn Night", "Москва", "2026-11-28", "Москва"), cal), null, "Лесландия (Мяглово) и DAB (Москва) — не дубли");
  assert.equal(findDuplicate(at("Вьюнок Трейл", "Гарболово", "2027-05-15"), cal)?.id, "probeg:9001", "Вьюнок: Гарболово ~ Куйвози, регион неизвестен — дубль по значимому слову");
  assert.equal(findDuplicate(at("Вьюнок Трейл", "Гарболово", "2027-05-15", "Ленинградская область"), cal)?.id, "probeg:9001", "Вьюнок: с регионом тоже дубль");
  assert.equal(findDuplicate(at("Осенний кросс", "Талдом", "2026-10-18", "Московская область"), cal), null, "«Осенний кросс» Талдом и Североморск — не дубли");
  assert.ok(!isTwin(tw("DAB Vertical Autumn Night", "Москва", "2026-11-28"), tw("Трейл «Лесландия. Night»", "Мяглово", "2026-11-28")), "и для снятия ручного старта");
}

// --- vk-sweep: отбор постов. Дата словами («18 апреля 2027») проходит — первый полный проход
// 12.10.2026 её терял из-за \b у кириллицы; реклама туров и итоги отсекаются; старше 180 дней — нет.
{
  const today = "2026-10-12";
  assert.ok(isVkRaceCandidate({ date: "2026-09-23", text: "Открыли регистрацию на весенний трейл! 🗓️18 апреля 2027, г. Истра" }, today));
  assert.ok(isVkRaceCandidate({ date: "2026-09-13", text: "17 июля 2027 года K-RUN проводит Ультратрейл «Восьмерка»" }, today));
  assert.ok(isVkRaceCandidate({ date: "2026-08-31", text: "Челябинский марафон 2027: 📆 Когда: 22.08.2027" }, today));
  assert.ok(isVkRaceCandidate({ date: "2026-08-23", text: "ТрейлФест 7 – 8 ноября 2026 г." }, today), "диапазон дней");
  assert.ok(!isVkRaceCandidate({ date: "2026-10-10", text: "Турция, раннее бронирование, вылет 9 мая, отель 5*, марафон скидок" }, today), "туры");
  assert.ok(!isVkRaceCandidate({ date: "2026-10-04", text: "Итоги забега 4 октября: результаты" }, today), "итоги");
  assert.ok(!isVkRaceCandidate({ date: "2026-01-02", text: "Трейл 18 апреля 2026" }, today), "старше 180 дней");
  assert.ok(!isVkRaceCandidate({ date: "2026-10-01", text: "Трейл в субботу, приходите" }, today), "без даты");
  assert.equal(vkSweepYear("2026-10-12"), 2027);
  assert.equal(vkSweepYear("2027-03-01"), 2027);
}

console.log("check:races-manual ok");
