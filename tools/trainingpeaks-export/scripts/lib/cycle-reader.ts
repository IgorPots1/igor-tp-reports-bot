/**
 * cycle-reader — ЗАВЕДЁННЫЙ ТРЕНЕРОМ цикл → цель недели для сборщика. READ-ONLY.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. До него строку в training_cycles можно было вставить, но нельзя
 * прочитать: таблица упоминалась ровно в одном месте (пакет приёмки) и только СЧИТАЛА
 * активные строки, а цель недели сборщик всё равно брал из buildDrafts — то есть из истории.
 * Заведение цикла ничего не меняло, и проверить его было нечем.
 *
 * ГРАНИЦА ОТВЕТСТВЕННОСТИ. Черновик (cycle-drafts) — это ПРЕДЛОЖЕНИЕ системы из истории.
 * Заведённый цикл — РЕШЕНИЕ ТРЕНЕРА. Читатель отдаёт второе и никогда не смешивает их
 * в одной строке: если тренер завёл цикл, история в цель недели не подмешивается вообще,
 * иначе получится «параметры тренера, слегка поправленные машиной», чего он не просил.
 * Единственное исключение — число дней: null в колонке означает «как в истории», это
 * явное значение «не задавал», а не подмешивание.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { mondayOf } from "./autoplanner-context.ts";
import type { CycleWeekTarget } from "./autoplanner-week.ts";
import {
  DELOAD_AEROBIC_FACTOR, DELOAD_EVERY_N, DELOAD_QUALITY_FACTOR, LENGTH_WEEKS,
  STEP_AEROBIC, STEP_QUALITY, TAPER_PROFILE, forecast,
  type CycleDraft, type CycleIntent,
} from "./training-cycle.ts";

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const weeksBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86400000));

/** Строка training_cycles в том виде, в каком она нужна читателю. */
type CycleRow = {
  id: string;
  trainingpeaks_athlete_id: number;
  intent: CycleIntent;
  target_date: string | null;
  target_race_id: string | null;
  status: string;
  length_weeks: number;
  base_aerobic_min: number;
  base_quality_min: number;
  base_aerobic_min_manual: number | null;
  base_quality_min_manual: number | null;
  base_manual_reason: string | null;
  step_aerobic: number | string;
  step_quality: number | string;
  peak_aerobic_min: number | null;
  deload_every_n: number;
  deload_depth_aerobic: number | string;
  deload_quality_factor: number | string;
  taper_profile: unknown;
  start_week: string | null;
  days: number | null;
};

const SELECT = "id, trainingpeaks_athlete_id, intent, target_date, target_race_id, status,"
  + " length_weeks, base_aerobic_min, base_quality_min, base_aerobic_min_manual,"
  + " base_quality_min_manual, base_manual_reason, step_aerobic, step_quality, peak_aerobic_min,"
  + " deload_every_n, deload_depth_aerobic, deload_quality_factor, taper_profile, start_week, days";

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export type ActiveCycle = {
  cycleId: string;
  target: CycleWeekTarget;
  /** что именно прочитано — уходит в отчёт, чтобы тренер видел свои числа, а не «магию» */
  provenance: string;
};

/**
 * Собрать строку таблицы в CycleDraft, который умеет разворачивать forecast().
 *
 * РУЧНАЯ БАЗА ГЛАВНЕЕ РАСЧЁТНОЙ. В таблице лежат обе: base_aerobic_min — то, что предложила
 * система при заведении, base_aerobic_min_manual — то, что тренер переопределил. Раньше
 * ручная база жила списком MANUAL_BASE прямо в коде (cycle-drafts.ts), потому что читать её
 * было неоткуда; теперь у неё есть место в данных.
 */
