import type { NextRequest } from "next/server";

import { captureAvatarFromInitData } from "@/features/club/avatars";
import { isClubAvatarsEnabled } from "@/features/club/constants";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { parseTelegramInitDataUser } from "@/features/telegram/validate-init-data";

export const runtime = "nodejs";

// Second avatar source (naryad §1): capture the caller's OWN Telegram photo_url from initData on
// mini-app open. initData carries photo_url even for users who never started the bot (the ~half that
// getUserProfilePhotos misses). The mini-app fires this once on mount; the server validates initData,
// then downloads + caches the photo (weekly-throttled, honouring the opt-out) into the same private
// bucket. Silent no-op when the feature is off. Never mutates anyone but the caller.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isClubAvatarsEnabled()) {
    return jsonResponse(200, { ok: true }); // feature off → nothing to do
  }
  let initData = "";
  try {
    const body = (await request.json()) as { initData?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
  } catch {
    return jsonResponse(400, { ok: false });
  }
  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false });
  }
  const user = parseTelegramInitDataUser(initData);
  await captureAvatarFromInitData(auth.student.id, user?.photoUrl ?? null);
  return jsonResponse(200, { ok: true });
}
