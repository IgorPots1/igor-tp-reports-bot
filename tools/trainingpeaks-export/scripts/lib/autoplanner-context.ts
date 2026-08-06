/**
 * autoplanner-context — сбор контекста атлета для резолвера и сборщика недели.
 *
 * Единственный модуль с I/O в автопланировщике v1. Читает ТОЛЬКО: workout_cache,
 * tp_threshold_applications, tp_zone_snapshots, athlete_training_baselines,
 * operational_signals. Ничего не пишет — ни в БД, ни в TP.
 *
 * Даёт: якоря (лёгкий + порог с фолбэками), объёмный конверт (катящийся 4-нед, §4.1),
 * наблюдаемое распределение дней недели (§4.2).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAnchor, extractEasySample, tierOf, type EasySample, type DateWindow } from "./easy-anchor.ts";
import { anchorConfidence } from "./easy-anchor.ts";
import type { AthleteAnchors, Confidence, EasyAnchor, ThresholdAnchor, Tier } from "./pace-resolver.ts";

const ILLNESS_TYPES = ["health_issue_started", "health_issue_improving", "pain_injury", "pause_training"];
const ILLNESS_TAIL_DAYS = 14;
/** §1.6: аварийный путь, когда нет ни своего якоря, ни зоны 2. Ground truth n=53. */
export const K_COHORT = 1.231;
/** Полоса вокруг когортной середины, чтобы получить пару краёв (узкая — доверие и так low). */
const COHORT_BAND = { fast: 0.97, slow: 1.03 };

const iso = (d: number): string => new Date(d).toISOString().slice(0, 10);
const todayIso = (): string => iso(Date.now());
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);
export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return iso(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
}

export type Envelope = {
  /** катящийся 4-нед: средние минуты бега в неделю (считается на лету, §4.1) */
  rolling4wWeeklyMin: number;
  rolling4wFrequency: number;
  rolling4wQuality: number;
  /** качественных сессий за 8 недель — потолок качества считается ОТСЮДА, не из baselines */
  qualityLast8w: number;
  /** объём работы последней качественной (reps × мин), null — истории нет */
  lastQualityWorkMinutes: number | null;
  /** потолки из baselines — ТОЛЬКО как потолки, не как цель */
  capWeeklyMin: number | null;
  capLongRunMin: number | null;
  capQuality: number | null;
  capFrequency: number | null;
  /** наблюдаемое распределение дней недели: 0=Пн … 6=Вс → сколько пробежек */
  dayHistogram: number[];
  weeksObserved: number;
};

export type AthleteContext = AthleteAnchors & {
  envelope: Envelope;
  illness: DateWindow[];
  hasActiveIllness: boolean;
};

type Row = {
  trainingpeaks_athlete_id: number; student_id: string | null; workout_date: string;
  title: string | null; is_completed: boolean | null; completed_time_raw: number | null;
  completed_distance_raw: number | null; description: string | null;
};

