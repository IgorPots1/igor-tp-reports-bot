import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { getTrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";
import { listTrainingPeaksStudents } from "@/features/trainingpeaks/repository";
import { buildCoachDeskTodayView } from "@/features/trainingpeaks/coach-desk-today";
import { getTrainingPeaksAttentionDigestBelgradeTodayIso } from "@/features/trainingpeaks/attention-digest-run";

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

const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatRuDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!match) {
    return "";
  }
  const day = Number.parseInt(match[3], 10);
  const month = RU_MONTHS[Number.parseInt(match[2], 10) - 1] ?? "";
  return `${day} ${month}`;
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
    // Snapshot + student usernames are BOTH plain Supabase reads — no TrainingPeaks/Mac call. The view
    // is recomputed live on every open; usernames power tap-through to each student's 1:1 chat.
    const [snapshot, students] = await Promise.all([
      getTrainingPeaksAttentionSnapshot(),
      listTrainingPeaksStudents(),
    ]);
    const usernameByStudentId = new Map<string, string | null>(
      students.map((student) => [student.id, student.telegramUsername ?? null])
    );
    const view = buildCoachDeskTodayView(snapshot, usernameByStudentId);
    return jsonResponse(200, {
      ok: true,
      date: formatRuDate(getTrainingPeaksAttentionDigestBelgradeTodayIso()),
      generatedAt: new Date().toISOString(),
      view,
    });
  } catch (error) {
    console.error("[miniapp.desk.today] snapshot failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить сводку." });
  }
}
