/* Календарь по частям (наряд 30.10.2026, второй этап защиты от выкачивания).
 *
 * Держит:
 *  1) ни один ответ /api/races/query не несёт больше MAX_ITEMS (50) стартов — при любых offset/limit;
 *  2) порции месяцев складываются ровно в прежний список, без дыр и повторов;
 *  3) сервер считает то же, что раньше считал браузер по полному списку (эталон ниже — дословный
 *     перенос логики из RacesCalendar.tsx до 30.10.2026): список, месяцы, счётчики на чипах и сезонах,
 *     «страница города», ожидаемые наверху, «Рядом в области», ожидаемые по месяцам, «Мои забеги»;
 *  4) мусор в адресе не роняет и не обходит потолок.
 *
 * npm run check:races-paged — без сети и базы. */

import assert from "node:assert/strict";

import {
  FEW_CITY_RACES,
  areaRaces,
  expectedCities,
  expectedDateMd,
  inUserCity,
  placeFromQuery,
  placePoint,
  placeSubject,
  publicExpected,
  seasons,
  sortCityExpected,
  type ExpectedItem,
  type PublicExpected,
} from "@/features/races-bot/core";
import { matchesQuery, queryWords, searchText } from "@/features/race-search/search";
import {
  MAX_ITEMS,
  PAGE,
  itemCount,
  metaOf,
  parseQuery,
  queryParams,
  runQuery,
  summary,
  type Ctx,
  type Query,
} from "@/app/races/race-query";
import { DISTS, NO_FILTERS, TYPES, applyFilters, distMatch, inRange, norm, publicRace, toRace, type Filters, type Race, type RaceRow } from "@/app/races/races-logic";

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── данные: 600 стартов на 14 месяцев, города с точками и без, ожидаемые ─────────
const TODAY = "2026-10-30";
const CITIES: [string, string, number | null, number | null][] = [
  ["Москва", "Москва", 55.75, 37.62],
  ["Тверь", "Тверская область", 56.86, 35.9],
  ["Старица", "Тверская область", 56.51, 34.93],
  ["Торжок", "Тверская область", 57.04, 34.96],
  ["Казань", "Республика Татарстан", 55.79, 49.12],
  ["Санкт-Петербург", "Санкт-Петербург", 59.94, 30.31],
  ["Сочи", "Краснодарский край", 43.6, 39.73],
  ["Кировск", "Мурманская область", null, null],
];
const NAMES = ["Осенний кросс", "Ночной забег", "Полумарафон", "Марафон", "Трейл Лисья гора", "Забег.РФ", "Белые ночи", "Гонка героев"];
const DIST: [string[], number[]][] = [
  [["5 км", "10 км"], [5, 10]],
  [["21,1 км"], [21.1]],
  [["42,2 км"], [42.195]],
  [["50 км"], [50]],
  [["3 км"], [3]],
];
const TYPES_DB = ["road", "trail", "tri", "track"];

function rows(): RaceRow[] {
  const out: RaceRow[] = [];
  for (let i = 0; i < 600; i++) {
    const [city, region, lat, lon] = CITIES[i % CITIES.length];
    const month = (i * 7) % 14; // 0..13 месяцев от ноября 2026
    const y = 2026 + Math.floor((10 + month) / 12);
    const m = ((10 + month) % 12) + 1;
    const d = 1 + ((i * 13) % 27);
    const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const [distances, km] = DIST[i % DIST.length];
    out.push({
      id: `t:${i}`, source: "probeg", source_url: `https://probeg.org/event/${i}/`, name: `${NAMES[i % NAMES.length]} ${city} ${i}`,
      date_start: ds, date_end: i % 11 === 0 ? ds.replace(/-(\d\d)$/, (_, dd) => `-${String(Math.min(28, Number(dd) + 1)).padStart(2, "0")}`) : null,
      city, region, distances, dist_km: km, race_type: TYPES_DB[i % TYPES_DB.length], tags: km.some((k) => k > 42.5) ? ["ultra"] : [],
      site_url: null, reg_url: null, vk_url: null, sources: i % 3 ? ["probeg"] : ["probeg", "marathonec"], link_ok: true, alt_dates: [], checked_note: null,
      subject: region, lat, lon,
    } as RaceRow);
  }
  // уже прошедший — в календарь не попадает
  out.push({ ...out[0], id: "t:past", date_start: "2026-10-01", date_end: null });
  return out;
}

