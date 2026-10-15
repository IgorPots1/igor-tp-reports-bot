/**
 * Единственный путь, которым скрипты календаря стартов ходят в чужую сеть (решение 15.10.2026:
 * myrace.info закрыт robots.txt целиком, а разовый скрипт всё равно его запросил).
 *
 * ПРАВИЛА (в коде, а не в тексте задания):
 *   — сайт: перед первым запросом к хосту читается https://<хост>/robots.txt (кэш на прогон);
 *     путь закрыт для нашего агента или для «*» — RobotsBlockedError, запроса нет;
 *     robots.txt 404/410 — правил нет, можно; 5xx, сеть, таймаут — НЕЛЬЗЯ (не знаем правил);
 *   — официальные API (API_HOSTS) живут по своим правилам использования, robots.txt у них про
 *     поисковых роботов: их пропускаем без robots, но с той же паузой между запросами;
 *   — downloader.disk.yandex.ru (robots: Disallow /) — только по ссылке, которую вернул
 *     официальный API Яндекс Диска для ОДНОГО файла, опубликованного организатором
 *     (opts.yandexDiskApiHref = true; решение Игоря 15.10.2026);
 *   — не чаще одного запроса в MIN_INTERVAL_MS на хост; Crawl-delay сайта, если он больше;
 *   — User-Agent всегда наш.
 * Обход запрещён проверкой: check:polite-fetch падает, если в скриптах календаря есть голый
 * fetch( или page.goto( мимо этого модуля.
 */

export const UA = "igorp.run race calendar (+https://igorp.run)";
const UA_TOKEN = "igorp.run";
export const MIN_INTERVAL_MS = 1100;

/** Официальные API по их правилам использования (не сайты для обхода). */
export const API_HOSTS = new Set([
  "api.open-meteo.com", "archive-api.open-meteo.com",
  "routing.openstreetmap.de", "tile.openstreetmap.org", "overpass-api.de", "nominatim.openstreetmap.org",
  "cloud-api.yandex.net", "api.vk.com", "api.telegram.org", "api.vercel.com",
]);
const YADISK_DOWNLOAD_HOST = "downloader.disk.yandex.ru";

export class RobotsBlockedError extends Error {
  constructor(public url: string, public reason: string) {
    super(`robots.txt запрещает ${url}: ${reason}`);
    this.name = "RobotsBlockedError";
  }
}

type Rule = { allow: boolean; path: string };
export type Robots = { rules: Rule[]; crawlDelayMs: number } | "allow-all" | "deny-all";

/** Разбор robots.txt: группа нашего агента, иначе «*». Пустой Disallow — всё можно. */
export function parseRobots(txt: string): Robots {
  const groups: { agents: string[]; rules: Rule[]; delay: number }[] = [];
  let cur: { agents: string[]; rules: Rule[]; delay: number } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], delay: 0 }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val) cur.rules.push({ allow: false, path: val });
    else if (key === "allow" && val) cur.rules.push({ allow: true, path: val });
    else if (key === "crawl-delay" && Number(val) > 0) cur.delay = Number(val) * 1000;
  }
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && UA_TOKEN.toLowerCase().includes(a)));
  const pick = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  if (!pick.length) return "allow-all";
  return { rules: pick.flatMap((g) => g.rules), crawlDelayMs: Math.max(0, ...pick.map((g) => g.delay)) };
}

/** Совпадение пути с правилом robots: префикс, «*» — любые символы, «$» — конец. */
function matches(pathAndQuery: string, rule: string): boolean {
  // «$» особый только в конце правила; в середине — обычный символ
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const re = new RegExp("^" + body + (anchored ? "$" : ""));
  return re.test(pathAndQuery);
}

/** Можно ли путь по разобранному robots: самое длинное совпавшее правило, при равенстве Allow. */
export function robotsAllows(robots: Robots, pathAndQuery: string): boolean {
  if (robots === "allow-all") return true;
  if (robots === "deny-all") return false;
  let best: Rule | null = null;
  for (const r of robots.rules) {
    if (!matches(pathAndQuery, r.path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Фабрика (для тестов — свой fetch и часы); в скриптах — готовые politeFetch/assertRobotsAllowed ниже. */
export function createPoliteFetch(deps: { fetch: FetchLike; sleep?: (ms: number) => Promise<void>; now?: () => number }) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const robotsCache = new Map<string, Promise<Robots>>();
  const lastAt = new Map<string, number>();

  async function robotsFor(origin: string): Promise<Robots> {
    let p = robotsCache.get(origin);
    if (!p) {
      p = (async () => {
        try {
          const res = await deps.fetch(`${origin}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
          if (res.status === 404 || res.status === 410) return "allow-all" as const;
          if (!res.ok) return "deny-all" as const;
          return parseRobots(await res.text());
        } catch {
          return "deny-all" as const;
        }
      })();
      robotsCache.set(origin, p);
    }
    return p;
  }

  async function check(url: string, opts: { yandexDiskApiHref?: boolean } = {}): Promise<number> {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error(`только http(s): ${url}`);
    if (API_HOSTS.has(u.hostname)) return 0;
    if (u.hostname === YADISK_DOWNLOAD_HOST) {
      if (opts.yandexDiskApiHref) return 0;
      throw new RobotsBlockedError(url, "хост скачивания Яндекс Диска — только по ссылке из официального API");
    }
    const robots = await robotsFor(u.origin);
    if (robots === "deny-all") throw new RobotsBlockedError(url, "robots.txt недоступен (ошибка сервера или сети) — правил не знаем");
    if (!robotsAllows(robots, u.pathname + u.search)) throw new RobotsBlockedError(url, "путь закрыт (Disallow)");
    return robots === "allow-all" ? 0 : robots.crawlDelayMs;
  }

  /** Проверка robots без запроса (для переходов браузера Playwright). */
  async function assertRobotsAllowed(url: string): Promise<void> {
    await check(url);
  }

  async function politeFetch(url: string, init: RequestInit = {}, opts: { yandexDiskApiHref?: boolean } = {}): Promise<Response> {
    const crawlDelay = await check(url, opts);
    const host = new URL(url).hostname;
    const gap = Math.max(MIN_INTERVAL_MS, crawlDelay);
    const wait = (lastAt.get(host) ?? -Infinity) + gap - now();
    if (wait > 0) await sleep(wait);
    lastAt.set(host, now());
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
    return deps.fetch(url, { ...init, headers });
  }

  return { politeFetch, assertRobotsAllowed };
}

const shared = createPoliteFetch({ fetch: (u, i) => fetch(u, i) });
export const politeFetch = shared.politeFetch;
export const assertRobotsAllowed = shared.assertRobotsAllowed;
