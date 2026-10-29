/* GET /en/week/go?t=<token>&p=offer|summary|followup|health → WhatsApp via /go/consult (tool en-week).
 * Marks the click for this person (cta_clicked_at + event), then redirects. The redirect always
 * happens, even when the flag is off or the DB fails: the person wants to reach Igor. */

import { after, NextResponse, type NextRequest } from "next/server";

import { isEnWeekEnabled } from "@/features/en-week/logic";
import { isToken, recordCta } from "@/features/en-week/service";
import { supabaseEnWeekStore } from "@/features/en-week/store";
import { consultUrl, prefillFor, type CtaPlace } from "@/features/en-week/texts";
import { isBotUserAgent } from "@/features/page-views/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLACES: CtaPlace[] = ["offer", "summary", "followup", "health"];

export function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const place = (PLACES as string[]).includes(q.get("p") ?? "") ? (q.get("p") as CtaPlace) : "offer";
  const token = q.get("t");
  if (isEnWeekEnabled() && isToken(token) && !isBotUserAgent(request.headers.get("user-agent"))) {
    after(async () => {
      try {
        await recordCta(supabaseEnWeekStore(), token, place, new Date());
      } catch (e) {
        console.error(`[en-week] cta: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }
  const track = q.get("k") === "r" ? "runner" : "beginner";
  return NextResponse.redirect(consultUrl(prefillFor(place, track)), { status: 302, headers: { "Cache-Control": "no-store" } });
}
