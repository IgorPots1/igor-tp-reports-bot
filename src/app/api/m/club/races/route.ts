import type { NextRequest } from "next/server";

import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isRacesEnabled } from "@/features/club/constants";
import { cancelClubRace, createClubRace, listClubRaces } from "@/features/club/cabinet";

export const runtime = "nodejs";

// Старты (Block 6). Gated by CLUB_RACES_ENABLED (OFF → 503). Student declares a
// race → coach-approval queue. No TP write from here.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isRacesEnabled()) {
    return jsonResponse(503, { ok: false, error: "Старты пока не активны." });
  }

  let body: { initData?: unknown; action?: unknown; race?: Record<string, unknown>; raceId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveClubStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  try {
    if (body.action === "create") {
      const res = await createClubRace(auth.student.id, body.race ?? {});
      if (!res.ok) {
        return jsonResponse(400, { ok: false, error: res.error });
      }
      const races = await listClubRaces(auth.student.id);
      return jsonResponse(200, { ok: true, view: { races } });
    }
    if (body.action === "cancel") {
      // Student cancels their own start. Not-yet-in-TP → deleted now; already-in-TP → a rollback
      // intent the Mac runner drains (deletes the TP event, then removes the row). No TP write here.
      const res = await cancelClubRace(auth.student.id, typeof body.raceId === "string" ? body.raceId : "");
      if (!res.ok) {
        return jsonResponse(400, { ok: false, error: res.error });
      }
      const races = await listClubRaces(auth.student.id);
      return jsonResponse(200, { ok: true, view: { races }, pending: res.pending ?? false });
    }
    const races = await listClubRaces(auth.student.id);
    return jsonResponse(200, { ok: true, view: { races } });
  } catch (error) {
    console.error("[m.club.races] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить старты." });
  }
}
