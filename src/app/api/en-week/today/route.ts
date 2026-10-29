/* GET /api/en-week/today?c=<ChatPlace client id>[&slot=morning|midday|evening][&peek=1]
 * ChatPlace calls this every 2 hours (docs/specs/en-week-chatplace.md) and sends `message`
 * only when `send` is true, with the buttons named in `buttons`. Idempotent per local day and
 * slot: a repeat call in the same slot returns send:false. Header x-en-week-key required. */

import { guardChatPlace, json, readParams } from "@/features/en-week/http";
import { isSlot } from "@/features/en-week/logic";
import { cleanClientId, dmToday } from "@/features/en-week/service";
import { supabaseEnWeekStore } from "@/features/en-week/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const denied = guardChatPlace(request);
  if (denied) return denied;
  const p = await readParams(request);
  const c = cleanClientId(p.c);
  if (!c) return json({ ok: false, error: "c" }, 400);
  try {
    const out = await dmToday(supabaseEnWeekStore(), c, new Date(), {
      slot: isSlot(p.slot) ? p.slot : null,
      peek: p.peek === "1" || p.peek === true,
    });
    return json(out);
  } catch (e) {
    console.error(`[en-week] today: ${e instanceof Error ? e.message : String(e)}`);
    return json({ ok: false, send: false }, 500);
  }
}

export const GET = handle;
export const POST = handle;
