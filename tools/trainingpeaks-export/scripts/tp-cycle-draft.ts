/**
 * tp-cycle-draft — черновик тренировочного цикла из данных + прогноз недель. READ-ONLY.
 *
 * НИ НА ЧТО НЕ ВЛИЯЕТ: ничего не пишет ни в БД, ни в TP, сборщик недель не трогает.
 * Задача — предложить тренеру ГОТОВЫЙ черновик, чтобы он правил, а не заполнял с нуля.
 *
 * Прогноз недель — ОТОБРАЖЕНИЕ. Ни к чему не обязывает: роль недели пересчитывается
 * при сборке с учётом того, как прошла предыдущая, и реактивная разгрузка может
 * понизить любую неделю (спека C2).
 *
 * Запуск:
 *   npx tsx tools/trainingpeaks-export/scripts/tp-cycle-draft.ts            — черновики по группе 12
 *   npx tsx tools/trainingpeaks-export/scripts/tp-cycle-draft.ts --forecast — плюс прогнозы на месяц
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { mondayOf } from "./lib/autoplanner-context.ts";
import { loadRoster } from "./lib/autoplanner-roster.ts";
import { loadAthleteContexts } from "./lib/autoplanner-context.ts";
import { splitSessionVolume } from "./lib/quality-volume.ts";
import {
  DELOAD_AEROBIC_FACTOR, DELOAD_EVERY_N, DELOAD_QUALITY_FACTOR, LENGTH_WEEKS,
  STEP_AEROBIC, STEP_QUALITY, TAPER_PROFILE, WORK_SHARE_MAX,
  PEAK_OVER_BASE_MAX, PEAK_OVER_HISTORIC_MAX, capBetween, forecast, intentFromDistance,
  CYCLE_BASE_HALF_LIFE_DAYS, weightedWeeklyBase, halfLifeForTrend, weeklySlope,
  type CycleMode,
  type CycleDraft, type CycleIntent,
} from "./lib/training-cycle.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

const GROUP: Array<[number, string]> = [
  [5733446, "Богачев"], [5475652, "Пономарева"], [5476215, "Кудрявцева"], [6009851, "Ярулина"],
  [5931798, "Панина"], [5905779, "Круглова"], [5748681, "Николаева"], [5475750, "Лобус"],
  [5475968, "Хофман"], [5461678, "Расницова"], [5807145, "Семешина"], [6290336, "Столова"],
];

/** База считается за 8 недель — то же окно, что у истории качества в сборщике. */
const BASE_WEEKS = 8;

