import type { NextRequest } from "next/server";

import { todayIsoInZone } from "@/features/intervals/loop/clock";
import {
  isRunAppEnabled,
  jsonResponse,
  rememberDetectedZone,
  resolveRunAppStudent,
} from "@/features/intervals/loop/miniapp-guard";
import { submitManualEntry } from "@/features/intervals/manual-entry";

export const runtime = "nodejs";

// Ручной ввод тренировки: заводит строку активности и тут же закрывает
// чек-ин ОДНОЙ отправкой формы. Прогрессия и связь с плановой сессией идут
// через тот же submitCheckin, которым закрывается обычная (device-based)
// тренировка — второго пути нет и не должно быть.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isRunAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Приложение пока не включено." });
  }

  let body: {
    initData?: unknown;
    sessionId?: unknown;
    date?: unknown;
    durationMinutes?: unknown;
    distanceKm?: unknown;
    averageHeartrate?: unknown;
    averagePaceSecPerKm?: unknown;
    effort?: unknown;
    pain?: unknown;
    comment?: unknown;
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
  if (!auth.sourceId) {
    return jsonResponse(409, {
      ok: false,
      code: "needs_connection",
      error: "Сначала выберите способ вести тренировки на экране подключения.",
    });
  }

  const zone = await rememberDetectedZone({
    studentUuid: auth.studentUuid,
    stored: auth.timezone,
    detected: body.timeZone,
  });

  const num = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN; // NaN-строку не подменяем null: пусть провалит валидацию честно
  };

  const durationMinutes = num(body.durationMinutes);
  if (durationMinutes === null || Number.isNaN(durationMinutes)) {
    return jsonResponse(400, { ok: false, error: "Укажите время тренировки." });
  }
  const distanceKm = num(body.distanceKm);
  const averageHeartrate = num(body.averageHeartrate);
  const averagePaceSecPerKm = num(body.averagePaceSecPerKm);
  if (
    (distanceKm !== null && Number.isNaN(distanceKm)) ||
    (averageHeartrate !== null && Number.isNaN(averageHeartrate)) ||
    (averagePaceSecPerKm !== null && Number.isNaN(averagePaceSecPerKm))
  ) {
    return jsonResponse(400, { ok: false, error: "Одно из чисел не распозналось." });
  }

  const date = typeof body.date === "string" && body.date ? body.date : todayIsoInZone(zone);
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";

  const result = await submitManualEntry({
    sourceId: auth.sourceId,
    date,
    durationMinutes,
    distanceKm,
    averageHeartrate,
    averagePaceSecPerKm,
    planSessionId: typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null,
    effortCode: String(body.effort ?? ""),
    painCode: String(body.pain ?? ""),
    commentText: comment.length > 0 ? comment : null,
  });

  if (!result.ok) {
    return jsonResponse(400, { ok: false, error: result.messageRu, code: result.code });
  }
  return jsonResponse(200, {
    ok: true,
    replyRu: result.checkin.replyRu,
    stepBefore: result.checkin.stepBefore,
    stepAfter: result.checkin.stepAfter,
  });
}
