/* Календарь стартов: чистая логика без React, чтобы её можно было проверить
 * чеком (npm run check:races).
 *
 * Данные приходят из view public.race_calendar (только чтение). Поведение
 * повторяет эталон тренера races-reference.html. Расхождения с нарядом, где
 * верили факту базы:
 *   — sources ВСЕГДА содержит и собственный источник старта (на 11.10.2026 у
 *     всех 405 строк source входит в sources). Поэтому «Подтверждён» ставится
 *     при двух и больше источниках, как в эталоне, а не при непустом списке:
 *     иначе плашка стояла бы на каждом старте и ничего бы не значила.
 */

export type RaceType = "road" | "trail" | "tri" | "track";

export type RaceRow = {
  id: string;
  source: string | null;
  source_url: string | null;
  name: string;
  date_start: string;
  date_end: string | null;
  city: string | null;
  region: string | null;
  distances: string[] | null;
  dist_km: (number | string)[] | null;
  race_type: string | null;
  tags: string[] | null;
  site_url: string | null;
  reg_url: string | null;
  vk_url: string | null;
  sources: string[] | null;
  link_ok: boolean | null;
  alt_dates: string[] | null;
  checked_note: string | null;
};

/** Старт в том виде, в каком он уходит в браузер: только нужные поля. */
export type Race = {
  id: string;
  name: string;
  ds: string;
  de: string;
  city: string;
  region: string;
  type: string;
  tags: string[];
  dist: string[];
  km: number[];
  site: string;
  reg: string;
  vk: string;
  src: string;
  srcName: string;
  nSources: number;
  linkBad: boolean;
  altDates: string[];
  checked: string;
};

export type TypeFilter = "all" | RaceType;
export type DistFilter = "all" | "short" | "10" | "half" | "marathon" | "ultra";

export const TYPES: [TypeFilter, string][] = [
  ["all", "Все"],
  ["road", "Шоссе"],
  ["trail", "Трейл"],
  ["tri", "Триатлон"],
  ["track", "Стадион"],
];
export const TYPE_LABEL: Record<string, string> = { road: "Шоссе", trail: "Трейл", tri: "Триатлон", track: "Стадион" };

export const DISTS: [DistFilter, string][] = [
  ["all", "Любая"],
  ["short", "до 10 км"],
  ["10", "10 км"],
  ["half", "Полумарафон"],
  ["marathon", "Марафон"],
  ["ultra", "Ультра"],
];

const SRC_NAME: Record<string, string> = {
  probeg: "probeg.org",
  marathonec: "marathonec.ru",
  ironstar: "iron-star.com",
  myrace: "myrace.info",
  regplace: "reg.place",
  orgeo: "orgeo.ru",
  where2run: "where2run.ru",
};

