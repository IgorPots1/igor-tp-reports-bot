import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { listTrainingPeaksStudents } from "@/features/trainingpeaks/repository";
import { listTrainingPeaksFeedbackJobs } from "@/features/trainingpeaks/feedback/feedback-queue";
import { isFeedbackSendEnabled } from "@/features/trainingpeaks/feedback/feedback-send";
import { buildReportsView } from "@/features/trainingpeaks/feedback/feedback-review-view";

export const runtime = "nodejs";

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isMiniAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Рабочий стол пока не активен." });
  }

  let initData = "";
  try {
    const body = (await request.json()) as { initData?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const coach = resolveMiniAppCoach({ initData });
  if (!coach.ok) {
    return jsonResponse(coach.httpStatus, { ok: false, error: coach.message });
  }

  try {
    // Both plain Supabase reads — no TrainingPeaks/Mac call. Jobs arrive newest-first;
    // student rows give each card a name + chat-tap username.
    const [jobs, students] = await Promise.all([
      listTrainingPeaksFeedbackJobs({ status: ["done", "blocked", "failed", "sent", "dismissed"], limit: 100 }),
      listTrainingPeaksStudents(),
    ]);
    const byId = new Map(students.map((s) => [s.id, { name: s.studentName, telegramUsername: s.telegramUsername ?? null }]));
    const view = buildReportsView(jobs, (id) => byId.get(id), isFeedbackSendEnabled());
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[miniapp.desk.reports.list] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить отчёты." });
  }
}
