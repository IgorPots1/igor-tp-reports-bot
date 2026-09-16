import type { NextRequest } from "next/server";

import { isRunAppEnabled, jsonResponse, resolveRunAppStudent } from "@/features/intervals/loop/miniapp-guard";
import { provisionManualSource } from "@/features/intervals/manual-entry";

export const runtime = "nodejs";

// Дверь для тех, у кого часов нет и не будет: экран подключения — не тупик.
//
// РЕЗОЛВЕР ТОТ ЖЕ, sourceId ИГНОРИРУЕМ. resolveRunAppStudent отдаёт studentUuid
// всегда, даже когда sourceId ещё null (часов нет) — ровно это здесь и нужно:
// человек стоит на экране подключения именно потому, что sourceId у него null.
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

  const result = await provisionManualSource(auth.studentUuid);
  if (!result.ok) {
    return jsonResponse(400, { ok: false, error: result.message });
  }
  return jsonResponse(200, { ok: true });
}
