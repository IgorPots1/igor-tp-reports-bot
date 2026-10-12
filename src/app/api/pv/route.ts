/* POST /api/pv — просмотр публичной страницы igorp.run (шлёт PageViewTracker через sendBeacon).
 * Всегда 204: счётчик не должен ничем мешать странице. Что писать, решает buildPageViewRow;
 * запись — после ответа (after), чтобы задумавшаяся база не задерживала маяк. */

import { after } from "next/server";

import { buildPageViewRow } from "@/features/page-views/record";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY_MAX_BYTES = 4096;

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (!raw || raw.length > BODY_MAX_BYTES) return noContent();

    const row = buildPageViewRow(JSON.parse(raw), {
      userAgent: request.headers.get("user-agent"),
      country: request.headers.get("x-vercel-ip-country"),
    });
    if (!row) return noContent();

    after(async () => {
      const { error } = await createSupabaseServerClient().from("page_views").insert(row);
      if (error) console.error(`[pv] insert: ${describeSupabaseError(error)}`);
    });
  } catch (e) {
    console.error(`[pv] ${e instanceof Error ? e.message : String(e)}`);
  }
  return noContent();
}
