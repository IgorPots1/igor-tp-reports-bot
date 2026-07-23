// Enqueue side of the bridge (мост, часть 1): assemble the planner input for a
// batch of workouts (the derived+laps+history+memory+health+student joins), run
// the context-packet builder, and enqueue one job per workout (pending, or
// blocked on untrusted data). Shared by the cron route and the manual proof so
// the assembly lives in ONE place.
//
// Trigger is derived_metrics.updated_at > watermark (a workout whose metrics were
// just (re)computed). Auto-start is NOT wired — the cron route exists but is not
// in vercel.json; Igor runs it manually first.

import { createSupabaseServerClient, withSupabaseNetworkRetry } from "@/features/supabase/server";
import { buildFeedbackContextPacket } from "@/features/trainingpeaks/feedback/context-packet";
import { enqueueTrainingPeaksFeedbackJob } from "@/features/trainingpeaks/feedback/feedback-queue";
import type { ContextPacket, PlannerDerivedMetrics, PlannerLap } from "@/features/trainingpeaks/feedback/types";

type SupabaseLike = ReturnType<typeof createSupabaseServerClient>;

const DERIVED_SELECT =
  "id, student_id, workout_cache_id, trainingpeaks_workout_id, workout_date, workout_type, comparison_key, reps_detected_count, rep_paces, rep_peak_hrs, rep_pace_fade_pct, rep_recovery_drops, avg_hr, hr_trusted, hr_quality, hr_decoupling_pct, aerobic_ef, rep_pace_cv, pct_time_hr_target, pct_time_pace_target, pace_trusted, distance_trusted, has_fit, fallback_level, updated_at";

type DerivedRow = Record<string, unknown>;

function asNums(value: unknown): Array<number | null> | null {
  if (!Array.isArray(value)) return null;
  return value.map((v) => (typeof v === "number" ? v : null));
}

function toPlannerDerived(r: DerivedRow, agg: { avgPaceSecPerKm: number | null; durationS: number | null }): PlannerDerivedMetrics {
  return {
    workoutId: r.trainingpeaks_workout_id as number,
    workoutDate: r.workout_date as string,
    workoutType: (r.workout_type as string | null) ?? null,
    comparisonKey: (r.comparison_key as string | null) ?? null,
    repsDetectedCount: (r.reps_detected_count as number | null) ?? null,
    repPaces: asNums(r.rep_paces),
    repPeakHrs: asNums(r.rep_peak_hrs),
    repPaceFadePct: (r.rep_pace_fade_pct as number | null) ?? null,
    repRecoveryDrops: asNums(r.rep_recovery_drops),
    avgHr: (r.avg_hr as number | null) ?? null,
    hrTrusted: (r.hr_trusted as boolean | null) ?? null,
    hrQuality: (r.hr_quality as string | null) ?? null,
    avgPaceSecPerKm: agg.avgPaceSecPerKm,
    durationS: agg.durationS,
    hrDecouplingPct: (r.hr_decoupling_pct as number | null) ?? null,
    aerobicEf: (r.aerobic_ef as number | null) ?? null,
    repPaceCv: (r.rep_pace_cv as number | null) ?? null,
    pctTimeHrTarget: (r.pct_time_hr_target as number | null) ?? null,
    pctTimePaceTarget: (r.pct_time_pace_target as number | null) ?? null,
    paceTrusted: (r.pace_trusted as boolean | null) ?? null,
    distanceTrusted: (r.distance_trusted as boolean | null) ?? null,
    hasFit: (r.has_fit as boolean | null) ?? null,
    fallbackLevel: (r.fallback_level as PlannerDerivedMetrics["fallbackLevel"]) ?? null,
  };
}

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;
async function fetchIn<T>(supabase: SupabaseLike, table: string, select: string, column: string, ids: string[], extra?: (q: AnyQuery) => AnyQuery): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunk(ids, 150)) {
    let q: AnyQuery = supabase.from(table).select(select).in(column, part);
    if (extra) q = extra(q);
    const { data, error } = (await withSupabaseNetworkRetry(() => q)) as { data: T[] | null; error: { message: string } | null };
    if (error) throw new Error(`fetch ${table} failed: ${error.message}`);
    out.push(...((data as T[]) ?? []));
  }
  return out;
}

/**
 * Build the planner input (ContextPacket) for each target workout, doing the
 * derived+laps+history+memory+health+student joins in bulk. Returns a map keyed
 * by workout_cache_id. Pure read.
 */