export const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
export const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/ё/g, "е");
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Внешняя ссылка только http(s): в базу пишут парсеры чужих сайтов. */
export function safeUrl(u: string | null | undefined): string {
  return /^https?:\/\//i.test(u || "") ? (u as string) : "";
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function dayMonth(s: string): string {
  const d = parseDate(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

/** Название и регион для показа: « — » и « – » между словами становятся дефисом.
 *  В базе текст остаётся как у организатора, меняется только вывод. */
export function displayName(name: string): string {
  return name.replace(/\s+[—–]\s+/g, " - ");
}

export function toRace(r: RaceRow): Race {
  const km = (r.dist_km || []).map(Number).filter((x) => Number.isFinite(x));
  const srcs = r.sources || [];
  return {
    id: r.id,
    name: displayName(r.name),
    ds: r.date_start,
    de: r.date_end || r.date_start,
    city: r.city || "",
    region: displayName(r.region || ""),
    type: r.race_type || "",
    tags: r.tags || [],
    dist: r.distances || [],
    km,
    site: safeUrl(r.site_url),
    reg: safeUrl(r.reg_url),
    vk: safeUrl(r.vk_url),
    src: safeUrl(r.source_url),
    srcName: SRC_NAME[r.source || ""] || "Источник",
    nSources: srcs.length,
    linkBad: r.link_ok === false,
    altDates: [...new Set((r.alt_dates || []).map((a) => a.split(":")[1]).filter((x) => x && x !== r.date_start))],
    checked: r.checked_note || "",
  };
}

export function fmtKm(k: number): string {
  return (Math.round(k * 10) / 10).toString().replace(".", ",");
}

/** «21100 м (Long) (+300м)» → «21,1 км»; слова вроде «полумарафон», «6 часов» как есть. */
export function prettyDist(x: string): string {
  const base = x.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const m = base.match(/^(\d+(?:[.,]\d+)?)\s*м$/);
  if (m && Number(m[1].replace(",", ".")) >= 1000) return `${fmtKm(Number(m[1].replace(",", ".")) / 1000)} км`;
  return base;
}

/** Дистанции для плашек: без детских и ходьбы; больше 8 — диапазон. */
export function distPills(r: Race): string[] {
  const adult = r.dist.filter((x) => !/дет|kids|скандинав|ходьб/i.test(x));
  if (adult.length > 8 && r.km.length > 8) {
    const km = r.km.filter((x) => x >= 1);
    if (km.length) return [`${fmtKm(Math.min(...km))}-${fmtKm(Math.max(...km))} км`];
  }
  const shown = adult.slice(0, 6).map(prettyDist);
  if (adult.length > shown.length) shown.push(`+${adult.length - shown.length}`);
  return shown;
}

export function distMatch(r: Race, d: DistFilter): boolean {
  const k = r.km;
  switch (d) {
    case "all":
      return true;
    case "short":
      return k.some((x) => x >= 3 && x < 10);
    case "10":
      return k.some((x) => x >= 9.5 && x <= 10.6);
    case "half":
      return r.tags.includes("half") || k.some((x) => Math.abs(x - 21.1) < 0.4);
    case "marathon":
      return r.tags.includes("marathon") || k.some((x) => Math.abs(x - 42.195) < 0.4);
    case "ultra":
      return r.tags.includes("ultra") || k.some((x) => x > 42.5);
  }
}

export type Filters = { q: string; type: TypeFilter; dist: DistFilter };
export const NO_FILTERS: Filters = { q: "", type: "all", dist: "all" };

export function haystack(r: Race): string {
  return norm([r.name, r.city, r.region].join(" "));
}

/** skip: не применять один из фильтров (для счётчиков на его же чипах). */
export function applyFilters(races: Race[], f: Filters, skip?: "type" | "dist"): Race[] {
  const words = norm(f.q).split(/[\s,]+/).filter(Boolean);
  return races.filter(
    (r) =>
      (skip === "type" || f.type === "all" || r.type === f.type) &&
      (skip === "dist" || distMatch(r, f.dist)) &&
      words.every((w) => haystack(r).includes(w)),
  );
}

const TYPE_IDS = new Set(TYPES.map(([v]) => v));
const DIST_IDS = new Set(DISTS.map(([v]) => v));

export function filtersFromSearch(search: string): Filters {
  const p = new URLSearchParams(search);
  const type = p.get("type") as TypeFilter | null;
  const dist = p.get("dist") as DistFilter | null;
  return {
    q: p.get("q") || "",
    type: type && TYPE_IDS.has(type) ? type : "all",
    dist: dist && DIST_IDS.has(dist) ? dist : "all",
  };
}

/** Только непустые параметры: ссылка «трейлы в Казани» короткая. */
export function filtersToSearch(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.type !== "all") p.set("type", f.type);
  if (f.dist !== "all") p.set("dist", f.dist);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export type DateStub = { day: string; tail: string; wd: string; weekend: boolean };

/** Дата слева от строки: число крупно, диапазон для многодневных, день недели. */
export function dateStub(r: Race): DateStub {
  const d1 = parseDate(r.ds);
  const d2 = parseDate(r.de);
  const multi = r.de !== r.ds;
  const tail = multi
    ? `-${d2.getDate()}${d2.getMonth() !== d1.getMonth() ? `.${String(d2.getMonth() + 1).padStart(2, "0")}` : ""}`
    : "";
  return {
    day: String(d1.getDate()),
    tail,
    wd: WD[d1.getDay()] + (multi ? `-${WD[d2.getDay()]}` : ""),
    weekend: d1.getDay() === 0 || d1.getDay() === 6,
  };
}

export type MonthGroup = { key: string; name: string; year: number; races: Race[] };

export function groupByMonth(races: Race[]): MonthGroup[] {
  const map = new Map<string, Race[]>();
  for (const r of races) {
    const k = r.ds.slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return [...map.entries()].map(([key, rs]) => {
    const [y, m] = key.split("-").map(Number);
    return { key, name: MONTHS[m - 1], year: y, races: rs };
  });
}

/** Порядок: дата, потом название по-русски. Прошедшие (по дате конца) не показываются. */
export function prepare(rows: RaceRow[], todayIso: string): Race[] {
  return rows
    .map(toRace)
    .filter((r) => r.de >= todayIso)
    .sort((a, b) => a.ds.localeCompare(b.ds) || a.name.localeCompare(b.name, "ru"));
}
