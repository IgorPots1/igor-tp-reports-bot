// Ожидаемые старты: забеги России, прошедшие за последний год на probeg.org, у которых
// ещё нет даты следующего проведения в календаре. Чистый модуль без Deno и Node API:
// его зовут и edge-функция (стадия ?stage=expected), и разовый подсчёт в Node
// (scripts/races-expected-preview.ts). Держит его npm run check:races-expected.

export type PastRace = {
  sid: string; // probeg event id прошлого проведения
  date: string; // YYYY-MM-DD, первый день
  name: string;
  city: string;
  region?: string | null;
  distances: string[];
  finishers: number | null;
  vk: string | null;
  site: string | null;
};

export type FutureRow = { id: string; name: string; date_start: string; city: string | null; region: string | null; race_type?: string | null };

export type ExpectedRow = {
  id: string; // probeg:<sid> прошлого проведения
  name: string;
  name_key: string;
  city: string;
  region: string | null;
  race_type: string;
  distances: string[];
  last_date: string;
  last_month: number;
  last_url: string;
  site_url: string | null;
  last_finishers: number | null;
};

const decode = (s: string) =>
  s.replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;/g, "'");
const clean = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const REGION_RE = /(область|край|республика|респ\.|автономн|округ|ао$)/i;
const FEDERAL = ["Москва", "Санкт-Петербург", "Севастополь"];

/** Ячейка места probeg: «Приморский край, Владивосток», «г. Санкт-Петербург, Пушкин», «Ульяновск». */
export function splitPlace(raw: string): { city: string; region: string | null } {
  const segs = raw.split(",").map((x) => x.replace(/^(г\.|город)\s*/i, "").trim()).filter(Boolean);
  if (!segs.length) return { city: "", region: null };
  const fed = FEDERAL.find((f) => segs[0] === f);
  if (fed) return { city: fed, region: fed };
  if (REGION_RE.test(segs[0])) {
    const rest = segs.slice(1).filter((x) => !/(район|г\.о\.|городской округ|м\.о\.|муниципальн)/i.test(x));
    const city = (rest[rest.length - 1] || "").replace(/^(д\.|с\.|п\.|пос\.|пгт|р\.п\.|ст\.|х\.|деревня|село|посёлок|поселок)\s*/i, "").trim();
    return { city: city || segs[0], region: segs[0] };
  }
  return { city: segs[0], region: null };
}

/** Строки таблицы probeg.org/races для ПРОШЕДШИХ стартов (столбцы: №, дата, название, город, дистанции, финишёры, ссылки). */
export function parsePastProbeg(html: string): PastRace[] {
  const out: PastRace[] = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
    if (tds.length < 6) continue;
    // Дату многодневного старта probeg оборачивает в <span class="nobr">. Было (до 29.10.2026):
    // ждали текст сразу за ссылкой, и ВСЕ многодневные старты молча выпадали из ожидаемых — среди
    // них Московский марафон (26–27.09.2026, 16 тысяч финишёров).
    const ev = tds[1].match(/href="\/event\/(\d+)\/"[^>]*>\s*(?:<span[^>]*>)?([^<]+)</);
    if (!ev) continue;
    const dm = ev[2].trim().match(/(\d{2})\.(\d{2})\.(\d{4})\s*$/) || ev[2].trim().match(/^(\d{2})(?:\.(\d{2}))?(?:\.(\d{4}))?/);
    const first = ev[2].trim().match(/^(\d{2})(?:\.(\d{2}))?(?:\.(\d{4}))?/);
    if (!dm || !first) continue;
    const year = first[3] || dm[3];
    const month = first[2] || dm[2];
    if (!year || !month) continue;
    const date = `${year}-${month}-${first[1]}`;
    // Только текст ссылки: рядом в той же ячейке probeg пишет оценку («4.8, число оценивших…»).
    const name = clean((tds[2].match(/<a[^>]*>([\s\S]*?)<\/a>/) || ["", tds[2]])[1]);
    const place = splitPlace(clean(tds[3]));
    const city = place.city;
    const distances = [...tds[4].matchAll(/<a[^>]*>([^<]+)<\/a>|<span[^>]*>([^<]+)<\/span>/g)].map((x) => clean(x[1] || x[2] || "")).filter(Boolean);
    const tot = clean(tds[5]).match(/всего:\s*(\d+)/);
    const fin = tot ? Number(tot[1]) : Number((clean(tds[5]).match(/^\d+/) || [""])[0]) || null;
    const links = tds[tds.length - 1];
    const vk = (links.match(/href="(https?:\/\/vk\.(?:com|ru)\/[^"]+)"/) || [])[1] || null;
    const site = (links.match(/href="(https?:\/\/[^"]+)"[^>]*>\s*Сайт/) || [])[1] || null;
    out.push({ sid: ev[1], date, name, city, region: place.region, distances, finishers: fin, vk, site });
  }
  return out;
}

