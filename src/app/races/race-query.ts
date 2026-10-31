/* Календарь по частям (наряд 30.10.2026, второй этап защиты): браузер больше не получает весь список
 * (~2400 стартов) одним документом. HTML /races несёт сводку и первую порцию ближайшего месяца, всё
 * остальное — /api/races/query страницами, под тем же лимитом частоты. Здесь — чистая логика без
 * React, сети и базы: что показать по фильтрам. Её держит npm run check:races-paged.
 *
 * Поведение то же, что было в RacesCalendar (там фильтровал браузер): поиск с алиасами, «страница
 * города» с ожидаемыми наверху и блоком «Рядом», вкладки сезонов, «Мои забеги», счётчики на чипах.
 * Изменилось только одно: старты приходят порциями. Ни один ответ не несёт больше MAX_ITEMS. */

import {
  FEW_CITY_RACES,
  areaRaces,
  expectedCities,
  expectedDateMd,
  inUserCity,
  placeFromQuery,
  placePoint,
  placeSubject,
  seasons,
  sortCityExpected,
  type PublicExpected,
} from "@/features/races-bot/core";
import { matchesQuery, queryWords, searchText } from "@/features/race-search/search";

import {
  DISTS,
  TYPES,
  applyFilters,
  distMatch,
  filtersFromSearch,
  inRange,
  norm,
  subjectsOf,
  type DistFilter,
  type Filters,
  type Race,
  type TypeFilter,
} from "./races-logic";

/** Порция списка. */
export const PAGE = 30;
/** Порция ожидаемых (наряд 01.11.2026): их 1843 из ~2360 строк календаря — порции мельче, выкачка дороже. */
export const EXPECTED_PAGE = 20;
/** Потолок стартов (с датой и ожидаемых вместе) в одном ответе. */
export const MAX_ITEMS = 50;
/** Ожидаемые города наверху и «Рядом» в сводке: первые, остальные — «Показать ещё». */
export const CITY_EXPECTED_FIRST = 8;
export const AREA_FIRST = 8;
/** «Мои забеги»: больше id в запросе не принимаем. */
export const MAX_IDS = 300;

export type Ctx = { races: Race[]; expected: PublicExpected[]; today: string };

/** Фильтры плюс «Мои забеги» (ids: ограничить список этими стартами). */
export type Query = Filters & { ids: string[] | null };

export type Page<T> = { items: T[]; total: number; next: number | null };
export type AreaItem = { race: Race; km: number | null };

export type Summary = {
  /** Счётчики на чипах — как раньше: без своего фильтра, без сезона и «Моих». */
  counts: { type: Record<string, number>; dist: Record<string, number>; season: Record<string, number> };
  /** Месяцы списка и сколько в каждом стартов. */
  months: [string, number][];
  listCount: number;
  listCities: number;
  /** «Страница города»: запрос — ровно город. */
  place: string | null;
  cityCount: number;
  cityExpected: Page<PublicExpected>;
  area: { subject: string } & Page<AreaItem>;
  expectedMonths: [number, number][];
  expectedTotal: number;
  /** Первая порция первого месяца списка (он раскрыт по умолчанию). */
  first: { month: string } & Page<Race> | null;
};

/** Сводка для шапки страницы: всего стартов, городов, области и города для подсказки поиска. */
export type Meta = { total: number; nCities: number; subjects: { subject: string; n: number }[]; cities: string[]; today: string };

const TYPE_IDS = TYPES.map(([v]) => v);
const DIST_IDS = DISTS.map(([v]) => v);

function page<T>(xs: T[], offset: number, limit: number): Page<T> {
  const o = Math.max(0, Math.floor(offset) || 0);
  const l = Math.max(1, Math.min(PAGE, Math.floor(limit) || PAGE));
  const items = xs.slice(o, o + l);
  return { items, total: xs.length, next: o + l < xs.length ? o + l : null };
}

