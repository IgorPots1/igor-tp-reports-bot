/**
 * tp-week-shape-measure — параметры формы недели ИЗ ПРАКТИКИ, а не из головы. READ-ONLY.
 *
 * ЗАЧЕМ. Пол лёгкого 20 мин, надбавка длительной +20 мин и порог падения объёма 0.6 были
 * УГАДАНЫ. Пол лёгкого вместе с аддитивной надбавкой делали трёхдневную неделю дороже 80 мин,
 * из-за чего у малообъёмных выбивался третий день, а вместе с ним качество (недель с качеством
 * стало вдвое меньше). Прежде чем чинить, надо посмотреть, что тренер пишет на самом деле.
 *
 * Источник — только coach_authored: описания и плановые длительности живут на is_planned=true
 * (проверено: из 1345 неплановых беговых ни одна не несёт диапазона темпа).
 * ЕДИНИЦЫ: planned_time_raw в ЧАСАХ.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-week-shape-measure.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { INTERVAL_TITLE_RE, CONTROL_MODE_EASY_RE, isEasyRunTitle, tierOf, type Tier } from "./lib/easy-anchor.ts";
import { mondayOf } from "./lib/autoplanner-context.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

const WEEKS_BACK = 26;
/** Явно длительная — так тренер их и называет. Не «самый длинный бег недели». */
const LONG_TITLE_RE = /длительн|длинн/i;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : "—");
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : "—");

type Row = { trainingpeaks_athlete_id: number; workout_date: string; title: string | null; planned_time_raw: number | null };

