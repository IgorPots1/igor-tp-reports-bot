// runc.run — Беговое сообщество (наряд 29.10.2026): Московский марафон, Московский полумарафон,
// марафон «Белые ночи», СПб полумарафон «Северная столица», Ночной забег, «Апрель», эстафета по
// Садовому кольцу, кроссы «Быстрый пёс» и «Лисья гора», «Скорость», Красочный забег, Большой
// фестиваль бега. Самые массовые старты страны, а у роботов их не было: Московского марафона в
// race_events не нашлось ни одного с 2025 года.
//
// Проверено 29.10.2026: robots.txt runc.run и поддоменов событий — «Allow: /»; в пользовательском
// соглашении запрета автоматического сбора нет (ограничения — про материалы пользователей). Берём
// только факты: название, даты, город, дистанции, ссылку.
//
// Устройство: в меню главной у каждого события дата БЕЗ года и ссылка на поддомен
// (moscowmarathon.runc.run); на странице события в шапке — дата С годом («26 сентября - 27 сентября
// 2026»). Без заголовка Accept-Language: ru сайт отдаёт английскую вёрстку без дат (get в index.ts
// его шлёт). Чистые функции без Deno: проверяются scripts/check-races-runc.ts.

export type RuncMenuItem = { host: string; url: string; name: string; label: string };
export type RuncEvent = { date_start: string; date_end: string; distances: string[] };

const MONTHS: [RegExp, number][] = [
  [/^январ/, 1], [/^феврал/, 2], [/^март/, 3], [/^апрел/, 4], [/^ма[йя]/, 5], [/^июн/, 6],
  [/^июл/, 7], [/^август/, 8], [/^сентябр/, 9], [/^октябр/, 10], [/^ноябр/, 11], [/^декабр/, 12],
];
const month = (w: string) => MONTHS.find(([r]) => r.test(w.toLowerCase()))?.[1] ?? 0;
const pad = (n: number) => String(n).padStart(2, "0");
const decode = (s: string) =>
  s.replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&#39;/g, "'");

/** Детские забеги, результаты, тренировки, магазин — не старты календаря. */
export const RUNC_SKIP = /^(kids|results|training|shop|foodpoint|vitrina|www)$/;
/** Петербургские события; остальные — Москва. */
export const RUNC_SPB = /^(wnmarathon|spbhalf)(-|$)/;

/** События из меню главной: поддомен, ссылка, название, дата без года. Дети и служебное — мимо. */
export function parseRuncMenu(html: string): RuncMenuItem[] {
  const out: RuncMenuItem[] = [];
  const seen = new Set<string>();
  const re = /responsive-left-runs-menu__item-label">([^<]+)<\/div>\s*<a href="(https:\/\/([a-z0-9-]+)\.runc\.run\/)"[^>]*class="responsive-left-runs-menu__item-link">([^<]+)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const [, label, url, host, name] = m;
    if (RUNC_SKIP.test(host) || /детск/i.test(name) || seen.has(host)) continue;
    seen.add(host);
    out.push({ host, url, name: decode(name).replace(/\s+/g, " ").trim(), label: label.trim() });
  }
  return out;
}

