/* GET /api/en-week/status?c=<id> → {ok, stage, day, next_workout_date, offer_due, case_due, ...}
 * For branching in ChatPlace (e.g. "no plan yet" reminder, stop the loop when stage=done).
 * Read-only apart from keeping the stored stage in step. Header x-en-week-key required. */

import { guardChatPlace, json, readParams } from "@/features/en-week/http";
import { cleanClientId, dmStatus } from "@/features/en-week/service";
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
    return json(await dmStatus(supabaseEnWeekStore(), c, new Date()));
  } catch (e) {
    console.error(`[en-week] status: ${e instanceof Error ? e.message : String(e)}`);
    return json({ ok: false }, 500);
  }
}

export const GET = handle;
export const POST = handle;
