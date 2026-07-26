// Daily pipeline staleness monitor. Every scan wrapper writes a SUCCESS heartbeat to
// trainingpeaks_cron_run_logs (tp-heartbeat, status=sent). This checks the age of the last SUCCESS
// per flow against a per-schedule threshold and, when a flow is overdue, sends ONE coach Telegram
// line «поток X молчит N часов». So a silent stall (a stopped or every-time-failing service)
// becomes a message instead of being found by accident — the class of bug behind the 9-day metrics
// stall and the health-scan frozen since May.
//
// READ-ONLY (no writes). Runs from run-feedback-safety-net.sh (09:30). Flags: --dry-run (no send).
//
// Thresholds (justified): hourly flows (cache/fit/enqueue) → 3h tolerates ~2 missed runs (a short
// sleep is fine, 3 misses is a problem). health (6×/day, every ~3-4h) → 8h = 2 missed cycles.
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
];
// Race-scan's wrapper lives outside the repo (local-only), so it can't write a heartbeat here yet.
// Until it does, monitor its OUTPUT freshness: the newest race_events row. Weaker (no new races ≠
// failure), so it's a soft flag with a note. Add tp-heartbeat --job=race_scan to that wrapper for a
// true signal.
const RACE_MAX_H = 9 * 24;

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

  // race — data-freshness fallback
  {
    const { data } = await sb.from("trainingpeaks_race_events").select("created_at").order("created_at", { ascending: false }).limit(1);
    const last = (data as Array<{ created_at: string }> | null)?.[0]?.created_at ?? null;
    const age = ageH(last);
    const ok = age <= RACE_MAX_H;
    state.push(`  ${ok ? "✅" : "⚠️"} старты/календарь (недельный, по данным race_events): последняя запись ${fmt(age)} назад · порог ${RACE_MAX_H / 24}д · heartbeat не настроен`);
    if (!ok) stale.push(`⚠️ старты/календарь: новых записей ${fmt(age)} (порог ${RACE_MAX_H / 24}д) — проверь race-scan`);
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