/** День и месяц начала из подписи меню: «21-22 февраля» → [21, 2], «5 апреля» → [5, 4]. */
export function labelStart(label: string): [number, number] | null {
  const m = label.match(/(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\s+([а-яё]+)/i) ?? label.match(/(\d{1,2})\s+([а-яё]+)/i);
  if (!m) return null;
  const mon = month(m[2]);
  return mon ? [Number(m[1]), mon] : null;
}

/**
 * Дата с годом со страницы события: «26 сентября - 27 сентября 2026», «16 мая 2026». Дат с годом на
 * странице бывает несколько (у весенних кроссов выше шапки стоит «22 февраля 2026» — сроки чего-то
 * другого), поэтому берётся та, чьи день и месяц начала совпадают с подписью в меню. Нет такой —
 * null: событие пропускается, дату не угадываем.
 */
export function parseRuncEvent(html: string, label: string): RuncEvent | null {
  const want = labelStart(label);
  if (!want) return null;
  const text = decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const re = /(\d{1,2})\s+([а-яё]+)(?:\s*[-–—]\s*(\d{1,2})\s+([а-яё]+))?\s+(20\d\d)(?!\d)/gi;
  for (const m of text.matchAll(re)) {
    const year = Number(m[5]);
    const m1 = month(m[2]);
    const m2 = m[4] ? month(m[4]) : m1;
    const d1 = Number(m[1]);
    const d2 = m[3] ? Number(m[3]) : d1;
    if (!m1 || !m2 || d1 !== want[0] || m1 !== want[1]) continue;
    // «30 декабря - 2 января 2027»: начало в прошлом году
    const y1 = m2 < m1 ? year - 1 : year;
    // Дистанции — в шапке сразу за датой и названием: «42,2 км», «2-8 км», «400 м».
    const head = text.slice(m.index! + m[0].length, m.index! + m[0].length + 300);
    const distances = [...new Set([...head.matchAll(/(\d+(?:[,.]\d+)?(?:\s*[-–]\s*\d+(?:[,.]\d+)?)?)\s*(км|м)(?![а-я])/gi)].map((x) => `${x[1].replace(".", ",")} ${x[2].toLowerCase()}`))];
    return { date_start: `${y1}-${pad(m1)}-${pad(d1)}`, date_end: `${year}-${pad(m2)}-${pad(d2)}`, distances };
  }
  return null;
}

/** Город и регион по поддомену. */
export function runcCity(host: string): string {
  return RUNC_SPB.test(host) ? "Санкт-Петербург" : "Москва";
}

/** Строка календаря из runc.run — те же поля, что у остальных роботов (Race в index.ts). */
export type RuncRace = {
  id: string; source: "runc"; source_id: string; source_url: string; name: string;
  date_start: string; date_end: string; date_text: string; city: string; region: string; location: string;
  distances: string[]; dist_km: number[]; race_type: string; tags: string[];
  site_url: string | null; reg_url: string | null; vk_url: string | null;
};
export type RuncDeps = {
  classify: (name: string, dists: string[], extra: string, trail: boolean) => { race_type: string; tags: string[] };
  distToKm: (d: string) => number | null;
  /** Пауза между страницами событий (поддомены — один сервер); 0, когда страницы уже скачаны. */
  pauseMs: number;
};

export const RUNC_HOME = "https://runc.run/";
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Предстоящие старты runc.run. Страницы берёт через fetchPage: в облаке это сеть, а с 29.10.2026 —
 * страницы, скачанные маком (runc.run не отвечает адресам облака Supabase, см. --feed в
 * scripts/races-manual.ts runc-feed). Ноль предстоящих — норма зимой; тревога — если не разобралось
 * меню или ни у одного события нет даты: значит, сменилась вёрстка.
 */
export async function collectRunc(fetchPage: (url: string) => Promise<string>, today: Date, horizon: Date, deps: RuncDeps): Promise<RuncRace[]> {
  const menu = parseRuncMenu(await fetchPage(RUNC_HOME));
  if (!menu.length) throw new Error("runc.run: меню событий не разобрано (сменилась вёрстка?)");
  const out: RuncRace[] = [];
  let dated = 0;
  for (const m of menu) {
    if (deps.pauseMs) await wait(deps.pauseMs);
    let ev;
    try { ev = parseRuncEvent(await fetchPage(m.url), m.label); } catch { continue; }
    if (ev) dated++;
    if (!ev || ev.date_end < isoDay(today) || ev.date_start > isoDay(horizon)) continue;
    const city = runcCity(m.host);
    const id = `${m.host}-${ev.date_start.slice(0, 4)}`;
    const dist_km = ev.distances.map(deps.distToKm).filter((x): x is number => x !== null);
    const { race_type, tags } = deps.classify(m.name, ev.distances, "", false);
    out.push({
      id: `runc:${id}`, source: "runc", source_id: id, source_url: m.url, name: m.name,
      date_start: ev.date_start, date_end: ev.date_end, date_text: m.label, city, region: city, location: city,
      distances: ev.distances, dist_km, race_type, tags, site_url: m.url, reg_url: null, vk_url: null,
    });
  }
  if (!dated) throw new Error(`runc.run: ни у одного из ${menu.length} событий не разобрана дата (сменилась вёрстка?)`);
  return out;
}

/** Страница для пакета с мака. Главная — HTML без скриптов, стилей и svg (меню разбирается по
 *  разметке); страница события — только текст: parseRuncEvent всё равно снимает теги, а пакет
 *  легче в десятки раз (на 29.10.2026 — 3,7 МБ с разметкой). */
export function compactPage(html: string, url: string): string {
  const bare = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  return url === RUNC_HOME ? bare : bare.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/** Пакет страниц с мака: только адреса runc.run и только строки — иначе стадия отказывается. */
export function feedFetcher(pages: unknown): ((url: string) => Promise<string>) | null {
  if (!pages || typeof pages !== "object" || Array.isArray(pages)) return null;
  const map = pages as Record<string, unknown>;
  for (const [u, v] of Object.entries(map)) if (!/^https:\/\/([a-z0-9-]+\.)?runc\.run\//.test(u) || typeof v !== "string") return null;
  return async (url: string) => {
    const html = map[url];
    if (typeof html !== "string") throw new Error(`нет страницы в пакете: ${url}`);
    return html;
  };
}
