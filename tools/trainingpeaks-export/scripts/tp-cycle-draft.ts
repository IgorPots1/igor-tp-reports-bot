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
import { splitSessionVolume } from "./lib/quality-volume.ts";
import {
  DELOAD_AEROBIC_FACTOR, DELOAD_EVERY_N, DELOAD_QUALITY_FACTOR, LENGTH_WEEKS,
  STEP_AEROBIC, STEP_QUALITY, TAPER_PROFILE, WORK_SHARE_MAX,
  PEAK_OVER_BASE_MAX, PEAK_OVER_HISTORIC_MAX, forecast, intentFromDistance,
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
  {
    const perWeek = new Map<number, Map<string, { aer: number; qual: number }>>();
    for (const r of allRows) {
      if (!roster.active.has(r.trainingpeaks_athlete_id)) continue;
      const minutes = Math.round((r.planned_time_raw ?? 0) * 60);
      if (minutes <= 0 || minutes > 300) continue;
      const s = splitSessionVolume(r.title, minutes, thr.get(r.trainingpeaks_athlete_id) ?? null);
      const wk = mondayOf(r.workout_date);
      const M = perWeek.get(r.trainingpeaks_athlete_id) ?? perWeek.set(r.trainingpeaks_athlete_id, new Map()).get(r.trainingpeaks_athlete_id)!;
      const w = M.get(wk) ?? M.set(wk, { aer: 0, qual: 0 }).get(wk)!;
      w.aer += s.aerobicMin; w.qual += s.qualityMin;
    }
    for (const [aid, M] of perWeek) {
      histAer.set(aid, [...M.values()].map((w) => w.aer).filter((x) => x > 0));
      histQual.set(aid, [...M.values()].map((w) => w.qual).filter((x) => x > 0));
    }
  }

  function draft(aid: number): CycleDraft {
    const gaps: string[] = [];
    const M = byAth.get(aid);
    const ws = M ? [...M.values()].filter((w) => w.aer + w.qual > 0) : [];
    if (ws.length < 4) gaps.push(`плановых недель за ${BASE_WEEKS} нед всего ${ws.length} — база ненадёжна`);
    const baseAerobicMin = Math.round(med(ws.map((w) => w.aer)));
    // Потолок роста — собственный исторический максимум аэробной недели [практика].
    // Считается по ВСЕМУ окну наблюдения, а не по 8 неделям базы.
    const histMax = Math.round(Math.max(baseAerobicMin, ...(histAer.get(aid) ?? [baseAerobicMin])));
    const baseQualityMin = Math.round(med(ws.map((w) => w.qual)));
    // ЛИЧНЫЙ потолок качества — собственный исторический максимум минут работы [практика].
    // Когортные 20% доли остаются последней защитой, но рабочий предел теперь личный.
    const histQualMax = Math.round(Math.max(baseQualityMin, ...(histQual.get(aid) ?? [baseQualityMin])));
    // Пик цикла: ограниченный выход за исторический максимум [решение Игоря].
    // Берётся МЕНЬШЕЕ из «максимум x1.10» и «база x1.25».
    const peakCapAerobicMin = Math.round(Math.min(histMax * PEAK_OVER_HISTORIC_MAX, baseAerobicMin * PEAK_OVER_BASE_MAX) / 5) * 5;
    if (baseQualityMin === 0) gaps.push("качественных минут за окно нет — база качества 0, цикл начнётся с нуля");
    const days = Math.round(med(ws.map((w) => w.days))) || 3;

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
      peakCapAerobicMin, historicMaxAerobicMin: histMax, peakCapQualityMin: histQualMax, gaps,
    };
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
    console.log(`  потолок качества: ${d.peakCapQualityMin} мин работы/нед — ЛИЧНЫЙ максимум (когортные ${Math.round(100 * WORK_SHARE_MAX)}% доли — последняя защита)`);
    console.log(`  шаг:              аэробный ×${d.stepAerobic} · качество ×${d.stepQuality}`);
    console.log(`  плановая разгрузка: каждые ${d.deloadEveryN} нед · аэробный ×${d.deloadDepthAerobic} · работа ×${d.deloadQualityFactor} · день и качество остаются`);
    console.log(`  подводка:         ${d.taperProfile.length ? d.taperProfile.map((t) => `за ${t.weeksOut} нед: аэр ×${t.aerobicFactor}, работа ×${t.qualityMinutesFactor}`).join(" · ") : "нет (цикл без старта)"}`);
    if (d.gaps.length) for (const g of d.gaps) console.log(`  ⚠ ${g}`);
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
  const cases = [pick("marathon"), pick("half"), pick("maintenance"),
    shortest ? [shortest[0], shortest[1]] as [number, string] : null]
    .filter((x): x is [number, string] => x != null)
    .filter((x, i, arr) => arr.findIndex((y) => y[0] === x[0]) === i);

  const firstWeek = addDays(mondayOf(today), 7);
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
    console.log(`  # неделя с    роль                 аэробн  работа  кач.%  рычаг      дней  формат качества`);
    // на месяц вперёд, но если старт близко — показываем до старта включительно
    // Цикл КОНЧАЕТСЯ стартом: показывать недели после него бессмысленно — это уже
    // другой цикл. Первый прогон продолжал Ярулиной «рост» на двух неделях ПОСЛЕ забега.
    const weeksToRace = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(firstWeek)) / (7 * 86400000)) + 1 : null;
    const horizon = weeksToRace != null ? Math.max(1, weeksToRace) : 4;
    for (const w of forecast(d, firstWeek, horizon)) {
      console.log(`  ${String(w.index).padStart(2)} ${w.weekStart}  ${w.role.padEnd(20)}`
        + `${String(w.aerobicMin).padStart(5)}   ${String(w.qualityMin).padStart(5)}`
        + `${(w.qualitySharePct.toFixed(1) + "%").padStart(7)}  ${(w.lever ?? "—").padEnd(10)}`
        + `${String(w.days).padStart(3)}   ${w.qualityHint}`);
      console.log(`     ${" ".repeat(11)}└ ${w.note}`);
    }
    console.log(`  ПРОГНОЗ НИ К ЧЕМУ НЕ ОБЯЗЫВАЕТ: роль недели пересчитывается перед сборкой,`);
    console.log(`  реактивная разгрузка (болезнь, провал выполнения) может понизить любую из них.`);
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
