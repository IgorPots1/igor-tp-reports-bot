// Cadence check — одна команда, чтобы завтра решить про 30 минут. Смотрит 4 сигнала:
//   1) сбои/429 от TP по дням (видно «было 3ч / стало 1ч»);
//   2) смерти сессии по дням;
//   3) сработал ли монитор сбоев экспорта (стрики в app_runtime_flags);
//   4) реальная задержка «TP увидел тренировку → карточка в списке» (median/p90).
// READ-ONLY. Запуск: npm --prefix tools/trainingpeaks-export run tp-cadence-report
// (или из корня: npm run — см. алиас).

import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { loadLocalEnv } from "./lib/local-env.ts";
loadLocalEnv();

import { getRuntimeFlag } from "../../../src/features/trainingpeaks/feedback/app-runtime-flags.ts";
import { createSupabaseServerClient } from "../../../src/features/supabase/server.ts";

const LOGS = path.join(os.homedir(), "igor-tp-reports-bot", "tools", "trainingpeaks-export", "logs");
const read = (f: string) => { try { return readFileSync(path.join(LOGS, f), "utf8"); } catch { return ""; } };

function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

function countByDay(text: string, day: string, re: RegExp): number {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.includes(day) && re.test(line)) n++;
  }
  return n;
}

async function main() {
  const days = lastDays(3);
  const cacheOut = read("workout-cache-scan.launchd.out.log");
  const fitOut = read("fit-ingest-scan.launchd.out.log");
  const fitErr = read("fit-ingest-scan.launchd.err.log");
  const cacheErr = read("workout-cache-scan.launchd.err.log");
  const allText = cacheOut + "\n" + fitOut + "\n" + fitErr + "\n" + cacheErr;

  console.log("═══ 1. Сбои / 429 от TP по дням (было 3ч → стало 1ч) ═══");
  console.log("день        | failed-строк | 429 | session-dead");
  for (const day of days) {
    const failed = countByDay(cacheOut + fitOut, day, /status=failed/u);
    const t429 = countByDay(allText, day, /\b429\b/u);
    const dead = countByDay(allText, day, /session dead|сессия.*умерла|aborting scan/iu);
    console.log(`${day}  | ${String(failed).padStart(11)} | ${String(t429).padStart(3)} | ${String(dead).padStart(12)}`);
  }
  console.log("(failed включает стабильные 403 — смотри тренд, не абсолют)\n");

  console.log("═══ 2. Монитор сбоев экспорта (стрики N подряд) ═══");
  try {
    const raw = await getRuntimeFlag("fit_ingest_failure_streaks");
    const streaks = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const hot = Object.entries(streaks).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
    console.log(`учеников со стриком ≥3: ${hot.length}${hot.length ? " → " + hot.map(([k, n]) => `${k}(${n})`).join(", ") : " (никого)"}`);
    const all = Object.entries(streaks).filter(([, n]) => n > 0);
    console.log(`всего с текущим стриком >0: ${all.length}\n`);
  } catch (e) {
    console.log(`(не смог прочитать app_runtime_flags: ${e instanceof Error ? e.message : String(e)})\n`);
  }

  console.log("═══ 3. Задержка «TP увидел тренировку → карточка в списке» ═══");
  const sb = createSupabaseServerClient();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: jobs } = await sb.from("trainingpeaks_workout_feedback_jobs")
    .select("workout_cache_id, created_at").gte("created_at", since).limit(2000);
  const jobRows = (jobs as Array<{ workout_cache_id: string; created_at: string }>) ?? [];
  const cacheIds = [...new Set(jobRows.map((j) => j.workout_cache_id))];
  const lagMin: number[] = [];
  for (let i = 0; i < cacheIds.length; i += 200) {
    const chunk = cacheIds.slice(i, i + 200);
    const { data: cache } = await sb.from("trainingpeaks_workout_cache")
      .select("id, source_updated_at").in("id", chunk);
    const byId = new Map((cache as Array<{ id: string; source_updated_at: string | null }> ?? []).map((c) => [c.id, c.source_updated_at]));
    for (const j of jobRows) {
      const su = byId.get(j.workout_cache_id);
      if (!su) continue;
      const lag = (new Date(j.created_at).getTime() - new Date(su).getTime()) / 60000;
      if (lag >= 0 && lag < 60 * 24 * 14) lagMin.push(lag);
    }
  }
  lagMin.sort((a, b) => a - b);
  const pct = (p: number) => (lagMin.length ? lagMin[Math.floor((lagMin.length - 1) * p)]! : NaN);
  console.log(`заэнкьюжено за 24ч: ${jobRows.length}, с валидной задержкой: ${lagMin.length}`);
  if (lagMin.length) {
    console.log(`задержка мин: median=${pct(0.5).toFixed(0)}  p90=${pct(0.9).toFixed(0)}  max=${lagMin[lagMin.length - 1]!.toFixed(0)}`);
    console.log("(это НАШ конвейер: TP-lastModified → карточка. Синк часов→TP сверх этого, вне нас.)");
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
