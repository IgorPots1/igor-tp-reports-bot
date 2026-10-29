/* POST /api/en-week/checkin {c, value: easy|ok|hard|skipped|pain} → {ok, reply}
 * The check-in goes to today's session, or the last past one still open. `reply` is the short
 * text ChatPlace sends back in the DM. Header x-en-week-key required. GET with query works too. */

import { guardChatPlace, json, readParams } from "@/features/en-week/http";
import { cleanClientId, dmCheckin } from "@/features/en-week/service";
import { supabaseEnWeekStore } from "@/features/en-week/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const denied = guardChatPlace(request);
  if (denied) return denied;
  const p = await readParams(request);
  const c = cleanClientId(p.c);
  if (!c) return json({ ok: false, error: "c" }, 400);
  const value = typeof p.value === "string" ? p.value.trim().toLowerCase() : p.value;
  try {
    const out = await dmCheckin(supabaseEnWeekStore(), c, value, new Date());
    if (!out.ok && !out.reply) return json({ ok: false, error: "value" }, 400);
    return json(out);
  } catch (e) {
    console.error(`[en-week] checkin: ${e instanceof Error ? e.message : String(e)}`);
    return json({ ok: false, reply: "" }, 500);
  }
}

export const POST = handle;
export const GET = handle;
