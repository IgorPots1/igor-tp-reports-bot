/**
 * tp-taper-check — есть ли у Игоря подводка перед стартом. READ-ONLY.
 *
 * ЗАЧЕМ. Замер 11.08 дал «подводки нет»: недели −1..−4 перед стартом оказались НЕ НИЖЕ
 * обычной недели атлета (×1.03–×1.06) на всех дистанциях, кроме марафона. Наряд 11.08
 * потребовал проверить две версии этого результата:
 *   (а) в объём недели −1 попадал сам забег и маскировал снижение;
 *   (б) главные старты подводятся, а проходные нет, и смесь их усредняет.
 *
 * РЕЗУЛЬТАТ ПРОВЕРКИ:
 *   (а) НЕ ПОДТВЕРДИЛАСЬ и не могла: забег лежит в неделе 0, а мерятся недели −1..−4,
 *       то есть до недели старта. Исключение дня забега меняет таблицу на 0.01 в одной
 *       ячейке из двадцати.
 *   (б) ПОДТВЕРДИЛАСЬ. Главные старты (≥8 недель подряд с планом до старта И самая
 *       длинная дистанция атлета за год) идут с пиком на −3/−2 и снижением на −1;
 *       проходные не подводятся вовсе.
 *
 * ВАЖНО ПРО ЗНАМЕНАТЕЛЬ. Сравнение идёт с ОБЫЧНОЙ неделей атлета (медиана его недель вне
 * ±5 недель от старта). Подводка при этом видна не как «ниже обычного», а как «ниже
 * собственного предстартового пика» — и читать таблицу надо именно так.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-taper-check.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { mondayOf } from "./lib/autoplanner-context.ts";
import { loadRoster } from "./lib/autoplanner-roster.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

const addDays = (s: string, n: number): string => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
const srt = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
function pct(s: number[], p: number): number {
  if (!s.length) return NaN;
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const med = (xs: number[]): number => pct(srt(xs), 0.5);

/** «Главный» старт: перед ним не меньше стольких недель подряд с планом. */
const MAIN_RACE_MIN_STREAK = 8;
const DIST_KEYS = ["5 км", "10 км", "21.1 км", "42.2 км", "не указана"] as const;
type DistKey = typeof DIST_KEYS[number];
const distKey = (km: number | null): DistKey =>
  km == null ? "не указана" : km < 7 ? "5 км" : km < 15 ? "10 км" : km < 30 ? "21.1 км" : "42.2 км";

type Race = { trainingpeaks_athlete_id: number; event_date: string; distance_km: number | null };

