/**
 * tp-heuristics-measure — девять оставшихся эвристик ПО ПРАКТИКЕ ИГОРЯ. READ-ONLY.
 *
 * ЗАЧЕМ. tp-week-shape-measure померил форму недели (полы, кратности, дни). Остались девять
 * констант, которые до сих пор УГАДАНЫ: шаг роста недели, порог падения тира, пороги потолка
 * качества, доля работы в неделе, шаг прогрессии, минимум недель для конверта, порог низкого
 * выполнения, минимальный вес якоря качества, ширина полосы лёгкого.
 *
 * ПРАВИЛО ЗАМЕРА (наряд 16.08): значение берётся ТОЛЬКО из практики. Подгонка под метрику
 * совпадения запрещена — это порча системы, даже если цифра вырастет.
 *
 * ТИП КОНСТАНТЫ ОПРЕДЕЛЯЕТ, КАКУЮ СТАТИСТИКУ БРАТЬ:
 *   ПОТОЛОК (шаг роста, доля работы, ширина полосы, шаг прогрессии) → ВЕРХНИЙ хвост практики.
 *   ПОЛ/ГЕЙТ (пороги качества, минимум недель)                     → НИЖНИЙ край (инвариант).
 *   ПОРОГ СОБЫТИЯ (падение тира, низкое выполнение)                → там, где практика ломается.
 *
 * Источник — coach_authored (is_planned=true). ЕДИНИЦЫ: planned_time_raw и completed_time_raw
 * в ЧАСАХ.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-heuristics-measure.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { INTERVAL_TITLE_RE, CONTROL_MODE_EASY_RE, isEasyRunTitle, extractEasySample, tierOf, type Tier } from "./lib/easy-anchor.ts";
import { extractQualitySample } from "./lib/quality-anchor.ts";
import { mondayOf } from "./lib/autoplanner-context.ts";
import { loadRoster, rosterSummary } from "./lib/autoplanner-roster.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

const WEEKS_BACK = 26;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : "—");
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : "—");
const srt = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

/** Верхний хвост — для констант-ПОТОЛКОВ. */
function upper(label: string, xs: number[], fmt: (n: number) => string): string {
  const s = srt(xs);
  return `${label.padEnd(22)} n=${String(s.length).padStart(5)}  медиана ${fmt(pct(s, 0.5)).padStart(6)}  p75 ${fmt(pct(s, 0.75)).padStart(6)}`
    + `  p90 ${fmt(pct(s, 0.90)).padStart(6)}  p95 ${fmt(pct(s, 0.95)).padStart(6)}  p99 ${fmt(pct(s, 0.99)).padStart(6)}  max ${fmt(s[s.length - 1] ?? NaN).padStart(6)}`;
}
/** Нижний край — для констант-ПОЛОВ и гейтов. */
function lower(label: string, xs: number[], fmt: (n: number) => string): string {
  const s = srt(xs);
  return `${label.padEnd(22)} n=${String(s.length).padStart(5)}  min ${fmt(s[0] ?? NaN).padStart(6)}  p01 ${fmt(pct(s, 0.01)).padStart(6)}  p05 ${fmt(pct(s, 0.05)).padStart(6)}`
    + `  p10 ${fmt(pct(s, 0.10)).padStart(6)}  p25 ${fmt(pct(s, 0.25)).padStart(6)}  медиана ${fmt(pct(s, 0.5)).padStart(6)}`;
}

type Row = {
  trainingpeaks_athlete_id: number; workout_date: string; title: string | null;
  planned_time_raw: number | null; completed_time_raw: number | null;
  is_planned: boolean | null; is_completed: boolean | null; description: string | null;
};

