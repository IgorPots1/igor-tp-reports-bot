import { createSupabaseServerClient } from "@/features/supabase/server";

// Публичная ручка здоровья для ВНЕШНЕГО монитора.
//
// 2026-08-03 про падение базы Игорь узнал, когда не смог зайти в админку — через часы после
// начала. /admin/login при этом отвечал 200: он в базу не ходит. Значит проверять надо не
// «отвечает ли сайт», а «жива ли база», и делать это снаружи, из системы, которая не зависит
// от наблюдаемой базы (UptimeRobot и подобные).
//
// Контракт намеренно бедный: 200 {db:"ok", ms} или 503 {db:"fail", error}. Ответ ПУБЛИЧНЫЙ,
// поэтому никаких секретов, имён таблиц, текстов ошибок PostgREST и вообще ничего о схеме —
// только фиксированный набор коротких кодов.

export const runtime = "nodejs";
// Не кэшировать: закэшированный «ok» — ровно то, из-за чего мониторинг проспал бы аварию.
export const dynamic = "force-dynamic";

/** Жёсткий предел: монитор опрашивает часто, ручка обязана отвечать быстро даже когда БД мертва. */
const DB_TIMEOUT_MS = 3000;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

/**
 * Самая дешёвая из возможных проверок: одна строка из таблицы, которая заведомо мала.
 * Считать что-то тяжёлое здесь нельзя — ручка дёргается каждые пять минут.
 */
async function probeDatabase(): Promise<{ ok: true } | { ok: false; code: string }> {
  const supabase = createSupabaseServerClient();
  try {
    const { error } = await supabase
      .from("trainingpeaks_students")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    if (error) {
      // Наружу отдаём только класс ошибки. Полный текст ушёл бы в публичный ответ.
      return { ok: false, code: "query_error" };
    }
    return { ok: true };
  } catch {
    // Сюда попадает сетевой отказ undici («fetch failed»), который мимо проверки error.
    return { ok: false, code: "unreachable" };
  }
}

export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  // Гонка с таймером: если база висит, ждать её дольше трёх секунд бессмысленно — монитор
  // всё равно должен получить ответ. Проверка при этом не отменяется (supabase-js не
  // принимает AbortSignal здесь), но её результат уже никого не ждёт.
  const timeout = new Promise<{ ok: false; code: string }>((resolve) => {
    setTimeout(() => resolve({ ok: false, code: "timeout" }), DB_TIMEOUT_MS);
  });

  const result = await Promise.race([probeDatabase(), timeout]);
  const ms = Date.now() - startedAt;

  if (result.ok) {
    return jsonResponse(200, { db: "ok", ms });
  }

  return jsonResponse(503, { db: "fail", error: result.code, ms });
}