async function pullRuns(sb: SupabaseClient, sinceDays: number): Promise<Row[]> {
  const since = addDays(todayIso(), -sinceDays);
  const out: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, student_id, workout_date, title, is_completed, completed_time_raw, completed_distance_raw, description:source_snapshot->>description")
      .eq("workout_type_value_id", 3).gte("workout_date", since).order("workout_date").range(f, f + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Порог: последнее применённое значение + классификация источника по истории тиров. */
async function pullThresholds(sb: SupabaseClient): Promise<Map<number, ThresholdAnchor>> {
  const { data, error } = await sb.from("tp_threshold_applications")
    .select("trainingpeaks_athlete_id, value_after, applied_at, kind, tier")
    .eq("kind", "pace").neq("tier", "rollback").order("applied_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<number, number>();
  const tiers = new Map<number, Set<string>>();
  for (const r of (data ?? []) as Array<{ trainingpeaks_athlete_id: number; value_after: number; tier: string | null }>) {
    const id = r.trainingpeaks_athlete_id;
    if (!latest.has(id) && r.value_after) latest.set(id, 1000 / r.value_after); // m/s → сек/км
    (tiers.get(id) ?? tiers.set(id, new Set()).get(id)!).add(r.tier ?? "");
  }
  const RACE_TIERS = new Set(["10к забег", "полумарафон", "5к забег", "марафон"]);
  const out = new Map<number, ThresholdAnchor>();
  for (const [id, paceSec] of latest) {
    const t = tiers.get(id) ?? new Set<string>();
    const hasRestore = t.has("restore");
    const hasRace = [...t].some((x) => RACE_TIERS.has(x));
    const hasCandidate = t.has("candidate");
    // restore / подтверждение забегом = решение тренера → high.
    // ТОЛЬКО candidate = смешанное качество (часть — согласие со сканом) → medium, не high.
    // Ни того ни другого (историческая массовая простановка) → bulk_only, medium_low.
    let source: ThresholdAnchor["source"]; let confidence: Confidence;
    if (hasRestore || hasRace) { source = "applied_threshold_coach"; confidence = "high"; }
    else if (hasCandidate) { source = "applied_threshold_coach"; confidence = "medium"; }
    else { source = "applied_threshold_bulk_only"; confidence = "medium_low"; }
    out.set(id, { paceSec, source, confidence });
  }
  return out;
}

/** Зона 2 (Endurance Run) из последнего снапшота TP: вторая зона набора workoutTypeId=0. */
async function pullZone2(sb: SupabaseClient): Promise<Map<number, { fastSec: number; slowSec: number }>> {
  const { data, error } = await sb.from("tp_zone_snapshots")
    .select("trainingpeaks_athlete_id, zones, captured_at").order("captured_at", { ascending: false });
  if (error) throw error;
  const out = new Map<number, { fastSec: number; slowSec: number }>();
  for (const r of (data ?? []) as Array<{ trainingpeaks_athlete_id: number; zones: unknown }>) {
    const id = r.trainingpeaks_athlete_id;
    if (out.has(id)) continue; // самый свежий снапшот
    const z = r.zones as { speedZones?: Array<{ workoutTypeId?: number; zones?: Array<{ minimum?: number; maximum?: number }> }> } | null;
    const set0 = z?.speedZones?.find((s) => Number(s.workoutTypeId) === 0);
    const z2 = set0?.zones?.[1]; // индекс 1 = вторая зона = Endurance Run
    if (!z2 || !z2.minimum || !z2.maximum) continue;
    out.set(id, { fastSec: Math.round(1000 / z2.maximum), slowSec: Math.round(1000 / z2.minimum) });
  }
  return out;
}

async function pullBaselines(sb: SupabaseClient): Promise<Map<number, { wk: number | null; long: number | null; q: number | null; freq: number | null }>> {
  const { data, error } = await sb.from("athlete_training_baselines")
    .select("trainingpeaks_athlete_id, weekly_minutes_cap, long_run_cap_min, quality_count_cap, frequency_cap, is_current")
    .eq("is_current", true);
  if (error) throw error;
  const m = new Map<number, { wk: number | null; long: number | null; q: number | null; freq: number | null }>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const id = Number(r.trainingpeaks_athlete_id); if (!Number.isFinite(id)) continue;
    m.set(id, { wk: r.weekly_minutes_cap as number | null, long: r.long_run_cap_min as number | null,
      q: r.quality_count_cap as number | null, freq: r.frequency_cap as number | null });
  }
  return m;
}

async function pullIllness(sb: SupabaseClient): Promise<Map<string, DateWindow[]>> {
  const { data, error } = await sb.from("trainingpeaks_student_operational_signals")
    .select("student_id, signal_type, valid_from, valid_until, source_date, target_date, created_at, resolved_at")
    .in("signal_type", ILLNESS_TYPES);
  if (error) throw error;
  const m = new Map<string, DateWindow[]>();
  for (const s of (data ?? []) as Array<Record<string, unknown>>) {
    const sid = s.student_id as string | null; if (!sid) continue;
    const from = (s.valid_from ?? s.source_date ?? s.target_date ?? (typeof s.created_at === "string" ? (s.created_at as string).slice(0, 10) : null)) as string | null;
    if (!from) continue;
    let to = (s.valid_until ?? (typeof s.resolved_at === "string" ? (s.resolved_at as string).slice(0, 10) : null)) as string | null;
    if (!to || to < from) to = addDays(from, 21);
    to = addDays(to, ILLNESS_TAIL_DAYS);
    (m.get(sid) ?? m.set(sid, []).get(sid)!).push({ from, to });
  }
  return m;
}

const QUALITY_TITLE_RE = /([0-9]+\s*[xх×]\s*[0-9]|интерв|отрезк|повтор|порог|фартлек|vo\s?2|мпк|темп выше)/i;

/** Собрать контекст по всем атлетам. asOf = дата, «на которую» считаем (обычно сегодня). */
export async function loadAthleteContexts(sb: SupabaseClient, asOf: string = todayIso()): Promise<Map<number, AthleteContext>> {
  const [rows, thresholds, zone2, baselines, illnessByStudent] = await Promise.all([
    pullRuns(sb, 200), pullThresholds(sb), pullZone2(sb), pullBaselines(sb), pullIllness(sb),
  ]);

  const byAth = new Map<number, Row[]>();
  for (const r of rows) (byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!).push(r);

  const out = new Map<number, AthleteContext>();
  const win4wStart = addDays(asOf, -28);
  const win8wStart = addDays(asOf, -56);

  for (const [aid, rs] of byAth) {
    let sid: string | null = null;
    const samples: EasySample[] = []; const seen = new Set<string>();
    const dayHistogram = [0, 0, 0, 0, 0, 0, 0];
    const weekMin = new Map<string, number>(); const weekFreq = new Map<string, number>(); const weekQual = new Map<string, number>();
    const qualityDates: string[] = []; let lastQ: { date: string; work: number } | null = null;

    for (const r of rs) {
      if (r.student_id) sid = r.student_id;
      const s = r.title ? extractEasySample(r.title, r.description ?? "") : null;
      if (s) {
        const k = `${r.workout_date}|${s.fast}|${s.slow}`;
        if (!seen.has(k)) { seen.add(k); samples.push({ date: r.workout_date, fast: s.fast, slow: s.slow, ceilingOnly: s.ceilingOnly }); }
      }
      if (r.is_completed && (r.completed_time_raw ?? 0) > 0) {
        const wk = mondayOf(r.workout_date);
        weekMin.set(wk, (weekMin.get(wk) ?? 0) + (r.completed_time_raw as number) * 60);
        weekFreq.set(wk, (weekFreq.get(wk) ?? 0) + 1);
        if (r.title && QUALITY_TITLE_RE.test(r.title)) {
          weekQual.set(wk, (weekQual.get(wk) ?? 0) + 1);
          if (r.workout_date >= win8wStart) {
            qualityDates.push(r.workout_date);
            const m = /([0-9]{1,2})\s*[xх×]\s*([0-9]{1,2}(?:[.,][0-9])?)\s*(мин|min)/i.exec(r.title);
            if (m) { const w = Number(m[1]) * Number(m[2].replace(",", ".")); if (Number.isFinite(w) && w > 0 && w <= 90) lastQ = { date: r.workout_date, work: w }; }
          }
        }
        const d = new Date(r.workout_date + "T00:00:00Z");
        dayHistogram[(d.getUTCDay() + 6) % 7] += 1;
      }
    }

    // катящийся 4-нед (§4.1): считаем на лету, персистированное не читаем
    const recentWeeks = [...weekMin.keys()].filter((w) => w >= win4wStart).sort();
    const avg = (m: Map<string, number>): number =>
      recentWeeks.length ? recentWeeks.reduce((a, w) => a + (m.get(w) ?? 0), 0) / recentWeeks.length : 0;
    const rolling4wWeeklyMin = Math.round(avg(weekMin));
    const b = baselines.get(aid);

    const tier: Tier = tierOf(rolling4wWeeklyMin > 0 ? rolling4wWeeklyMin
      : ([...weekMin.values()].reduce((a, x) => a + x, 0) / Math.max([...weekMin.size ? weekMin.keys() : []].length, 1) || 0));

    const illness = sid ? illnessByStudent.get(sid) ?? [] : [];
    const hasActiveIllness = illness.some((w) => asOf >= w.from && asOf <= w.to);

    // ЯКОРЬ ЛЁГКОГО: свой → зона 2 → когортное отношение (§1.6)
    const own = buildAnchor(samples, addDays(asOf, 1), { halfLifeDays: 21, illness });
    let easy: EasyAnchor | null = null;
    if (own) {
      easy = { fastSec: own.fast, slowSec: own.slow, source: "easy_description",
        confidence: anchorConfidence(own.effectiveN) as Confidence, effectiveN: own.effectiveN };
    } else {
      const z2 = zone2.get(aid);
      const thr = thresholds.get(aid);
      if (z2) easy = { fastSec: z2.fastSec, slowSec: z2.slowSec, source: "tp_zone2", confidence: "medium" };
      else if (thr) {
        const mid = thr.paceSec * K_COHORT;
        easy = { fastSec: Math.round(mid * COHORT_BAND.fast), slowSec: Math.round(mid * COHORT_BAND.slow),
          source: "cohort_ratio", confidence: "low" };
      }
    }

    out.set(aid, {
      athleteId: aid, tier, easy, threshold: thresholds.get(aid) ?? null,
      illness, hasActiveIllness,
      envelope: {
        rolling4wWeeklyMin, rolling4wFrequency: Math.round(avg(weekFreq) * 10) / 10,
        rolling4wQuality: Math.round(avg(weekQual) * 10) / 10,
        capWeeklyMin: b?.wk ?? null, capLongRunMin: b?.long ?? null,
        capQuality: b?.q ?? null, capFrequency: b?.freq ?? null,
        qualityLast8w: qualityDates.length,
        lastQualityWorkMinutes: lastQ ? lastQ.work : null,
        dayHistogram, weeksObserved: weekMin.size,
      },
    });
  }
  return out;
}
