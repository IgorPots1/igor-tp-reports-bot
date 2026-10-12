/* Тело POST /api/pv → строка page_views. Чистая функция: решает, писать ли, и обрезает поля.
 * В строку попадают ТОЛЬКО перечисленные колонки — лишние ключи из тела отбрасываются. */

import { isBotUserAgent, isExcludedPath, isTrackedPath } from "./paths";

export type PageViewRow = {
  path: string;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  visitor_id: string | null;
  session_id: string | null;
  user_agent: string | null;
  country: string | null;
};

const PATH_MAX = 200;
const REFERRER_MAX = 500;
const UTM_MAX = 200;
const ID_MAX = 64;
const USER_AGENT_MAX = 500;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** null — не писать: не тот раздел, служебная зона, бот или мусор вместо тела. */
export function buildPageViewRow(
  body: unknown,
  meta: { userAgent: string | null; country: string | null },
): PageViewRow | null {
  if (isBotUserAgent(meta.userAgent)) return null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  if (typeof b.path !== "string" || !b.path.startsWith("/")) return null;
  // Только путь: query и hash отрезаем (UTM приходят отдельными полями).
  const pathname = b.path.split(/[?#]/u)[0];
  if (isExcludedPath(pathname) || !isTrackedPath(pathname)) return null;

  const country = meta.country && /^[A-Za-z]{2}$/u.test(meta.country) ? meta.country.toUpperCase() : null;

  return {
    path: pathname.slice(0, PATH_MAX),
    referrer: text(b.referrer, REFERRER_MAX),
    utm_source: text(b.utm_source, UTM_MAX),
    utm_medium: text(b.utm_medium, UTM_MAX),
    utm_campaign: text(b.utm_campaign, UTM_MAX),
    utm_content: text(b.utm_content, UTM_MAX),
    visitor_id: text(b.visitor_id, ID_MAX),
    session_id: text(b.session_id, ID_MAX),
    user_agent: text(meta.userAgent, USER_AGENT_MAX),
    country,
  };
}
