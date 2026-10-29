/* POST /api/en-week/start: the entry page's answers → a plan (or the health stop).
 * Public (the page calls it), no key. Health arrives as a boolean only: the page never sends
 * which item was tapped, and nothing else from the body is stored.
 * A new plan sends Igor one Telegram message (notify.ts); nothing else here pings anyone. */

import { after } from "next/server";

import { instagramHandle } from "@/features/breakdown/instagram-handle";
import { FLAG_OFF, json } from "@/features/en-week/http";
import { cleanAnswers, isEnWeekEnabled, safeTz } from "@/features/en-week/logic";
import { notifyCoach } from "@/features/en-week/notify";
import { cleanClientId, createPlan } from "@/features/en-week/service";
import { supabaseEnWeekStore } from "@/features/en-week/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isEnWeekEnabled()) return json(FLAG_OFF, 404);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "json" }, 400);
  }
  // Honeypot: real people never fill this hidden field.
  if (typeof body.website === "string" && body.website.trim()) return json({ ok: false, error: "save" }, 400);

  if (typeof body.health !== "boolean") return json({ ok: false, error: "answers" }, 422);
  // Every answer is checked against the option lists (cleanAnswers); unknown keys are dropped.
  const cleaned = cleanAnswers(body);
  if (!cleaned.ok) return json({ ok: false, error: cleaned.error }, 422);

  const countryHeader = request.headers.get("x-vercel-ip-country");
  try {
    const out = await createPlan(
      supabaseEnWeekStore(),
      {
        clientId: cleanClientId(body.c),
        // ChatPlace passes ?u={{username}}; an unfilled placeholder is rejected by instagramHandle.
        username: instagramHandle(body.u),
        answers: cleaned.answers,
        tz: safeTz(body.tz),
        health: body.health,
        country: countryHeader && /^[A-Za-z]{2}$/u.test(countryHeader) ? countryHeader.toUpperCase() : null,
      },
      new Date(),
      // One Telegram ping to Igor per new plan, after the response (never delays the page).
      { notify: (text) => after(() => notifyCoach(text)) },
    );
    if (!out.ok) return json(out, 422);
    return json(out);
  } catch (e) {
    console.error(`[en-week] start: ${e instanceof Error ? e.message : String(e)}`);
    return json({ ok: false, error: "save" }, 500);
  }
}
