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
import { enqueueTrainingPeaksFeedbackJob, fetchHandledWorkoutCacheIds, fetchWorkoutJobBlockState } from "@/features/trainingpeaks/feedback/feedback-queue";
import type { ContextPacket, PlannerDerivedMetrics, PlannerLap } from "@/features/trainingpeaks/feedback/types";
import { fetchAllInChunks, fetchAllRows } from "@/features/supabase/paginate";

type SupabaseLike = ReturnType<typeof createSupabaseServerClient>;

const DERIVED_SELECT =
  "id, student_id, workout_cache_id, trainingpeaks_workout_id, workout_date, workout_type, comparison_key, reps_detected_count, rep_paces, rep_peak_hrs, rep_pace_fade_pct, rep_recovery_drops, avg_hr, hr_trusted, hr_quality, hr_decoupling_pct, aerobic_ef, rep_pace_cv, pct_time_hr_target, pct_time_pace_target, pace_trusted, distance_trusted, has_fit, fallback_level, updated_at";

// Read windows for the feedback sweep. Sized to what each consumer actually reads
// back, verified by output parity vs full history (docs/pagination-window-report.md).
//   history: the comparison norm uses recent (≤8 нед) + an "old" pool (>6 нед). A
//     year (365d) covers the full data depth (~14 мес) with margin, so the old-mode
//     median is unchanged, while cutting the per-sweep volume vs unbounded.
//   health: health-baseline.ts uses only the last 30 days before a workout; targets
//     are ≤3 days old, so 60 days is a safe superset.
export const FEEDBACK_HISTORY_WINDOW_DAYS = 365;
export const FEEDBACK_HEALTH_WINDOW_DAYS = 60;

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


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;
// Chunks the `.in()` list (URL length) AND paginates each chunk's result (the 1000
// server cap). Ordered by `id` so pages don't overlap. Callers pass FILTERS in
// `extra`; they must NOT pass `.limit(N>1000)` (a no-op cap that silently truncates)
// or an `.order()` (pagination owns ordering here).
async function fetchIn<T>(supabase: SupabaseLike, table: string, select: string, column: string, ids: string[], extra?: (q: AnyQuery) => AnyQuery, orderBy: string = "id"): Promise<T[]> {
  if (ids.length === 0) return [];
  // `orderBy` must be a UNIQUE column for pagination to be correct. Default `id`;
  // tables without an `id` (e.g. trainingpeaks_student_health_metric_profiles, keyed
  // by student_id) pass their own unique column.
  return fetchAllInChunks<T>(
    ids,
    150,
    (chunkIds, from, to) => {
      let q: AnyQuery = supabase.from(table).select(select).in(column, chunkIds);
      if (extra) q = extra(q);
      q = q.order(orderBy, { ascending: true }).range(from, to);
      return withSupabaseNetworkRetry(() => q) as Promise<{ data: T[] | null; error: { message: string } | null }>;
    },
    { label: `feedback:${table}` }
  );
}

/**
 * Races (starts) must not distort a student's normal picture: a race is a max effort with high
 * pulse, fast pace and end drift — normal for a competition, wrong to "correct". This returns the
 * set of `${studentId}|${date}` that are races, from the trainingpeaks_race_events calendar
 * (student + event_date). Used to keep races out of the comparison base / personal baselines and
 * out of the normal feedback queue. Calendar-only by design (title/HR heuristics are unreliable).
 */
async function fetchRaceKeys(supabase: SupabaseLike, studentIds: string[], fromYmd: string): Promise<Set<string>> {
  const keys = new Set<string>();
  if (studentIds.length === 0) return keys;
  const rows = await fetchIn<{ student_id: string; event_date: string }>(
    supabase,
    "trainingpeaks_race_events",
    "student_id, event_date",
    "student_id",
    studentIds,
    (q) => q.gte("event_date", fromYmd)
  );
  for (const r of rows) keys.add(`${r.student_id}|${r.event_date}`);
  return keys;
}

/**
 * Build the planner input (ContextPacket) for each target workout, doing the
 * derived+laps+history+memory+health+student joins in bulk. Returns a map keyed
 * by workout_cache_id. Pure read.
 */
