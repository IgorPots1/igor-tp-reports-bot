// Daily pipeline staleness monitor. Every scan wrapper writes a SUCCESS heartbeat to
// trainingpeaks_cron_run_logs (tp-heartbeat, status=sent). This checks the age of the last SUCCESS
// per flow against a per-schedule threshold and, when a flow is overdue, sends ONE coach Telegram
// line «поток X молчит N часов». So a silent stall (a stopped or every-time-failing service)
// becomes a message instead of being found by accident — the class of bug behind the 9-day metrics
// stall and the health-scan frozen since May.
//
// Coverage is deliberately CROSS-HOST: besides the Mac scan flows, it also watches the VERCEL crons
// (утренняя сводка + импорт платежей). Those run off-box, so when Vercel silently stops invoking
// them — as happened 2026-07-28, unnoticed for 3 days — the Mac monitor is the only thing that can
// see it, because both write their run rows to the shared Supabase. Adding a flow here = one row per
// success + a threshold; that is all it takes to make the next silent death visible next morning.
//
// READ-ONLY (no writes). Runs from run-feedback-safety-net.sh (09:30). Flags: --dry-run (no send).
//
// Thresholds (justified): hourly flows (cache/fit/enqueue) → 3h tolerates ~2 missed runs (a short
// sleep is fine, 3 misses is a problem). health (6×/day, every ~3-4h) → 8h = 2 missed cycles.
// Vercel daily crons (digest 09:00, billing 08:30) → 26h = one missed day + 2h buffer.
// race (weekly Mon) → 9 days = one missed week + buffer (tightens once race becomes daily).

import { loadLocalEnv } from "./lib/local-env.ts";
loadLocalEnv();

import { createSupabaseServerClient } from "../../../src/features/supabase/server.ts";
import { sendCoachTelegramMessage } from "./lib/coach-telegram-notify.ts";

type HeartbeatFlow = { job: string; label: string; maxH: number; cadence: string };
const HEARTBEAT_FLOWS: HeartbeatFlow[] = [
  { job: "workout_cache_scan", label: "кэш тренировок", maxH: 3, cadence: "часовой" },
  { job: "fit_ingest_scan", label: "метрики FIT", maxH: 3, cadence: "часовой" },
  { job: "workout_feedback_enqueue", label: "очередь фидбека", maxH: 3, cadence: "часовой" },
  { job: "health_metrics_scan", label: "здоровье (сон/пульс/HRV)", maxH: 8, cadence: "6×/день" },
  // Vercel cron — writes the same cron_run_logs row (status=sent) on a successful digest send.
  { job: "attention_digest", label: "утренняя сводка (Vercel)", maxH: 26, cadence: "дневной" },
  // ДОБАВЛЕНЫ 13.08. Эти потоки писали heartbeat, но в списке монитора их не было — то есть
  // они могли встать так же тихо, как встал скан стартов. Пороги: суточные с запасом 2ч,
  // редкие — по своей каденции.
  { job: "club_execute_approved", label: "клуб: исполнение одобренного", maxH: 3, cadence: "часовой" },
  { job: "club_reconcile_tp", label: "клуб: сверка с TP", maxH: 3, cadence: "часовой" },
  { job: "club_materialize_full", label: "клуб: материализация", maxH: 26, cadence: "дневной" },
  { job: "club_probeg_sync", label: "клуб: синхронизация пробегов", maxH: 4 * 24, cadence: "пн+чт" },
  { job: "db_stats_guard", label: "сторож размера БД", maxH: 26, cadence: "дневной" },
  { job: "feedback_safety_net", label: "сетка отчётов", maxH: 26, cadence: "дневной" },
  { job: "feedback_lexicon_grow", label: "рост лексикона", maxH: 9 * 24, cadence: "недельный" },
];

/**
 * ЗАДАНИЯ ИЗ trainingpeaks_jobs — сторожатся ПО ПРОГОНАМ, а не по heartbeat.
 *
 * У этих потоков heartbeat нет вовсе, зато есть таблица заданий со статусом. Проверяется то же
 * самое, что для скана стартов: возраст последнего УСПЕШНОГО прогона и число провалов ПОДРЯД.
 *
 * ЗАЧЕМ. Инвентаризация 13.08 показала два мёртвых потока, за которыми не следил никто:
 *   weekly_reports     — 25 заданий, 10 провалов, последний успех 74 ДНЯ назад;
 *   race_results_probe — последний успех 82 ДНЯ назад.
 * Оба умерли тихо и были найдены случайно, при разборе совсем другой задачи.
 */
