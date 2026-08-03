// Сторож статистики планировщика.
//
// 2026-08-03 статистика слетала ТРИЖДЫ за день после перезапусков инстанса (Fair Use restore,
// восстановление, смена compute). Планировщик начинал считать 48-мегабайтные таблицы пустыми,
// строил nested loop, и всё упиралось в statement_timeout: 500-е на админке, лента клуба мёртвая,
// CPU 100%. Каждый раз это ловилось руками по симптомам, через часы. Лечится одним ANALYZE.
//
// Этот скрипт раз в сутки спрашивает базу, есть ли таблицы без статистики, и если есть —
// прогоняет ANALYZE поимённо (не по всей базе: `analyze;` целиком рвётся по таймауту).
// Поиск и прогон живут в RPC analyze_stale_tables (см. миграцию 20260905000000): PostgREST не
// пускает в pg_catalog, а supabase-js не умеет служебные команды.
//
// Запуск:
//   node --experimental-strip-types tools/trainingpeaks-export/scripts/tp-db-stats-guard.ts [--dry-run]
//   --dry-run — только посчитать и доложить, ANALYZE не гонять.

import { loadLocalEnv } from "./lib/local-env.ts";

loadLocalEnv();

import { createClient } from "@supabase/supabase-js";

import { sendCoachTelegramMessage } from "./lib/coach-telegram-notify.ts";

const DRY_RUN = process.argv.includes("--dry-run");
const TAG = "[db-stats-guard]";

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(message: string): void {
  console.log(`${stamp()} ${TAG} ${message}`);
}

function logError(message: string): void {
  console.error(`${stamp()} ${TAG} ${message}`);
}

/** Полный текст ошибки, а не "undefined". Тот же принцип, что describeSupabaseError в src/. */
function describe(error: unknown): string {
  if (error === null || error === undefined) return "no error object";
  if (typeof error === "string") return error;
  const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  const parts: string[] = [];
  if (typeof e.code === "string" && e.code) parts.push(`code=${e.code}`);
  if (typeof e.message === "string" && e.message) parts.push(e.message);
  if (typeof e.details === "string" && e.details) parts.push(`details=${e.details}`);
  if (typeof e.hint === "string" && e.hint) parts.push(`hint=${e.hint}`);
  if (parts.length > 0) return parts.join(" · ");
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

type AnalyzedRow = { table_name: string; size_bytes: number; duration_ms: number };

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

/**
 * Уведомление тренеру. Сторож существует ровно ради того, чтобы Игорь узнавал о беде не из
 * «не могу зайти в админку», поэтому провал самого сторожа обязан быть слышным.
 * Ученикам отсюда не пишем никогда — только TELEGRAM_COACH_CHAT_IDS.
 */
async function alertCoach(text: string): Promise<void> {
  try {
    await sendCoachTelegramMessage(text);
  } catch (error) {
    logError(`не смог отправить уведомление тренеру: ${describe(error)}`);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  log(`старт${DRY_RUN ? " (dry-run)" : ""}`);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const message = "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы — сторож статистики не может работать.";
    logError(message);
    await alertCoach(`⚠️ Сторож статистики БД не запустился: ${message}`);
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1. Сколько таблиц без статистики (read-only, дёшево).
  const counted = await supabase.rpc("count_stale_stat_tables");
  if (counted.error) {
    const detail = describe(counted.error);
    logError(`не смог посчитать таблицы без статистики: ${detail}`);
    await alertCoach(
      `⚠️ Сторож статистики БД не смог опросить базу.\n${detail}\n` +
        `Если это «function ... does not exist» — не применена миграция 20260905000000_analyze_stale_tables_rpc.sql.`
    );
    process.exitCode = 1;
    return;
  }

  const staleCount = Number(counted.data ?? 0);
  log(`таблиц без статистики: ${staleCount}`);

  if (staleCount === 0) {
    log(`готово за ${Date.now() - startedAt} мс, делать нечего`);
    return;
  }

  if (DRY_RUN) {
    log(`dry-run: прогнал бы ANALYZE по ${staleCount} таблицам, но не гоню`);
    return;
  }

  // 2. Прогон ANALYZE поимённо. Своё окно statement_timeout задано внутри функции.
  const analyzedAt = Date.now();
  const analyzed = await supabase.rpc("analyze_stale_tables", { max_tables: 200 });
  if (analyzed.error) {
    const detail = describe(analyzed.error);
    logError(`ANALYZE не прошёл: ${detail}`);
    await alertCoach(`⚠️ Сторож статистики БД: ANALYZE не прошёл.\nТаблиц без статистики: ${staleCount}.\n${detail}`);
    process.exitCode = 1;
    return;
  }

  const rows = (analyzed.data as AnalyzedRow[] | null) ?? [];
  const totalMs = Date.now() - analyzedAt;
  for (const row of rows) {
    log(`  ANALYZE ${row.table_name} (${formatMb(Number(row.size_bytes))}) — ${row.duration_ms} мс`);
  }
  log(`прогнал ${rows.length} из ${staleCount}, суммарно ${totalMs} мс, всего ${Date.now() - startedAt} мс`);

  // Нашли и починили — это не рутина, а признак того, что инстанс опять перезапускали.
  // Тренер должен об этом знать, иначе третий раз за день снова обнаружится по симптомам.
  if (rows.length > 0) {
    const top = rows
      .slice(0, 5)
      .map((r) => `${r.table_name} (${formatMb(Number(r.size_bytes))})`)
      .join(", ");
    await alertCoach(
      `📊 Статистика планировщика слетала: прогнал ANALYZE по ${rows.length} таблицам за ${Math.round(totalMs / 1000)} с.\n` +
        `Крупнейшие: ${top}.\n` +
        `Обычно означает, что инстанс Supabase перезапускали.`
    );
  }

  if (rows.length < staleCount) {
    log(`осталось ${staleCount - rows.length} — превышен лимит за прогон, доберутся следующим запуском`);
  }
}

main().catch(async (error) => {
  logError(`необработанный сбой: ${describe(error)}`);
  await alertCoach(`⚠️ Сторож статистики БД упал: ${describe(error)}`);
  process.exitCode = 1;
});
