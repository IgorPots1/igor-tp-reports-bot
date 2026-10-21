import { NextRequest } from "next/server";

import { todayIsoInZone } from "@/features/intervals/loop/clock";
import {
  PlanPageInputError,
  markRepliesSeen,
  movePageSession,
  parseReportInput,
  saveMyDays,
  sendStudentMessage,
  submitPageReport,
} from "@/features/intervals/plan-page/actions";
import { isPlanPageEnabled } from "@/features/intervals/plan-page/core";
import { resolvePlanLink } from "@/features/intervals/plan-page/links";
import { loadPlanPageView } from "@/features/intervals/plan-page/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "dub1";

// Страница плана ученицы по ссылке из intervals_plan_links. Соседняя ручка
// (../route.ts) — планы Ильи из athlete_plans; общая у них только форма адреса.
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

type Ctx = { params: Promise<{ slug: string; token: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!isPlanPageEnabled()) return json({ ok: false, error: "Страница выключена" }, 404);
  const { slug, token } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  try {
    const access = await resolvePlanLink(slug, token);
    if (!access) return json({ ok: false, error: "Ссылка не найдена" }, 404);
    const todayIso = todayIsoInZone(access.timezone);
    const load = () => loadPlanPageView({ sourceId: access.sourceId, studentName: access.studentName, todayIso });

    switch (body.op) {
      case "report": {
        const view = await load();
        await submitPageReport(access, parseReportInput((body.report ?? {}) as Record<string, unknown>), view.isManualEntry);
        break;
      }
      case "move":
        await movePageSession(access, String(body.sessionId ?? ""), String(body.toDate ?? ""), todayIso);
        break;
      case "days":
        await saveMyDays({
          sourceId: access.sourceId,
          available: Array.isArray(body.available) ? body.available.map(Number) : [],
          long: body.long === null || body.long === undefined ? null : Number(body.long),
          changedBy: "student",
          origin: "student_answer",
        });
        break;
      case "message":
        await sendStudentMessage(access, String(body.text ?? ""), "page");
        break;
      case "seen":
        await markRepliesSeen(access, Array.isArray(body.ids) ? body.ids.map(String) : []);
        return json({ ok: true });
      default:
        return json({ ok: false, error: "Unknown op" }, 422);
    }
    return json({ ok: true, view: await load() });
  } catch (e) {
    if (e instanceof PlanPageInputError) return json({ ok: false, error: e.message }, 422);
    console.error("[plan-page] POST failed", e);
    return json({ ok: false, error: "Не сохранилось, попробуйте ещё раз" }, 500);
  }
}
