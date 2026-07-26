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
  console.warn(
    `[club.clientlog] no_init_data hasTelegram=${d.hasTelegram} hasWebApp=${d.hasWebApp} platform=${d.platform} version=${d.version} initDataLen=${d.initDataLen} hasUser=${d.hasUser}` +
      (d.hasWebApp && !d.hasUser ? " → SDK ЕСТЬ, но Telegram не дал данные mini-app (открыто как обычная страница / XOclub не зарегистрирован под этим ботом)" : "") +
      (!d.hasTelegram ? " → SDK НЕ загрузился (нет window.Telegram)" : "")
  );
  return jsonResponse(200, { ok: true });
}
