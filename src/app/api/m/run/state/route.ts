import type { NextRequest } from "next/server";

import {
  isRunAppEnabled,
  jsonResponse,
  rememberDetectedZone,
  resolveRunAppStudent,
} from "@/features/intervals/loop/miniapp-guard";
import { getOnboardingAnswers, getPrefill } from "@/features/intervals/loop/repository";
import { visibleFormFields } from "@/features/intervals/loop/prefill";
import { loadStudentView } from "@/features/intervals/loop/service";
import { FALLBACK_TIMEZONES, todayIsoInZone } from "@/features/intervals/loop/clock";

export const runtime = "nodejs";

// Состояние экрана ученика: нужна ли анкета и что показывать сегодня.
//
// СЕТИ ЗДЕСЬ НЕТ НАМЕРЕННО. Тянуть тренировки из Intervals на открытии экрана
// значило бы заставить человека ждать чужой API ради данных, которые нужны не
// ему, а тренеру. Свежесть тренировок обеспечивает раннер (см. п.7 наряда).
export async function POST(request: NextRequest): Promise<Response> {
  if (!isRunAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Приложение пока не включено." });
  }

  let body: { initData?: unknown; timeZone?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveRunAppStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code });
  }

  try {
    // Зона приезжает от браузера ученика и запоминается на карточке. Спрашиваем
    // её только если определить не удалось.
    const zone = await rememberDetectedZone({
      studentUuid: auth.studentUuid,
      stored: auth.timezone,
      detected: body.timeZone,
    });

    const answers = await getOnboardingAnswers(auth.sourceId);
    if (!answers) {
      // Поля, которые тренер задал за ученика, в форму НЕ попадают вовсе —
      // ни заполненными, ни спрятанными под «уточните». Клиент получает список
      // того, что показывать, а не список того, что скрыть: скрывать —
      // значит сначала отдать наружу то, чего человек видеть не должен.
      const prefill = await getPrefill(auth.sourceId);
      return jsonResponse(200, {
        ok: true,
        needsOnboarding: true,
        studentName: auth.studentName,
        formFields: visibleFormFields(prefill),
        // Пояс спрашиваем ТОЛЬКО когда он не определился сам.
        needsTimezone: zone === null,
        timezoneOptions: zone === null ? FALLBACK_TIMEZONES : [],
        // Цель отдаём, только если её задал тренер: от неё зависит, надо ли
        // вообще спрашивать дату старта и вопрос про непрерывный бег. Это не
        // раскрытие — это цель её же плана.
        presetGoalKind:
          prefill && prefill.setFields.includes("goalKind") ? prefill.values.goalKind : null,
      });
    }
    const view = await loadStudentView(auth.sourceId, todayIsoInZone(zone));
    return jsonResponse(200, {
      ok: true,
      needsOnboarding: false,
      studentName: auth.studentName,
      view,
    });
  } catch (error) {
    console.error("[m.run.state] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить план." });
  }
}
