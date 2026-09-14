import type { NextRequest } from "next/server";

import { todayIsoInZone } from "@/features/intervals/loop/clock";
import {
  isRunAppEnabled,
  jsonResponse,
  rememberDetectedZone,
  resolveRunAppStudent,
} from "@/features/intervals/loop/miniapp-guard";
import { submitCheckin } from "@/features/intervals/loop/service";

export const runtime = "nodejs";

// Чек-ин после тренировки. Двигает ступень — это несущая связь контура.
//
// НАРУЖУ НИЧЕГО НЕ УХОДИТ. Ни тренеру, ни ученице сообщений не отправляется:
// ответ возвращается прямо в экран. Тренер видит чек-ин, когда открывает
// админку.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isRunAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Приложение пока не включено." });
  }

  let body: {
    initData?: unknown;
    sessionId?: unknown;
    effort?: unknown;
    pain?: unknown;
    comment?: unknown;
    voiceFileId?: unknown;
    timeZone?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveRunAppStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code });
  }

  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";

  // ДЕНЬ ЧЕК-ИНА СЧИТАЕТСЯ ПО ЗОНЕ УЧЕНИКА. По зоне тренера вечерняя пробежка
  // москвича легла бы на следующий день, то есть на другую сессию и другую
  // ступень: прогрессия двигается по дню.
  const zone = await rememberDetectedZone({
    studentUuid: auth.studentUuid,
    stored: auth.timezone,
    detected: body.timeZone,
  });

  try {
    const result = await submitCheckin({
      sourceId: auth.sourceId,
      // null — «пробежала, но этого не было в плане». Такой чек-ин полноценен:
      // ни плановой сессии, ни активности из Intervals он не требует.
      planSessionId: typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null,
      sessionDate: todayIsoInZone(zone),
      effortCode: String(body.effort ?? ""),
      painCode: String(body.pain ?? ""),
      commentText: comment.length > 0 ? comment : null,
      voiceFileId: typeof body.voiceFileId === "string" && body.voiceFileId ? body.voiceFileId : null,
    });

    if (!result.ok) {
      return jsonResponse(400, { ok: false, error: result.messageRu, code: result.code });
    }
    return jsonResponse(200, {
      ok: true,
      replyRu: result.replyRu,
      stepBefore: result.stepBefore,
      stepAfter: result.stepAfter,
    });
  } catch (error) {
    console.error("[m.run.checkin] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось сохранить ответ." });
  }
}