export async function assemblePlannerInputsForWorkouts(
  supabase: SupabaseLike,
  targetDerivedRows: DerivedRow[]
): Promise<Map<string, ContextPacket>> {
  const studentIds = [...new Set(targetDerivedRows.map((r) => r.student_id as string))];

  // Full run history per student (for compareWorkout + personal baselines).
  const historyRows = await fetchIn<DerivedRow>(supabase, "trainingpeaks_workout_derived_metrics", DERIVED_SELECT, "student_id", studentIds, (q) =>
    q.eq("workout_type", "run").limit(6000)
  );

  const students = await fetchIn<Record<string, unknown>>(supabase, "trainingpeaks_students", "id, sex, telegram_formality", "id", studentIds);
  const studentById = new Map(students.map((s) => [s.id as string, s]));

  const memoryRows = await fetchIn<Record<string, unknown>>(
    supabase,
    "trainingpeaks_student_memory_items",
    "student_id, memory_type, summary_text, valid_from, last_seen_at",
    "student_id",
    studentIds,
    (q) => q.in("memory_type", ["emotional_state", "health_status"]).limit(4000)
  );
  const memoryByStudent = new Map<string, ContextPacket["memoryItems"]>();
  for (const m of memoryRows) {
    const date = (m.valid_from as string | null) ?? (m.last_seen_at ? (m.last_seen_at as string).slice(0, 10) : null);
    const list = memoryByStudent.get(m.student_id as string) ?? [];
    list.push({ type: m.memory_type as ContextPacket["memoryItems"][number]["type"], text: m.summary_text as string, date });
    memoryByStudent.set(m.student_id as string, list);
  }

  const healthRows = await fetchIn<Record<string, unknown>>(
    supabase,
    "trainingpeaks_health_metrics_cache",
    "student_id, metric_date, metric_key, value_numeric, value_avg_numeric",
    "student_id",
    studentIds,
    (q) => q.in("metric_key", ["pulse", "sleep_hours", "hrv", "body_battery"]).limit(40000)
  );
  const healthByStudent = new Map<string, ContextPacket["healthMetrics"]>();
  for (const h of healthRows) {
    const value = (h.value_numeric as number | null) ?? (h.value_avg_numeric as number | null);
    if (typeof value !== "number") continue;
    const list = healthByStudent.get(h.student_id as string) ?? [];
    list.push({ metricDate: h.metric_date as string, metricKey: h.metric_key as ContextPacket["healthMetrics"][number]["metricKey"], value });
    healthByStudent.set(h.student_id as string, list);
  }
  const profiles = await fetchIn<Record<string, unknown>>(supabase, "trainingpeaks_student_health_metric_profiles", "student_id, has_pulse, has_sleep_hours, has_hrv, has_body_battery", "student_id", studentIds);
  const profileByStudent = new Map(profiles.map((p) => [p.student_id as string, { hasPulse: !!p.has_pulse, hasSleepHours: !!p.has_sleep_hours, hasHrv: !!p.has_hrv, hasBodyBattery: !!p.has_body_battery }]));

  // Laps + titles for every involved workout (targets + history).
  const allCacheIds = [...new Set([...targetDerivedRows, ...historyRows].map((r) => r.workout_cache_id as string))];
  const lapsByCacheId = new Map<string, PlannerLap[]>();
  const rawLapAgg = new Map<string, { distanceM: number; timeS: number }>();
  const lapRows = await fetchIn<Record<string, unknown>>(
    supabase,
    "trainingpeaks_workout_laps",
    "workout_cache_id, lap_index, distance_m, timer_time_s, elapsed_time_s, avg_hr, is_work",
    "workout_cache_id",
    allCacheIds,
    (q) => q.eq("source", "fit")
  );
  for (const l of lapRows) {
    const cacheId = l.workout_cache_id as string;
    const list = lapsByCacheId.get(cacheId) ?? [];
    list.push({
      lapIndex: l.lap_index as number,
      distanceM: (l.distance_m as number | null) ?? null,
      timerTimeS: (l.timer_time_s as number | null) ?? null,
      elapsedTimeS: (l.elapsed_time_s as number | null) ?? null,
      paceSecPerKm: null,
      avgHr: (l.avg_hr as number | null) ?? null,
      isWork: (l.is_work as boolean | null) ?? null,
    });
    lapsByCacheId.set(cacheId, list);
    const a = rawLapAgg.get(cacheId) ?? { distanceM: 0, timeS: 0 };
    a.distanceM += typeof l.distance_m === "number" ? l.distance_m : 0;
    a.timeS += typeof l.timer_time_s === "number" ? l.timer_time_s : 0;
    rawLapAgg.set(cacheId, a);
  }
  const titleByCacheId = new Map<string, string | null>();
  const cacheRows = await fetchIn<Record<string, unknown>>(supabase, "trainingpeaks_workout_cache", "id, title", "id", allCacheIds);
  for (const c of cacheRows) titleByCacheId.set(c.id as string, (c.title as string | null) ?? null);

  const aggFor = (cacheId: string) => {
    const a = rawLapAgg.get(cacheId) ?? { distanceM: 0, timeS: 0 };
    return { avgPaceSecPerKm: a.distanceM > 0 && a.timeS > 0 ? (a.timeS / a.distanceM) * 1000 : null, durationS: a.timeS > 0 ? a.timeS : null };
  };

  const historyByStudent = new Map<string, PlannerDerivedMetrics[]>();
  for (const r of historyRows) {
    const row = toPlannerDerived(r, aggFor(r.workout_cache_id as string));
    const list = historyByStudent.get(r.student_id as string) ?? [];
    list.push(row);
    historyByStudent.set(r.student_id as string, list);
  }

  const result = new Map<string, ContextPacket>();
  for (const r of targetDerivedRows) {
    const sid = r.student_id as string;
    const cacheId = r.workout_cache_id as string;
    const current = toPlannerDerived(r, aggFor(cacheId));
    const student = studentById.get(sid);
    const history = (historyByStudent.get(sid) ?? []).filter((h) => h.workoutId !== current.workoutId && h.workoutDate < current.workoutDate);
    const packet: ContextPacket = {
      studentId: sid,
      sex: (student?.sex as "female" | "male" | null) ?? null,
      telegramFormality: (student?.telegram_formality as ContextPacket["telegramFormality"]) ?? "unknown",
      workout: { workoutId: current.workoutId, workoutDate: current.workoutDate, title: titleByCacheId.get(cacheId) ?? null },
      current,
      history,
      lastPraise: null,
      laps: lapsByCacheId.get(cacheId) ?? [],
      memoryItems: memoryByStudent.get(sid) ?? [],
      healthMetrics: healthByStudent.get(sid) ?? [],
      healthProfile: profileByStudent.get(sid) ?? null,
    };
    result.set(cacheId, packet);
  }
  return result;
}

