import type { NextRequest } from "next/server";

import { saveNutritionFileReport } from "@/features/nutrition/admin";
import { validateTelegramInitData } from "@/features/telegram/validate-init-data";
import { resolveMiniAppStudent } from "@/features/telegram/miniapp-student-resolver";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { formatNutritionCompactWeekRange } from "@/features/nutrition/report-date-coverage";

export const runtime = "nodejs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isMiniAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Mini app not yet active." });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const initData = (formData.get("initData") as string | null)?.trim() ?? "";
  if (!initData || !validateTelegramInitData(initData)) {
    return jsonResponse(401, { ok: false, error: "Не авторизован." });
  }

  const resolved = await resolveMiniAppStudent({ initData });
  if (!resolved.ok) {
    return jsonResponse(resolved.httpStatus, { ok: false, error: resolved.message });
  }
  const student = resolved.student;

  const weekFrom = (formData.get("weekFrom") as string | null)?.trim() ?? "";
  const weekTo = (formData.get("weekTo") as string | null)?.trim() ?? "";
  if (!ISO_DATE.test(weekFrom) || !ISO_DATE.test(weekTo) || weekFrom > weekTo) {
    return jsonResponse(400, { ok: false, error: "Неверный диапазон дат." });
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return jsonResponse(400, { ok: false, error: "Файл не прикреплён." });
  }

  let result: Awaited<ReturnType<typeof saveNutritionFileReport>>;
  try {
    result = await saveNutritionFileReport({
      // The nutrition pipeline keys on the student ROW id (UUID), not the slug.
      studentId: student.id,
      weekFrom,
      weekTo,
      files: [fileEntry],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось сохранить отчёт.";
    console.warn("[miniapp.confirm] save failed", { studentId: student.id, message });
    return jsonResponse(422, { ok: false, error: message });
  }

  console.info("[miniapp.confirm] saved", {
    studentId: student.id,
    reportId: result.report.id,
    effectiveWeekFrom: result.effectiveWeekFrom,
    effectiveWeekTo: result.effectiveWeekTo,
    macrosSaved: result.macros.length,
  });

  // Notify Igor via all configured coach chat IDs
  const coachChatIds = getTrainingPeaksCoachChatIds();
  const weekRange = formatNutritionCompactWeekRange(result.effectiveWeekFrom, result.effectiveWeekTo);
  const noticeText =
    `${student.studentName} загрузила отчёт о питании за ${weekRange}` +
    ` (${result.macros.length} дн., через Telegram).`;

  await Promise.allSettled(
    coachChatIds.map((chatId) =>
      sendTelegramMessage(chatId, noticeText).catch((err) => {
        console.warn("[miniapp.confirm] coach notify failed", { chatId, error: String(err) });
      })
    )
  );

  return jsonResponse(200, { ok: true, reportId: result.report.id });
}
