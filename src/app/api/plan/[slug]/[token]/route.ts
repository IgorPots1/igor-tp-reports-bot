import { NextRequest } from "next/server";

import {
  PlanInputError,
  loadPlanView,
  notifyCoach,
  parseReportInput,
  resolvePlanToken,
  saveCoachReply,
  saveReport,
} from "@/features/athlete-plans/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ответы личные и зависят от токена в пути: ни CDN, ни браузер не кэшируют.
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

type Ctx = { params: Promise<{ slug: string; token: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug, token } = await ctx.params;
  try {
    const access = await resolvePlanToken(slug, token);
    if (!access) return json({ ok: false, error: "Ссылка не найдена" }, 404);
    return json({ ok: true, view: await loadPlanView(access) });
  } catch (e) {
    console.error("[plan] GET failed", e);
    return json({ ok: false, error: "Не удалось загрузить план" }, 500);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug, token } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  try {
    const access = await resolvePlanToken(slug, token);
    if (!access) return json({ ok: false, error: "Ссылка не найдена" }, 404);

    // Отчёт шлёт только ученик, ответ пишет только тренер. Роль из токена.
    if (body.op === "report") {
      if (access.role !== "athlete") return json({ ok: false, error: "Отчёт заполняет ученик" }, 403);
      const input = parseReportInput((body.report ?? {}) as Record<string, unknown>);
      if ("error" in input) return json({ ok: false, error: input.error }, 422);
      const isNew = await saveReport(access.planId, input);
      await notifyCoach(access, input, isNew, input.keepPaths.length + input.newFiles.length);
    } else if (body.op === "reply") {
      if (access.role !== "coach") return json({ ok: false, error: "Not allowed" }, 403);
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      const reply = typeof body.reply === "string" ? body.reply.trim().slice(0, 3000) || null : null;
      await saveCoachReply(access.planId, sessionId, reply);
    } else {
      return json({ ok: false, error: "Unknown op" }, 422);
    }

    return json({ ok: true, view: await loadPlanView(access) });
  } catch (e) {
    if (e instanceof PlanInputError) return json({ ok: false, error: e.message }, 422);
    console.error("[plan] POST failed", e);
    return json({ ok: false, error: "Не сохранилось, попробуй ещё раз" }, 500);
  }
}