function expectedItems(): ExpectedItem[] {
  const out: ExpectedItem[] = [];
  const cities: [string, string, { lat: number; lon: number } | null][] = [
    ["Иваново", "Ивановская область", { lat: 57.0, lon: 40.97 }],
    ["Тверь", "Тверская область", { lat: 56.86, lon: 35.9 }],
    ["Москва", "Москва", { lat: 55.75, lon: 37.62 }],
    ["Казань", "Республика Татарстан", null],
  ];
  for (let i = 0; i < 260; i++) {
    const [city, region, geo] = cities[i % cities.length];
    const m = 1 + (i % 12);
    out.push({
      id: `probeg:e${i}`, name: `${NAMES[i % NAMES.length]} ${city}`, city, region, subject: region, geo,
      type: TYPES_DB[i % 3], distances: ["10 км"], km: [10], lastMonth: m,
      lastDate: `2025-${String(m).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`, lastUrl: "https://probeg.org/event/1/", site: "",
      finishers: i % 5 === 0 ? 900 : 100,
    });
  }
  return out;
}

const races: Race[] = rows()
  .map(toRace)
  .filter((r) => r.de >= TODAY)
  .sort((a, b) => a.ds.localeCompare(b.ds) || a.name.localeCompare(b.name, "ru"))
  .map((r) => ({ ...publicRace(r), dateFixed: false }));
const expected: PublicExpected[] = expectedItems().map(publicExpected);
const ctx: Ctx = { races, expected, today: TODAY };

