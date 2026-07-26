import type { NextRequest } from "next/server";

import {
  parseTelegramInitDataStartParam,
  parseTelegramInitDataUser,
  validateClubInitData,
} from "@/features/telegram/validate-init-data";
import { isClubEnabled, jsonResponse } from "@/features/club/miniapp-guard";
import { logClubLinkEvent } from "@/features/club/service";

export const runtime = "nodejs";

// Student tapped «Это не я» on the confirmation screen (spec v3 block 2.1). No
// binding, no access. Logs a `rejected` event for coach review. Terminal — the
// client shows "Хорошо, ничего не привязали" with no retry.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Клуб пока не активен." });
  }

  let initData = "";
  try {
    const body = (await request.json()) as { initData?: unknown };
    initData = typeof body.initData === "string" ? body.initData.trim() : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }
  if (!initData || !validateClubInitData(initData)) {
    return jsonResponse(401, { ok: false, error: "Не авторизован." });
  }

  const tgUser = parseTelegramInitDataUser(initData);
  const rawStart = parseTelegramInitDataStartParam(initData);
  const rowId = rawStart ? (rawStart.startsWith("r_") ? rawStart.slice(2) : rawStart) : null;

  await logClubLinkEvent({
    telegramUserId: tgUser?.id ?? null,
    telegramUsername: tgUser?.username ?? null,
    studentId: rowId,
    result: "rejected",
    reason: "not_me",
  });

  return jsonResponse(200, { ok: true });
}
