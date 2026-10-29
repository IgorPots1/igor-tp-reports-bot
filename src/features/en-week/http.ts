/* Small shared pieces of the /api/en-week/* routes. */

import { isAuthorizedEnWeek } from "./auth";
import { isEnWeekEnabled } from "./logic";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export const FLAG_OFF = { ok: false, skipped: "EN_WEEK_ENABLED off" };

/** Flag first (off → 404, nothing is read), then the ChatPlace key (bad → 401). */
export function guardChatPlace(request: Request): Response | null {
  if (!isEnWeekEnabled()) return json(FLAG_OFF, 404);
  if (!isAuthorizedEnWeek(request)) return json({ ok: false, error: "unauthorized" }, 401);
  return null;
}

/** Query string merged with a JSON body (POST). ChatPlace may send either. */
export async function readParams(request: Request): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URL(request.url).searchParams) out[k] = v;
  if (request.method === "POST") {
    try {
      const body = (await request.json()) as unknown;
      if (body && typeof body === "object" && !Array.isArray(body)) Object.assign(out, body);
    } catch {
      // empty or non-JSON body: query only
    }
  }
  return out;
}
