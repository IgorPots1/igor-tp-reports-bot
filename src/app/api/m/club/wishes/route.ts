import type { NextRequest } from "next/server";

import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isWishesEnabled } from "@/features/club/constants";
import { createWish, listWishes } from "@/features/club/cabinet";

export const runtime = "nodejs";

// Пожелания (Block 7.1). Gated by CLUB_WISHES_ENABLED (OFF → 503). 1–10 scales +
// free text (nutrition-form pattern). Student sees own past submissions; nothing
// is auto-sent to the coach.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isWishesEnabled()) {
    return jsonResponse(503, { ok: false, error: "Пожелания пока не активны." });
  }

  let body: { initData?: unknown; action?: unknown; wish?: Record<string, unknown> } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveClubStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  try {
    if (body.action === "create") {
      const res = await createWish(auth.student.id, body.wish ?? {});
      if (!res.ok) {
        return jsonResponse(400, { ok: false, error: res.error });
      }
      const wishes = await listWishes(auth.student.id);
      return jsonResponse(200, { ok: true, view: { wishes } });
    }
    const wishes = await listWishes(auth.student.id);
    return jsonResponse(200, { ok: true, view: { wishes } });
  } catch (error) {
    console.error("[m.club.wishes] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить пожелания." });
  }
}
