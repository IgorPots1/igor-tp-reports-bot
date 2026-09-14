import type { NextRequest } from "next/server";

import { todayIsoInZone } from "@/features/intervals/loop/clock";
import {
  isRunAppEnabled,
  jsonResponse,
  rememberDetectedZone,
  resolveRunAppStudent,
} from "@/features/intervals/loop/miniapp-guard";
import { moveStudentSession } from "@/features/intervals/loop/service";

export const runtime = "nodejs";

// Перенос тренировки самой ученицей. Отказы — с человеческой причиной, а не
// «нельзя»: непонятный отказ ученица понесёт тренеру, то есть ровно туда,
// откуда перенос и уводили.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isRunAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Приложение пока не включено." });
  }

  let body: { initData?: unknown; sessionId?: unknown; toDate?: unknown; timeZone?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveRunAppStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const toDate = typeof body.toDate === "string" ? body.toDate : "";
  if (!sessionId || !/^\d{4}-\d{2}-\d{2}$/u.test(toDate)) {
    return jsonResponse(400, { ok: false, error: "Не указано, что и куда переносим." });
  }

  // Без подключённых часов данных не будет, а значит и плана. Отправляем на
  // экран подключения вместо невнятного отказа.
  if (!auth.sourceId) {
    return jsonResponse(409, {
      ok: false,
      code: "needs_connection",
      error: "Сначала подключите часы: без данных план не собрать.",
    });
  }

  // «Сегодня» для проверки «не в прошлое» — тоже по зоне ученика.
  const zone = await rememberDetectedZone({
    studentUuid: auth.studentUuid,
    stored: auth.timezone,
    detected: body.timeZone,
  });

  try {
    const result = await moveStudentSession({
      sourceId: auth.sourceId,
      sessionId,
      toDate,
      todayIso: todayIsoInZone(zone),
      movedBy: `student:${auth.telegramUserId}`,
    });
    if (!result.ok) {
      return jsonResponse(400, { ok: false, error: result.messageRu, code: result.code });
    }
    return jsonResponse(200, { ok: true, toDate: result.toDate });
  } catch (error) {
    console.error("[m.run.move] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось перенести тренировку." });
  }
}
