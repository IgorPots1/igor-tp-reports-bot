import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { intakeNutritionReportFiles } from "@/features/nutrition/file-intake";
import { snapParsedDatesToCalendarWeek } from "@/features/nutrition/report-date-coverage";
import { validateTelegramInitData } from "@/features/telegram/validate-init-data";
import { resolveMiniAppStudent } from "@/features/telegram/miniapp-student-resolver";

export const runtime = "nodejs";

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

  const sid = (formData.get("sid") as string | null) ?? null;
  const sig = (formData.get("sig") as string | null) ?? null;
  const resolved = await resolveMiniAppStudent({ initData, sid, sig });
  if (!resolved.ok) {
    return jsonResponse(resolved.httpStatus, { ok: false, error: resolved.message });
  }
  const student = resolved.student;

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return jsonResponse(400, { ok: false, error: "Файл не прикреплён." });
  }

  const previewReportId = randomUUID();

  let intake: Awaited<ReturnType<typeof intakeNutritionReportFiles>>;
  try {
    intake = await intakeNutritionReportFiles({
      studentId: student.studentId,
      reportId: previewReportId,
      weekFrom: "2000-01-01",
      files: [fileEntry],
      persistFiles: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось распознать файл.";
    console.warn("[miniapp.upload] intake failed", { studentId: student.studentId, message });
    return jsonResponse(422, { ok: false, error: message });
  }

  const parsedDates = intake.extraction.dateCoverage.dateCoverage.dates;
  const dayCount = parsedDates.length;

  const snapped = snapParsedDatesToCalendarWeek(parsedDates);

  if (!snapped) {
    return jsonResponse(200, {
      ok: true,
      preview: {
        weekFrom: null,
        weekTo: null,
        dayCount,
        snappingApplied: false,
        needsManualWeek: true,
      },
    });
  }

  const rawFrom = intake.extraction.dateCoverage.parsedWeekFrom;
  const rawTo = intake.extraction.dateCoverage.parsedWeekTo;
  const snappingApplied = snapped.weekFrom !== rawFrom || snapped.weekTo !== rawTo;

  console.info("[miniapp.upload] success", {
    studentId: student.studentId,
    dayCount,
    weekFrom: snapped.weekFrom,
    weekTo: snapped.weekTo,
    snappingApplied,
  });

  return jsonResponse(200, {
    ok: true,
    preview: {
      weekFrom: snapped.weekFrom,
      weekTo: snapped.weekTo,
      dayCount,
      snappingApplied,
      needsManualWeek: false,
    },
  });
}