export function citiesOf(races: Race[]): string[] {
  const counts = new Map<string, number>();
  for (const r of races) if (r.city) counts.set(r.city, (counts.get(r.city) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export function metaOf(ctx: Ctx): Meta {
  const cities = citiesOf(ctx.races);
  // В подсказке поиска — 300 самых частых городов: названия без стартов, полный список не нужен.
  return { total: ctx.races.length, nCities: cities.length, subjects: subjectsOf(ctx.races), cities: cities.slice(0, 300), today: ctx.today };
}

/** Внутренности, общие для всех видов: место, фильтр, список. */
function base(ctx: Ctx, q: Query) {
  const { races, expected, today } = ctx;
  const placeCities = [...new Set([...citiesOf(races), ...expectedCities(expected)])];
  const place = placeFromQuery(q.q, placeCities);
  const filt = (rs: Race[], skip?: "type" | "dist") =>
    place ? applyFilters(rs, { ...q, q: "" }, skip).filter((r) => inUserCity(r, place)) : applyFilters(rs, q, skip);
  const season = seasons(today).find((s) => s.key === q.season && s.key !== "all") ?? null;
  const ids = q.ids ? new Set(q.ids) : null;
  const pool = ids ? races.filter((r) => ids.has(r.id)) : races;
  const list = filt(pool).filter((r) => !season || inRange(r, season.from, season.to));
  return { place, filt, season, list };
}

function cityExpectedOf(ctx: Ctx, q: Query, place: string | null, cityCount: number): PublicExpected[] {
  if (!place || q.ids || cityCount >= FEW_CITY_RACES) return [];
  const c = norm(place);
  const xs = ctx.expected.filter(
    (e) =>
      (norm(e.city) === c || norm(e.region) === c) &&
      (q.type === "all" || e.type === q.type) &&
      (q.dist === "all" || distMatch({ km: e.km, tags: [] } as unknown as Race, q.dist)),
  );
  return sortCityExpected(xs, (e) => e.big, (e) => expectedDateMd(e.md, ctx.today));
}

function areaOf(ctx: Ctx, q: Query, place: string | null): { subject: string; items: AreaItem[] } {
  if (!place || q.ids) return { subject: "", items: [] };
  const { races, expected } = ctx;
  const a = areaRaces(races, place, [], [], placePoint(races, expected, place), placeSubject(races, expected, place));
  return { subject: a.subject, items: a.items.filter(({ race }) => applyFilters([race], { ...q, q: "", region: "" }).length > 0) };
}

/** Ожидаемые (не наверху города) с теми же поиском и фильтрами, по месяцу прошлого проведения. */
function expectedShown(ctx: Ctx, q: Query, top: Set<string>, season: { from: string; to: string } | null): PublicExpected[] {
  if (q.ids) return [];
  const words = queryWords(q.q);
  return ctx.expected.filter((e) => {
    if (top.has(e.id)) return false;
    if (q.type !== "all" && e.type !== q.type) return false;
    if (q.dist !== "all" && !distMatch({ km: e.km, tags: [] } as unknown as Race, q.dist)) return false;
    if (q.region && e.subject !== q.region) return false;
    if (season) {
      const d = expectedDateMd(e.md, ctx.today);
      if (d < season.from || d > season.to) return false;
    }
    return matchesQuery(searchText(e.name, e.city, e.region, e.subject), words);
  });
}

/** С ближайшего месяца: сейчас октябрь — сначала ноябрь, декабрь, потом весна. */
function monthOrder(today: string) {
  const startM = Number(today.slice(5, 7));
  return (m: number) => (m - startM + 12) % 12;
}

function monthsOf(list: Race[]): [string, number][] {
  const by = new Map<string, number>();
  for (const r of list) by.set(r.ds.slice(0, 7), (by.get(r.ds.slice(0, 7)) || 0) + 1);
  return [...by.entries()];
}

export function summary(ctx: Ctx, q: Query): Summary {
  const { place, filt, list } = base(ctx, q);
  const typeBase = filt(ctx.races, "type");
  const distBase = filt(ctx.races, "dist");
  const seasonBase = filt(ctx.races);
  const counts = {
    type: Object.fromEntries(TYPE_IDS.map((v) => [v, v === "all" ? typeBase.length : typeBase.filter((r) => r.type === v).length])),
    dist: Object.fromEntries(DIST_IDS.map((v) => [v, distBase.filter((r) => distMatch(r, v)).length])),
    season: Object.fromEntries(seasons(ctx.today).map((s) => [s.key, s.key === "all" ? seasonBase.length : seasonBase.filter((r) => inRange(r, s.from, s.to)).length])),
  };
  const cityCount = place ? filt(ctx.races).length : 0;
  const cityExp = cityExpectedOf(ctx, q, place, cityCount);
  const area = areaOf(ctx, q, place);
  const season = seasons(ctx.today).find((s) => s.key === q.season && s.key !== "all") ?? null;
  const shown = expectedShown(ctx, q, new Set(cityExp.map((e) => e.id)), season);
  const byM = new Map<number, number>();
  for (const e of shown) byM.set(e.lastMonth, (byM.get(e.lastMonth) || 0) + 1);
  const ord = monthOrder(ctx.today);
  const months = monthsOf(list);
  const cityPage = page(cityExp, 0, CITY_EXPECTED_FIRST);
  const areaPage = page(area.items, 0, AREA_FIRST);
  // Первая порция первого месяца — в остаток бюджета ответа.
  const room = MAX_ITEMS - cityPage.items.length - areaPage.items.length;
  const firstMonth = months[0]?.[0] ?? null;
  return {
    counts,
    months,
    listCount: list.length,
    listCities: new Set(list.map((r) => r.city).filter(Boolean)).size,
    place,
    cityCount,
    cityExpected: cityPage,
    area: { subject: area.subject, ...areaPage },
    expectedMonths: [...byM.entries()].sort((a, b) => ord(a[0]) - ord(b[0])),
    expectedTotal: shown.length,
    first: firstMonth ? { month: firstMonth, ...page(list.filter((r) => r.ds.startsWith(firstMonth)), 0, Math.min(PAGE, room)) } : null,
  };
}

export function monthPage(ctx: Ctx, q: Query, month: string, offset: number, limit = PAGE): Page<Race> {
  const { list } = base(ctx, q);
  return page(list.filter((r) => r.ds.startsWith(month)), offset, limit);
}

export function expectedPage(ctx: Ctx, q: Query, m: number, offset: number, limit = PAGE): Page<PublicExpected> {
  const { place, filt, season } = base(ctx, q);
  const cityCount = place ? filt(ctx.races).length : 0;
  const top = new Set(cityExpectedOf(ctx, q, place, cityCount).map((e) => e.id));
  return page(expectedShown(ctx, q, top, season).filter((e) => e.lastMonth === m), offset, Math.min(limit, EXPECTED_PAGE));
}

export function cityExpectedPage(ctx: Ctx, q: Query, offset: number, limit = PAGE): Page<PublicExpected> {
  const { place, filt } = base(ctx, q);
  return page(cityExpectedOf(ctx, q, place, place ? filt(ctx.races).length : 0), offset, Math.min(limit, EXPECTED_PAGE));
}

export function areaPage(ctx: Ctx, q: Query, offset: number, limit = PAGE): { subject: string } & Page<AreaItem> {
  const { place } = base(ctx, q);
  const a = areaOf(ctx, q, place);
  return { subject: a.subject, ...page(a.items, offset, limit) };
}

export type View = "summary" | "month" | "expected" | "cityexp" | "area";
export type QueryResult =
  | ({ view: "summary" } & Summary)
  | ({ view: "month"; month: string } & Page<Race>)
  | ({ view: "expected"; m: number } & Page<PublicExpected>)
  | ({ view: "cityexp" } & Page<PublicExpected>)
  | ({ view: "area"; subject: string } & Page<AreaItem>);

/** Параметры адреса → запрос. Мусор не роняет: неизвестное — по умолчанию. */
export function parseQuery(sp: URLSearchParams): { q: Query; view: View; month: string; m: number; offset: number; limit: number } {
  const f = filtersFromSearch(`?${sp.toString()}`);
  const idsRaw = sp.get("ids");
  const ids = idsRaw === null ? null : idsRaw.split(",").map((x) => x.trim()).filter((x) => x && x.length <= 200).slice(0, MAX_IDS);
  const v = sp.get("view");
  const view: View = v === "month" || v === "expected" || v === "cityexp" || v === "area" ? v : "summary";
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") || "") ? (sp.get("month") as string) : "";
  const m = Math.min(12, Math.max(1, Number(sp.get("m")) || 1));
  return {
    q: { ...f, q: f.q.slice(0, 200), type: f.type as TypeFilter, dist: f.dist as DistFilter, ids },
    view,
    month,
    m,
    offset: Number(sp.get("offset")) || 0,
    limit: Number(sp.get("limit")) || PAGE,
  };
}

export function runQuery(ctx: Ctx, sp: URLSearchParams): QueryResult {
  const p = parseQuery(sp);
  switch (p.view) {
    case "month":
      return { view: "month", month: p.month, ...monthPage(ctx, p.q, p.month, p.offset, p.limit) };
    case "expected":
      return { view: "expected", m: p.m, ...expectedPage(ctx, p.q, p.m, p.offset, p.limit) };
    case "cityexp":
      return { view: "cityexp", ...cityExpectedPage(ctx, p.q, p.offset, p.limit) };
    case "area":
      return { view: "area", ...areaPage(ctx, p.q, p.offset, p.limit) };
    default:
      return { view: "summary", ...summary(ctx, p.q) };
  }
}

/** Сколько стартов в ответе (с датой и ожидаемых): чек и маршрут держат ≤ MAX_ITEMS. */
export function itemCount(r: QueryResult): number {
  if (r.view === "summary") return (r.first?.items.length ?? 0) + r.cityExpected.items.length + r.area.items.length;
  return r.items.length;
}

/** Параметры запроса для адреса /api/races/query (клиент). */
export function queryParams(q: Query, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  if (q.q.trim()) p.set("q", q.q.trim());
  if (q.type !== "all") p.set("type", q.type);
  if (q.dist !== "all") p.set("dist", q.dist);
  if (q.region) p.set("region", q.region);
  if (q.season) p.set("season", q.season);
  if (q.ids) p.set("ids", q.ids.join(","));
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}
