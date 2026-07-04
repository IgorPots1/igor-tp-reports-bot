import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/features/supabase/server";

export const runtime = "nodejs";

const jsonHeaders = { "Content-Type": "application/json" };

function msk(date: Date): string {
  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  const { name: rawName, phone: rawPhone, telegram: rawTelegram } =
    body as Record<string, unknown>;

  const name =
    typeof rawName === "string" ? rawName.trim().slice(0, 200) : "";
  const phone =
    typeof rawPhone === "string" ? rawPhone.trim().slice(0, 50) : "";
  const telegram =
    typeof rawTelegram === "string" ? rawTelegram.trim().slice(0, 100) : "";

  if (!name || !phone) {
    return new Response(
      JSON.stringify({ ok: false, error: "name and phone are required" }),
      { status: 422, headers: jsonHeaders }
    );
  }

  const leadsChat = process.env.LEADS_CHAT_ID;
  if (!leadsChat) {
    console.error("[lead] LEADS_CHAT_ID is not set");
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Server misconfiguration: LEADS_CHAT_ID not set",
      }),
      { status: 500, headers: jsonHeaders }
    );
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("[lead] TELEGRAM_BOT_TOKEN is not set");
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Server misconfiguration: TELEGRAM_BOT_TOKEN not set",
      }),
      { status: 500, headers: jsonHeaders }
    );
  }

  const now = msk(new Date());
  const text = `🏃 <b>Новая заявка с сайта</b>\nИмя: ${name}\nТелефон: ${phone}\nTelegram: ${telegram || "—"}\nВремя: ${now}\nИсточник: landing igorp.run`;

  const userAgent = req.headers.get("user-agent") ?? "";

  let tgOk = false;
  let dbOk = false;

  // Telegram (независимо от Supabase)
  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: leadsChat,
          parse_mode: "HTML",
          text,
        }),
      }
    );
    const tgJson = (await tgRes.json()) as { ok: boolean };
    tgOk = tgJson.ok === true;
    if (!tgOk) console.error("[lead] Telegram error:", JSON.stringify(tgJson));
  } catch (err) {
    console.error("[lead] Telegram fetch failed:", err);
  }

  // Supabase (независимо от Telegram)
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from("leads").insert({
      name,
      phone,
      telegram: telegram || null,
      source: "landing",
      user_agent: userAgent,
      status: "new",
    });
    if (error) {
      console.error("[lead] Supabase insert error:", error);
    } else {
      dbOk = true;
    }
  } catch (err) {
    console.error("[lead] Supabase failed:", err);
  }

  // Log for debugging
  if (!dbOk) {
    console.warn("[lead] DB insert failed, tgOk:", tgOk);
  }

  if (tgOk) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  }
  return new Response(
    JSON.stringify({ ok: false, error: "Failed to send notification" }),
    { status: 500, headers: jsonHeaders }
  );
}
