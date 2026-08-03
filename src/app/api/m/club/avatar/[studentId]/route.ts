import type { NextRequest } from "next/server";

import { getAvatarImage, verifyAvatarSignature } from "@/features/club/avatars";
import { isClubAvatarsEnabled } from "@/features/club/constants";
import { isClubEnabled } from "@/features/club/miniapp-guard";

export const runtime = "nodejs";

// Avatar image proxy (corzina B). The browser only ever hits THIS path — the Telegram CDN URL and
// the bot token never leave the server. An <img> GET cannot carry initData, so the authed club feed
// mints a short-lived HMAC-signed URL (?e=<exp>&s=<sig>); we verify it here, then getAvatarImage
// re-checks club_avatar_visible live (a purged/opted-out student returns 403 even with a valid sig).
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ studentId: string }> }
): Promise<Response> {
  if (!isClubEnabled() || !isClubAvatarsEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  const { studentId } = await ctx.params;
  const params = new URL(request.url).searchParams;
  if (!verifyAvatarSignature(studentId, params.get("e"), params.get("s"))) {
    return new Response("Forbidden", { status: 403 });
  }
  const result = await getAvatarImage(studentId);
  if (result.kind === "forbidden") return new Response("Forbidden", { status: 403 });
  if (result.kind === "none") return new Response("Not found", { status: 404 });
  return new Response(result.bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      // Kept at one hour ON PURPOSE, unlike the route image next door which caches for a day. This
      // URL has no content hash, so this max-age is exactly how long a browser can keep showing a
      // face after the student flips club_avatar_visible off. An hour of stale privacy is the most
      // we want to trade for egress; the 128px resize on upload is where the avatar saving comes from.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
