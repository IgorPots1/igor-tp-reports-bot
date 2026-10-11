import { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { SUGGEST_LIMIT_PER_HOUR, checkSuggestion, clientIp, hashIp } from "@/app/races/suggest-logic";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* Форма «Добавить старт» на /races. Пишет в race_suggestions ключом service role:
   у anon доступа к таблице нет, иначе honeypot и лимит обходились бы прямым
   запросом в PostgREST. Разбирает заявки еженедельный раннер races-weekly. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Не получилось прочитать форму." }, 400);
  }

  const check = checkSuggestion(body);
  // Бот получает тот же ответ, что и человек, чтобы не подбирал обход.
  if (check.kind === "bot") return json({ ok: true });
  if (check.kind === "invalid") return json({ ok: false, error: check.error }, 422);

  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-16) ?? "races";
  const ipHash = hashIp(clientIp(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip")), salt);

  try {
    const sb = createSupabaseServerClient();
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count, error: countError } = await sb
      .from("race_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if (countError) throw countError;
    if ((count ?? 0) >= SUGGEST_LIMIT_PER_HOUR) {
      return json({ ok: false, error: "Слишком много заявок за час. Попробуйте позже." }, 429);
    }
    const { error } = await sb.from("race_suggestions").insert({ ...check.value, ip_hash: ipHash, status: "new" });
    if (error) throw error;
    return json({ ok: true });
  } catch (err) {
    console.error("[races/suggest] не записал заявку:", err);
    return json({ ok: false, error: "Не получилось отправить. Попробуйте ещё раз чуть позже." }, 500);
  }
}
