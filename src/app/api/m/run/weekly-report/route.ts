import type { NextRequest } from "next/server";

import { todayIsoInZone } from "@/features/intervals/loop/clock";
import {
  isRunAppEnabled,
  jsonResponse,
  rememberDetectedZone,
  resolveRunAppStudent,
} from "@/features/intervals/loop/miniapp-guard";
import { saveWeeklyReport } from "@/features/intervals/loop/repository";
import {
  reportedWeekStart,
  scheduleByCode,
  weeklyReportReplyRu,
  wellbeingByCode,
  type ScheduleCode,
  type WellbeingCode,
} from "@/features/intervals/loop/weekly-report";

export const runtime = "nodejs";

// Недельная форма. Наружу ничего не уходит: ответ возвращается в экран, тренер
// видит его, когда открывает карточку. Ровно как у чек-ина.

export async function POST(request: NextRequest): Promise<Response> {
  if (!isRunAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Приложение пока не включено." });
  }

  let body: {
    initData?: unknown;
    schedule?: unknown;
    wellbeing?: unknown;
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

  const schedule = typeof body.schedule === "string" ? scheduleByCode(body.schedule) : null;
  const wellbeing = typeof body.wellbeing === "string" ? wellbeingByCode(body.wellbeing) : null;
  if (!schedule || !wellbeing) {
    return jsonResponse(400, { ok: false, error: "Ответьте на оба вопроса." });
  }
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";

  // НЕДЕЛЯ СЧИТАЕТСЯ ПО ЗОНЕ УЧЕНИКА — та же причина, что и у чек-ина: в
  // воскресенье вечером по Владивостоку в Белграде ещё воскресенье днём, но
  // если зону перепутать, форма ляжет на следующую неделю.
  const zone = await rememberDetectedZone({
    studentUuid: auth.studentUuid,
    stored: auth.timezone,
    detected: body.timeZone,
  });
  // За КАКУЮ неделю отчёт, решает один и тот же помощник для формы и для
  // экрана: иначе в понедельник ответ лёг бы на начавшуюся неделю вместо
  // закончившейся.
  const weekStart = reportedWeekStart(todayIsoInZone(zone));
  if (!weekStart) {
    return jsonResponse(409, {
      ok: false,
      error: "Недельную форму можно заполнить в воскресенье или в понедельник.",
    });
  }

  const saved = await saveWeeklyReport({
    sourceId: auth.sourceId,
    weekStart,
    scheduleCode: schedule.code,
    wellbeingCode: wellbeing.code,
    commentText: comment ? comment : null,
  });
  if (!saved.ok) {
    return jsonResponse(500, { ok: false, error: "Не получилось сохранить. Попробуйте ещё раз." });
  }

  return jsonResponse(200, {
    ok: true,
    replyRu: weeklyReportReplyRu(schedule.code as ScheduleCode, wellbeing.code as WellbeingCode),
  });
}
