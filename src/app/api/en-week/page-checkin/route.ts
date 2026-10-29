/* POST /api/en-week/page-checkin {token, idx, value} → {ok, reply, view}
 * Check-in from the plan page. The personal token is the only key (same as the link). */

import { FLAG_OFF, json } from "@/features/en-week/http";
import { isEnWeekEnabled } from "@/features/en-week/logic";
import { isToken, pageCheckin } from "@/features/en-week/service";
import { supabaseEnWeekStore } from "@/features/en-week/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isEnWeekEnabled()) return json(FLAG_OFF, 404);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false }, 400);
  }
  if (!isToken(body.token)) return json({ ok: false }, 404);
  try {
    const out = await pageCheckin(supabaseEnWeekStore(), body.token, Number(body.idx), body.value, new Date());
    return json(out, out.ok ? 200 : 409);
  } catch (e) {
    console.error(`[en-week] page-checkin: ${e instanceof Error ? e.message : String(e)}`);
    return json({ ok: false }, 500);
  }
}