// ── сопоставление «это то же событие, но в следующем году» ───────────────────

const STOP = new Set(["забег", "пробег", "трейл", "trail", "марафон", "полумарафон", "кросс", "race", "run", "фестиваль", "бега", "по", "на", "и", "в", "the", "открытый", "чемпионат", "этап", "кубок", "г", "ежегодный", "традиционный", "международный", "всероссийский",
  // Спонсорская приставка меняется от года к году: «Сочи Марафон» 2025 → «Альфа-Банк Сочи Марафон» 2026.
  "банк", "альфа", "сбер", "сберпрайм"]);

/** Ключ названия без года, номеров проведения и служебных слов: «XIII Казанский марафон 2026» → «казанский». */
export function nameKey(name: string): string {
  return [...keyTokens(name)].sort().join(" ");
}

export function keyTokens(name: string): Set<string> {
  const words = name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'.,:;!?()|—–\-\/№]/g, " ")
    .split(/\s+/)
    .filter((w) => !/^[ivxlc]+$/.test(w) && !/^\d+(-?(й|я|е|ый|ой|ий))?$/.test(w) && !/^20\d\d$/.test(w));
  const key = new Set(words.filter((w) => w.length > 2 && !STOP.has(w)));
  // Название из одних служебных слов: «Всероссийский полумарафон «ЗаБег.РФ»» (Москва 2026, 46 тысяч
  // финишёров). Было (до 29.10.2026): пустой ключ, и buildExpected такой старт пропускал.
  return key.size ? key : new Set(words.filter((w) => w.length > 1));
}

/** Доля слов a, нашедшихся в b (точно или по общему началу из 5 букв). */
function cover(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if ([...b].some((x) => x === w || (w.length > 4 && x.length > 4 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))))) n++;
  return n / a.size;
}

/**
 * Похожесть названий в обе стороны: меньшая из долей. Было (до 15.10.2026): доля от меньшего ключа,
 * и «Завидово» целиком входил в «IRONSTAR Завидово», а «DAB Vertical Summer» — в «… Summer Night».
 */
export function nameScore(a: string, b: string): number {
  const A = keyTokens(a), B = keyTokens(b);
  return Math.min(cover(A, B), cover(B, A));
}

// Разновидность одной серии: ночной, зимний, летний… Слово есть только с одной стороны — это другой
// старт серии, а не следующее проведение («DAB Vertical Summer» ≠ «DAB Vertical Summer Night»).
const VARIANTS: [string, RegExp][] = [
  ["night", /night|ночн|ночь|полуночн/i],
  ["winter", /winter|зимн|зима/i],
  ["spring", /spring|весенн|весна/i],
  ["summer", /summer|летн|лето/i],
  ["autumn", /autumn|осенн|осень/i],
  // «Марафон» и «полумарафон» — служебные слова ключа, и «Московский марафон» с «Московским
  // полумарафоном» давали один ключ «московский»: buildExpected оставлял один из двух (до 29.10.2026).
  ["half", /полумарафон|half[\s-]?marathon/i],
  ["marathon", /(?<!полу)марафон|(?<!half[\s-]?)marathon/i],
];
const variants = (name: string) => VARIANTS.filter(([, re]) => re.test(name)).map(([k]) => k).join(",");

const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/ё/g, "е").trim();

/** Неделя года 1..53 (ISO-подобно, по понедельникам не важно: сравниваем разницу). */
export function weekOfYear(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / (7 * 864e5)) + 1;
}

export function weekDiff(a: string, b: string): number {
  const d = Math.abs(weekOfYear(a) - weekOfYear(b));
  return Math.min(d, 52 - d);
}

/** Окно следующего проведения: годовщина прошлого через год или через два, ±60 дней. */
export const EDITION_WINDOW_DAYS = 60;
export function nearAnniversary(lastIso: string, nextIso: string): boolean {
  const gap = (Date.parse(`${nextIso}T00:00:00Z`) - Date.parse(`${lastIso}T00:00:00Z`)) / 864e5;
  return Math.abs(gap - 365) <= EDITION_WINDOW_DAYS || Math.abs(gap - 730) <= EDITION_WINDOW_DAYS;
}