async function pull(sb: SupabaseClient, sinceDays: number): Promise<Row[]> {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const out: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, workout_date, title, planned_time_raw, completed_time_raw, is_planned, is_completed, description:source_snapshot->>description")
      .eq("workout_type_value_id", 3).gte("workout_date", since).order("workout_date").range(f, f + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const isQuality = (t: string): boolean => INTERVAL_TITLE_RE.test(t);
const isEasy = (t: string): boolean => !isQuality(t) && (isEasyRunTitle(t) || CONTROL_MODE_EASY_RE.test(t));

/** соседние ли понедельники (ровно 7 дней) — иначе это не «неделя к неделе» */
function isNextWeek(prev: string, cur: string): boolean {
  return Math.round((Date.parse(cur) - Date.parse(prev)) / 86400000) === 7;
}

async function main(): Promise<void> {
  const sb = sbc();
  // ЗАМЕР ИДЁТ ТОЛЬКО ПО ДЕЙСТВУЮЩИМ. Этот скрипт читает кэш напрямую, мимо
  // loadAthleteContexts, поэтому фильтр зовём здесь явно — иначе константы считаются
  // в том числе по ушедшим ученикам и по служебному аккаунту тренера.
  const roster = await loadRoster(sb);
  const rowsAll = await pull(sb, WEEKS_BACK * 7);
  const rows = rowsAll.filter((r) => roster.active.has(r.trainingpeaks_athlete_id));
  console.log(rosterSummary(roster));
  console.log(`беговых записей до фильтра ${rowsAll.length} → после ${rows.length}`);

  // ── раскладка: атлет → неделя → {план, факт, качественные, все сессии} ──
  type Wk = { plan: number; fact: number; quality: Array<{ date: string; work: number | null }>; sessions: number };
  const byAth = new Map<number, Map<string, Wk>>();
  const easyBands: number[] = [];
  const qualitySamples = new Map<number, Array<{ date: string; fast: number; slow: number; work: number }>>();

  for (const r of rows) {
    const wk = mondayOf(r.workout_date);
    const weeks = byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, new Map()).get(r.trainingpeaks_athlete_id)!;
    const w = weeks.get(wk) ?? weeks.set(wk, { plan: 0, fact: 0, quality: [], sessions: 0 }).get(wk)!;
    const t = r.title ?? "", d = r.description ?? "";

    if (r.is_planned === true) {
      const min = Math.round((r.planned_time_raw ?? 0) * 60);
      if (min > 0 && min <= 300) { w.plan += min; w.sessions++; }
      if (isQuality(t)) {
        const q = extractQualitySample(t, d);
        w.quality.push({ date: r.workout_date, work: q ? q.workMinutes * q.reps : null });
        if (q) {
          const arr = qualitySamples.get(r.trainingpeaks_athlete_id) ?? qualitySamples.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!;
          arr.push({ date: r.workout_date, fast: q.fast, slow: q.slow, work: q.workMinutes * q.reps });
        }
      }
      // И. ширина полосы лёгкого — как её пишет тренер
      if (isEasy(t)) {
        const e = extractEasySample(t, d);
        if (e && !e.ceilingOnly) easyBands.push(e.slow - e.fast);
      }
    }
    const fmin = Math.round((r.completed_time_raw ?? 0) * 60);
    if (fmin > 0 && fmin <= 300) w.fact += fmin;
  }

  // тир по медианному ПЛАНОВОМУ объёму (та же валюта, что у конверта)
  const tierOfAth = new Map<number, Tier>();
  for (const [aid, weeks] of byAth) {
    const totals = srt([...weeks.values()].map((w) => w.plan).filter((x) => x > 0));
    if (totals.length === 0) continue;
    tierOfAth.set(aid, tierOf(pct(totals, 0.5)));
  }
  const TIERS: Tier[] = ["T1", "T2", "T3"];

  console.log(`ЗАМЕР ДЕВЯТИ ЭВРИСТИК ПО ПРАКТИКЕ · окно ${WEEKS_BACK} нед · источник coach_authored`);
  console.log(`беговых записей ${rows.length} · атлетов ${byAth.size} · тиры: ${TIERS.map((t) => `${t} ${[...tierOfAth.values()].filter((x) => x === t).length}`).join(" · ")}`);

  // ═══ A. WEEKLY_GROWTH_MAX — ГЛАВНЫЙ ПОДОЗРЕВАЕМЫЙ ═══
  // Это ПОТОЛОК роста: сколько тренер СЕБЕ ПОЗВОЛЯЕТ прибавить от плана к плану.
  // Мерить надо верхний хвост, а не медиану: медиана роста ≈ 1.0 (неделя к неделе ровная).
  console.log(`\n═══ A. ШАГ РОСТА НЕДЕЛИ: план[N] / план[N−1] (константа WEEKLY_GROWTH_MAX = 1.10) ═══`);
  const growth: Record<Tier, number[]> = { T1: [], T2: [], T3: [] };
  const growthNew: number[] = [], growthEstab: number[] = [];
  const growthAll: number[] = [];
  for (const [aid, weeks] of byAth) {
    const tier = tierOfAth.get(aid); if (!tier) continue;
    const ks = [...weeks.keys()].sort();
    const firstWeek = ks.find((k) => (weeks.get(k)!.plan) > 0);
    for (let i = 1; i < ks.length; i++) {
      const a = weeks.get(ks[i - 1])!, b = weeks.get(ks[i])!;
      if (!isNextWeek(ks[i - 1], ks[i]) || a.plan <= 0 || b.plan <= 0) continue;
      const g = b.plan / a.plan;
      if (g > 5) continue; // возврат из простоя, не «рост»
      growth[tier].push(g); growthAll.push(g);
      // «новый» — первые 8 недель наблюдения (гипотеза наряда: новых разбегают быстрее)
      const ageWeeks = firstWeek ? Math.round((Date.parse(ks[i]) - Date.parse(firstWeek)) / (7 * 86400000)) : 99;
      (ageWeeks <= 8 ? growthNew : growthEstab).push(g);
    }
  }
  for (const t of TIERS) console.log(upper(t, growth[t], f2));
  console.log(upper("ВСЕ", growthAll, f2));
  console.log(upper("новые (первые 8 нед)", growthNew, f2));
  console.log(upper("устоявшиеся", growthEstab, f2));
  const shareOver = (xs: number[], k: number): string => `${xs.length ? Math.round(100 * xs.filter((x) => x > k).length / xs.length) : 0}%`;
  console.log(`  доля переходов выше 1.10: ВСЕ ${shareOver(growthAll, 1.10)} · новые ${shareOver(growthNew, 1.10)} · устоявшиеся ${shareOver(growthEstab, 1.10)}`);
  console.log(`  доля выше 1.25: ${shareOver(growthAll, 1.25)} · выше 1.50: ${shareOver(growthAll, 1.50)}`);
  for (const t of TIERS) console.log(`  ${t}: доля выше 1.10 ${shareOver(growth[t], 1.10)} · выше 1.25 ${shareOver(growth[t], 1.25)}`);

  // A2. СЫРОЙ ЗАМЕР ВЫШЕ ЗАГРЯЗНЁН: неделя после провала (болезнь, отпуск, недописанный план)
  // даёт кратность 3–5, и это НЕ прогрессия, а ВОЗВРАТ К НОРМЕ. Смешивать их нельзя: потолок
  // роста работает ровно в тот момент, когда прошлая неделя была маленькой.
  // Делим по состоянию БАЗОВОЙ недели относительно обычного планового объёма атлета.
  console.log(`\n─── A2. ТОТ ЖЕ ШАГ РОСТА, НО ОТДЕЛЬНО ОТ НОРМАЛЬНОЙ БАЗЫ И ОТ ПРОВАЛА ───`);
  const fromNormal: Record<Tier, number[]> = { T1: [], T2: [], T3: [] };
  const fromDip: number[] = [], fromNormalAll: number[] = [];
  const fromNormalNew: number[] = [], fromNormalEstab: number[] = [];
  for (const [aid, weeks] of byAth) {
    const tier = tierOfAth.get(aid); if (!tier) continue;
    const medPlan = pct(srt([...weeks.values()].map((w) => w.plan).filter((x) => x > 0)), 0.5);
    if (!(medPlan > 0)) continue;
    const ks = [...weeks.keys()].sort();
    const firstWeek = ks.find((k) => weeks.get(k)!.plan > 0);
    for (let i = 1; i < ks.length; i++) {
      const a = weeks.get(ks[i - 1])!, b = weeks.get(ks[i])!;
      if (!isNextWeek(ks[i - 1], ks[i]) || a.plan <= 0 || b.plan <= 0) continue;
      const g = b.plan / a.plan;
      if (g > 5) continue;
      // «нормальная база» — прошлая неделя не была провалом и не была огрызком плана
      if (a.plan >= medPlan * 0.7 && a.sessions >= 3) {
        fromNormal[tier].push(g); fromNormalAll.push(g);
        const ageWeeks = firstWeek ? Math.round((Date.parse(ks[i]) - Date.parse(firstWeek)) / (7 * 86400000)) : 99;
        (ageWeeks <= 8 ? fromNormalNew : fromNormalEstab).push(g);
      } else fromDip.push(g);
    }
  }
  for (const t of TIERS) console.log(upper(`${t} от нормы`, fromNormal[t], f2));
  console.log(upper("ВСЕ от нормы", fromNormalAll, f2));
  console.log(upper("новые от нормы", fromNormalNew, f2));
  console.log(upper("устоявшиеся от нормы", fromNormalEstab, f2));
  console.log(upper("ВОЗВРАТ ИЗ ПРОВАЛА", fromDip, f2));
  console.log(`  от нормы: доля выше 1.10 ${shareOver(fromNormalAll, 1.10)} · выше 1.25 ${shareOver(fromNormalAll, 1.25)}`);
  console.log(`  из провала: доля выше 1.10 ${shareOver(fromDip, 1.10)} · выше 1.50 ${shareOver(fromDip, 1.50)} · медиана ${f2(pct(srt(fromDip), 0.5))}`);

  // ═══ Б. TIER_DROP_VOLUME_RATIO ═══
  // Прямых меток тира в данных нет. Мерим ПОВЕДЕНИЕ ТРЕНЕРА: после недели, где ФАКТ провалился
  // до доли r от скользящего среднего факта, насколько он режет ПЛАН следующей недели.
  console.log(`\n═══ Б. ПАДЕНИЕ ОБЪЁМА → РЕАКЦИЯ ТРЕНЕРА (константа TIER_DROP_VOLUME_RATIO = 0.6) ═══`);
  const dropBuckets: Array<[string, number, number]> = [["<0.3", 0, 0.3], ["0.3–0.5", 0.3, 0.5], ["0.5–0.7", 0.5, 0.7], ["0.7–0.9", 0.7, 0.9], [">=0.9", 0.9, 99]];
  const dropRows: Array<{ r: number; nextPlanRatio: number }> = [];
  for (const [, weeks] of byAth) {
    const ks = [...weeks.keys()].sort();
    for (let i = 4; i < ks.length; i++) {
      const prior = ks.slice(Math.max(0, i - 5), i - 1).map((k) => weeks.get(k)!.fact).filter((x) => x > 0);
      if (prior.length < 3) continue;
      const rollFact = prior.reduce((a, b) => a + b, 0) / prior.length;
      const lastFact = weeks.get(ks[i - 1])!.fact;
      const nextPlan = weeks.get(ks[i])!.plan;
      const priorPlan = srt(ks.slice(Math.max(0, i - 5), i).map((k) => weeks.get(k)!.plan).filter((x) => x > 0));
      if (rollFact <= 0 || nextPlan <= 0 || priorPlan.length < 3) continue;
      dropRows.push({ r: lastFact / rollFact, nextPlanRatio: nextPlan / pct(priorPlan, 0.5) });
    }
  }
  for (const [label, lo, hi] of dropBuckets) {
    const inB = dropRows.filter((x) => x.r >= lo && x.r < hi);
    const rs = srt(inB.map((x) => x.nextPlanRatio));
    console.log(`  факт/среднее ${label.padEnd(8)} n=${String(inB.length).padStart(4)}  план след. недели / обычный план: медиана ${f2(pct(rs, 0.5))} · p25 ${f2(pct(rs, 0.25))} · доля с урезкой >20%: ${rs.length ? Math.round(100 * rs.filter((x) => x < 0.8).length / rs.length) : 0}%`);
  }

  // ═══ В. QUALITY_CAP_THRESHOLDS ═══
  // ГЕЙТ: сколько качественных за 8 недель тренер УЖЕ имел, когда ставил 1-ю / 2-ю в неделю.
  // Берём НИЖНИЙ край: гейт — это «ниже НЕ БЫВАЕТ», а не «обычно бывает».
  console.log(`\n═══ В. ИСТОРИЯ КАЧЕСТВА ПЕРЕД НЕДЕЛЕЙ С 1 И 2 КАЧЕСТВЕННЫМИ (константа 3 / 6 за 8 нед) ═══`);
  // ЛЕВАЯ ЦЕНЗУРА: у атлета, чьи данные начинаются в середине окна, «история за 8 недель»
  // выйдет нулевой не потому, что тренер не ставил качество, а потому что мы не видим прошлого.
  // Считаем только недели, отстоящие от первой наблюдённой минимум на 8 недель.
  const prior8: Record<number, number[]> = { 0: [], 1: [], 2: [] };
  for (const [, weeks] of byAth) {
    const ks = [...weeks.keys()].sort();
    const first = ks[0];
    for (let i = 0; i < ks.length; i++) {
      const w = weeks.get(ks[i])!;
      if (w.plan <= 0) continue;
      if (Math.round((Date.parse(ks[i]) - Date.parse(first)) / (7 * 86400000)) < 8) continue;
      const from = new Date(Date.parse(ks[i]) - 8 * 7 * 86400000).toISOString().slice(0, 10);
      let cnt = 0;
      for (const k of ks) { if (k >= from && k < ks[i]) cnt += weeks.get(k)!.quality.length; }
      const q = Math.min(2, w.quality.length);
      prior8[q].push(cnt);
    }
  }
  console.log(lower("недель с 0 качеств.", prior8[0], f1));
  console.log(lower("недель с 1 качеств.", prior8[1], f1));
  console.log(lower("недель с 2+ качеств.", prior8[2], f1));
  const shareBelow = (xs: number[], k: number): string => `${xs.length ? Math.round(100 * xs.filter((x) => x < k).length / xs.length) : 0}%`;
  console.log(`  недель с 1 качественной, где история < 3: ${shareBelow(prior8[1], 3)} · с 2+, где история < 6: ${shareBelow(prior8[2], 6)}`);

  // ═══ Г. WORK_SHARE_OF_WEEKLY_MAX ═══
  console.log(`\n═══ Г. ОБЪЁМ РАБОТЫ КАЧЕСТВЕННОЙ / ПЛАНОВЫЙ ОБЪЁМ НЕДЕЛИ (константа 0.22) ═══`);
  const workShare: Record<Tier, number[]> = { T1: [], T2: [], T3: [] };
  const workShareAll: number[] = [];
  for (const [aid, weeks] of byAth) {
    const tier = tierOfAth.get(aid); if (!tier) continue;
    for (const [, w] of weeks) {
      if (w.plan <= 0) continue;
      for (const q of w.quality) { if (q.work != null && q.work > 0) { workShare[tier].push(q.work / w.plan); workShareAll.push(q.work / w.plan); } }
    }
  }
  for (const t of TIERS) console.log(upper(t, workShare[t], f2));
  console.log(upper("ВСЕ", workShareAll, f2));
  console.log(`  доля сессий выше 0.22: ${shareOver(workShareAll, 0.22)}`);

  // ═══ Д. PROGRESSION_STEP_MAX ═══
  console.log(`\n═══ Д. ШАГ ПРОГРЕССИИ: работа[N] / работа[N−1] у соседних качественных (константа 1.20) ═══`);
  const step: Record<Tier, number[]> = { T1: [], T2: [], T3: [] };
  const stepAll: number[] = [];
  for (const [aid, arr] of qualitySamples) {
    const tier = tierOfAth.get(aid); if (!tier) continue;
    const xs = [...arr].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < xs.length; i++) {
      const gap = Math.round((Date.parse(xs[i].date) - Date.parse(xs[i - 1].date)) / 86400000);
      if (gap <= 0 || gap > 21) continue; // разрыв больше трёх недель — это уже не «шаг»
      if (xs[i - 1].work <= 0) continue;
      const s = xs[i].work / xs[i - 1].work;
      if (s > 5) continue;
      step[tier].push(s); stepAll.push(s);
    }
  }
  for (const t of TIERS) console.log(upper(t, step[t], f2));
  console.log(upper("ВСЕ", stepAll, f2));
  console.log(`  доля шагов выше 1.20: ${shareOver(stepAll, 1.20)} · выше 1.50: ${shareOver(stepAll, 1.50)} · доля шагов вниз (<1.0): ${shareBelow(stepAll, 1.0)}`);

  // ═══ Е. MIN_WEEKS_FOR_ENVELOPE ═══
  // Сколько недель нужно, чтобы среднее ПЕРЕСТАЛО врать о следующей неделе.
  console.log(`\n═══ Е. ТОЧНОСТЬ КОНВЕРТА ОТ ЧИСЛА НАБЛЮДЁННЫХ НЕДЕЛЬ (константа MIN_WEEKS_FOR_ENVELOPE = 4) ═══`);
  const errByK = new Map<number, number[]>();
  for (const [, weeks] of byAth) {
    const ks = [...weeks.keys()].sort().filter((k) => weeks.get(k)!.plan > 0);
    for (let i = 1; i < ks.length; i++) {
      const actual = weeks.get(ks[i])!.plan;
      for (let k = 1; k <= Math.min(8, i); k++) {
        const win = ks.slice(i - k, i).map((x) => weeks.get(x)!.plan);
        const mean = win.reduce((a, b) => a + b, 0) / win.length;
        if (mean <= 0) continue;
        (errByK.get(k) ?? errByK.set(k, []).get(k)!).push(Math.abs(mean - actual) / actual);
      }
    }
  }
  for (let k = 1; k <= 8; k++) {
    const e = srt(errByK.get(k) ?? []);
    console.log(`  недель в окне ${k}: n=${String(e.length).padStart(5)}  медианная ошибка прогноза ${f2(pct(e, 0.5) * 100)}%  p75 ${f2(pct(e, 0.75) * 100)}%`);
  }

  // ═══ Ж. LOW_COMPLIANCE_RATIO ═══
  console.log(`\n═══ Ж. ВЫПОЛНЕНИЕ: факт недели / план недели (константа LOW_COMPLIANCE_RATIO = 0.70) ═══`);
  const comp: Record<Tier, number[]> = { T1: [], T2: [], T3: [] };
  const compAll: number[] = [];
  const compNonZero: number[] = [];
  let zeroWeeks = 0, planWeeks = 0;
  for (const [aid, weeks] of byAth) {
    const tier = tierOfAth.get(aid); if (!tier) continue;
    for (const [, w] of weeks) {
      if (w.plan <= 0) continue;
      planWeeks++;
      const c = w.fact / w.plan;
      comp[tier].push(c); compAll.push(c);
      if (w.fact > 0) compNonZero.push(c); else zeroWeeks++;
    }
  }
  for (const t of TIERS) console.log(lower(t, comp[t], f2));
  console.log(lower("ВСЕ", compAll, f2));
  // Недели с НУЛЕВЫМ фактом — это либо «человек не бежал вообще», либо дыра синхронизации.
  // Держать их в одном мешке с «пробежал 60% плана» нельзя: они утягивают все нижние перцентили в 0.
  console.log(lower("ВСЕ, факт > 0", compNonZero, f2));
  console.log(`  недель с планом ${planWeeks} · из них факт РОВНО 0: ${zeroWeeks} (${Math.round(100 * zeroWeeks / Math.max(planWeeks, 1))}%)`);
  console.log(`  доля недель ниже 0.70: ${shareBelow(compAll, 0.70)} · ниже 0.40: ${shareBelow(compAll, 0.40)} · медиана ${f2(pct(srt(compAll), 0.5))}`);
  console.log(`  среди недель с фактом > 0: ниже 0.70 ${shareBelow(compNonZero, 0.70)} · ниже 0.40 ${shareBelow(compNonZero, 0.40)}`);

  // Ж2. ГЕЙТ СРАБАТЫВАЕТ НЕ ПО ОДНОЙ НЕДЕЛЕ, А ПО ТРЁМ ПОДРЯД — значит и мерить надо серии.
  // Доля одиночных недель ниже порога говорит не о том, как часто гейт срабатывает.
  console.log(`\n─── Ж2. КАК ЧАСТО НАБИРАЕТСЯ 3 НЕДЕЛИ ПОДРЯД НИЖЕ ПОРОГА ───`);
  for (const thr of [0.4, 0.5, 0.6, 0.7, 0.8]) {
    let hits = 0, total = 0, athHit = 0;
    for (const [aid, weeks] of byAth) {
      if (!tierOfAth.get(aid)) continue;
      const ks = [...weeks.keys()].sort().filter((k) => weeks.get(k)!.plan > 0);
      let run = 0, any = false;
      for (const k of ks) {
        const w = weeks.get(k)!;
        total++;
        if (w.fact / w.plan < thr) { run++; if (run >= 3) { hits++; any = true; } } else run = 0;
      }
      if (any) athHit++;
    }
    console.log(`  порог ${thr.toFixed(2)}: недель под сработавшим гейтом ${hits} из ${total} (${Math.round(100 * hits / Math.max(total, 1))}%) · атлетов задето ${athHit} из ${tierOfAth.size}`);
  }

  // ═══ З. MIN_QUALITY_ANCHOR_EFF_N — как быстро стареет предписание качества ═══
  // Прямо мерим ДРЕЙФ: насколько расходится темп работы у двух качественных, разнесённых на D дней.
  console.log(`\n═══ З. ДРЕЙФ ТЕМПА РАБОТЫ ОТ ВОЗРАСТА ПРЕДПИСАНИЯ (константа MIN_QUALITY_ANCHOR_EFF_N = 0.25 ≈ 6 нед) ═══`);
  const driftBuckets: Array<[string, number, number]> = [["0–14 дн", 0, 15], ["15–28", 15, 29], ["29–42", 29, 43], ["43–56", 43, 57], ["57–84", 57, 85], [">84", 85, 999]];
  const drift: Array<{ d: number; delta: number }> = [];
  for (const [, arr] of qualitySamples) {
    const xs = [...arr].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      const d = Math.round((Date.parse(xs[j].date) - Date.parse(xs[i].date)) / 86400000);
      const mid = (x: { fast: number; slow: number }): number => (x.fast + x.slow) / 2;
      drift.push({ d, delta: Math.abs(mid(xs[j]) - mid(xs[i])) });
    }
  }
  for (const [label, lo, hi] of driftBuckets) {
    const inB = srt(drift.filter((x) => x.d >= lo && x.d < hi).map((x) => x.delta));
    console.log(`  разрыв ${label.padEnd(9)} n=${String(inB.length).padStart(5)}  расхождение темпа: медиана ${f1(pct(inB, 0.5))} с/км · p75 ${f1(pct(inB, 0.75))} · p90 ${f1(pct(inB, 0.90))}`);
  }

  // ═══ И. EASY_BAND_MAX_S ═══
  console.log(`\n═══ И. ШИРИНА ПОЛОСЫ ЛЁГКОГО, КАК ЕЁ ПИШЕТ ТРЕНЕР (константа EASY_BAND_MAX_S = 25 с/км) ═══`);
  console.log(upper("ширина полосы, с/км", easyBands, f1));
  const hist = new Map<number, number>();
  for (const b of easyBands) { const k = Math.min(60, Math.round(b / 10) * 10); hist.set(k, (hist.get(k) ?? 0) + 1); }
  console.log(`  распределение: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}с×${v}`).join(" ")}`);
  console.log(`  доля полос шире 25 с/км: ${shareOver(easyBands, 25)} · шире 40: ${shareOver(easyBands, 40)}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
