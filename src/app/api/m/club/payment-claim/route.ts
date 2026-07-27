import type { NextRequest } from "next/server";

import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isBillingEnabled } from "@/features/club/constants";
import { createPaymentClaim } from "@/features/club/cabinet";

export const runtime = "nodejs";

// "Я оплатил" (Phase E). Gated by CLUB_BILLING_ENABLED (OFF -> 503). Records a claim
// into the coach inbox for MANUAL reconciliation. Auth strictly by initData; student_id
// from the resolver, never the client. No auto-match, no confirmation, no notifications.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isBillingEnabled()) {
    return jsonResponse(503, { ok: false, error: "Оплата пока не активна." });
  }

  let initData: unknown = "";
  let note: unknown = null;
  try {
    const body = (await request.json()) as { initData?: unknown; note?: unknown };
    initData = body.initData;
    note = body.note;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  try {
    const res = await createPaymentClaim(auth.student.id, note);
    if (!res.ok) {
      return jsonResponse(503, { ok: false, error: res.error ?? "Оплата пока не активна." });
    }
    return jsonResponse(200, { ok: true, duplicate: res.duplicate ?? false });
  } catch (error) {
    console.error("[m.club.payment-claim] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось отправить заявку." });
  }
}