/**
 * Следующее проведение прошлого старта в календаре. Строго, потому что в announced строка уходит
 * сама, без тренера: годовщина через год или два ±60 дней, тот же город (без учёта регистра и ё),
 * тот же тип, если известен с обеих сторон, похожее название в обе стороны (nameScore ≥ 0.75) и
 * одна и та же разновидность серии (ночной, зимний…).
 * Было (до 15.10.2026): неделя года ±2 в 120–400 днях, доля от меньшего ключа ≥ 0.6, тип не сверялся.
 */
export function findNextEdition(p: { name: string; city: string; date: string; race_type?: string | null }, future: FutureRow[]): FutureRow | null {
  const kind = variants(p.name);
  let best: { row: FutureRow; score: number } | null = null;
  for (const f of future) {
    if (!nearAnniversary(p.date, f.date_start)) continue;
    if (!p.city || !f.city || norm(f.city) !== norm(p.city)) continue;
    if (p.race_type && f.race_type && p.race_type !== f.race_type) continue;
    if (variants(f.name) !== kind) continue;
    const score = nameScore(p.name, f.name);
    if (score >= 0.75 && (!best || score > best.score)) best = { row: f, score };
  }
  return best?.row ?? null;
}

const JUNK = /онлайн|online|виртуал|челлендж|тренировк|забег обещаний|parkrun|паркран|5 в[её]рст|скандинавск|ходьб|лыж|велос|плаван|заплыв|эстафета школ|школьн|детск|первенство (школ|дюсш)|спартакиад/i;

export function classifyType(name: string, distances: string[]): string {
  const t = `${name} ${distances.join(" ")}`.toLowerCase();
  if (/триатлон|дуатлон|акватлон|swimrun|свимран/.test(t)) return "tri";
  if (/трейл|trail|кросс|горн|скай|sky|вертикал|ультратрейл/.test(t)) return "trail";
  if (/манеж|стадион|лёгкой атлетике|легкой атлетике/.test(t) && !/марафон/.test(t)) return "track";
  return "road";
}

/** Ожидаемые: прошлые старты без следующего проведения в календаре. Стадион, детское и прочее не беговое — мимо. */
export function buildExpected(past: PastRace[], future: FutureRow[]): { expected: ExpectedRow[]; announced: { id: string; race_id: string }[] } {
  const expected: ExpectedRow[] = [];
  const announced: { id: string; race_id: string }[] = [];
  const seenKey = new Set<string>();
  // Свежие первыми: если старт проводился дважды за год, ожидаем по последнему проведению.
  for (const p of [...past].sort((a, b) => b.date.localeCompare(a.date))) {
    if (JUNK.test(p.name)) continue;
    const type = classifyType(p.name, p.distances);
    if (type === "track") continue;
    const key = nameKey(p.name);
    if (!key) continue;
    const k = `${key}|${norm(p.city)}|${variants(p.name)}`;
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    const next = findNextEdition({ ...p, race_type: type }, future);
    const id = `probeg:${p.sid}`;
    if (next) {
      announced.push({ id, race_id: next.id });
      continue;
    }
    expected.push({
      id,
      name: p.name.replace(/\s+[—–]\s+/g, " - "),
      name_key: key,
      city: p.city,
      region: p.region ?? null,
      race_type: type,
      distances: p.distances.filter((d) => !/дет/i.test(d)).slice(0, 8),
      last_date: p.date,
      last_month: Number(p.date.slice(5, 7)),
      last_url: `https://probeg.org/event/${p.sid}/`,
      site_url: p.site || p.vk,
      last_finishers: p.finishers,
    });
  }
  return { expected, announced };
}

/** Окна запроса к probeg по неделям: таблица обрезается на 100 строках. */
export function weekWindows(fromIso: string, toIso: string): [string, string][] {
  const out: [string, string][] = [];
  let t = Date.parse(`${fromIso}T00:00:00Z`);
  const end = Date.parse(`${toIso}T00:00:00Z`);
  while (t <= end) {
    const a = new Date(t).toISOString().slice(0, 10);
    const b = new Date(Math.min(t + 6 * 864e5, end)).toISOString().slice(0, 10);
    out.push([a, b]);
    t += 7 * 864e5;
  }
  return out;
}

export function probegPastUrl(from: string, to: string): string {
  return `https://probeg.org/races/?date_region=0&country=RU&date_from=${from}&date_to=${to}&hide_parkruns=on&btnSearchSubmit=1`;
}
