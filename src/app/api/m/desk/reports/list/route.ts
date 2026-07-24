import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { countTrainingPeaksStudentThreadsByStudentIds, listTrainingPeaksStudents } from "@/features/trainingpeaks/repository";
import { listTrainingPeaksFeedbackJobs } from "@/features/trainingpeaks/feedback/feedback-queue";
import { isFeedbackSendEnabled } from "@/features/trainingpeaks/feedback/feedback-send";
import { buildReportsView } from "@/features/trainingpeaks/feedback/feedback-review-view";
import { getActiveFeedbackGeneratorBackend } from "@/features/trainingpeaks/feedback/feedback-backend-mode";

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
    // Plain Supabase reads — no TrainingPeaks/Mac call. «Новые» (pending/generating) now
    // surface too, so Igor sees the list before generating; shared is a history state.
    const [jobs, students, backend] = await Promise.all([
      listTrainingPeaksFeedbackJobs({
        status: ["pending", "generating", "done", "blocked", "failed", "sent", "shared", "dismissed"],
        limit: 200,
      }),
      listTrainingPeaksStudents(),
      getActiveFeedbackGeneratorBackend(),
    ]);
    // Which students have a linked group/topic → share-only channel (Business API can't
    // post to groups). Only the students who actually appear in the jobs are counted.
    const jobStudentIds = Array.from(new Set(jobs.map((j) => j.studentId)));
    const threadCounts = await countTrainingPeaksStudentThreadsByStudentIds(jobStudentIds);
    const byId = new Map(
      students.map((s) => [
        s.id,
        {
          name: s.studentName,
          telegramUsername: s.telegramUsername ?? null,
          // DM-reachable = chat linked AND delivery enabled (mirrors the send gates).
          dmCapable: Boolean(s.telegramChatId) && s.telegramDeliveryEnabled,
          hasGroupThread: (threadCounts.get(s.id) ?? 0) > 0,
        },
      ])
    );
    const view = buildReportsView(jobs, (id) => byId.get(id), isFeedbackSendEnabled());
    // Merge the active backend into the view so the client's toggle reflects it.
    return jsonResponse(200, { ok: true, view: { ...view, backend } });
  } catch (error) {
    console.error("[miniapp.desk.reports.list] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить отчёты." });
  }
}
