/* Поисковик по User-Agent — только с адреса самого поисковика (наряд 29.10.2026, проверка защиты как
 * атака). Было (с 20.10.2026): запас LIMITS.bot давался по одному User-Agent, и скрипт с обычного IP,
 * назвавшись Googlebot, получал 600 в минуту и 10 000 в час вместо 60 и 600 — проверено на боевом
 * сайте: с исчерпанным лимитом «Googlebot» и «YandexBot» продолжали получать 200.
 *
 * Как проверяем (так советуют сами поисковики):
 *  - Google и Bing — опубликованные списки адресов (JSON), кэш на сутки;
 *  - Telegram (превью ссылок) — опубликованный список адресов Telegram;
 *  - Яндекс — обратный DNS (*.yandex.ru/.net/.com) и прямой обратно на тот же адрес, через DNS-over-HTTPS;
 *  - остальные превью (facebook, Twitter, VK, WhatsApp) — без запаса: превью — один запрос на ссылку,
 *    обычного лимита им хватает.
 * Не подтвердилось или список не скачался — обычный лимит человека (60 в минуту), не отказ: настоящий
 * поисковик при сбое списка просто идёт медленнее, сайт для него не закрывается.
 * Работает в middleware (edge): только fetch, без node:*. */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const DAY_MS = 24 * 3600 * 1000;

/** Списки адресов. Ключ — семейство, проверяемое по списку. */
export const RANGE_LISTS: Record<string, string[]> = {
  google: [
    "https://developers.google.com/static/search/apis/ipranges/googlebot.json",
    "https://developers.google.com/static/search/apis/ipranges/special-crawlers.json",
  ],
  bing: ["https://www.bing.com/toolbox/bingbot.json"],
  telegram: ["https://core.telegram.org/resources/cidr.txt"],
};

/** Семейство по токену User-Agent (токены — GOOD_BOTS в guard.ts). null — без запаса. */
export function botFamily(token: string): "google" | "bing" | "telegram" | "yandex" | null {
  const t = token.toLowerCase();
  if (t.startsWith("google") || t === "adsbot-google") return "google";
  if (t === "bingbot" || t === "bingpreview") return "bing";
  if (t === "telegrambot") return "telegram";
  if (t.startsWith("yandex")) return "yandex";
  return null;
}

// ---------- адреса и подсети ----------

/** Адрес числом (IPv4 — 32 бита, IPv6 — 128). null — не адрес. */
export function ipToBig(ip: string): { v: 4 | 6; n: bigint } | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const p = ip.split(".").map(Number);
    if (p.some((x) => x > 255)) return null;
    return { v: 4, n: p.reduce((a, x) => (a << BigInt(8)) | BigInt(x), BigInt(0)) };
  }
  if (!ip.includes(":") || !/^[0-9a-f:.]+$/i.test(ip)) return null;
  if (ip.split("::").length > 2) return null;
  const [head, tail] = ip.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = ip.includes("::") ? 8 - h.length - t.length : 0;
  const groups = [...h, ...Array(Math.max(fill, 0)).fill("0"), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { v: 6, n: groups.reduce((a, g) => (a << BigInt(16)) | BigInt(parseInt(g, 16)), BigInt(0)) };
}

export type Cidr = { v: 4 | 6; base: bigint; bits: number };

export function parseCidr(s: string): Cidr | null {
  const [addr, len] = s.trim().split("/");
  const ip = ipToBig(addr ?? "");
  const bits = Number(len);
  if (!ip || !Number.isInteger(bits) || bits < 0 || bits > (ip.v === 4 ? 32 : 128)) return null;
  return { v: ip.v, base: ip.n, bits };
}

export function inCidr(ip: string, c: Cidr): boolean {
  const a = ipToBig(ip);
  if (!a || a.v !== c.v) return false;
  const width = BigInt(c.v === 4 ? 32 : 128);
  const shift = width - BigInt(c.bits);
  return a.n >> shift === c.base >> shift;
}

/** Подсети из ответа: JSON Google/Bing ({prefixes:[{ipv4Prefix|ipv6Prefix}]}) или текст построчно. */
export function parseRanges(body: string): Cidr[] {
  let raw: string[];
  try {
    const j = JSON.parse(body) as { prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[] };
    raw = (j.prefixes ?? []).map((p) => p.ipv4Prefix ?? p.ipv6Prefix ?? "");
  } catch {
    raw = body.split(/\s+/);
  }
  return raw.map(parseCidr).filter((c): c is Cidr => c !== null);
}

// ---------- проверка с кэшем ----------

export function createBotVerifier(fetchImpl: FetchLike, now: () => number = Date.now) {
  const lists = new Map<string, { at: number; ranges: Cidr[] }>();
  const loading = new Map<string, Promise<Cidr[]>>();
  const dnsCache = new Map<string, { at: number; ok: boolean }>();

  async function ranges(family: string): Promise<Cidr[]> {
    const have = lists.get(family);
    if (have && now() - have.at < DAY_MS) return have.ranges;
    let p = loading.get(family);
    if (!p) {
      p = (async () => {
        const got: Cidr[] = [];
        for (const url of RANGE_LISTS[family] ?? []) {
          try {
            const res = await fetchImpl(url, { signal: AbortSignal.timeout(1500) });
            if (res.ok) got.push(...parseRanges(await res.text()));
          } catch {
            // список не скачался — ниже решаем по старому или без запаса
          }
        }
        if (got.length) lists.set(family, { at: now(), ranges: got });
        loading.delete(family);
        // Сбой обновления: старый список лучше пустого (настоящий поисковик не упрётся в 60 в минуту).
        return got.length ? got : (have?.ranges ?? []);
      })();
      loading.set(family, p);
    }
    return p;
  }

  async function dns(name: string, type: "PTR" | "A" | "AAAA"): Promise<string[]> {
    const res = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { Answer?: { data?: string }[] };
    return (j.Answer ?? []).map((a) => String(a.data ?? "").replace(/\.$/, ""));
  }

  /** Обратный DNS → имя Яндекса → прямой DNS обратно на тот же адрес. */
  async function yandexByDns(ip: string): Promise<boolean> {
    const a = ipToBig(ip);
    if (!a) return false;
    const rev =
      a.v === 4
        ? `${ip.split(".").reverse().join(".")}.in-addr.arpa`
        : `${a.n.toString(16).padStart(32, "0").split("").reverse().join(".")}.ip6.arpa`;
    const hosts = (await dns(rev, "PTR")).filter((h) => /\.yandex\.(ru|net|com)$/i.test(h));
    for (const host of hosts) {
      const back = await dns(host, a.v === 4 ? "A" : "AAAA");
      if (back.some((x) => ipToBig(x)?.n === a.n)) return true;
    }
    return false;
  }

  async function verified(token: string, ip: string): Promise<boolean> {
    const family = botFamily(token);
    if (!family || !ipToBig(ip)) return false;
    if (family === "yandex") {
      const c = dnsCache.get(ip);
      if (c && now() - c.at < DAY_MS) return c.ok;
      let ok = false;
      try {
        ok = await yandexByDns(ip);
      } catch {
        return false; // сбой DNS не кэшируем: следующий запрос проверит заново
      }
      if (dnsCache.size > 5000) dnsCache.clear();
      dnsCache.set(ip, { at: now(), ok });
      return ok;
    }
    return (await ranges(family)).some((c) => inCidr(ip, c));
  }

  return { verified };
}

const shared = createBotVerifier((u, i) => fetch(u, i));
export const verifiedBot = shared.verified;
