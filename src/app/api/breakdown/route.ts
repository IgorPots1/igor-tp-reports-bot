import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { stravaLinkOk } from "@/features/breakdown/strava-link";

// Free Strava breakdown form (igorp.run/breakdown, English, @runnigor).
// Saves the answers; the strava-breakdown agent picks them up from
// strava_breakdown_requests. A short ping goes to the coach's leads chat.
// Nothing is sent to the runner from here: the breakdown itself goes out by hand.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonHeaders = { "Content-Type": "application/json" };
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const GOAL_TYPES = ["5K or 10K", "Half or marathon", "No race yet"];
const RUNS_WEEK = ["0-1", "2-3", "4-5", "6+"];
const INJURY = ["none", "right now", "healed"];
const HR_STRAP = ["always", "sometimes", "wrist only"];

function str(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, limit);
  return trimmed || null;
}
function pick(value: unknown, allowed: string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  // Honeypot: real people never fill this hidden field.
  if (str(body.website, 200)) return json({ ok: true }, 200);

  const strava = str(body.strava_link, 300);
  if (!strava || !stravaLinkOk(strava)) {
    return json({ ok: false, error: "strava_link" }, 422);
  }
  const ageRaw = Number(str(body.age, 3));
  const row = {
    chatplace_client_id: str(body.c, 64),
    instagram: str(body.instagram, 60)?.replace(/^@/u, "") ?? null,
    goal_type: pick(body.goal_type, GOAL_TYPES),
    goal_details: str(body.goal_details, 300),
    runs_week: pick(body.runs_week, RUNS_WEEK),
    age: Number.isInteger(ageRaw) && ageRaw >= 10 && ageRaw <= 99 ? ageRaw : null,
    best_recent: str(body.best_recent, 300),
    injury: pick(body.injury, INJURY),
    injury_details: str(body.injury_details, 500),
    hr_strap: pick(body.hr_strap, HR_STRAP),
    strava_link: strava,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    status: "new",
  };
  if (!row.chatplace_client_id && !row.instagram) {
    return json({ ok: false, error: "instagram" }, 422);
  }

  let dbOk = false;
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from("strava_breakdown_requests").insert(row);
    if (error) console.error("[breakdown] insert failed:", error.message);
    else dbOk = true;
  } catch (err) {
    console.error("[breakdown] supabase failed:", err);
  }
  if (!dbOk) return json({ ok: false, error: "save" }, 500);

  // Coach ping (best effort, never blocks the runner).
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const leadsChat = process.env.LEADS_CHAT_ID;
  if (botToken && leadsChat) {
    const who = row.instagram ? `@${row.instagram}` : `ChatPlace ${row.chatplace_client_id}`;
    const text = [
      "@runnigor <b>Strava breakdown: new form</b>",
      `Who: ${esc(who)}`,
      `Goal: ${esc([row.goal_type, row.goal_details].filter(Boolean).join(", ") || "-")}`,
      `Runs a week: ${row.runs_week ?? "-"}`,
      `Injury: ${esc([row.injury, row.injury_details].filter(Boolean).join(", ") || "-")}`,
      `Strava: ${esc(row.strava_link)}`,
    ].join("\n");
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: leadsChat, parse_mode: "HTML", text, disable_web_page_preview: true }),
      });
    } catch (err) {
      console.error("[breakdown] telegram ping failed:", err);
    }
  }
  return json({ ok: true }, 200);
}
