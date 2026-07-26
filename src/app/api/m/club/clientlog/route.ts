import type { NextRequest } from "next/server";

import { isClubEnabled, jsonResponse } from "@/features/club/miniapp-guard";

export const runtime = "nodejs";

// Diagnostic sink: the club mini app posts its client-side state here when initData
// is empty, so «SDK not loaded» vs «SDK loaded but no mini-app data» is visible in
// the server (Vercel) logs. No auth, no personal data — just the WebApp environment.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false });
  }
  let diag: unknown = null;
  try {
    diag = await request.json();
  } catch {
    /* ignore */
  }
  const d = (diag ?? {}) as Record<string, unknown>;
  const recovered = d.source === "recovered";
  console.warn(
    `[club.clientlog] ${recovered ? "recovered" : "no_init_data"} hasTelegram=${d.hasTelegram} hasWebApp=${d.hasWebApp} platform=${d.platform} version=${d.version} initDataLen=${d.initDataLen} hasUser=${d.hasUser} hashLen=${d.hashLen} hashHasTgData=${d.hashHasTgData} hasSessionInit=${d.hasSessionInit} referrerHost=${d.referrerHost} source=${d.source} recoveredLen=${d.recoveredLen}` +
      // Interpretation: pin the cause from the facts.
      (recovered
        ? " → SDK не отдал initData, но восстановили из hash/sessionStorage (гонка загрузки SDK) — пользователь ВОШЁЛ"
        : "") +
      (!recovered && !d.hasTelegram ? " → SDK НЕ загрузился (нет window.Telegram)" : "") +
      (!recovered && d.hasTelegram && !d.hashHasTgData && !d.hasSessionInit
        ? " → launch-hash пуст И session пуст: Telegram НЕ передал tgWebAppData (открыто не как mini-app / hash срезан редиректом ДО загрузки)"
        : "") +
      (!recovered && d.hasWebApp && d.hashHasTgData && !d.hasUser
        ? " → hash с данными БЫЛ, но SDK его не разобрал — версия/платформа SDK"
        : "")
  );
  return jsonResponse(200, { ok: true });
}