async function main(): Promise<void> {
  const sb = sbc();
  const roster = await loadRoster(sb);
  const today = new Date().toISOString().slice(0, 10);
  const since = addDays(today, -365);

  type Row = { trainingpeaks_athlete_id: number; workout_date: string; planned_time_raw: number | null };
  const allRows: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, workout_date, planned_time_raw")
      .eq("workout_type_value_id", 3).eq("is_planned", true).gte("workout_date", since).order("workout_date").range(f, f + 999);
    if (error) throw error;
    allRows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  const rows = allRows.filter((r) => roster.active.has(r.trainingpeaks_athlete_id));

  const allRaces: Race[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_race_events")
      .select("trainingpeaks_athlete_id, event_date, distance_km").range(f, f + 999);
    if (error) throw error;
    allRaces.push(...((data ?? []) as unknown as Race[]));
    if (!data || data.length < 1000) break;
  }
  const races = allRaces.filter((r) => roster.active.has(r.trainingpeaks_athlete_id)
    && r.event_date && r.event_date < today && r.event_date >= since);

  // Недельные плановые минуты. День самого забега исключаем: проверка версии (а) наряда.
  const raceDates = new Map<number, Set<string>>();
  for (const r of races) (raceDates.get(r.trainingpeaks_athlete_id) ?? raceDates.set(r.trainingpeaks_athlete_id, new Set()).get(r.trainingpeaks_athlete_id)!).add(r.event_date);

  const weeks = new Map<number, Map<string, number>>();
  for (const r of rows) {
    const min = Math.round((r.planned_time_raw ?? 0) * 60);
    if (min <= 0 || min > 300) continue;
    if (raceDates.get(r.trainingpeaks_athlete_id)?.has(r.workout_date)) continue;
    const wk = mondayOf(r.workout_date);
    const M = weeks.get(r.trainingpeaks_athlete_id) ?? weeks.set(r.trainingpeaks_athlete_id, new Map()).get(r.trainingpeaks_athlete_id)!;
    M.set(wk, (M.get(wk) ?? 0) + min);
  }

  const longestOf = new Map<number, number>();
  for (const r of races) longestOf.set(r.trainingpeaks_athlete_id, Math.max(longestOf.get(r.trainingpeaks_athlete_id) ?? 0, r.distance_km ?? 0));

  const isMain = (M: Map<string, number>, r: Race): boolean => {
    const raceWk = mondayOf(r.event_date);
    let streak = 0;
    for (let n = 1; n <= 10; n++) { const v = M.get(addDays(raceWk, -7 * n)); if (v && v > 0) streak++; else break; }
    return streak >= MAIN_RACE_MIN_STREAK && (r.distance_km ?? 0) >= (longestOf.get(r.trainingpeaks_athlete_id) ?? 0) - 0.01;
  };

  const baseline = (M: Map<string, number>, raceWk: string): number | null => {
    const v = [...M.entries()].filter(([wk]) => Math.abs((Date.parse(wk) - Date.parse(raceWk)) / (7 * 86400000)) > 5).map(([, x]) => x).filter((x) => x > 0);
    return v.length >= 6 ? med(v) : null;
  };

  const table = (label: string, keep: (M: Map<string, number>, r: Race) => boolean): void => {
    const B: Record<string, Record<number, number[]>> = {};
    for (const k of DIST_KEYS) B[k] = { 1: [], 2: [], 3: [], 4: [] };
    const ALL: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
    let used = 0;
    for (const r of races) {
      const M = weeks.get(r.trainingpeaks_athlete_id); if (!M || !keep(M, r)) continue;
      const raceWk = mondayOf(r.event_date), base = baseline(M, raceWk); if (!base) continue;
      used++;
      for (let n = 1; n <= 4; n++) { const v = M.get(addDays(raceWk, -7 * n)); if (!v || v <= 0) continue; B[distKey(r.distance_km)][n].push(v / base); ALL[n].push(v / base); }
    }
    const f = (a: number[]): string => (a.length ? `×${med(a).toFixed(2)} (${a.length})` : "—");
    // Подводка видна как падение от СОБСТВЕННОГО предстартового пика, а не от обычной недели.
    const drop = (b: Record<number, number[]>): string => {
      const peak = Math.max(...[4, 3, 2].map((n) => (b[n].length ? med(b[n]) : 0)));
      const last = b[1].length ? med(b[1]) : NaN;
      return Number.isFinite(last) && peak > 0 ? `${Math.round(100 * (last / peak - 1))}%` : "—";
    };
    console.log(`\n${label} · стартов в расчёте ${used}`);
    console.log(`  ${"дистанция".padEnd(14)}${"нед −4".padEnd(14)}${"нед −3".padEnd(14)}${"нед −2".padEnd(14)}${"нед −1".padEnd(14)}от пика`);
    for (const k of DIST_KEYS) {
      if (!B[k][1].length && !B[k][2].length) continue;
      console.log(`  ${k.padEnd(14)}${f(B[k][4]).padEnd(14)}${f(B[k][3]).padEnd(14)}${f(B[k][2]).padEnd(14)}${f(B[k][1]).padEnd(14)}${drop(B[k])}`);
    }
    console.log(`  ${"ВСЕ".padEnd(14)}${f(ALL[4]).padEnd(14)}${f(ALL[3]).padEnd(14)}${f(ALL[2]).padEnd(14)}${f(ALL[1]).padEnd(14)}${drop(ALL)}`);
  };

  console.log(`ПОДВОДКА · действующих ${roster.active.size} · завершённых стартов за год ${races.length}`);
  console.log(`объём недели относительно ОБЫЧНОЙ недели атлета; «от пика» — падение недели −1 к лучшей из −4…−2`);
  table("ВСЕ СТАРТЫ", () => true);
  table(`ГЛАВНЫЕ (≥${MAIN_RACE_MIN_STREAK} нед подряд с планом И самая длинная дистанция года)`, (M, r) => isMain(M, r));
  table("ПРОХОДНЫЕ", (M, r) => !isMain(M, r));
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