// Feedback on a workout older than this is pointless (the coach has already replied
// by hand) and, after an outage, a bulk recompute of the backlog would flood the
// review queue. The sweep skips run workouts whose date is older than this.
const DEFAULT_MAX_WORKOUT_AGE_DAYS = 3;

export type FeedbackEnqueueSummary = { scanned: number; enqueued: number; blocked: number; skipped: number };

/**
 * Poll derived_metrics.updated_at > sinceUpdatedAt (run workouts NEWER than the age
 * floor), assemble the packet, and enqueue each (pending or blocked). Idempotent via
 * the queue's active-workout partial-unique index (duplicates → skipped). Writes to
 * the queue table — needs migration 20260722180000 applied.
 *
 * The workout-date floor (maxWorkoutAgeDays, default 3) is the key guard against a
 * post-outage flood: when metrics for an 11-day backlog get recomputed at once, their
 * updated_at is fresh, so without this floor every stale workout would enqueue.
 */
export async function sweepAndEnqueueFeedbackJobs(input: { sinceUpdatedAt: string; limit?: number; maxWorkoutAgeDays?: number }): Promise<FeedbackEnqueueSummary> {
  const supabase = createSupabaseServerClient();
  const maxAgeDays = input.maxWorkoutAgeDays ?? DEFAULT_MAX_WORKOUT_AGE_DAYS;
  // 'YYYY-MM-DD' floor; workout_date is a date column, compared lexically.
  const workoutDateFloor = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString().slice(0, 10);
  const { data: rows, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("trainingpeaks_workout_derived_metrics")
      .select(DERIVED_SELECT)
      .eq("workout_type", "run")
      .gt("updated_at", input.sinceUpdatedAt)
      .gte("workout_date", workoutDateFloor)
      .order("updated_at", { ascending: true })
      .limit(input.limit ?? 200)
  );
  if (error) throw new Error(`enqueue sweep: list derived failed: ${error.message}`);
  const derivedRows = (rows as DerivedRow[]) ?? [];
  if (derivedRows.length === 0) return { scanned: 0, enqueued: 0, blocked: 0, skipped: 0 };

  const packetsInput = await assemblePlannerInputsForWorkouts(supabase, derivedRows);
  const summary: FeedbackEnqueueSummary = { scanned: derivedRows.length, enqueued: 0, blocked: 0, skipped: 0 };

  for (const r of derivedRows) {
    const cacheId = r.workout_cache_id as string;
    const studentId = r.student_id as string;
    const plannerInput = packetsInput.get(cacheId);
    if (!plannerInput) continue;
    const built = buildFeedbackContextPacket(plannerInput);
    const res = built.blocked
      ? await enqueueTrainingPeaksFeedbackJob({ workoutCacheId: cacheId, studentId, blockedReason: built.reason })
      : await enqueueTrainingPeaksFeedbackJob({ workoutCacheId: cacheId, studentId, packet: built.packet });
    if (res.skipped) summary.skipped += 1;
    else if (built.blocked) summary.blocked += 1;
    else summary.enqueued += 1;
  }
  return summary;
}
