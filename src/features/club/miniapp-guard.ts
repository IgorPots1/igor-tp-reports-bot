// Shared gate + auth for /api/m/club/* routes. Keeps each route thin and keeps
// the club surface isolated from /m/desk and /m/n. Coach accounts are rejected
// (this is a student-facing, read-only surface).

import { validateTelegramInitData } from "@/features/telegram/validate-init-data";
import { resolveMiniAppStudent } from "@/features/telegram/miniapp-student-resolver";
import type { TrainingPeaksStudent } from "@/features/trainingpeaks/repository";

/** Outer mini-app gate + club feature flag. Both must be on. */
export function isClubEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true" && process.env.CLUB_ENABLED === "true";
}

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type ClubStudentResolution =
  | { ok: true; student: TrainingPeaksStudent }
  | { ok: false; httpStatus: number; error: string };

export async function resolveClubStudent(initDataRaw: unknown): Promise<ClubStudentResolution> {
  const initData = typeof initDataRaw === "string" ? initDataRaw.trim() : "";
  if (!initData || !validateTelegramInitData(initData)) {
    return { ok: false, httpStatus: 401, error: "Не авторизован." };
  }
  const resolved = await resolveMiniAppStudent({ initData });
  if (!resolved.ok) {
    return { ok: false, httpStatus: resolved.httpStatus, error: resolved.message };
  }
  return { ok: true, student: resolved.student };
}
