import type { NextRequest } from "next/server";

import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isBillingEnabled } from "@/features/club/constants";
import { getClubBilling } from "@/features/club/cabinet";

export const runtime = "nodejs";

// Оплата (Block 7.2). Gated by CLUB_BILLING_ENABLED (OFF → 503). Read-only status /
// history from the Coach OS billing module (stub until wired). NO payment fields in
// the mini app; reminders would be drafts into the coach queue, never auto-sent.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isBillingEnabled()) {
    return jsonResponse(503, { ok: false, error: "Оплата пока не активна." });
  }

  let initData: unknown = "";
  try {
    initData = ((await request.json()) as { initData?: unknown }).initData;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  try {
    const view = await getClubBilling(auth.student.id);
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.club.billing] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить оплату." });
  }
}
