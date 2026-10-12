/* Бот «Забеги России»: чистая логика без сети и базы. Её держит npm run check:races-bot.
 *
 * Здесь: короткие коды стартов для deep link, город в ссылке, разбор поиска текстом,
 * фильтры человека и планировщик плановых сообщений (дайджест, 12 недель, неделя,
 * накануне, после финиша, отмена). Планировщик ничего не шлёт: он только говорит, что
 * пора отправить, а отправляет bot.ts. Поэтому его можно проверить на любых датах.
 */

import { distMatch, norm, plural, type Race } from "@/app/races/races-logic";

export type BotRace = Race & { firstSeen: string | null };

// ── коды для deep link ───────────────────────────────────────────────────────
//
// id стартов содержат «:» и кириллицу (ironstar:казань-2027-…), а параметр start в Telegram —
// только [A-Za-z0-9_-] до 64 символов. Код — 53-битный хэш id в base36: стабилен, одинаков
// на сервере и в браузере (без node:crypto), обратного отображения не нужно: сервер находит
// старт, посчитав код у каждого из ~2 тыс. стартов. Коллизия на таком объёме невероятна.

function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function raceCode(id: string): string {
  return cyrb53(id).toString(36).padStart(11, "0");
}

export const START_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

const TR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Город в ссылке t.me/…?start=c_<slug>: латиница, цифры, дефис. «Санкт-Петербург» → sankt-peterburg. */
export function citySlug(city: string): string {
  return norm(city)
    .split("")
    .map((c) => TR[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export type StartParam =
  | { kind: "race"; code: string }
  | { kind: "city"; slug: string }
  | { kind: "src"; label: string }
  | { kind: "none" };

export function parseStart(raw: string | null | undefined): StartParam {
  const p = (raw || "").trim();
  if (!p || !START_PARAM_RE.test(p)) return { kind: "none" };
  if (p.startsWith("r_") && p.length > 2) return { kind: "race", code: p.slice(2) };
  if (p.startsWith("c_") && p.length > 2) return { kind: "city", slug: p.slice(2) };
  if (p.startsWith("src_") && p.length > 4) return { kind: "src", label: p.slice(4) };
  return { kind: "none" };
}

// Ссылка igorp.run/go/<код>: r|s + код старта, дальше tg_id в base36 и подпись (её считает runtime.ts
// HMAC от токена бота, чтобы клик нельзя было приписать чужому id). Без «-uid-подпись» — анонимный клик.
export const GO_RE = /^([rs])([0-9a-z]{11})(?:-([0-9a-z]{1,14})-([0-9a-f]{10}))?$/;

export type GoCode = { kind: "r" | "s"; code: string; uid: number | null; sig: string | null };

export function parseGo(raw: string): GoCode | null {
  const m = GO_RE.exec(raw);
  if (!m) return null;
  return { kind: m[1] as "r" | "s", code: m[2], uid: m[3] ? parseInt(m[3], 36) : null, sig: m[4] ?? null };
}

export function findRaceByCode(races: BotRace[], code: string): BotRace | null {
  return races.find((r) => raceCode(r.id) === code) ?? null;
}

export function findCityBySlug(cities: string[], slug: string): string | null {
  return cities.find((c) => citySlug(c) === slug) ?? null;
}

/** Города по числу стартов, самые частые первыми. */
export function knownCities(races: BotRace[]): string[] {
  const counts = new Map<string, number>();
  for (const r of races) if (r.city) counts.set(r.city, (counts.get(r.city) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export function matchCity(cities: string[], text: string): string | null {
  const t = norm(text).trim();
  if (!t) return null;
  return cities.find((c) => norm(c) === t) ?? cities.find((c) => norm(c).startsWith(t) && t.length >= 4) ?? null;
}

// ── «в Москве» ───────────────────────────────────────────────────────────────

const PREP: Record<string, string> = {
  москва: "Москве", "санкт-петербург": "Санкт-Петербурге", казань: "Казани", екатеринбург: "Екатеринбурге",
  "нижний новгород": "Нижнем Новгороде", "ростов-на-дону": "Ростове-на-Дону", сочи: "Сочи", тверь: "Твери",
};

/** «в Москве», «в Казани»; если форму не угадать уверенно — «в городе X». */
export function inCity(city: string): string {
  const key = norm(city).trim();
  if (PREP[key]) return `в ${PREP[key]}`;
  if (/[\s-]/.test(key)) return `в городе ${city}`;
  if (/а$/.test(key)) return `в ${city.slice(0, -1)}е`;
  if (/ь$/.test(key)) return `в ${city.slice(0, -1)}и`;
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(key)) return `в ${city}е`;
  return `в городе ${city}`;
}

// ── фильтры человека ─────────────────────────────────────────────────────────

export type TypeId = "road" | "trail" | "tri";
export type DistId = "short" | "half" | "marathon" | "ultra";
export const TYPE_BUTTONS: [TypeId, string][] = [["road", "Шоссе"], ["trail", "Трейл"], ["tri", "Триатлон"]];
export const DIST_BUTTONS: [DistId, string][] = [["short", "До 10 км"], ["half", "Полумарафон"], ["marathon", "Марафон"], ["ultra", "Ультра"]];

export function distOk(r: Race, d: DistId): boolean {
  if (d === "short") return r.km.some((x) => x >= 3 && x <= 10.6);
  return distMatch(r, d);
}

/** Пустой выбор — без ограничения; несколько — любое из выбранного. */
export function matchUser(r: Race, types: string[], dists: string[]): boolean {
  const tOk = !types.length || types.includes(r.type);
  const dOk = !dists.length || dists.some((d) => distOk(r, d as DistId));
  return tOk && dOk;
}

export function inUserCity(r: Race, city: string | null): boolean {
  if (!city) return false;
  const c = norm(city);
  return norm(r.city) === c || (norm(r.region) === c && !!r.region);
}

// ── поиск текстом: «трейл Казань», «марафон май» ─────────────────────────────

const MONTH_WORDS: [RegExp, number][] = [
  [/^январ/, 1], [/^феврал/, 2], [/^март/, 3], [/^апрел/, 4], [/^ма[йяе]$/, 5], [/^июн/, 6],
  [/^июл/, 7], [/^август/, 8], [/^сентябр/, 9], [/^октябр/, 10], [/^ноябр/, 11], [/^декабр/, 12],
];

export type ParsedSearch = { q: string; types: TypeId[]; dists: DistId[]; month: number | null };

export function parseSearch(text: string): ParsedSearch {
  const types: TypeId[] = [];
  const dists: DistId[] = [];
  let month: number | null = null;
  const rest: string[] = [];
  for (const w of norm(text).replace(/[«»"',.!?]/g, " ").split(/\s+/).filter(Boolean)) {
    if (/^шосс/.test(w)) types.push("road");
    else if (/^трейл/.test(w) || /^trail/.test(w)) types.push("trail");
    else if (/^триатлон/.test(w)) types.push("tri");
    else if (/^полумарафон/.test(w)) dists.push("half");
    else if (/^марафон/.test(w)) dists.push("marathon");
    else if (/^ультра/.test(w)) dists.push("ultra");
    else if (/^(5|10)(км)?$/.test(w) || w === "км") {
      if (w !== "км") dists.push("short");
    } else {
      const m = MONTH_WORDS.find(([re]) => re.test(w));
      if (m) month = m[1];
      else if (!["в", "на", "по", "забег", "забеги", "старт", "старты"].includes(w)) rest.push(w);
    }
  }
  return { q: rest.join(" "), types: [...new Set(types)], dists: [...new Set(dists)], month };
}

export function searchRaces(races: BotRace[], s: ParsedSearch): BotRace[] {
  const words = s.q.split(/\s+/).filter(Boolean);
  return races.filter((r) => {
    if (!matchUser(r, s.types, s.dists)) return false;
    if (s.month && Number(r.ds.slice(5, 7)) !== s.month) return false;
    const hay = norm(`${r.name} ${r.city} ${r.region}`);
    return words.every((w) => hay.includes(w));
  });
}

// ── даты и местное время ─────────────────────────────────────────────────────

export function localParts(now: Date, tz: string): { date: string; hour: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: wd };
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 864e5);
}

/** Тихие часы 22:00-9:00 по поясу человека: ничего не шлём. */
export function isQuiet(hour: number): boolean {
  return hour < 9 || hour >= 22;
}

/** «6 дней», «29 недель», «завтра», «сегодня». */
export function countdown(days: number): string {
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days < 21) return `${days} ${plural(days, "день", "дня", "дней")}`;
  const w = Math.round(days / 7);
  return `${w} ${plural(w, "неделя", "недели", "недель")}`;
}

/** Старт, к которому готовятся 12 недель: полумарафон, марафон, ультра или триатлон. */
export function isLongRace(r: Race, userDists: string[]): boolean {
  if (r.type === "tri") return true;
  const long: DistId[] = ["half", "marathon", "ultra"];
  const wanted = userDists.length ? long.filter((d) => userDists.includes(d)) : long;
  return wanted.some((d) => distOk(r, d));
}

// ── планировщик ──────────────────────────────────────────────────────────────

export type PlanUser = {
  tg_id: number;
  city: string | null;
  types: string[];
  distances: string[];
  digest_on: boolean;
  digest_every_weeks: number;
  digest_last_at: string | null;
  paused_until: string | null;
  tz: string;
  blocked: boolean;
  created_at: string;
};

export type PlanFollow = {
  race_id: string;
  created_at: string;
  race_name: string | null;
  race_date: string | null;
  race_end: string | null;
  race_city: string | null;
};

export type PlanAction =
  | { kind: "digest"; races: BotRace[] }
  | { kind: "w12" | "d7" | "d1"; race: BotRace }
  | { kind: "after" | "cancelled"; follow: PlanFollow }
  | { kind: "drop"; follow: PlanFollow };

export const CONSULT_COOLDOWN_DAYS = 30;

export function consultAllowed(offeredAt: string | null, now: Date): boolean {
  return !offeredAt || now.getTime() - Date.parse(offeredAt) >= CONSULT_COOLDOWN_DAYS * 864e5;
}

/**
 * Что пора отправить этому человеку в этот час. sent — ключи `${kind}:${race_id}` уже
 * отправленного. Тихие часы, пауза и блокировка глушат всё; «drop» (старт давно прошёл и
 * пропал из календаря) — тихая уборка без сообщения.
 */
export function planUser(input: {
  now: Date;
  user: PlanUser;
  follows: PlanFollow[];
  racesById: Map<string, BotRace>;
  races: BotRace[];
  sent: Set<string>;
}): PlanAction[] {
  const { now, user, follows, racesById, races, sent } = input;
  if (user.blocked) return [];
  if (user.paused_until && Date.parse(user.paused_until) > now.getTime()) return [];
  const { date: today, hour, weekday } = localParts(now, user.tz || "Europe/Moscow");
  if (isQuiet(hour)) return [];
  const out: PlanAction[] = [];

  // Дайджест: понедельник, с 10:00, раз в неделю (или в две). Нет новых — ничего.
  if (user.digest_on && user.city && weekday === 1 && hour >= 10) {
    const periodDays = 7 * (user.digest_every_weeks === 2 ? 2 : 1);
    const last = user.digest_last_at ? Date.parse(user.digest_last_at) : null;
    if (last === null || now.getTime() - last >= (periodDays - 1) * 864e5) {
      const since = Math.max(last ?? 0, now.getTime() - periodDays * 864e5);
      const fresh = races.filter(
        (r) =>
          r.ds >= today &&
          r.firstSeen !== null &&
          Date.parse(r.firstSeen) > since &&
          inUserCity(r, user.city) &&
          matchUser(r, user.types, user.distances),
      );
      if (fresh.length) out.push({ kind: "digest", races: fresh });
    }
  }

  for (const f of follows) {
    const r = racesById.get(f.race_id);
    const once = (k: string) => !sent.has(`${k}:${f.race_id}`);
    if (!r) {
      // view race_calendar держит только предстоящие старты. Пропал старт, который ещё не
      // прошёл, — его отменили или убрали: одно сообщение и снять. Прошёл вчера — «С финишем!»
      // по снимку. Давно прошёл — тихо снять.
      const end = f.race_end || f.race_date;
      if (f.race_date && f.race_date >= today) {
        if (once("cancelled")) out.push({ kind: "cancelled", follow: f });
      } else if (end && daysBetween(end, today) === 1) {
        if (hour >= 10 && once("after")) out.push({ kind: "after", follow: f });
      } else if (!end || daysBetween(end, today) > 1) {
        out.push({ kind: "drop", follow: f });
      }
      continue;
    }
    const left = daysBetween(today, r.ds);
    if (
      left >= 78 && left <= 84 && hour >= 10 && once("w12") &&
      isLongRace(r, user.distances) &&
      daysBetween(f.created_at.slice(0, 10), r.ds) > 84
    ) out.push({ kind: "w12", race: r });
    else if (left >= 5 && left <= 7 && hour >= 10 && once("d7")) out.push({ kind: "d7", race: r });
    else if (left === 1 && hour >= 12 && once("d1")) out.push({ kind: "d1", race: r });
  }
  return out;
}
