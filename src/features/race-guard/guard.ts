/* Защита /races от выкачивания (наряд 20.10.2026): лимит частоты по IP, журнал отказов, пометка
 * о запрете сбора. Работает и в middleware (edge), и в маршрутах (node): только fetch, без node:*.
 * Счётчик и журнал — в Supabase (race_guard_hit / race_guard_log_add, только service_role).
 * Сбой базы или таймаут — запрос ПРОПУСКАЕТСЯ: защита не должна ронять сайт. */

/** Лимиты на IP. Поисковики и превью мессенджеров — отдельно, с запасом: обход Googlebot с одного
 *  адреса бывает плотнее 60 в минуту, а User-Agent можно подделать, поэтому не безлимит. */
export const LIMITS = {
  human: { perMin: 60, perHour: 600 },
  bot: { perMin: 600, perHour: 10000 },
  // Мини-приложение с проверенной подписью: считается по пользователю Telegram, не по IP. Выжимка
  // предзагружается при прокрутке списка, и честная прокрутка даёт больше 60 запросов в минуту.
  miniapp: { perMin: 300, perHour: 3000 },
} as const;
export type LimitKind = keyof typeof LIMITS;

export const COPYRIGHT_TEXT = "© igorp.run. Копирование и автоматический сбор данных запрещены.";
/** Заголовок ответа API. В HTTP-заголовке только латиница (кириллица в значении — ошибка у fetch),
 *  поэтому по-английски, а русский текст — вторым заголовком в percent-кодировке. */
export const COPYRIGHT_HEADERS: Record<string, string> = {
  "X-Copyright": "(c) igorp.run. Copying and automated collection of data are prohibited.",
  "X-Copyright-Ru": encodeURIComponent(COPYRIGHT_TEXT),
};

/** Поисковики и превью ссылок, которые нельзя задеть. Совпадение — по токену в User-Agent. */
const GOOD_BOTS = [
  "Googlebot",
  "Google-InspectionTool",
  "GoogleOther",
  "AdsBot-Google",
  "YandexBot",
  "YandexMobileBot",
  "YandexImages",
  "YandexMetrika",
  "bingbot",
  "BingPreview",
  "TelegramBot",
  "facebookexternalhit",
  "Twitterbot",
  "vkShare",
  "WhatsApp",
];

export function goodBot(ua: string): string | null {
  const low = ua.toLowerCase();
  return GOOD_BOTS.find((b) => low.includes(b.toLowerCase())) ?? null;
}

/** IP клиента за прокси Vercel: первый адрес x-forwarded-for, иначе x-real-ip. */
export function clientIp(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || h.get("x-real-ip")?.trim() || "unknown";
}

/** Маска для журнала: IPv4 — последний октет «x», IPv6 — первые три группы и «::x». */
export function maskIp(ip: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, ".x");
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::x`;
  return "unknown";
}

export type Decision = { allowed: boolean; nMin: number; nHour: number; limit: { perMin: number; perHour: number } };

/** Решение по счётчикам: отдельной функцией, чтобы проверка шла без базы. */
export function decide(nMin: number, nHour: number, kind: LimitKind): Decision {
  const limit = LIMITS[kind];
  return { allowed: nMin <= limit.perMin && nHour <= limit.perHour, nMin, nHour, limit };
}

type Env = { url: string; key: string };

function env(): Env | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function rpc(e: Env, fn: string, body: unknown, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`${e.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}

/** Прибавить запрос в счётчик и решить. Нет окружения, база не ответила за 400 мс — пропускаем. */
export async function hitBucket(bucket: string, kind: LimitKind, fetchImpl: typeof fetch = fetch): Promise<Decision> {
  const e = env();
  if (!e) return decide(0, 0, kind);
  try {
    const res = await rpc(e, "race_guard_hit", { p_bucket: bucket }, 400, fetchImpl);
    if (!res.ok) return decide(0, 0, kind);
    const rows = (await res.json()) as { n_min: number; n_hour: number }[];
    return decide(rows[0]?.n_min ?? 0, rows[0]?.n_hour ?? 0, kind);
  } catch {
    return decide(0, 0, kind);
  }
}

/** Счётчик по IP: у поисковиков и превью (по User-Agent) — свой, с запасом. */
export async function hit(ip: string, ua: string, fetchImpl: typeof fetch = fetch): Promise<Decision> {
  const kind: LimitKind = goodBot(ua) !== null ? "bot" : "human";
  if (ip === "unknown") return decide(0, 0, kind);
  return hitBucket(`${kind === "bot" ? "bot" : "ip"}:${ip}`, kind, fetchImpl);
}

export type RefusalKind = "rate_limit" | "no_init_data" | "bad_init_data" | "forbidden";

/** Строка в журнал отказов. Ошибки глотаются: журнал не должен мешать ответу. */
export async function logRefusal(kind: RefusalKind, ip: string, ua: string, path: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const e = env();
  if (!e) return;
  try {
    await rpc(e, "race_guard_log_add", { p_kind: kind, p_ip_masked: maskIp(ip), p_ua: ua.slice(0, 300), p_path: path.slice(0, 300) }, 1500, fetchImpl);
  } catch {
    // пропуск
  }
}

export function tooManyRequests(d: Decision): Response {
  return new Response(JSON.stringify({ ok: false, error: "rate_limited", message: COPYRIGHT_TEXT }), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": d.nMin > d.limit.perMin ? "60" : "3600",
      "Cache-Control": "no-store",
      ...COPYRIGHT_HEADERS,
    },
  });
}
