/**
 * tp-billing-import-failsafe — ПОДСТРАХОВКА ИМПОРТА ПЛАТЕЖЕЙ с Мака. Vercel остаётся основным.
 *
 * ЗАЧЕМ. Диагностика 13.08: Vercel пропускает дни ШТАТНО — 8 из последних 40, пачками по 1-2 дня,
 * раз в 1-2 недели, и так с начала июля. Время прогона плывёт до 51 минуты от расписания.
 * Это свойство расписания «по возможности», а не поломка: данные не теряются, потому что импорт
 * смотрит на 7 дней назад и отсекает повторы по external_hash.
 *
 * Но пропуск в 3+ дня уже подходит к краю окна, а Игорь узнаёт о нём только из утреннего
 * сторожа. Поэтому Мак раз в сутки смотрит, был ли УСПЕШНЫЙ прогон за последние 26 часов, и
 * если не было — дёргает тот же маршрут сам.
 *
 * ПОЧЕМУ ЭТО БЕЗОПАСНО. Дёргается ровно тот же production-маршрут с тем же секретом; повторы
 * отсекаются на уровне вложений (external_hash + already_processed), поэтому задвоить платежи
 * нельзя даже если Vercel и Мак сработают одновременно. Ничего не пишется напрямую в биллинг —
 * только HTTP-вызов.
 *
 * ЧЕГО ОН НЕ ДЕЛАЕТ: не чинит Vercel, не меняет расписание, не трогает данные. Если маршрут
 * ответит ошибкой — она уйдёт в лог и в тревогу тренеру, а не будет проглочена.
 *
 * Запуск:  npx tsx tools/trainingpeaks-export/scripts/tp-billing-import-failsafe.ts
 * Флаги:   --dry-run  посмотреть решение, не вызывая маршрут
 *          --force    вызвать независимо от возраста последнего успеха
 */
import process from "node:process";

import { loadLocalEnv } from "./lib/local-env.ts";
loadLocalEnv();

import { createSupabaseServerClient } from "../../../src/features/supabase/server.ts";
import { sendCoachTelegramMessage } from "./lib/coach-telegram-notify.ts";

/** 26 часов: сутки плюс два часа на разброс расписания Vercel (замерен до 51 минуты). */
const STALE_AFTER_HOURS = 26;

function baseUrl(): string | null {
  const raw = process.env.BILLING_IMPORT_BASE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const sb = createSupabaseServerClient();

  const { data, error } = await sb
    .from("billing_email_import_runs")
    .select("started_at, status")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`не прочитать billing_email_import_runs: ${error.message}`);

  const last = (data as Array<{ started_at: string }> | null)?.[0]?.started_at ?? null;
  const ageH = last ? (Date.now() - Date.parse(last)) / 3_600_000 : Infinity;
  const stale = force || ageH > STALE_AFTER_HOURS;

  console.log(`[billing-failsafe] последний успех: ${last ?? "никогда"}`
    + ` (${ageH === Infinity ? "нет" : ageH.toFixed(1) + "ч"} назад), порог ${STALE_AFTER_HOURS}ч`);

  if (!stale) { console.log("[billing-failsafe] Vercel отработал, вмешиваться не нужно"); return; }
  if (dryRun) { console.log("[billing-failsafe] --dry-run: вызвал бы маршрут, но не вызываю"); return; }

  const url = baseUrl();
  const secret = process.env.CRON_SECRET?.trim();
  if (!url || !secret) {
    const what = !url ? "BILLING_IMPORT_BASE_URL / NEXT_PUBLIC_SITE_URL" : "CRON_SECRET";
    console.error(`[billing-failsafe] не задан ${what} — подстраховка невозможна`);
    await sendCoachTelegramMessage(`⚠️ подстраховка импорта платежей не настроена: нет ${what}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[billing-failsafe] успеха нет ${ageH.toFixed(1)}ч — дёргаю маршрут сам`);
  try {
    const res = await fetch(`${url}/api/cron/billing-email-import`, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}`, "x-failsafe-caller": "mac-failsafe" },
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[billing-failsafe] маршрут ответил HTTP ${res.status}: ${body.slice(0, 300)}`);
      await sendCoachTelegramMessage(`⚠️ подстраховка импорта платежей: маршрут ответил ${res.status}.`
        + ` Импорта нет ${Math.round(ageH)}ч — нужен взгляд.`);
      process.exitCode = 1;
      return;
    }
    console.log(`[billing-failsafe] маршрут отработал: ${body.slice(0, 300)}`);
    await sendCoachTelegramMessage(`ℹ️ импорт платежей не запускался ${Math.round(ageH)}ч,`
      + ` Мак дёрнул его сам — прошёл успешно.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[billing-failsafe] вызов не удался: ${msg}`);
    await sendCoachTelegramMessage(`⚠️ подстраховка импорта платежей: вызов не удался (${msg.slice(0, 120)}).`
      + ` Импорта нет ${Math.round(ageH)}ч.`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(`[billing-failsafe] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
