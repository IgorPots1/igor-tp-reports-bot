/* GET /go/consult?tool=<инструмент>&text=<заготовка> — кнопка «Записаться на консультацию»
 * под бесплатными инструментами. Пишет клик в consult_clicks и сразу отправляет человека
 * в Telegram тренера (английские инструменты en-*: в WhatsApp). Запись — после ответа (after): база не должна задерживать переход,
 * а её сбой не должен ломать запись на консультацию. */

import { after, NextResponse, type NextRequest } from "next/server";

import { buildConsultClickRow, consultTarget, normalizeConsultTool } from "@/features/consult-clicks/record";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tool = normalizeConsultTool(params.get("tool"));
  const target = consultTarget(params.get("text"), tool);

  try {
    const row = buildConsultClickRow(tool, {
      referrer: request.headers.get("referer"),
      userAgent: request.headers.get("user-agent"),
      country: request.headers.get("x-vercel-ip-country"),
    });
    if (row) {
      after(async () => {
        const { error } = await createSupabaseServerClient().from("consult_clicks").insert(row);
        if (error) console.error(`[consult-click] insert: ${describeSupabaseError(error)}`);
      });
    }
  } catch (e) {
    console.error(`[consult-click] ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store" } });
}