const srt = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const med = (xs: number[]): number => { const s = srt(xs); if (!s.length) return 0; const i = (s.length - 1) / 2; return Number.isInteger(i) ? s[i] : (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);

type Row = { trainingpeaks_athlete_id: number; workout_date: string; title: string | null; planned_time_raw: number | null };
type Race = { id: string; trainingpeaks_athlete_id: number; event_date: string; title: string | null; distance_km: number | null };

async function main(): Promise<void> {
  const sb = sbc();
  const roster = await loadRoster(sb);
  // Контексты нужны РАДИ ОКОН БОЛЕЗНИ: база цикла исключает их так же, как якорь лёгкого.
  const ctx = await loadAthleteContexts(sb);
  const today = iso(Date.now());
  const since = addDays(today, -BASE_WEEKS * 7);

  // Тянем сразу 26 недель: база считается по последним 8, а потолок роста —
  // по всему окну (собственный исторический максимум атлета).
  const HIST_WEEKS = 26;
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
      .select("id, trainingpeaks_athlete_id, event_date, title, distance_km").gte("event_date", today).order("event_date").range(f, f + 999);
    if (error) throw error;
    races.push(...((data ?? []) as unknown as Race[]));
    if (!data || data.length < 1000) break;
  }

  // пороги нужны классификатору объёма для форм в метрах
  const thr = new Map<number, number>();
  {
    const { data } = await sb.from("tp_threshold_applications").select("trainingpeaks_athlete_id, value_after, created_at").order("created_at");
    for (const x of (data ?? []) as Array<Record<string, unknown>>) {
      const v = Number(x.value_after);
      if (Number.isFinite(v) && v > 0) thr.set(Number(x.trainingpeaks_athlete_id), 1000 / v);
    }
  }

  // атлет → неделя → {аэробные, качественные минуты, дни}
  const byAth = new Map<number, Map<string, { aer: number; qual: number; days: number }>>();
  for (const r of rows) {
    if (!roster.active.has(r.trainingpeaks_athlete_id)) continue;
    const minutes = Math.round((r.planned_time_raw ?? 0) * 60);
    if (minutes <= 0 || minutes > 300) continue;
    const s = splitSessionVolume(r.title, minutes, thr.get(r.trainingpeaks_athlete_id) ?? null);
    const wk = mondayOf(r.workout_date);
    const M = byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, new Map()).get(r.trainingpeaks_athlete_id)!;
    const w = M.get(wk) ?? M.set(wk, { aer: 0, qual: 0, days: 0 }).get(wk)!;
    w.aer += s.aerobicMin; w.qual += s.qualityMin; w.days += 1;
  }

  // Исторические аэробные недели за всё окно — из них берётся потолок роста.
  const histAer = new Map<number, number[]>();
  const histQual = new Map<number, number[]>();
  /** те же 26 недель, но С ДАТАМИ — нужны для взвешивания по свежести */
  const weekly = new Map<number, Array<{ weekStart: string; aer: number; qual: number; days: number }>>();
  {
    const perWeek = new Map<number, Map<string, { aer: number; qual: number; days: number }>>();
    for (const r of allRows) {
      if (!roster.active.has(r.trainingpeaks_athlete_id)) continue;
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
    const baseAerobicMin = weightedWeeklyBase(wk26.map((w) => ({ weekStart: w.weekStart, value: w.aer, hasTraining: w.aer + w.qual > 0 })), today, illness, halfLife)
      || base8Aerobic;
    const illWeeks = wk26.filter((w) => w.aer + w.qual > 0).length
      - wk26.filter((w) => w.aer + w.qual > 0 && !illness.some((iw) => w.weekStart >= iw.from && w.weekStart <= iw.to)).length;
    // Потолок роста — собственный исторический максимум аэробной недели [практика].
    // Считается по ВСЕМУ окну наблюдения, а не по 8 неделям базы.
    const histMax = Math.round(Math.max(baseAerobicMin, ...(histAer.get(aid) ?? [baseAerobicMin])));
    const baseQualityMin = weightedWeeklyBase(wk26.map((w) => ({ weekStart: w.weekStart, value: w.qual, hasTraining: w.aer + w.qual > 0 })), today, illness, halfLife);
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
      ownSharePct: 100 * baseQualityMin / Math.max(baseAerobicMin + baseQualityMin, 1),
      halfLifeDays: halfLife, base42Aerobic: flat || base8Aerobic,
      slopeMinPerWeek: weeklySlope(ordered.map((w) => w.aer)), gaps,
    };
  }

  /** Честное имя тому, что цикл делает: растит или просто доводит до старта. */
  function cycleMode(d: typeof drafts extends Map<number, infer T> ? T : never, firstWeek: string): CycleMode {
    if (d.intent === "maintenance") return "поддержание";
    const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(firstWeek)) / (7 * 86400000)) + 1 : 8;
    const growth = forecast(d, firstWeek, Math.max(1, w2r)).filter((w) => w.role === "рост").length;
    return growth === 0 ? "подвод к старту в текущей форме" : "подготовка";
  }

  const INTENT_RU: Record<CycleIntent, string> = { "5k": "5 км", "10k": "10 км", half: "21.1 км", marathon: "42.2 км", maintenance: "поддерживающий" };

  console.log(`ЧЕРНОВИКИ ЦИКЛА · база за ${BASE_WEEKS} недель · ${today}`);
  console.log(`качественный объём = ТОЛЬКО рабочие отрезки (правило Игоря, lib/quality-volume.ts)`);
  console.log(`НИЧЕГО НЕ ЗАПИСАНО: ни в БД, ни в TP. Тренер правит черновик, а не заполняет с нуля.\n`);

  const drafts = new Map<number, CycleDraft>();
  for (const [aid, sur] of GROUP) {
    const d = draft(aid);
    drafts.set(aid, d);
    console.log(`${"─".repeat(78)}`);
    console.log(`${sur} · атлет ${aid}`);
    console.log(`  тип цикла:        ${INTENT_RU[d.intent]}${d.targetDate ? ` · старт ${d.targetDate}` : " · старта в базе нет"}`);
    console.log(`  что цикл делает:  ${cycleMode(d, addDays(mondayOf(today), 7))}`);
    console.log(`  длина:            ${d.lengthWeeks} нед`);
    console.log(`  база аэробная:    ${d.baseAerobicMin} мин/нед`);
    console.log(`  база качества:    ${d.baseQualityMin} мин работы/нед`
      + (d.baseAerobicMin + d.baseQualityMin > 0 ? ` (${(100 * d.baseQualityMin / (d.baseAerobicMin + d.baseQualityMin)).toFixed(1)}% недели)` : ""));
    console.log(`  беговых дней:     ${d.days}`);
    const byHist = d.historicMaxAerobicMin * PEAK_OVER_HISTORIC_MAX;
    const byBase = d.baseAerobicMin * PEAK_OVER_BASE_MAX;
    const binder = byBase < byHist ? `связывает БАЗА ×${PEAK_OVER_BASE_MAX}` : `связывает МАКСИМУМ ×${PEAK_OVER_HISTORIC_MAX}`;
    console.log(`  потолок аэробн.:  ${d.peakCapAerobicMin} мин/нед · свой максимум ${d.historicMaxAerobicMin} · база ${d.baseAerobicMin}`
      + ` · ${binder} · к базе ${d.peakCapAerobicMin >= d.baseAerobicMin ? "+" : ""}${Math.round(100 * (d.peakCapAerobicMin / Math.max(d.baseAerobicMin, 1) - 1))}%`);
    console.log(`  потолок качества: ${d.peakCapQualityMin} мин работы/нед · норма ${d.baseQualityMin} + половина до максимума ${d.historicMaxQualityMin}`
      + ` (когортные ${Math.round(100 * WORK_SHARE_MAX)}% доли — последняя защита)`);
    console.log(`  шаг:              аэробный ×${d.stepAerobic} · качество ×${d.stepQuality}`);
    console.log(`  плановая разгрузка: каждые ${d.deloadEveryN} нед · аэробный ×${d.deloadDepthAerobic} · работа ×${d.deloadQualityFactor} · день и качество остаются`);
    console.log(`  подводка:         ${d.taperProfile.length ? d.taperProfile.map((t) => `за ${t.weeksOut} нед: аэр ×${t.aerobicFactor}, работа ×${t.qualityMinutesFactor}`).join(" · ") : "нет (цикл без старта)"}`);
    if (d.gaps.length) for (const g of d.gaps) console.log(`  ⚠ ${g}`);
  }

  const firstWeekAll = addDays(mondayOf(today), 7);

  console.log(`\n${"═".repeat(78)}`);
  console.log(`БАЗА ЦИКЛА: 8 НЕДЕЛЬ (было) ПРОТИВ 26 СО СВЕЖЕСТЬЮ (стало), период полураспада ${CYCLE_BASE_HALF_LIFE_DAYS} дн`);
  console.log(`${"═".repeat(78)}`);
  console.log(`  фамилия      8н    26н@42  26н@тренд  полураспад  тренд   доля 8н -> итог   больн`);
  for (const [aid, sur] of GROUP) {
    const d = drafts.get(aid)!;
    const sh8 = 100 * d.base8Quality / Math.max(d.base8Aerobic + d.base8Quality, 1);
    const sh26 = 100 * d.baseQualityMin / Math.max(d.baseAerobicMin + d.baseQualityMin, 1);
    const dA = d.baseAerobicMin - d.base8Aerobic;
    console.log(`  ${sur.padEnd(13)}${String(d.base8Aerobic).padStart(4)}${String(d.base42Aerobic).padStart(8)}`
      + `${String(d.baseAerobicMin).padStart(10)}${String(d.halfLifeDays + " дн").padStart(12)}`
      + `${d.slopeMinPerWeek.toFixed(1).padStart(8)}`
      + `   ${(sh8.toFixed(1) + "%").padStart(6)} -> ${(sh26.toFixed(1) + "%").padEnd(6)}`
      + `${String(d.illWeeks).padStart(5)}`
      + (d.halfLifeDays < CYCLE_BASE_HALF_LIFE_DAYS ? "  окно укорочено" : "")
      + (Math.abs(dA) > 25 ? "  ⚠ сильный сдвиг" : ""));
  }

  // ПРОВЕРКА: не занижает ли новая база тех, кто РЕАЛЬНО вырос за последние месяцы.
  // Тренд — наклон недельного аэробного объёма по 26 неделям, мин/нед. Если человек растёт,
  // свежесть должна тянуть базу вверх, а не вниз.
  console.log(`\n  тренд объёма за 26 недель против сдвига базы (растущих база занижать не должна):`);
  console.log(`  фамилия      тренд мин/нед   сдвиг базы   вердикт`);
  for (const [aid, sur] of GROUP) {
    const d = drafts.get(aid)!;
    const ws = (weekly.get(aid) ?? []).filter((w) => w.aer + w.qual > 0).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    if (ws.length < 8) { console.log(`  ${sur.padEnd(13)}мало недель (${ws.length})`); continue; }
    const xs = ws.map((_, i) => i), ys = ws.map((w) => w.aer);
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    const dA = d.baseAerobicMin - d.base8Aerobic;
    const verdict = slope > 1 && dA < -10 ? "⚠ растёт, а база занижена"
      : slope > 1 ? "растёт, база не занижена"
      : slope < -1 && dA > 10 ? "падает, база подтянута вверх"
      : "тренда почти нет";
    console.log(`  ${sur.padEnd(13)}${slope.toFixed(1).padStart(10)}${((dA >= 0 ? "+" : "") + dA).padStart(13)}   ${verdict}`);
  }

  console.log(`\n${"═".repeat(78)}`);
  console.log(`ДОЛЯ КАЧЕСТВА: СВОЯ ОБЫЧНАЯ ПРОТИВ ПИКОВОЙ В ЦИКЛЕ`);
  console.log(`${"═".repeat(78)}`);
  console.log(`  фамилия      своя   пик    разгрузка  макс.откл.  потолок работы   аэробный потолок`);
  for (const [aid, sur] of GROUP) {
    const d = drafts.get(aid)!;
    const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(firstWeekAll)) / (7 * 86400000)) + 1 : 8;
    const fc = forecast(d, firstWeekAll, Math.max(1, w2r)).filter((w) => w.role !== "старт");
    const own = 100 * d.baseQualityMin / Math.max(d.baseAerobicMin + d.baseQualityMin, 1);
    const peak = fc.length ? Math.max(...fc.map((w) => w.qualitySharePct)) : 0;
    const dl = fc.filter((w) => w.role === "плановая разгрузка");
    const dlShare = dl.length ? dl.reduce((a, w) => a + w.qualitySharePct, 0) / dl.length : NaN;
    // главное число: НАИБОЛЬШИЙ уход доли от своей обычной за весь цикл, в любую сторону
    const maxDev = fc.length ? Math.max(...fc.map((w) => Math.abs(w.qualitySharePct - own))) : 0;
    console.log(`  ${sur.padEnd(13)}${(own.toFixed(1) + "%").padStart(6)}${(peak.toFixed(1) + "%").padStart(7)}`
      + `${(Number.isFinite(dlShare) ? dlShare.toFixed(1) + "%" : "нет").padStart(11)}`
      + `${(maxDev.toFixed(1)).padStart(11)}`
      + `      ${String(d.baseQualityMin).padStart(3)} -> ${String(d.peakCapQualityMin).padStart(3)}`
      + `        ${String(d.peakCapAerobicMin).padStart(4)}`
      + (maxDev > 3 ? "   ⚠" : ""));
  }
  // СВОДКА ПО РЫЧАГАМ: у кого рост упирается в аэробный, у кого в качество, у кого ни в что.
  // Смотрим горизонт цикла каждого, считаем роли недель роста.
  console.log(`\n${"═".repeat(78)}`);
  console.log(`ЧЕМ РАСТЁТ КАЖДЫЙ (недели роста в пределах его цикла)`);
  console.log(`${"═".repeat(78)}`);
  console.log(`  фамилия      оба  аэробн  качество  упёрлись  доля качества в конце`);
  for (const [aid, sur] of GROUP) {
    const d = drafts.get(aid)!;
    const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(firstWeekAll)) / (7 * 86400000)) + 1 : 8;
    const fc = forecast(d, firstWeekAll, Math.max(1, w2r));
    const g = fc.filter((w) => w.role === "рост");
    const cnt = (k: string): number => g.filter((w) => w.lever === k).length;
    const last = g[g.length - 1] ?? fc[fc.length - 1];
    console.log(`  ${sur.padEnd(13)}${String(cnt("оба")).padStart(3)}${String(cnt("аэробный")).padStart(8)}`
      + `${String(cnt("качество")).padStart(10)}${String(cnt("упёрлись")).padStart(10)}`
      + `${(last ? last.qualitySharePct.toFixed(1) + "%" : "—").padStart(12)} (своя ${(100 * d.baseQualityMin / Math.max(d.baseAerobicMin + d.baseQualityMin, 1)).toFixed(1)}%)`);
  }

  if (!process.argv.includes("--forecast")) return;

  // Три показательных случая: марафон, полумарафон, без старта.
  const pick = (want: CycleIntent): [number, string] | null => {
    for (const [aid, sur] of GROUP) if (drafts.get(aid)?.intent === want) return [aid, sur];
    return null;
  };
  // Четвёртым — короткий цикл: у кого до старта меньше типовой длины сильнее всех.
  const shortest = GROUP
    .map(([aid, sur]) => [aid, sur, drafts.get(aid)] as const)
    .filter((x) => x[2]?.targetDate)
    .sort((a, b) => Date.parse(a[2]!.targetDate!) - Date.parse(b[2]!.targetDate!))[0];
  // Пономарева — главный случай по потолку качества (норма 20, максимум 60).
  const ponomareva = GROUP.find(([a]) => a === 5475652) ?? null;
  const kudr = GROUP.find(([a]) => a === 5476215) ?? null;
  const cases = [pick("marathon"), pick("half"), pick("maintenance"),
    ponomareva ? [ponomareva[0], ponomareva[1]] as [number, string] : null,
    kudr ? [kudr[0], kudr[1]] as [number, string] : null,
    shortest ? [shortest[0], shortest[1]] as [number, string] : null]
    .filter((x): x is [number, string] => x != null)
    .filter((x, i, arr) => arr.findIndex((y) => y[0] === x[0]) === i);

  const firstWeek = firstWeekAll;
  for (const [aid, sur] of cases) {
    const d = drafts.get(aid)!;
    console.log(`\n${"═".repeat(78)}`);
    const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(firstWeek)) / (7 * 86400000)) + 1 : null;
    const shortNote = w2r != null && w2r <= d.taperProfile.length + 1
      ? "  КОРОТКИЙ ЦИКЛ: до старта меньше подводки — цикл состоит только из её хвоста"
      : (w2r != null && w2r < LENGTH_WEEKS[d.intent] ? "  КОРОТКИЙ ЦИКЛ: подхвачен с хвоста, полная длина не помещается" : "");
    console.log(`ПРОГНОЗ НА МЕСЯЦ · ${sur} · ${INTENT_RU[d.intent]}${d.targetDate ? ` · старт ${d.targetDate}` : ""}`);
    if (shortNote) console.log(shortNote);
    console.log(`${"═".repeat(78)}`);
      const ownShare = 100 * d.baseQualityMin / Math.max(d.baseAerobicMin + d.baseQualityMin, 1);
    console.log(`  своя обычная доля качества: ${ownShare.toFixed(1)}% — колонка «откл.» показывает уход от неё`);
    console.log(`  # неделя с    роль                 аэробн  работа  кач.%  откл.  рычаг      дней  формат качества`);
    // на месяц вперёд, но если старт близко — показываем до старта включительно
    // Цикл КОНЧАЕТСЯ стартом: показывать недели после него бессмысленно — это уже
    // другой цикл. Первый прогон продолжал Ярулиной «рост» на двух неделях ПОСЛЕ забега.
    const weeksToRace = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(firstWeek)) / (7 * 86400000)) + 1 : null;
    const horizon = weeksToRace != null ? Math.max(1, weeksToRace) : 4;
    for (const w of forecast(d, firstWeek, horizon)) {
      console.log(`  ${String(w.index).padStart(2)} ${w.weekStart}  ${w.role.padEnd(20)}`
        + `${String(w.aerobicMin).padStart(5)}   ${String(w.qualityMin).padStart(5)}`
        + `${(w.qualitySharePct.toFixed(1) + "%").padStart(7)}`
        + `${(w.role === "старт" ? "—" : (w.qualitySharePct - ownShare >= 0 ? "+" : "") + (w.qualitySharePct - ownShare).toFixed(1)).padStart(7)}  `
        + `${(w.lever ?? "—").padEnd(10)}`
        + `${String(w.days).padStart(3)}   ${w.qualityHint}`);
      console.log(`     ${" ".repeat(11)}└ ${w.note}`);
    }
    console.log(`  ПРОГНОЗ НИ К ЧЕМУ НЕ ОБЯЗЫВАЕТ: роль недели пересчитывается перед сборкой,`);
    console.log(`  реактивная разгрузка (болезнь, провал выполнения) может понизить любую из них.`);
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
