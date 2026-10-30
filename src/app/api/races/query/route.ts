/* Календарь по частям (наряд 30.10.2026): сводка по фильтрам и порции стартов для /races и
 * мини-приложения. Ни один ответ не несёт больше MAX_ITEMS стартов (race-query.ts).
 *
 * Лимит: сайт без подписи — по IP в middleware (60 в минуту, 600 в час), как у страниц. С заголовком
 * X-Telegram-Init-Data middleware IP не считает, поэтому здесь подпись проверяется ВСЕГДА, когда
 * заголовок есть: верная — лимит по пользователю Telegram и «Важное» в ответе, неверная — 401 и счёт
 * в лимит IP (requireMiniapp). Ответ не кэшируется в CDN: мини-приложению он приходит с «Важным»,
 * и закэшированная копия досталась бы запросу без подписи. */

import { COPYRIGHT_HEADERS } from "@/features/race-guard/guard";
import { INIT_DATA_HEADER, requireMiniapp } from "@/features/race-guard/miniapp-auth";
import { detailsIndex, raceContext } from "@/app/races/race-data";
import { MAX_ITEMS, itemCount, runQuery, type QueryResult } from "@/app/races/race-query";
import type { Race } from "@/app/races/races-logic";

export const runtime = "nodejs";
// Франкфурт, а не Дублин, как остальные адреса календаря: данные этот адрес держит в памяти (race-data.ts,
// обновление раз в 10 минут), и к базе ходит редко, а смена фильтра — запрос на каждый клик. Ближе к
// людям — быстрее ответ: от Москвы и мака до fra1 ~20 мс, до dub1 через край сети — 200+ мс (замер 30.10.2026).
export const preferredRegion = "fra1";

const HEADERS = { "Cache-Control": "private, no-store", ...COPYRIGHT_HEADERS };

function withExtras(r: QueryResult, idx: Map<string, { line: string | null; n: number }>): QueryResult {
  const add = (x: Race): Race => {
    const d = idx.get(x.id);
    return d ? { ...x, important: d.line, detailsN: d.n } : x;
  };
  if (r.view === "summary") return { ...r, first: r.first ? { ...r.first, items: r.first.items.map(add) } : null, area: { ...r.area, items: r.area.items.map((a) => ({ ...a, race: add(a.race) })) } };
  if (r.view === "month") return { ...r, items: r.items.map(add) };
  if (r.view === "area") return { ...r, items: r.items.map((a) => ({ ...a, race: add(a.race) })) };
  return r;
}

export async function GET(request: Request) {
  let miniapp = false;
  if (request.headers.get(INIT_DATA_HEADER)) {
    const auth = await requireMiniapp(request);
    if (auth instanceof Response) return auth;
    miniapp = true;
  }
  const ctx = await raceContext();
  if (!ctx) return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: HEADERS });
  let result = runQuery(ctx, new URL(request.url).searchParams);
  if (miniapp) result = withExtras(result, await detailsIndex());
  if (itemCount(result) > MAX_ITEMS) {
    // Не должно случаться (race-query.ts режет порции); на всякий случай — отказ, а не утечка.
    console.error(`[races] query: ${itemCount(result)} стартов в ответе, потолок ${MAX_ITEMS}`);
    return Response.json({ ok: false, error: "too_many" }, { status: 500, headers: HEADERS });
  }
  return Response.json({ ok: true, ...result }, { headers: HEADERS });
}
