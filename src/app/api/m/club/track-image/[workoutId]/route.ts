import type { NextRequest } from "next/server";

import { isClubMapTilesEnabled } from "@/features/club/constants";
import { isClubEnabled } from "@/features/club/miniapp-guard";
import { getTrackImage, verifyTrackImageSignature } from "@/features/club/track-maps";

export const runtime = "nodejs";

// Route-image proxy (Phase 4b). Streams the cached Mapbox static image for a workout's route.
// The browser only ever hits THIS path — the Mapbox URL and token never leave the server. An
// <img> GET cannot carry Telegram initData, so the authed feed mints a short-lived HMAC-signed
// URL (?e=<exp>&s=<sig>); we verify it here, then getTrackImage re-checks club_routes_visible
// live (a purged/disabled student returns 403 even with a still-valid signature).
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ workoutId: string }> }
): Promise<Response> {
  if (!isClubEnabled() || !isClubMapTilesEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  const { workoutId } = await ctx.params;
  const params = new URL(request.url).searchParams;
  if (!verifyTrackImageSignature(workoutId, params.get("h"), params.get("e"), params.get("s"))) {
    return new Response("Forbidden", { status: 403 });
  }
  const result = await getTrackImage(workoutId);
  if (result.kind === "forbidden") return new Response("Forbidden", { status: 403 });
  if (result.kind === "none") return new Response("Not found", { status: 404 });
  return new Response(result.bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      // Signed + short-lived URL; a brief private cache is fine and spares repeat Storage reads.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
