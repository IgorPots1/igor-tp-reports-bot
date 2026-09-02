import { NextRequest } from "next/server";

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

export const runtime = "nodejs";

const jsonHeaders = { "Content-Type": "application/json" };

/**
 * Сохранение ответов подборщика кроссовок.
 *
 * Это не заявка и не лид: сообщений никуда не уходит, тренеру ничего не
 * прилетает. Смысл один — знать, чем реально бегает аудитория, и на чём
 * основана выданная ротация.
 *
 * Ни IP, ни user-agent НЕ сохраняются, и это не забывчивость: в ответах есть
 * вес и история травм — данные о здоровье, — и в уведомлении человеку обещано,
 * что технических следов браузера мы не пишем. Обещание держится тем, что
 * заголовки здесь просто не читаются. Приходит запрос без согласия — его
 * вообще не бывает: клиент в этом случае не отправляет ничего.
 *
 * Отвечает 200 даже когда запись не удалась: человек уже увидел свою выдачу,
 * и падение сбора статистики не должно выглядеть для него ошибкой.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const { answers, picks } = body as Record<string, unknown>;
  if (typeof answers !== "object" || answers === null) {
    return new Response(JSON.stringify({ ok: false, error: "answers required" }), {
      status: 422,
      headers: jsonHeaders,
    });
  }

  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from("shoe_picker_answers").insert({
      answers,
      picks: picks ?? null,
      source: "tools/shoes",
    });
    if (error) {
      console.error("[shoes] Supabase insert error:", describeSupabaseError(error));
      return new Response(JSON.stringify({ ok: true, stored: false }), {
        status: 200,
        headers: jsonHeaders,
      });
    }
  } catch (err) {
    console.error("[shoes] Supabase failed:", describeSupabaseError(err));
    return new Response(JSON.stringify({ ok: true, stored: false }), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true, stored: true }), {
    status: 200,
    headers: jsonHeaders,
  });
}