async function pull(sb: SupabaseClient, sinceDays: number): Promise<Row[]> {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const out: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, workout_date, title, planned_time_raw")
      .eq("workout_type_value_id", 3).eq("is_planned", true)
      .gte("workout_date", since).order("workout_date").range(f, f + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Sess = { min: number; title: string; easy: boolean; quality: boolean; long: boolean };

function classify(r: Row): Sess | null {
  const min = Math.round((r.planned_time_raw ?? 0) * 60);
  if (min <= 0 || min > 300) return null;
  const t = r.title ?? "";
  const quality = INTERVAL_TITLE_RE.test(t);
  const easy = !quality && (isEasyRunTitle(t) || CONTROL_MODE_EASY_RE.test(t));
  return { min, title: t, easy, quality, long: !quality && LONG_TITLE_RE.test(t) };
}

async function main(): Promise<void> {
  const sb = sbc();
  const rows = await pull(sb, WEEKS_BACK * 7);

  // athlete → week → сессии
  const byAth = new Map<number, Map<string, Sess[]>>();
  for (const r of rows) {
    const s = classify(r);
    if (!s) continue;
    const wk = mondayOf(r.workout_date);
    const weeks = byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, new Map()).get(r.trainingpeaks_athlete_id)!;
    (weeks.get(wk) ?? weeks.set(wk, []).get(wk)!).push(s);
  }

  // Тир атлета — по МЕДИАННОМУ плановому объёму недели за окно (стабильнее, чем по одной неделе).
  const tierOfAth = new Map<number, Tier>();
  const medWeeklyOfAth = new Map<number, number>();
  for (const [aid, weeks] of byAth) {
    const totals = [...weeks.values()].map((ss) => ss.reduce((a, x) => a + x.min, 0)).filter((x) => x > 0).sort((a, b) => a - b);
    if (totals.length === 0) continue;
    const med = pct(totals, 0.5);
    medWeeklyOfAth.set(aid, med);
    tierOfAth.set(aid, tierOf(med));
  }

  const TIERS: Tier[] = ["T1", "T2", "T3"];
  const shortestEasy: Record<Tier, number[]> = { T1: [], T2: [], T3: [] };
  const longRatio: Record<Tier, number[]> = { T1: [], T2: [], T3: [] };
  const longDelta: Record<Tier, number[]> = { T1: [], T2: [], T3: [] };
  const qualityFull: Record<Tier, number[]> = { T1: [], T2: [], T3: [] };
  const daysLowVol: number[] = [];
  const weeklyLowVol: number[] = [];
  let weeksSeen = 0;

  for (const [aid, weeks] of byAth) {
    const tier = tierOfAth.get(aid); if (!tier) continue;
    const lowVol = (medWeeklyOfAth.get(aid) ?? 0) < 90;
    for (const [, ss] of weeks) {
      const total = ss.reduce((a, x) => a + x.min, 0);
      if (total <= 0) continue;
      weeksSeen++;
      const easies = ss.filter((x) => x.easy && !x.long);
      const longs = ss.filter((x) => x.long);
      if (easies.length > 0) shortestEasy[tier].push(Math.min(...easies.map((x) => x.min)));
      if (longs.length > 0 && easies.length > 0) {
        const L = Math.max(...longs.map((x) => x.min));
        const E = Math.max(...easies.map((x) => x.min));
        if (E > 0) { longRatio[tier].push(L / E); longDelta[tier].push(L - E); }
      }
      for (const q of ss.filter((x) => x.quality)) qualityFull[tier].push(q.min);
      if (lowVol) { daysLowVol.push(ss.length); weeklyLowVol.push(total); }
    }
  }

  const line = (label: string, xs: number[], fmt: (n: number) => string): string => {
    const s = [...xs].sort((a, b) => a - b);
    return `${label.padEnd(6)} n=${String(s.length).padStart(5)}  p05 ${fmt(pct(s, 0.05)).padStart(6)}  p10 ${fmt(pct(s, 0.10)).padStart(6)}`
      + `  p25 ${fmt(pct(s, 0.25)).padStart(6)}  медиана ${fmt(pct(s, 0.5)).padStart(6)}  p75 ${fmt(pct(s, 0.75)).padStart(6)}  max ${fmt(s[s.length - 1] ?? NaN).padStart(6)}`;
  };

  console.log(`ИЗМЕРЕНИЕ ФОРМЫ НЕДЕЛИ ПО ПРАКТИКЕ · окно ${WEEKS_BACK} недель · только coach_authored (is_planned)`);
  console.log(`плановых беговых записей ${rows.length} · атлетов ${byAth.size} · атлето-недель ${weeksSeen}`);
  console.log(`тир по МЕДИАННОМУ плановому объёму недели: T1 <120, T2 <240, T3 >=240 мин`);
  const byTierCount = TIERS.map((t) => `${t} ${[...tierOfAth.values()].filter((x) => x === t).length}`).join(" · ");
  console.log(`атлетов по тирам: ${byTierCount}`);

  console.log(`\n═══ А. САМАЯ КОРОТКАЯ ЛЁГКАЯ ПРОБЕЖКА НЕДЕЛИ, мин (настоящий пол лёгкого) ═══`);
  for (const t of TIERS) console.log(line(t, shortestEasy[t], f1));

  console.log(`\n═══ Б. ДЛИТЕЛЬНАЯ / САМЫЙ ДЛИННЫЙ ЛЁГКИЙ ТОЙ ЖЕ НЕДЕЛИ ═══`);
  console.log(`кратно:`);
  for (const t of TIERS) console.log(line(t, longRatio[t], f2));
  console.log(`абсолютно, мин:`);
  for (const t of TIERS) console.log(line(t, longDelta[t], f1));

  console.log(`\n═══ В. МАЛООБЪЁМНЫЕ (медианный плановый объём < 90 мин): сколько беговых дней ═══`);
  const dsorted = [...daysLowVol].sort((a, b) => a - b);
  console.log(line("дней", daysLowVol, f1));
  console.log(line("объём", weeklyLowVol, f1));
  const hist = new Map<number, number>();
  for (const d of daysLowVol) hist.set(d, (hist.get(d) ?? 0) + 1);
  console.log(`  распределение дней: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}д×${v}`).join(" ")}`);
  console.log(`  доля недель с >=3 днями: ${dsorted.length ? Math.round(100 * dsorted.filter((x) => x >= 3).length / dsorted.length) : 0}%`);

  console.log(`\n═══ Г. ПОЛНАЯ ДЛИТЕЛЬНОСТЬ КАЧЕСТВЕННОЙ СЕССИИ, мин ═══`);
  for (const t of TIERS) console.log(line(t, qualityFull[t], f1));

  // Правило «длительная — самая длинная сессия недели» задано на глаз. Проверяем его прямо:
  // в неделях, где есть И длительная, И качественная, длиннее ли длительная.
  console.log(`\n═══ Е. ДЛИТЕЛЬНАЯ ПРОТИВ КАЧЕСТВЕННОЙ В ТОЙ ЖЕ НЕДЕЛЕ ═══`);
  for (const t of TIERS) {
    let both = 0, longWins = 0, tie = 0;
    const ratios: number[] = [];
    for (const [aid, weeks] of byAth) {
      if (tierOfAth.get(aid) !== t) continue;
      for (const [, ss] of weeks) {
        const longs = ss.filter((x) => x.long), quals = ss.filter((x) => x.quality);
        if (!longs.length || !quals.length) continue;
        const L = Math.max(...longs.map((x) => x.min)), Q = Math.max(...quals.map((x) => x.min));
        both++; if (L > Q) longWins++; else if (L === Q) tie++;
        ratios.push(L / Q);
      }
    }
    const rs = ratios.sort((a, b) => a - b);
    console.log(`${t.padEnd(6)} недель с обеими n=${String(both).padStart(4)} · длительная длиннее ${both ? Math.round(100 * longWins / both) : 0}%`
      + ` · поровну ${both ? Math.round(100 * tie / both) : 0}% · длительная/качественная медиана ${f2(pct(rs, 0.5))} p10 ${f2(pct(rs, 0.10))}`);
  }

  // Проверка гипотезы: аддитивная надбавка или кратная? Смотрим, как дельта растёт с объёмом.
  console.log(`\n═══ Д. АДДИТИВНАЯ ИЛИ КРАТНАЯ: дельта и кратность по корзинам объёма лёгкого ═══`);
  const buckets: Array<[string, number, number]> = [["<25", 0, 25], ["25–39", 25, 40], ["40–59", 40, 60], ["60–89", 60, 90], [">=90", 90, 1e9]];
  const pairs: Array<{ e: number; l: number }> = [];
  for (const [aid, weeks] of byAth) {
    if (!tierOfAth.get(aid)) continue;
    for (const [, ss] of weeks) {
      const easies = ss.filter((x) => x.easy && !x.long);
      const longs = ss.filter((x) => x.long);
      if (!easies.length || !longs.length) continue;
      pairs.push({ e: Math.max(...easies.map((x) => x.min)), l: Math.max(...longs.map((x) => x.min)) });
    }
  }
  for (const [label, lo, hi] of buckets) {
    const inB = pairs.filter((p) => p.e >= lo && p.e < hi);
    if (!inB.length) { console.log(`  лёгкий ${label.padEnd(6)} n=0`); continue; }
    const d = [...inB.map((p) => p.l - p.e)].sort((a, b) => a - b);
    const r = [...inB.map((p) => p.l / p.e)].sort((a, b) => a - b);
    console.log(`  лёгкий ${label.padEnd(6)} n=${String(inB.length).padStart(4)}  дельта медиана ${f1(pct(d, 0.5)).padStart(6)} p10 ${f1(pct(d, 0.10)).padStart(6)}`
      + `   ·  кратность медиана ${f2(pct(r, 0.5))} p10 ${f2(pct(r, 0.10))}`);
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
