/* POST /api/en-week/page-screenshot
 *   {token, idx, dataUrl}   → upload a workout screenshot (JPEG/PNG/WEBP data URL, max 4 MB)
 *   {token, remove: id}     → delete one of the person's own screenshots
 * → {ok, view} | {ok:false, error}. Token-scoped: only the token owner's own sessions. Private
 * bucket, the page gets signed URLs. No coach notification. */

import { FLAG_OFF, json } from "@/features/en-week/http";
import { isEnWeekEnabled } from "@/features/en-week/logic";
import { isToken, pageAddScreenshot, pageDeleteScreenshot } from "@/features/en-week/service";
import { supabaseEnWeekStore } from "@/features/en-week/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS = { not_found: 404, not_yet: 409, limit: 409, type: 415, size: 413 } as const;

export async function POST(request: Request) {
  if (!isEnWeekEnabled()) return json(FLAG_OFF, 404);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "type" }, 400);
  }
  if (!isToken(body.token)) return json({ ok: false, error: "not_found" }, 404);
  try {
    const store = supabaseEnWeekStore();
    const out =
      typeof body.remove === "string"
        ? await pageDeleteScreenshot(store, body.token, body.remove, new Date())
        : await pageAddScreenshot(store, body.token, Number(body.idx), body.dataUrl, new Date());
    return json(out, out.ok ? 200 : STATUS[out.error]);
  } catch (e) {
    console.error(`[en-week] screenshot: ${e instanceof Error ? e.message : String(e)}`);
    return json({ ok: false, error: "save" }, 500);
  }
}
