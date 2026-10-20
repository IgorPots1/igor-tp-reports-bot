/* Для списка в мини-приложении (наряд 20.10.2026): по каждому старту строка «Важное» и число полей
 * выжимки (кнопка «Всё о старте» — от 3). Раньше ехало в HTML /races всем подряд; теперь только
 * мини-приложению по подписанному initData (X-Telegram-Init-Data), см. miniapp-auth.ts. */

import { COPYRIGHT_HEADERS } from "@/features/race-guard/guard";
import { requireMiniapp } from "@/features/race-guard/miniapp-auth";
import { loadDetailsIndex } from "@/app/races/load";

export const runtime = "nodejs";
export const preferredRegion = "dub1";

export async function GET(request: Request) {
  const auth = await requireMiniapp(request);
  if (auth instanceof Response) return auth;
  const index = await loadDetailsIndex();
  // [строка «Важное», число полей]: компактно, ответ на ~500 стартов.
  const details: Record<string, [string | null, number]> = {};
  for (const [id, d] of index) if (d.line || d.n) details[id] = [d.line, d.n];
  return Response.json({ ok: true, details }, { headers: { "Cache-Control": "private, no-store", ...COPYRIGHT_HEADERS } });
}
