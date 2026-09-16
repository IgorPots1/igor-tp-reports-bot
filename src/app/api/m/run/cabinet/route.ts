import type { NextRequest } from "next/server";

import { isRunAppEnabled, jsonResponse, resolveRunAppStudent } from "@/features/intervals/loop/miniapp-guard";
import { loadCabinetView } from "@/features/intervals/loop/service";
import { todayIsoInZone } from "@/features/intervals/loop/clock";

export const runtime = "nodejs";

// Личный кабинет: недель вместе, неделя цикла, итоги, история, ступени.
// Отдельный маршрут, а не часть /state — кабинет открывают заметно реже
// главного экрана, и незачем считать его при каждом обычном заходе.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isRunAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Приложение пока не включено." });
  }

  let body: { initData?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveRunAppStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code });
  }
  if (!auth.sourceId) {
    return jsonResponse(409, { ok: false, code: "needs_connection", error: "Сначала подключите часы." });
  }

  try {
    const view = await loadCabinetView(auth.sourceId, todayIsoInZone(auth.timezone));
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.run.cabinet] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить кабинет." });
  }
}
