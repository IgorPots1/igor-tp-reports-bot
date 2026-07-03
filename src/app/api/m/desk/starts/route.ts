import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { listUpcomingTrainingPeaksRaceEvents } from "@/features/trainingpeaks/repository";
import { buildCoachDeskStartsView } from "@/features/trainingpeaks/coach-desk-starts";
import { getTrainingPeaksAttentionDigestBelgradeTodayIso } from "@/features/trainingpeaks/attention-digest-run";

export const runtime = "nodejs";

// Radar window: today .. +30 days.
const STARTS_WINDOW_DAYS = 30;

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function addDaysIso(iso: string, days: number): string {
  const base = Date.parse(`${iso}T00:00:00Z`);
  const shifted = new Date(base + days * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

// Read-only upcoming-races radar. No scan is triggered and no job is queued — this only reads the
// trainingpeaks_race_events table. Coach-authenticated like the other desk routes.
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
    const today = getTrainingPeaksAttentionDigestBelgradeTodayIso();
    const rows = await listUpcomingTrainingPeaksRaceEvents({
      fromDate: today,
      toDate: addDaysIso(today, STARTS_WINDOW_DAYS),
    });
    const view = buildCoachDeskStartsView(rows, today);
    return jsonResponse(200, { ok: true, windowDays: STARTS_WINDOW_DAYS, view });
  } catch (error) {
    console.error("[miniapp.desk.starts] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить старты." });
  }
}
