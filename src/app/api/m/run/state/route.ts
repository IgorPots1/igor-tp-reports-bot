import type { NextRequest } from "next/server";

import { isRunAppEnabled, jsonResponse, resolveRunAppStudent } from "@/features/intervals/loop/miniapp-guard";
import { getOnboardingAnswers } from "@/features/intervals/loop/repository";
import { loadStudentView } from "@/features/intervals/loop/service";
import { todayIsoInCoachTimezone } from "@/features/intervals/loop/clock";

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

  try {
    const answers = await getOnboardingAnswers(auth.sourceId);
    if (!answers) {
      return jsonResponse(200, {
        ok: true,
        needsOnboarding: true,
        studentName: auth.studentName,
      });
    }
    const view = await loadStudentView(auth.sourceId, todayIsoInCoachTimezone());
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