type JobFlow = { jobType: string; label: string; maxH: number; cadence: string; onDemand?: boolean };
const JOB_FLOWS: JobFlow[] = [
  { jobType: "race_scan_events", label: "старты/календарь", maxH: 9 * 24, cadence: "недельный" },
  // ПО ТРЕБОВАНИЮ — ВОЗРАСТ НЕ СТОРОЖИМ. Разбор 13.08 показал, что оба «мёртвых» потока на
  // самом деле исправны: у weekly_reports все провалы это РУЧНЫЕ ОТМЕНЫ тренером из Telegram
  // (cancelled_by_coach, «broad weekly job created by mistake»), а успеха нет 74 дня просто
  // потому, что его никто не запускал с 30.05. У race_results_probe та же картина.
  // Тревожить «успеха нет 74 дня» на потоке, который запускают руками, — ложный сигнал каждый
  // день; проверка, падающая не там, где надо, хуже отсутствующей. Поэтому здесь сторожим
  // только ПРОВАЛЫ ПОДРЯД (сломалось при запуске) и ЗАСТРЯВШИЕ в очереди задания.
  { jobType: "weekly_reports", label: "недельные отчёты", maxH: 0, cadence: "по требованию", onDemand: true },
  { jobType: "race_results_probe", label: "результаты стартов", maxH: 0, cadence: "по требованию", onDemand: true },
  { jobType: "race_scan_backfill", label: "добор стартов назад", maxH: 0, cadence: "по требованию", onDemand: true },
];
const JOB_FAIL_STREAK_ALERT = 2;
/** Задание, висящее в очереди дольше этого, никем не взято — это поломка раннера. */
const JOB_STUCK_QUEUED_H = 48;
// РАБОТА СКАНА СТАРТОВ ЧИТАЕТСЯ ИЗ ТАБЛИЦЫ ЗАДАНИЙ, А НЕ ИЗ СВЕЖЕСТИ ДАННЫХ (правка 13.08).
//
// Прежде здесь стоял слабый прокси: возраст самой новой строки trainingpeaks_race_events.
// Он ОБМАНУЛ РОВНО В ТОМ СЛУЧАЕ, ради которого написан. Скан упал 03.08 и 10.08 подряд, десять
// дней система не видела новых стартов — и не увидела марафоны двух учениц. При этом строки в
// race_events появлялись (11.08 их создал ручной backfill, плюс проверка результатов трогает
// updated_at), возраст «последней записи» оставался маленьким, и монитор всё это время показывал
// зелёное. «Данные свежие» и «процесс жив» — разные вещи; прокси меряет первое, а нужно второе.
//
// Теперь сигнал берётся из trainingpeaks_jobs по job_type=race_scan_events:
//   1) возраст ПОСЛЕДНЕГО УСПЕШНОГО прогона против порога;
//   2) сколько провалов подряд накопилось с последнего успеха — два подряд это уже сигнал,
//      не дожидаясь порога по времени. Ровно этот случай и был: 03.08 и 10.08.
const RACE_MAX_H = 9 * 24;
const RACE_FAIL_STREAK_ALERT = 2;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const sb = createSupabaseServerClient();
  const now = Date.now();
  const ageH = (iso: string | null): number => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 3_600_000) : Infinity);
  const fmt = (h: number): string => (h === Infinity ? "нет успеха" : h < 48 ? `${h.toFixed(0)}ч` : `${(h / 24).toFixed(0)}д`);

  const state: string[] = [];
  const stale: string[] = [];

  for (const f of HEARTBEAT_FLOWS) {
    const { data } = await sb
      .from("trainingpeaks_cron_run_logs")
      .select("started_at")
      .eq("job_name", f.job)
      .eq("status", "sent")
      .order("started_at", { ascending: false })
      .limit(1);
    const last = (data as Array<{ started_at: string }> | null)?.[0]?.started_at ?? null;
    const age = ageH(last);
    const ok = age <= f.maxH;
    state.push(`  ${ok ? "✅" : "⚠️"} ${f.label} (${f.cadence}): последний успех ${fmt(age)} назад · порог ${f.maxH}ч`);
    if (!ok) stale.push(`⚠️ ${f.label}: молчит ${fmt(age)} (порог ${f.maxH}ч)`);
  }

  // задания из trainingpeaks_jobs — по прогонам
  for (const f of JOB_FLOWS) {
    const { data } = await sb
      .from("trainingpeaks_jobs")
      .select("status, created_at, finished_at, error_message")
      .eq("job_type", f.jobType)
      .order("created_at", { ascending: false })
      .limit(30);
    const rows = (data as Array<{ status: string; created_at: string; finished_at: string | null; error_message: string | null }> | null) ?? [];
    if (rows.length === 0) { state.push(`  ➖ ${f.label} (${f.cadence}): заданий нет вовсе`); continue; }
    const lastOk = rows.find((r) => r.status === "completed") ?? null;
    const age = ageH(lastOk?.finished_at ?? lastOk?.created_at ?? null);
    let streak = 0;
    let lastErr: string | null = null;
    for (const r of rows) {
      if (r.status === "completed") break;
      if (r.status === "failed") { streak++; if (!lastErr) lastErr = r.error_message; }
    }
    // застрявшее в очереди задание — поломка раннера, а не отсутствие спроса
    const stuck = rows.find((r) => r.status === "queued" && ageH(r.created_at) > JOB_STUCK_QUEUED_H) ?? null;
    const overdue = !f.onDemand && age > f.maxH;
    const failing = streak >= JOB_FAIL_STREAK_ALERT;
    const ok = !overdue && !failing && !stuck;
    const ageText = f.onDemand
      ? `последний запуск ${fmt(age)} назад · по требованию, возраст не сторожим`
      : `последний успех ${fmt(age)} назад · порог ${Math.round(f.maxH / 24)}д`;
    state.push(`  ${ok ? "✅" : "⚠️"} ${f.label} (${f.cadence}, по ЗАДАНИЯМ): ${ageText} · провалов подряд ${streak}`);
    if (failing) stale.push(`⚠️ ${f.label}: ${streak} провала подряд, последний успех ${fmt(age)} назад${lastErr ? ` — ${lastErr.slice(0, 160)}` : ""}`);
    else if (overdue) stale.push(`⚠️ ${f.label}: успеха нет ${fmt(age)} (порог ${Math.round(f.maxH / 24)}д)`);
    if (stuck) stale.push(`⚠️ ${f.label}: задание висит в очереди ${fmt(ageH(stuck.created_at))} — раннер его не берёт`);
  }

  // billing email import (Vercel cron, daily 08:30) — REAL MONEY, and it logs to its OWN table
  // (billing_email_import_runs), not cron_run_logs, so it needs a dedicated freshness read. A
  // successful run is status='success'; its started_at is the freshness anchor. This is the flow
  // that silently stopped 2026-07-28 → payments stopped importing with no alert.
  {
    const { data } = await sb
      .from("billing_email_import_runs")
      .select("started_at")
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1);
    const last = (data as Array<{ started_at: string }> | null)?.[0]?.started_at ?? null;
    const age = ageH(last);
    const ok = age <= 26;
    state.push(`  ${ok ? "✅" : "⚠️"} импорт платежей (Vercel, дневной): последний успех ${fmt(age)} назад · порог 26ч`);
    if (!ok) stale.push(`⚠️ импорт платежей: молчит ${fmt(age)} (порог 26ч) — проверь Vercel cron billing-email-import`);
  }

  console.log(`[tp-pipeline-heartbeat-monitor] ${new Date(now).toISOString()}`);
  console.log(state.join("\n"));

  if (stale.length === 0) {
    console.log("[tp-pipeline-heartbeat-monitor] все потоки живы — тревоги нет");
    return;
  }
  const message = `🚨 Потоки данных молчат:\n${stale.join("\n")}`;
  console.log(`[tp-pipeline-heartbeat-monitor] STALE=${stale.length}\n${message}`);
  if (!dryRun) await sendCoachTelegramMessage(message);
}

main().then(() => process.exit(0)).catch((e) => { console.error(`[tp-pipeline-heartbeat-monitor] failed: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
