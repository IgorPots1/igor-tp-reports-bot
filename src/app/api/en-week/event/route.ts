/* POST /api/en-week/event {kind: "open", c?}: the entry page was opened (top of the funnel).
 * Only "open" is accepted; bots and link previews are not counted. Never fails the page. */

import { isBotUserAgent } from "@/features/page-views/paths";
import { FLAG_OFF, json } from "@/features/en-week/http";
import { isEnWeekEnabled } from "@/features/en-week/logic";
import { cleanClientId } from "@/features/en-week/service";
import { supabaseEnWeekStore } from "@/features/en-week/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isEnWeekEnabled()) return json(FLAG_OFF, 404);
  if (isBotUserAgent(request.headers.get("user-agent"))) return json({ ok: true });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.kind !== "open") return json({ ok: false }, 400);
    await supabaseEnWeekStore().logEvent(null, "open", { linked: !!cleanClientId(body.c) });
  } catch (e) {
    console.error(`[en-week] event: ${e instanceof Error ? e.message : String(e)}`);
  }
  return json({ ok: true });
}