function rowToDraft(r: CycleRow): CycleDraft {
  const baseAerobic = r.base_aerobic_min_manual ?? r.base_aerobic_min;
  const baseQuality = r.base_quality_min_manual ?? r.base_quality_min;
  const taper = Array.isArray(r.taper_profile) && r.taper_profile.length > 0
    ? (r.taper_profile as CycleDraft["taperProfile"])
    : (TAPER_PROFILE[r.intent] ?? []);
  // Потолок пика: тренер мог задать явно; иначе цикл не выходит выше собственной базы
  // больше, чем позволяет шаг — историю сюда НЕ подмешиваем, это решение тренера.
  const peakCap = r.peak_aerobic_min ?? Math.round(baseAerobic * Math.pow(num(r.step_aerobic, STEP_AEROBIC), r.length_weeks));
  return {
    athleteId: Number(r.trainingpeaks_athlete_id),
    intent: r.intent,
    targetRaceId: r.target_race_id,
    targetDate: r.target_date,
    lengthWeeks: r.length_weeks || LENGTH_WEEKS[r.intent] || 12,
    baseAerobicMin: baseAerobic,
    baseQualityMin: baseQuality,
    stepAerobic: num(r.step_aerobic, STEP_AEROBIC),
    stepQuality: num(r.step_quality, STEP_QUALITY),
    deloadEveryN: r.deload_every_n || DELOAD_EVERY_N,
    deloadDepthAerobic: num(r.deload_depth_aerobic, DELOAD_AEROBIC_FACTOR),
    deloadQualityFactor: num(r.deload_quality_factor, DELOAD_QUALITY_FACTOR),
    taperProfile: taper,
    // ДНИ СЮДА НЕ КЛАДЁМ. forecast() их только пробрасывает, а решает число дней
    // loadActiveCycles ниже (тренер → история → прогноз). Если продублировать r.days и здесь,
    // обе ветки дадут одно и то же число, и проверку «дни тренера главнее» станет нечем
    // отличить от «дни из прогноза» — ровно так первая версия проверки и оказалась беззубой.
    days: 0,
    peakCapAerobicMin: peakCap,
    historicMaxAerobicMin: peakCap,
    peakCapQualityMin: Math.round(baseQuality * Math.pow(num(r.step_quality, STEP_QUALITY), r.length_weeks)),
    historicMaxQualityMin: baseQuality,
    aerobicIfFromMax: peakCap,
    base8Aerobic: baseAerobic,
    base8Quality: baseQuality,
    illWeeks: 0,
    halfLifeDays: 0,
    base42Aerobic: baseAerobic,
    slopeMinPerWeek: 0,
    baseAerobicManual: r.base_aerobic_min_manual,
    baseQualityManual: r.base_quality_min_manual,
    baseManualReason: r.base_manual_reason,
    baseAerobicComputed: r.base_aerobic_min,
    baseQualityComputed: r.base_quality_min,
    ownSharePct: baseAerobic + baseQuality > 0 ? 100 * baseQuality / (baseAerobic + baseQuality) : 0,
    gaps: r.base_manual_reason ? [`база задана ТРЕНЕРОМ: ${r.base_manual_reason}`] : [],
  };
}

/**
 * Активные циклы → цель недели, начинающейся с weekStart.
 *
 * Пустая карта = активных циклов нет, и это НОРМА: сборщик тогда идёт прежним путём.
 * Атлеты без активного цикла в карту не попадают вообще.
 */
export async function loadActiveCycles(
  sb: SupabaseClient,
  weekStart: string,
  fallbackDays?: Map<number, number>,
): Promise<Map<number, ActiveCycle>> {
  // МИГРАЦИЯ 20260920000000 МОЖЕТ БЫТЬ ЕЩЁ НЕ ПРИМЕНЕНА — она кладётся файлом, а применяет
  // её Игорь. Пока колонок start_week и days нет, читатель обязан работать без них, а не
  // падать: иначе пакет приёмки и сборка недель ложатся из-за неприменённой миграции.
  let rows: CycleRow[] = [];
  const full = await sb.from("training_cycles").select(SELECT).eq("status", "active");
  if (full.error) {
    if (!/column .* does not exist/i.test(full.error.message)) throw full.error;
    const base = await sb.from("training_cycles")
      .select(SELECT.replace(", start_week, days", "")).eq("status", "active");
    if (base.error) throw base.error;
    rows = ((base.data ?? []) as unknown as CycleRow[]).map((r) => ({ ...r, start_week: null, days: null }));
  } else {
    rows = (full.data ?? []) as unknown as CycleRow[];
  }

  const out = new Map<number, ActiveCycle>();
  for (const raw of rows) {
    const aid = Number(raw.trainingpeaks_athlete_id);
    if (!Number.isFinite(aid)) continue;

    // НАЧАЛО ЦИКЛА. Задано — считаем позицию недели от него; не задано — цикл читается
    // от текущей недели, то есть всегда «неделя 1». Это осознанная деградация, а не
    // догадка: без start_week узнать позицию неоткуда, а придумывать её от created_at
    // нельзя — тренер заводит цикл заранее и задним числом.
    const start = raw.start_week ? mondayOf(raw.start_week) : weekStart;
    const idx = Math.max(0, weeksBetween(start, weekStart));
    if (idx >= raw.length_weeks) continue; // цикл кончился — неделя строится прежним путём

    const draft = rowToDraft(raw);
    // Сколько недель разворачивать: до старта, если он задан, иначе вся длина цикла.
    const wantWeeks = raw.target_date
      ? Math.max(1, weeksBetween(start, raw.target_date) + 1)
      : raw.length_weeks;
    const series = forecast(draft, start, wantWeeks);
    const wk = series[idx];
    if (!wk) continue;

    // ЧИСЛО ДНЕЙ: задано тренером — берём его; null — «как в истории», прежнее поведение.
    const days = raw.days ?? fallbackDays?.get(aid) ?? wk.days;

    out.set(aid, {
      cycleId: raw.id,
      target: {
        weekIndex: idx + 1,
        totalWeeks: series.length,
        role: wk.role,
        aerobicMin: wk.aerobicMin,
        qualityMin: wk.qualityMin,
        days,
      },
      provenance: `цикл тренера ${raw.intent}${raw.target_date ? ` к ${raw.target_date}` : ""}`
        + `, начат ${start}${raw.start_week ? "" : " (start_week не задан — считаем от текущей недели)"}`
        + `, база ${draft.baseAerobicMin}+${draft.baseQualityMin}`
        + `${raw.base_aerobic_min_manual != null ? " (ручная)" : ""}`
        + `, дней ${days}${raw.days == null ? " (из истории)" : " (задано тренером)"}`,
    });
  }
  return out;
}