export async function assemblePlannerInputsForWorkouts(
  supabase: SupabaseLike,
  targetDerivedRows: DerivedRow[],
  opts?: { historyWindowDays?: number | null; healthWindowDays?: number | null }
): Promise<Map<string, ContextPacket>> {
  const studentIds = [...new Set(targetDerivedRows.map((r) => r.student_id as string))];

  // Read windows bound the sweep's data volume without changing output (verified by
  // the parity harness — scripts/measure-window-parity.ts). `null` = no window (full
  // history), used by the parity test. The comparison norm looks back at most
  // ~8 weeks recent + an "old" pool; the health baseline uses only the last 30 days
  // (health-baseline.ts). See docs/pagination-window-report.md §1.
  const historyWindowDays = opts?.historyWindowDays === undefined ? FEEDBACK_HISTORY_WINDOW_DAYS : opts.historyWindowDays;
  const healthWindowDays = opts?.healthWindowDays === undefined ? FEEDBACK_HEALTH_WINDOW_DAYS : opts.healthWindowDays;
  const dayFloor = (days: number | null): string | null =>
    days == null ? null : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const historyFloor = dayFloor(historyWindowDays);
  const healthFloor = dayFloor(healthWindowDays);

  // Races to exclude from history (comparison base + personal easy-run baselines) so a max-effort
  // start doesn't inflate the norm and later read as "the student regressed".
  const raceKeys = await fetchRaceKeys(supabase, studentIds, new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10));

  // Run history per student (for compareWorkout + personal baselines), bounded to the
  // window the comparison actually reads back.
  const historyRows = await fetchIn<DerivedRow>(supabase, "trainingpeaks_workout_derived_metrics", DERIVED_SELECT, "student_id", studentIds, (q) => {
    const base = q.eq("workout_type", "run");
    return historyFloor ? base.gte("workout_date", historyFloor) : base;
  });

  const students = await fetchIn<Record<string, unknown>>(supabase, "trainingpeaks_students", "id, sex, telegram_formality", "id", studentIds);
  const studentById = new Map(students.map((s) => [s.id as string, s]));

  const memoryRows = await fetchIn<Record<string, unknown>>(
    supabase,
    "trainingpeaks_student_memory_items",
    "student_id, memory_type, summary_text, valid_from, last_seen_at",
    "student_id",
    studentIds,
    (q) => q.in("memory_type", ["emotional_state", "health_status"])
  );
  const memoryByStudent = new Map<string, ContextPacket["memoryItems"]>();
  for (const m of memoryRows) {
    const date = (m.valid_from as string | null) ?? (m.last_seen_at ? (m.last_seen_at as string).slice(0, 10) : null);
    const list = memoryByStudent.get(m.student_id as string) ?? [];
    list.push({ type: m.memory_type as ContextPacket["memoryItems"][number]["type"], text: m.summary_text as string, date });
    memoryByStudent.set(m.student_id as string, list);
  }

  // Raw inbound athlete messages (the transient "what the student said about the workout"
  // that isn't durable memory). Verbatim previews from the context-observation store, last
  // ~30 days; context-packet windows them to each workout's date. This is the general
  // "student words → prompt" channel, so a report like "было 30-31°С" reaches the model
  // even when no narrow rule (heat keyword, fatigue word) fires.
  const obsRows = await fetchIn<Record<string, unknown>>(
    supabase,
    "trainingpeaks_telegram_context_observations",
    "student_id, text_preview, labels, observed_at",
    "student_id",
    studentIds,
    (q) => q.gte("observed_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  );
  const messagesByStudent = new Map<string, ContextPacket["studentMessages"]>();
  for (const o of obsRows) {
    const text = (o.text_preview as string | null)?.trim();
    if (!text) continue;
    const list = messagesByStudent.get(o.student_id as string) ?? [];
    list.push({ text, date: (o.observed_at as string).slice(0, 10), labels: Array.isArray(o.labels) ? (o.labels as unknown[]).map(String) : [] });
    messagesByStudent.set(o.student_id as string, list);
  }

  const healthRows = await fetchIn<Record<string, unknown>>(
    supabase,
    "trainingpeaks_health_metrics_cache",
    "student_id, metric_date, metric_key, value_numeric, value_avg_numeric",
    "student_id",
    studentIds,
    (q) => {
      const base = q.in("metric_key", ["pulse", "sleep_hours", "hrv", "body_battery"]);
      return healthFloor ? base.gte("metric_date", healthFloor) : base;
    }
  );
  const healthByStudent = new Map<string, ContextPacket["healthMetrics"]>();
  for (const h of healthRows) {
    const value = (h.value_numeric as number | null) ?? (h.value_avg_numeric as number | null);
    if (typeof value !== "number") continue;
    const list = healthByStudent.get(h.student_id as string) ?? [];
    list.push({ metricDate: h.metric_date as string, metricKey: h.metric_key as ContextPacket["healthMetrics"][number]["metricKey"], value });
    healthByStudent.set(h.student_id as string, list);
  }
  const profiles = await fetchIn<Record<string, unknown>>(supabase, "trainingpeaks_student_health_metric_profiles", "student_id, has_pulse, has_sleep_hours, has_hrv, has_body_battery", "student_id", studentIds, undefined, "student_id");
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
    if (raceKeys.has(`${r.student_id as string}|${r.workout_date as string}`)) continue; // race → out of baselines/comparison
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
      studentMessages: messagesByStudent.get(sid) ?? [],
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
 * @deprecated Workout-triggered enqueue — drafted EVERY synced run, including silent students'.
 * Replaced by sweepAndEnqueueReportedRunWorkouts (draft only on a recognised report). No live
 * path calls this anymore; kept only for reference/back-compat. Do NOT wire it back — it reopens
 * the noise this model removed.
 *
 * Poll derived_metrics.updated_at > sinceUpdatedAt (run workouts NEWER than the age
 * floor), assemble the packet, and enqueue each (pending or blocked). Idempotent via
 * the queue's active-workout partial-unique index (duplicates → skipped).
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

  // Don't resurrect a workout the coach already dealt with. The queue's unique index only
  // blocks duplicate ACTIVE jobs (pending/generating); once a job is done/dismissed/sent/
  // shared the index lets a new pending in — so an hourly metrics recompute (fresh
  // updated_at, same workout inside the 3-day window) would keep re-adding cleared cards.
  const handledCacheIds = await fetchHandledWorkoutCacheIds([...new Set(derivedRows.map((r) => r.workout_cache_id as string))]);

  for (const r of derivedRows) {
    const cacheId = r.workout_cache_id as string;
    const studentId = r.student_id as string;
    if (handledCacheIds.has(cacheId)) {
      summary.skipped += 1;
      continue;
    }
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

// ─── Report-triggered enqueue (the new model) ────────────────────────────────────────────
// A run is drafted ONLY once the student has written a recognised report about it — the message
// is both the trigger AND the words context. Silent runs never enter the queue; strength/other
// types are never candidates. The reverse of sweepAndEnqueueFeedbackJobs (which drafted every
// synced run). Idempotent: the handled-guard skips a run that already has a job, and a report
// with no synced run yet simply re-matches on the next hourly sweep (nothing is lost).

export type FeedbackReportSweepSummary = {
  reports: number; // report_like observations scanned in the lookback (active students)
  studentsReporting: number;
  reportsMatchedRun: number; // reports that found a fresh run in [D-1, D]
  reportsNoRunYet: number; // report present, run not synced yet → waits for next sweep
  reportsRunAlreadyHandled: number; // the window run already has a job (or was chosen this sweep)
  reportsRunIsRace: number; // the window run is a race (calendar) → not drafted; coach answers it personally
  reportsRunTooOld: number; // the matched run is older than the freshness cap → not queued (keeps the queue to today/yesterday)
  runsEnqueued: number; // distinct runs enqueued as pending
  runsBlocked: number;
  runsSkipped: number;
  runsWithWords: number; // of enqueued, how many packets carry student words (expected == enqueued)
  // Populated only on a dryRun — the runs that WOULD be enqueued, for proof/inspection.
  details?: Array<{ studentId: string; workoutCacheId: string; workoutDate: string; reportDate: string; wordsCount: number; blocked: boolean }>;
};

// Report on the run day OR the next morning: workout_date ∈ [reportDate-1, reportDate].
const REPORT_MATCH_WINDOW_DAYS = 1;
// Freshness cap for the QUEUE (relative to today, not to the report). fit-ingest recomputes metrics
// over a 5-day window, and a report from a day or two ago can still match an older run — but the
// coach only wants TODAY's cards. So only a run from today or yesterday is queued; an older matched
// run is counted (reportsRunTooOld) and skipped. Metrics still recompute over 5d; only the QUEUE
// stays fresh, so a 5-day recompute never resurrects old cards to hand-clean.
const ENQUEUE_MAX_WORKOUT_AGE_DAYS = 1;
// How far back to scan reports each sweep. Wider than the match window so a report whose run
// syncs late (TP lag) still binds on a later sweep; past this a report stops trying (the daily
// safety-net digest catches a genuine report whose run never arrived).
const DEFAULT_REPORT_LOOKBACK_MS = 48 * 60 * 60 * 1000;

function shiftYmd(ymd: string, deltaDays: number): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Scan recent recognised reports and enqueue the RUN each one is about (with the student's words
 * already attached to the packet). Run-only: workout_type='run'; strength/other are never
 * candidates. Selection per report: the runs in [reportDate-1, reportDate] that have no job yet;
 * usually exactly one (run-only + 1-day window), so the match is unambiguous. If more than one,
 * the LATEST run at/before the report is taken (the one they're writing about). If none has synced
 * yet, the report is left for the next sweep. Nothing auto-sends (generation stays a Mini App tap).
 */
export async function sweepAndEnqueueReportedRunWorkouts(input?: { reportLookbackMs?: number; dryRun?: boolean }): Promise<FeedbackReportSweepSummary> {
  const supabase = createSupabaseServerClient();
  const lookbackMs = input?.reportLookbackMs ?? DEFAULT_REPORT_LOOKBACK_MS;
  const dryRun = input?.dryRun ?? false;
  const sinceIso = new Date(Date.now() - lookbackMs).toISOString();

  // Active, non-service students only — a deactivated student gets no drafts.
  // Paginated: the roster is ~600 today, but an unpaged read would silently drop
  // students past 1000 as the club grows.
  const studRows = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      withSupabaseNetworkRetry(() =>
        supabase.from("trainingpeaks_students").select("id, is_active, is_service_account").order("id", { ascending: true }).range(from, to)
      ) as Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
    { label: "report-sweep:students" }
  );
  const activeIds = new Set(
    (studRows ?? []).filter((s) => s.is_active && !s.is_service_account).map((s) => s.id as string)
  );

  // 1. recognised reports in the lookback, attributed to an active student.
  // Paginated: a busy 48h window can exceed 1000 observations; the old .limit(5000)
  // silently capped at 1000 (server max-rows) and report_like reports past it were
  // dropped → those runs were never drafted.
  const obsRows = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      withSupabaseNetworkRetry(() =>
        supabase
          .from("trainingpeaks_telegram_context_observations")
          .select("student_id, observed_at, labels")
          .gte("observed_at", sinceIso)
          .order("id", { ascending: true })
          .range(from, to)
      ) as Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
    { label: "report-sweep:observations" }
  );
  const reports = (obsRows ?? [])
    .filter((o) => {
      const labels = Array.isArray(o.labels) ? (o.labels as unknown[]).map(String) : [];
      return labels.includes("report_like") && o.student_id && activeIds.has(o.student_id as string);
    })
    .map((o) => ({ studentId: o.student_id as string, date: (o.observed_at as string).slice(0, 10), observedAt: o.observed_at as string }));

  const summary: FeedbackReportSweepSummary = {
    reports: reports.length,
    studentsReporting: new Set(reports.map((r) => r.studentId)).size,
    reportsMatchedRun: 0,
    reportsNoRunYet: 0,
    reportsRunAlreadyHandled: 0,
    reportsRunIsRace: 0,
    reportsRunTooOld: 0,
    runsEnqueued: 0,
    runsBlocked: 0,
    runsSkipped: 0,
    runsWithWords: 0,
  };
  if (reports.length === 0) return summary;

  // 2. recent RUN rows for the reporting students (run-only gate here).
  const reportingIds = [...new Set(reports.map((r) => r.studentId))];
  const runFloor = shiftYmd(new Date(Date.now() - lookbackMs).toISOString().slice(0, 10), -(REPORT_MATCH_WINDOW_DAYS + 1));
  const runRows = await fetchIn<DerivedRow>(supabase, "trainingpeaks_workout_derived_metrics", DERIVED_SELECT, "student_id", reportingIds, (q) =>
    q.eq("workout_type", "run").gte("workout_date", runFloor)
  );
  const runsByStudent = new Map<string, DerivedRow[]>();
  for (const r of runRows) {
    const list = runsByStudent.get(r.student_id as string) ?? [];
    list.push(r);
    runsByStudent.set(r.student_id as string, list);
  }

  // 3. block-state guard: a run with an active/done/sent/shared job is never re-enqueued; a run
  // whose only job is DISMISSED is re-enqueued only when THIS report is newer than the dismissal
  // (a fresh report after the coach cleared the card resurrects it; the same report doesn't loop).
  const blockState = await fetchWorkoutJobBlockState([...new Set(runRows.map((r) => r.workout_cache_id as string))]);

  // Races (from the calendar) are never drafted for the normal queue — a start has race-normal
  // high pulse / drift, and "hold an even pace" would be nonsense. Igor answers starts personally.
  const raceKeys = await fetchRaceKeys(supabase, reportingIds, runFloor);

  // 4. per report, pick the run it's about; dedupe so two reports about one run enqueue it once.
  const enqueueFloor = shiftYmd(new Date().toISOString().slice(0, 10), -ENQUEUE_MAX_WORKOUT_AGE_DAYS);
  const chosen = new Map<string, { row: DerivedRow; reportDate: string }>();
  for (const rep of reports) {
    const prevDay = shiftYmd(rep.date, -REPORT_MATCH_WINDOW_DAYS);
    const inWindow = (runsByStudent.get(rep.studentId) ?? []).filter((r) => {
      const wd = r.workout_date as string;
      return wd === rep.date || wd === prevDay;
    });
    if (inWindow.length === 0) {
      summary.reportsNoRunYet += 1; // run not synced yet → next sweep will bind it
      continue;
    }
    // Freshness cap: only queue runs from today/yesterday, even if an older report matched. Keeps a
    // 5-day metrics recompute from resurrecting old cards. An older matched run is counted, not queued.
    const fresh = inWindow.filter((r) => (r.workout_date as string) >= enqueueFloor);
    if (fresh.length === 0) {
      summary.reportsRunTooOld += 1;
      continue;
    }
    const candidates = fresh.filter((r) => !raceKeys.has(`${r.student_id as string}|${r.workout_date as string}`));
    if (candidates.length === 0) {
      summary.reportsRunIsRace += 1; // only a race in window → not drafted
      continue;
    }
    const available = candidates.filter((r) => {
      const cacheId = r.workout_cache_id as string;
      if (chosen.has(cacheId)) return false;
      const bs = blockState.get(cacheId);
      if (!bs) return true; // no job yet → enqueue
      if (bs.blocked) return false; // active/done/sent/shared → already handled
      // only dismissed: resurrect only if the report is newer than the dismissal
      return !bs.dismissedAt || rep.observedAt > bs.dismissedAt;
    });
    if (available.length === 0) {
      summary.reportsRunAlreadyHandled += 1;
      continue;
    }
    // The LATEST run at/before the report is the one they're writing about. No wall-clock start
    // time is stored, so a same-day tie breaks on updated_at (freshest metrics).
    available.sort((a, b) => {
      const byDate = (b.workout_date as string).localeCompare(a.workout_date as string);
      if (byDate !== 0) return byDate;
      return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    });
    chosen.set(available[0].workout_cache_id as string, { row: available[0], reportDate: rep.date });
    summary.reportsMatchedRun += 1;
  }
  if (chosen.size === 0) return summary;

  // 5. build packets (windowStudentWords attaches the report as words) and enqueue.
  const chosenList = [...chosen.values()];
  const packets = await assemblePlannerInputsForWorkouts(supabase, chosenList.map((c) => c.row));
  const details: NonNullable<FeedbackReportSweepSummary["details"]> = [];
  for (const { row, reportDate } of chosenList) {
    const cacheId = row.workout_cache_id as string;
    const studentId = row.student_id as string;
    const plannerInput = packets.get(cacheId);
    if (!plannerInput) {
      summary.runsSkipped += 1;
      continue;
    }
    const built = buildFeedbackContextPacket(plannerInput);
    const wordsCount = built.blocked ? 0 : built.packet.studentWords.length;
    if (!built.blocked && wordsCount > 0) summary.runsWithWords += 1;
    if (dryRun) {
      details.push({ studentId, workoutCacheId: cacheId, workoutDate: row.workout_date as string, reportDate, wordsCount, blocked: built.blocked });
      if (built.blocked) summary.runsBlocked += 1;
      else summary.runsEnqueued += 1;
      continue;
    }
    const res = built.blocked
      ? await enqueueTrainingPeaksFeedbackJob({ workoutCacheId: cacheId, studentId, blockedReason: built.reason })
      : await enqueueTrainingPeaksFeedbackJob({ workoutCacheId: cacheId, studentId, packet: built.packet });
    if (res.skipped) summary.runsSkipped += 1;
    else if (built.blocked) summary.runsBlocked += 1;
    else summary.runsEnqueued += 1;
  }
  if (dryRun) summary.details = details;
  return summary;
}
