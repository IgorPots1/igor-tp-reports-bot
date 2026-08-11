/**
 * cycle-drafts — построение черновиков цикла из истории. Один источник для отчётного
 * скрипта и для сборки недель, чтобы черновик в приёмке и черновик в бою были одним
 * и тем же кодом, а не двумя копиями.
 *
 * READ-ONLY: только чтение кэша и стартов, ничего не пишет.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { mondayOf, type AthleteContext } from "./autoplanner-context.ts";
import { splitSessionVolume } from "./quality-volume.ts";
import {
  CYCLE_BASE_HALF_LIFE_DAYS, LENGTH_WEEKS, PEAK_OVER_BASE_MAX, PEAK_OVER_HISTORIC_MAX,
  STEP_AEROBIC, STEP_QUALITY, TAPER_PROFILE, DELOAD_AEROBIC_FACTOR, DELOAD_EVERY_N,
  DELOAD_QUALITY_FACTOR, capBetween, halfLifeForTrend, intentFromDistance, weeklySlope,
  weightedWeeklyBase, type CycleDraft, type CycleIntent,
} from "./training-cycle.ts";

const BASE_WEEKS = 8;
const HIST_WEEKS = 26;
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);
const srt = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const med = (xs: number[]): number => { const s = srt(xs); if (!s.length) return 0; const i = (s.length - 1) / 2; return Number.isInteger(i) ? s[i] : (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };

const MANUAL_BASE: Record<number, { aerobic?: number; quality?: number; reason: string }> = {
  5461678: { aerobic: 179, reason: "снизилась по семейным обстоятельствам — новая норма, не провал" },
};

type Row = { trainingpeaks_athlete_id: number; workout_date: string; title: string | null; planned_time_raw: number | null };
type Race = { id: string; trainingpeaks_athlete_id: number; event_date: string; distance_km: number | null };

export async function buildDrafts(
  sb: SupabaseClient,
  ctx: Map<number, AthleteContext>,
  today: string,
): Promise<Map<number, CycleDraft>> {
  const since = addDays(today, -BASE_WEEKS * 7);
  const histSince = addDays(today, -HIST_WEEKS * 7);

  const allRows: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, workout_date, title, planned_time_raw")
      .eq("workout_type_value_id", 3).eq("is_planned", true).gte("workout_date", histSince).order("workout_date").range(f, f + 999);
    if (error) throw error;
    allRows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  const rows = allRows.filter((r) => r.workout_date >= since);

  const races: Race[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_race_events")
      .select("id, trainingpeaks_athlete_id, event_date, distance_km").gte("event_date", today).order("event_date").range(f, f + 999);
    if (error) throw error;
    races.push(...((data ?? []) as unknown as Race[]));
    if (!data || data.length < 1000) break;
  }

  const thr = new Map<number, number>();
  {
    const { data } = await sb.from("tp_threshold_applications").select("trainingpeaks_athlete_id, value_after, created_at").order("created_at");
    for (const x of (data ?? []) as Array<Record<string, unknown>>) {
      const v = Number(x.value_after);
      if (Number.isFinite(v) && v > 0) thr.set(Number(x.trainingpeaks_athlete_id), 1000 / v);
    }
  }

  const byAth = new Map<number, Map<string, { aer: number; qual: number; days: number }>>();
  for (const r of rows) {
    if (!ctx.has(r.trainingpeaks_athlete_id)) continue;
    const minutes = Math.round((r.planned_time_raw ?? 0) * 60);
    if (minutes <= 0 || minutes > 300) continue;
    const s = splitSessionVolume(r.title, minutes, thr.get(r.trainingpeaks_athlete_id) ?? null);
    const wk = mondayOf(r.workout_date);
    const M = byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, new Map()).get(r.trainingpeaks_athlete_id)!;
    const w = M.get(wk) ?? M.set(wk, { aer: 0, qual: 0, days: 0 }).get(wk)!;
    w.aer += s.aerobicMin; w.qual += s.qualityMin; w.days += 1;
  }

  const histAer = new Map<number, number[]>();
  const histQual = new Map<number, number[]>();
  const weekly = new Map<number, Array<{ weekStart: string; aer: number; qual: number; days: number }>>();
  {
    const perWeek = new Map<number, Map<string, { aer: number; qual: number; days: number }>>();
    for (const r of allRows) {
      if (!ctx.has(r.trainingpeaks_athlete_id)) continue;
      const minutes = Math.round((r.planned_time_raw ?? 0) * 60);
      if (minutes <= 0 || minutes > 300) continue;
      const s = splitSessionVolume(r.title, minutes, thr.get(r.trainingpeaks_athlete_id) ?? null);
      const wk = mondayOf(r.workout_date);
      const M = perWeek.get(r.trainingpeaks_athlete_id) ?? perWeek.set(r.trainingpeaks_athlete_id, new Map()).get(r.trainingpeaks_athlete_id)!;
      const w = M.get(wk) ?? M.set(wk, { aer: 0, qual: 0, days: 0 }).get(wk)!;
      w.aer += s.aerobicMin; w.qual += s.qualityMin; w.days += 1;
    }
    for (const [aid, M] of perWeek) {
      histAer.set(aid, [...M.values()].map((w) => w.aer).filter((x) => x > 0));
      histQual.set(aid, [...M.values()].map((w) => w.qual).filter((x) => x > 0));
      weekly.set(aid, [...M.entries()].map(([weekStart, w]) => ({ weekStart, aer: w.aer, qual: w.qual, days: w.days })));
    }
  }

  function draft(aid: number): CycleDraft {
    const gaps: string[] = [];
    const M = byAth.get(aid);
    const ws = M ? [...M.values()].filter((w) => w.aer + w.qual > 0) : [];
    if (ws.length < 4) gaps.push(`плановых недель за ${BASE_WEEKS} нед всего ${ws.length} — база ненадёжна`);
    // СТАРАЯ база за 8 недель — оставлена ТОЛЬКО для сравнения в отчёте.
    const base8Aerobic = Math.round(med(ws.map((w) => w.aer)));
    const base8Quality = Math.round(med(ws.map((w) => w.qual)));
    // НОВАЯ база: 26 недель со взвешиванием по свежести, больные недели исключены.
    const wk26 = weekly.get(aid) ?? [];
    const illness = ctx.get(aid)?.illness ?? [];
    // Период полураспада зависит от тренда: у растущего окно короче (см. halfLifeForTrend).
    const ordered = [...wk26].filter((w) => w.aer + w.qual > 0).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    const flat = weightedWeeklyBase(wk26.map((w) => ({ weekStart: w.weekStart, value: w.aer, hasTraining: w.aer + w.qual > 0 })), today, illness, CYCLE_BASE_HALF_LIFE_DAYS);
    const halfLife = halfLifeForTrend(ordered.map((w) => w.aer), flat || base8Aerobic);
    const manual = MANUAL_BASE[aid] ?? null;
    const baseAerobicComputed = weightedWeeklyBase(wk26.map((w) => ({ weekStart: w.weekStart, value: w.aer, hasTraining: w.aer + w.qual > 0 })), today, illness, halfLife)
      || base8Aerobic;
    const baseAerobicMin = manual?.aerobic ?? baseAerobicComputed;
    const illWeeks = wk26.filter((w) => w.aer + w.qual > 0).length
      - wk26.filter((w) => w.aer + w.qual > 0 && !illness.some((iw) => w.weekStart >= iw.from && w.weekStart <= iw.to)).length;
    // Потолок роста — собственный исторический максимум аэробной недели [практика].
    // Считается по ВСЕМУ окну наблюдения, а не по 8 неделям базы.
    const histMax = Math.round(Math.max(baseAerobicMin, ...(histAer.get(aid) ?? [baseAerobicMin])));
    const baseQualityComputed = weightedWeeklyBase(wk26.map((w) => ({ weekStart: w.weekStart, value: w.qual, hasTraining: w.aer + w.qual > 0 })), today, illness, halfLife);
    const baseQualityMin = manual?.quality ?? baseQualityComputed;
    if (manual) gaps.push(`база задана ТРЕНЕРОМ: ${manual.reason}`);
    // ЛИЧНЫЙ потолок качества — собственный исторический максимум минут работы [практика].
    // Когортные 20% доли остаются последней защитой, но рабочий предел теперь личный.
    const histQualRaw = Math.round(Math.max(baseQualityMin, ...(histQual.get(aid) ?? [baseQualityMin])));
    // Норма + половина расстояния до максимума [решение Игоря]: максимум это одна,
    // возможно случайная неделя, норма — то, что человек несёт постоянно.
    const histQualMax = capBetween(baseQualityMin, histQualRaw);
    // Пик цикла: ограниченный выход за исторический максимум [решение Игоря].
    // Берётся МЕНЬШЕЕ из «максимум x1.10» и «база x1.25».
    const peakCapAerobicMin = Math.round(Math.min(histMax * PEAK_OVER_HISTORIC_MAX, baseAerobicMin * PEAK_OVER_BASE_MAX) / 5) * 5;
    // Проверка п.2 наряда: не даёт ли аэробный максимум такого же отрыва от нормы,
    // как качественный. Если бы потолок брался просто от максимума — куда бы он ушёл.
    const aerobicIfFromMax = Math.round(histMax * PEAK_OVER_HISTORIC_MAX / 5) * 5;
    if (baseQualityMin === 0) gaps.push("качественных минут за окно нет — база качества 0, цикл начнётся с нуля");
    const days = Math.round(weightedWeeklyBase(wk26.map((w) => ({ weekStart: w.weekStart, value: w.days, hasTraining: w.aer + w.qual > 0 })), today, illness, halfLife))
      || Math.round(med(ws.map((w) => w.days))) || 3;

    const mine = races.filter((r) => r.trainingpeaks_athlete_id === aid).sort((a, b) => a.event_date.localeCompare(b.event_date));
    const race = mine[0] ?? null;
    const intent: CycleIntent = race ? intentFromDistance(race.distance_km) : "maintenance";
    if (race && race.distance_km == null) gaps.push(`у старта ${race.event_date} не указана дистанция — тип цикла взят как поддерживающий`);

    // длина цикла: не больше, чем недель до старта
    let lengthWeeks = LENGTH_WEEKS[intent];
    if (race) {
      const w = Math.round((Date.parse(race.event_date) - Date.parse(mondayOf(today))) / (7 * 86400000));
      if (w < lengthWeeks) { gaps.push(`до старта ${w} нед, а типовой цикл ${LENGTH_WEEKS[intent]} — цикл укорочен`); lengthWeeks = Math.max(w, 1); }
    }
    return {
      athleteId: aid, intent, targetRaceId: race?.id ?? null, targetDate: race?.event_date ?? null,
      lengthWeeks, baseAerobicMin, baseQualityMin,
      stepAerobic: STEP_AEROBIC, stepQuality: STEP_QUALITY,
      deloadEveryN: DELOAD_EVERY_N, deloadDepthAerobic: DELOAD_AEROBIC_FACTOR, deloadQualityFactor: DELOAD_QUALITY_FACTOR,
      taperProfile: TAPER_PROFILE[intent], days,
      peakCapAerobicMin, historicMaxAerobicMin: histMax, peakCapQualityMin: histQualMax,
      historicMaxQualityMin: histQualRaw, aerobicIfFromMax, base8Aerobic, base8Quality, illWeeks,
      baseAerobicManual: manual?.aerobic ?? null, baseQualityManual: manual?.quality ?? null,
      baseManualReason: manual?.reason ?? null,
      baseAerobicComputed, baseQualityComputed,
      ownSharePct: 100 * baseQualityMin / Math.max(baseAerobicMin + baseQualityMin, 1),
      halfLifeDays: halfLife, base42Aerobic: flat || base8Aerobic,
      slopeMinPerWeek: weeklySlope(ordered.map((w) => w.aer)), gaps,
    };
  }

  const out = new Map<number, CycleDraft>();
  for (const aid of ctx.keys()) {
    const d = draft(aid);
    // Черновик считается только там, где есть из чего: без плановых недель цикл бессмыслен.
    if ((weekly.get(aid) ?? []).filter((w) => w.aer + w.qual > 0).length >= 4) out.set(aid, d);
  }
  return out;
}