// ── эталон: логика браузера до 30.10.2026 (RacesCalendar.tsx), перенесена дословно ─────
function before(f: Filters, mine: Set<string> | null) {
  const cities = (() => {
    const counts = new Map<string, number>();
    for (const r of races) if (r.city) counts.set(r.city, (counts.get(r.city) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  })();
  const seasonTabs = seasons(TODAY);
  const season = seasonTabs.find((s) => s.key === f.season && s.key !== "all") ?? null;
  const placeCities = [...new Set([...cities, ...expectedCities(expected)])];
  const place = placeFromQuery(f.q, placeCities);
  const filt = (rs: Race[], skip?: "type" | "dist") => (place ? applyFilters(rs, { ...f, q: "" }, skip).filter((r) => inUserCity(r, place)) : applyFilters(rs, f, skip));
  const base = filt(races).filter((r) => !season || inRange(r, season.from, season.to));
  const list = mine ? base.filter((r) => mine.has(r.id)) : base;
  const cityCount = place ? filt(races).length : 0;
  const cityExpected = (() => {
    if (!place || mine || cityCount >= FEW_CITY_RACES) return [];
    const c = norm(place);
    const xs = expected.filter(
      (e) => (norm(e.city) === c || norm(e.region) === c) && (f.type === "all" || e.type === f.type) && (f.dist === "all" || distMatch({ km: e.km, tags: [] } as unknown as Race, f.dist)),
    );
    return sortCityExpected(xs, (e) => e.big, (e) => expectedDateMd(e.md, TODAY));
  })();
  const expectedByMonth = (() => {
    if (mine) return [] as [number, PublicExpected[]][];
    const words = queryWords(f.q);
    const top = new Set(cityExpected.map((e) => e.id));
    const shown = expected.filter((e) => {
      if (top.has(e.id)) return false;
      if (f.type !== "all" && e.type !== f.type) return false;
      if (f.dist !== "all" && !distMatch({ km: e.km, tags: [] } as unknown as Race, f.dist)) return false;
      if (f.region && e.subject !== f.region) return false;
      if (season) {
        const d = expectedDateMd(e.md, TODAY);
        if (d < season.from || d > season.to) return false;
      }
      return matchesQuery(searchText(e.name, e.city, e.region, e.subject), words);
    });
    const by = new Map<number, PublicExpected[]>();
    for (const e of shown) by.set(e.lastMonth, [...(by.get(e.lastMonth) || []), e]);
    const startM = Number(TODAY.slice(5, 7));
    return [...by.entries()].sort((a, b) => ((a[0] - startM + 12) % 12) - ((b[0] - startM + 12) % 12));
  })();
  const typeBase = filt(races, "type");
  const distBase = filt(races, "dist");
  const area = (() => {
    if (!place || mine) return { subject: "", items: [] as { race: Race; km: number | null }[] };
    const a = areaRaces(races, place, [], [], placePoint(races, expected, place), placeSubject(races, expected, place));
    return { subject: a.subject, items: a.items.filter(({ race }) => applyFilters([race], { ...f, q: "", region: "" }).length > 0) };
  })();
  const seasonBase = filt(races);
  return {
    list,
    place,
    cityCount,
    cityExpected,
    expectedByMonth,
    area,
    type: Object.fromEntries(TYPES.map(([v]) => [v, v === "all" ? typeBase.length : typeBase.filter((r) => r.type === v).length])),
    dist: Object.fromEntries(DISTS.map(([v]) => [v, distBase.filter((r) => distMatch(r, v)).length])),
    season: Object.fromEntries(seasonTabs.map((s) => [s.key, s.key === "all" ? seasonBase.length : seasonBase.filter((r) => inRange(r, s.from, s.to)).length])),
  };
}

/** Всё содержимое вида, собранное порциями через runQuery — как это делает браузер. */
function collect<T>(params: Record<string, string | number>, q: Query): T[] {
  const out: T[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const r = runQuery(ctx, new URLSearchParams(queryParams(q, { ...params, offset })));
    assert.ok(itemCount(r) <= MAX_ITEMS);
    const page = r as unknown as { items: T[]; next: number | null };
    out.push(...page.items);
    offset = page.next;
  }
  return out;
}

const CASES: (Partial<Filters> & { mine?: string[] })[] = [
  {},
  { type: "trail" },
  { dist: "half" },
  { type: "road", dist: "10" },
  { region: "Тверская область" },
  { season: "near" },
  { season: seasons(TODAY)[1].key },
  { q: "Тверь" },
  { q: "Иваново" },
  { q: "Старица", type: "trail" },
  { q: "марафон" },
  { q: "кросс казань" },
  { q: "спб" },
  { q: "ничего такого нет" },
  { mine: ["t:1", "t:7", "t:300", "t:599", "нет-такого"] },
  { mine: [] },
];

async function main() {
  await check("сервер считает то же, что раньше браузер: список, месяцы, чипы, город, рядом, ожидаемые", () => {
    for (const c of CASES) {
      const f: Filters = { ...NO_FILTERS, ...c };
      const q: Query = { ...f, ids: c.mine ?? null };
      const was = before(f, c.mine ? new Set(c.mine) : null);
      const s = summary(ctx, q);
      const tag = JSON.stringify(c);
      assert.equal(s.listCount, was.list.length, `${tag}: число стартов`);
      assert.equal(s.place, was.place, `${tag}: страница города`);
      assert.equal(s.cityCount, was.cityCount, `${tag}: стартов города`);
      assert.deepEqual(s.counts.type, was.type, `${tag}: счётчики типа`);
      assert.deepEqual(s.counts.dist, was.dist, `${tag}: счётчики дистанции`);
      assert.deepEqual(s.counts.season, was.season, `${tag}: счётчики сезонов`);
      // месяцы и их порции = прежний список целиком, тот же порядок
      const wasMonths = new Map<string, Race[]>();
      for (const r of was.list) wasMonths.set(r.ds.slice(0, 7), [...(wasMonths.get(r.ds.slice(0, 7)) || []), r]);
      assert.deepEqual(s.months, [...wasMonths.entries()].map(([k, rs]) => [k, rs.length]), `${tag}: месяцы`);
      const got = s.months.flatMap(([k]) => collect<Race>({ view: "month", month: k }, q));
      assert.deepEqual(got.map((r) => r.id), was.list.map((r) => r.id), `${tag}: порции месяцев складываются в прежний список`);
      // ожидаемые
      assert.deepEqual(collect<PublicExpected>({ view: "cityexp" }, q).map((e) => e.id), was.cityExpected.map((e) => e.id), `${tag}: ожидаются в городе`);
      assert.deepEqual(s.expectedMonths, was.expectedByMonth.map(([m, xs]) => [m, xs.length]), `${tag}: ожидаемые по месяцам`);
      for (const [m, xs] of was.expectedByMonth) {
        assert.deepEqual(collect<PublicExpected>({ view: "expected", m }, q).map((e) => e.id), xs.map((e) => e.id), `${tag}: ожидаемые ${m}`);
      }
      assert.equal(s.area.subject, was.area.subject, `${tag}: область «рядом»`);
      assert.deepEqual(
        collect<{ race: Race; km: number | null }>({ view: "area" }, q).map((a) => [a.race.id, a.km]),
        was.area.items.map((a) => [a.race.id, a.km]),
        `${tag}: «Рядом в области»`,
      );
      assert.equal(s.expectedTotal, was.expectedByMonth.reduce((n, [, xs]) => n + xs.length, 0));
    }
  });

  await check("потолок: ни один ответ не несёт больше 50 стартов при любых offset/limit", () => {
    const qs = [
      "",
      "limit=1000",
      "view=month&month=2026-11&limit=1000",
      "view=month&month=2026-11&offset=-5&limit=-1",
      "view=expected&m=6&limit=99999",
      "view=cityexp&q=Иваново&limit=500",
      "view=area&q=Тверь&limit=500",
      "q=Тверь",
      "q=Иваново",
      `ids=${races.slice(0, 400).map((r) => r.id).join(",")}`,
      `view=month&month=${races[0].ds.slice(0, 7)}&ids=${races.slice(0, 400).map((r) => r.id).join(",")}&limit=60`,
      "view=bogus&month=xx&m=99&offset=abc",
    ];
    for (const s of qs) {
      const r = runQuery(ctx, new URLSearchParams(s));
      assert.ok(itemCount(r) <= MAX_ITEMS, `${s}: ${itemCount(r)} стартов`);
      if (r.view !== "summary") assert.ok(r.items.length <= PAGE, `${s}: порция больше ${PAGE}`);
    }
    // сводка «страницы города» с ожидаемыми и «рядом» — тоже в бюджете
    for (const c of CASES) {
      const s = summary(ctx, { ...NO_FILTERS, ...c, ids: c.mine ?? null });
      assert.ok((s.first?.items.length ?? 0) + s.cityExpected.items.length + s.area.items.length <= MAX_ITEMS, JSON.stringify(c));
    }
  });

  await check("HTML /races: сводка без фильтров — первая порция ближайшего месяца, не больше 30", () => {
    const s = summary(ctx, { ...NO_FILTERS, ids: null });
    assert.ok(s.first, "первый месяц есть");
    assert.equal(s.first!.month, races[0].ds.slice(0, 7));
    assert.ok(s.first!.items.length <= PAGE);
    assert.deepEqual(s.first!.items.map((r) => r.id), races.filter((r) => r.ds.startsWith(s.first!.month)).slice(0, PAGE).map((r) => r.id));
    const json = JSON.stringify({ meta: metaOf(ctx), s });
    assert.ok(!json.includes("probeg.org"), "в HTML нет страниц-источников");
    assert.ok(!/"src"|"srcName"|"important"|"detailsN"|"lastUrl"|"lastDate"/.test(json), "в HTML нет закрытых полей");
    const allIds = new Set(races.map((r) => r.id));
    const leaked = [...json.matchAll(/"id":"(t:\d+)"/g)].map((m) => m[1]).filter((id) => allIds.has(id));
    assert.ok(new Set(leaked).size <= MAX_ITEMS, `в HTML ${new Set(leaked).size} стартов`);
  });

  await check("адрес: мусор не роняет, «Мои» ограничены по числу id", () => {
    const p = parseQuery(new URLSearchParams("type=evil&dist=x&season=../../&m=-3&offset=NaN&q=" + "а".repeat(5000)));
    assert.equal(p.q.type, "all");
    assert.equal(p.q.dist, "all");
    assert.equal(p.q.season, "");
    assert.equal(p.m, 1);
    assert.equal(p.offset, 0);
    assert.equal(p.q.q.length, 200);
    assert.equal(p.view, "summary");
    const many = parseQuery(new URLSearchParams(`ids=${Array.from({ length: 1000 }, (_, i) => `x${i}`).join(",")}`));
    assert.equal(many.q.ids!.length, 300);
    assert.equal(parseQuery(new URLSearchParams("")).q.ids, null, "без ids — весь календарь");
    assert.deepEqual(parseQuery(new URLSearchParams("ids=")).q.ids, [], "пустые «Мои» — пустой список, не весь календарь");
    assert.equal(summary(ctx, { ...NO_FILTERS, ids: [] }).listCount, 0);
  });

  await check("queryParams ↔ parseQuery: фильтры доходят до сервера без потерь", () => {
    const q: Query = { q: "трейл Казань", type: "trail", dist: "half", region: "Республика Татарстан", season: "near", ids: ["a:1", "b:2"] };
    const back = parseQuery(new URLSearchParams(queryParams(q, { view: "month", month: "2026-11", offset: 30 })));
    assert.deepEqual(back.q, q);
    assert.equal(back.view, "month");
    assert.equal(back.month, "2026-11");
    assert.equal(back.offset, 30);
  });

  if (failed) {
    console.log(`\ncheck:races-paged — упало ${failed}`);
    process.exit(1);
  }
  console.log("\ncheck:races-paged — всё зелёное");
}

void main();
