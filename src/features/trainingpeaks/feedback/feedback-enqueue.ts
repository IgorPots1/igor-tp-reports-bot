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
import { detectWeakConfirmation, normalizeObserverText } from "@/features/trainingpeaks/report-detector";
import { extractStatedFactors } from "@/features/trainingpeaks/feedback/factor-extraction-ai";
import { classifyReport, isReportCandidate, resolveArbiterDecision, type ReportVerdict } from "@/features/trainingpeaks/feedback/report-arbiter-ai";
import { deviceGlitchScope } from "@/features/trainingpeaks/feedback/stated-factors";
import { isSensitiveTopic } from "@/features/trainingpeaks/feedback/sensitive-topics";
import { isDataFragment } from "@/features/trainingpeaks/feedback/session-type";
import { enqueueTrainingPeaksFeedbackJob, enrichPendingCardStudentWords, fetchHandledWorkoutCacheIds, fetchWorkoutJobBlockState, flagDoneCardLateReport, reviveDismissedFeedbackJob } from "@/features/trainingpeaks/feedback/feedback-queue";
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
  opts?: { historyWindowDays?: number | null; healthWindowDays?: number | null; groupBoundByCacheId?: Map<string, boolean> }
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
    "student_id, text_preview, labels, observed_at, metadata, source_type",
    "student_id",
    studentIds,
    (q) => q.gte("observed_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  );
  const messagesByStudent = new Map<string, ContextPacket["studentMessages"]>();
  for (const o of obsRows) {
    const text = (o.text_preview as string | null)?.trim();
    if (!text) continue;
    // Drop THIRD-PARTY messages: in a shared group topic linked to student X, everyone else's messages
    // are stored under X's student_id (senderRole=third_party_in_linked_topic — 281 such rows found in
    // the audit, e.g. 4 other people's reports under one student). Feeding them to the factor extractor
    // and the words channel poisoned X's context with someone else's «тяжело»/«gps»/«еда». Keep only the
    // student's own (known/linked_student; business_dm is 1:1 so its unset role is the student too).
    const senderRole = ((o.metadata as Record<string, unknown> | null)?.senderRole as string | undefined) ?? null;
    if (senderRole === "third_party_in_linked_topic") continue;
    const list = messagesByStudent.get(o.student_id as string) ?? [];
    const channel = o.source_type === "group_topic" || o.source_type === "business_dm" ? (o.source_type as "group_topic" | "business_dm") : null;
    list.push({ text, date: (o.observed_at as string).slice(0, 10), at: o.observed_at as string, labels: Array.isArray(o.labels) ? (o.labels as unknown[]).map(String) : [], channel });
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

  // Privacy fix в: the coach's most recent outgoing touch per student — a persistent factor the student
  // raised BEFORE this touch is treated as already-answered and not re-raised (Виктория: недосып поднят
  // заново после того, как вопрос уже закрыли). Best-effort: a missing row → no suppression.
  const contactRows = await fetchIn<Record<string, unknown>>(supabase, "trainingpeaks_student_contact_status", "student_id, last_coach_touch_at", "student_id", studentIds, undefined, "student_id");
  const coachTouchByStudent = new Map((contactRows ?? []).map((c) => [c.student_id as string, (c.last_coach_touch_at as string | null) ?? null]));

  // Laps + titles for every involved workout (targets + history).
  const allCacheIds = [...new Set([...targetDerivedRows, ...historyRows].map((r) => r.workout_cache_id as string))];
  const lapsByCacheId = new Map<string, PlannerLap[]>();
  // Track total AND work-only aggregates: fix #2 uses the WORK portion for a segmented run's steady pace
  // (warm-up/cool-down/recovery laps otherwise drag the average and manufacture false "progress").
  const rawLapAgg = new Map<string, { distanceM: number; timeS: number; workDistanceM: number; workTimeS: number; anyWork: boolean; anyNonWork: boolean }>();
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
    const a = rawLapAgg.get(cacheId) ?? { distanceM: 0, timeS: 0, workDistanceM: 0, workTimeS: 0, anyWork: false, anyNonWork: false };
    const dist = typeof l.distance_m === "number" ? l.distance_m : 0;
    const time = typeof l.timer_time_s === "number" ? l.timer_time_s : 0;
    a.distanceM += dist;
    a.timeS += time;
    if (l.is_work === true) {
      a.workDistanceM += dist;
      a.workTimeS += time;
      a.anyWork = true;
    } else if (l.is_work === false) {
      a.anyNonWork = true;
    }
    rawLapAgg.set(cacheId, a);
  }
  const titleByCacheId = new Map<string, string | null>();
  // planned_time_raw is in HOURS (verified: 1.25 → 75 min); ×3600 → planned seconds, for the fragment gate.
  const plannedSecByCacheId = new Map<string, number | null>();
  const cacheRows = await fetchIn<Record<string, unknown>>(supabase, "trainingpeaks_workout_cache", "id, title, planned_time_raw", "id", allCacheIds);
  for (const c of cacheRows) {
    titleByCacheId.set(c.id as string, (c.title as string | null) ?? null);
    const ph = c.planned_time_raw as number | null;
    plannedSecByCacheId.set(c.id as string, typeof ph === "number" && ph > 0 ? ph * 3600 : null);
  }

  const aggFor = (cacheId: string) => {
    const a = rawLapAgg.get(cacheId) ?? { distanceM: 0, timeS: 0, workDistanceM: 0, workTimeS: 0, anyWork: false, anyNonWork: false };
    // Fix #2: a SEGMENTED run (has explicit non-work laps — warm-up/cool-down/recovery) uses its WORK
    // portion for pace, so those laps can't blend the steady pace slow. A uniform continuous run (no
    // is_work=false lap) uses all laps unchanged. Duration stays the TOTAL time (the ±25% comparability band).
    const useWork = a.anyWork && a.anyNonWork && a.workDistanceM > 0 && a.workTimeS > 0;
    const distanceM = useWork ? a.workDistanceM : a.distanceM;
    const timeS = useWork ? a.workTimeS : a.timeS;
    return { avgPaceSecPerKm: distanceM > 0 && timeS > 0 ? (timeS / distanceM) * 1000 : null, durationS: a.timeS > 0 ? a.timeS : null };
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
    // Privacy fix а/б: a GROUP-bound card is built ONLY from group_topic messages, with sensitive/medical
    // topics stripped — личка never reaches a group draft, and health topics don't either (even the
    // student's own group message about an operation). A private (DM) card keeps the full context.
    const groupBound = opts?.groupBoundByCacheId?.get(cacheId) ?? false;
    const allMessages = messagesByStudent.get(sid) ?? [];
    const studentMessages = groupBound
      ? allMessages.filter((m) => m.channel === "group_topic" && !isSensitiveTopic(m.text))
      : allMessages;
    // Durable memory is health_status / emotional_state summaries — inherently private. Keep it out of a
    // group draft entirely (health_status) and drop any emotional item that reads as a sensitive topic.
    const allMemory = memoryByStudent.get(sid) ?? [];
    const memoryItems = groupBound ? allMemory.filter((m) => m.type !== "health_status" && !isSensitiveTopic(m.text)) : allMemory;
    const packet: ContextPacket = {
      studentId: sid,
      sex: (student?.sex as "female" | "male" | null) ?? null,
      telegramFormality: (student?.telegram_formality as ContextPacket["telegramFormality"]) ?? "unknown",
      workout: { workoutId: current.workoutId, workoutDate: current.workoutDate, title: titleByCacheId.get(cacheId) ?? null },
      current,
      history,
      lastPraise: null,
      laps: lapsByCacheId.get(cacheId) ?? [],
      memoryItems,
      studentMessages,
      groupBound,
      coachTouchAt: coachTouchByStudent.get(sid) ?? null,
      healthMetrics: healthByStudent.get(sid) ?? [],
      healthProfile: profileByStudent.get(sid) ?? null,
    };
    result.set(cacheId, packet);
  }

  // Block 1 — extract the factors each student named around their workout (Haiku primary, keyword
  // fallback). Parallel across packets; only packets with in-window messages call the model, so the
  // cost tracks the enqueue rate (a handful/day). Never throws — degrades to [] / deterministic.
  await Promise.all(
    [...result.entries()].map(async ([cacheId, packet]) => {
      // Блок 6 — data-fragment gate, BEFORE the planner/type classification. A «Длительный бег» that
      // ran 5 min at 80 min planned is a broken record, not a short run: treat as untrusted data so it
      // gets a warm words-only draft (never «для длительной пульс подрос нормально» on 5 min).
      if (isDataFragment(packet.current.durationS, plannedSecByCacheId.get(cacheId) ?? null, packet.workout.title)) {
        packet.current = { ...packet.current, paceTrusted: false, distanceTrusted: false };
      }
      packet.statedFactors = await extractStatedFactors(packet.studentMessages, packet.workout.workoutDate);
      // If the student flagged their device as off, drop trust for the metric THEY pointed at,
      // BEFORE the planner runs — otherwise the arc asserts conclusions on data they distrust.
      // «часы/пульс странно» → drop HR (unchanged). «GPS/трек/дистанция врёт» → drop pace+distance
      // (Karnaukh: GPS glitch, yet we advised «разогнались, бегите медленнее» — pace was never gated).
      // Dropping pace/distance routes the run to the warm words-only draft (buildSensorGlitchPacket).
      const glitch = deviceGlitchScope(packet.statedFactors);
      if (glitch.hr || glitch.paceDistance) {
        packet.current = {
          ...packet.current,
          ...(glitch.hr ? { hrTrusted: false } : {}),
          ...(glitch.paceDistance ? { paceTrusted: false, distanceTrusted: false } : {}),
        };
      }
    })
  );

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
  weakReports: number; // weak_report_confirmation ("готово"/"✅") scanned — promoted only via a time-correlated run
  studentsReporting: number;
  reportsMatchedRun: number; // reports that found a fresh run in [D-1, D]
  reportsNoRunYet: number; // report present, run not synced yet → waits for next sweep
  reportsWeakBeforeRun: number; // a weak ack whose window run started AFTER the message → a pre-run "готово", not a report
  reportsRunAlreadyHandled: number; // the window run already has a job (or was chosen this sweep)
  reportsRunIsRace: number; // the window run is a race (calendar) → not drafted; coach answers it personally
  reportsRunTooOld: number; // the matched run is older than the freshness cap → not queued (keeps the queue to today/yesterday)
  runsEnqueued: number; // distinct runs enqueued as pending
  runsBlocked: number;
  runsSkipped: number;
  runsWithWords: number; // of enqueued, how many packets carry student words (expected == enqueued)
  runsRevived?: number; // dismissed cards flipped back in place by a fresh report (no duplicate row)
  runsEnriched?: number; // clarification follow-ups that added words to an existing pre-generation card
  enrichmentsCount?: number; // dryRun only: how many clarification enrichments were queued
  // Populated only on a dryRun — the runs that WOULD be enqueued, for proof/inspection.
  details?: Array<{ studentId: string; workoutCacheId: string; workoutDate: string; reportDate: string; wordsCount: number; blocked: boolean }>;
};

// Report on the run day OR the next morning: workout_date ∈ [reportDate-1, reportDate].
const REPORT_MATCH_WINDOW_DAYS = 1;
// Freshness cap keyed to the REPORT date, not the run's age (Igor's call). The old run-age cap
// (only today/yesterday RUNS) dropped a legit fresh report whose run synced late from TP — the run
// looked "2 days old" while the report was fresh (Panina/Slastnaia). Now a report from the last few
// days queues its matched run even with sync lag; a report OLDER than this (a stale one re-scanned
// each sweep) is skipped so a 5-day metrics recompute can't resurrect old cards. The block-state
// guard already stops re-queuing a run that already has a job, so the run's own age needs no cap.
const ENQUEUE_MAX_REPORT_AGE_DAYS = 2;
// A weak ack ("готово") counts as a report only if it came AFTER the run started. cache.start_time is
// naive local while observed_at is UTC, so a fixed tolerance absorbs the timezone skew (Belgrade ~+2h,
// wider for others) — enough to still reject a clearly pre-run "поехали" hours before an evening run.
// Block 4 (timezone recon) decides whether to tighten this or drop the time check for date-only.
const WEAK_AFTER_START_TOLERANCE_MS = 6 * 60 * 60 * 1000;
// How far back to scan reports each sweep. Wider than the match window so a report whose run
// syncs late (TP lag) still binds on a later sweep; past this a report stops trying (the daily
// safety-net digest catches a genuine report whose run never arrived).
const DEFAULT_REPORT_LOOKBACK_MS = 48 * 60 * 60 * 1000;

function shiftYmd(ymd: string, deltaDays: number): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

// Bounded-concurrency map — the arbiter classifies a batch of new messages per sweep without firing
// all requests at once (mirrors the eval harness's pool).
async function runConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// Persist the arbiter verdict on the observation so later sweeps reuse it (classify-once). Best-effort:
// a failed write just means the message is re-classified next sweep — never blocks the sweep.
async function cacheReportAiVerdicts(supabase: SupabaseLike, verdicts: Array<{ id: string; label: ReportVerdict }>): Promise<void> {
  const at = new Date().toISOString();
  for (const v of verdicts) {
    await withSupabaseNetworkRetry(() =>
      supabase.from("trainingpeaks_telegram_context_observations").update({ report_ai_label: v.label, report_ai_at: at }).eq("id", v.id)
    ).catch(() => {});
  }
}

// A report that NAMES its workout type ("сделал интервалы", "лёгкая", "темповый") should bind to a run
// of that type, not merely the latest run in the window — an interval report landing on a same-day easy
// run mislabels the whole card (the reason surge/pace advice went to the wrong workout). We distinguish
// only the INTERVAL axis (reps_detected_count>0), the one the derived row answers deterministically at
// match time; easy-vs-tempo is left to the latest-run tie-break. `по\s+\d` catches "по 400"; `\d[xх×]\d`
// catches "5х400". Cyrillic-safe lookbehind on «по» (JS \b is ASCII-only).
const INTERVAL_REPORT_RE = /интервал|отрезк|повтор|(?<![а-яё])по\s+\d|\d\s*[xхx×]\s*\d/iu;
const NON_INTERVAL_REPORT_RE = /лёгк|легк|восстанов|трусц|спокойн|темпов|длительн|длинн/iu;

export function reportNamedType(text: string): "interval" | "non_interval" | null {
  const t = (text ?? "").toLowerCase();
  if (INTERVAL_REPORT_RE.test(t)) return "interval";
  if (NON_INTERVAL_REPORT_RE.test(t)) return "non_interval";
  return null;
}

function runIsInterval(row: DerivedRow): boolean {
  const reps = row.reps_detected_count;
  return typeof reps === "number" && reps > 0;
}

// Pick the run a report is about: the LATEST at/before the report, BUT if the report names a type and at
// least one candidate matches it, restrict to those first. Falls back to all candidates when the named
// type isn't present among them (e.g. the interval run hasn't synced yet) — no run is ever dropped, only
// re-ranked. With no named type this is exactly the old latest-run pick (drop-in).
export function pickRunForReport(candidates: DerivedRow[], text: string): DerivedRow {
  const named = reportNamedType(text);
  let pool = candidates;
  if (named === "interval") {
    const m = candidates.filter(runIsInterval);
    if (m.length > 0) pool = m;
  } else if (named === "non_interval") {
    const m = candidates.filter((r) => !runIsInterval(r));
    if (m.length > 0) pool = m;
  }
  return [...pool].sort((a, b) => {
    const byDate = (b.workout_date as string).localeCompare(a.workout_date as string);
    if (byDate !== 0) return byDate;
    return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  })[0];
}

// The run a report/clarification is about: type-aware latest non-race run in [date-1, date] (same rule
// as the enqueue matching loop). Used to point a clarification at the card to enrich.
function matchRunCacheId(studentId: string, date: string, text: string, runsByStudent: Map<string, DerivedRow[]>, raceKeys: Set<string>): string | null {
  const prev = shiftYmd(date, -REPORT_MATCH_WINDOW_DAYS);
  const inWindow = (runsByStudent.get(studentId) ?? []).filter((r) => {
    const wd = r.workout_date as string;
    return (wd === date || wd === prev) && !raceKeys.has(`${r.student_id as string}|${wd}`);
  });
  if (inWindow.length === 0) return null;
  return pickRunForReport(inWindow, text).workout_cache_id as string;
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
        supabase.from("trainingpeaks_students").select("id, is_active, is_service_account, telegram_chat_id, telegram_delivery_enabled").order("id", { ascending: true }).range(from, to)
      ) as Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
    { label: "report-sweep:students" }
  );
  const activeIds = new Set(
    (studRows ?? []).filter((s) => s.is_active && !s.is_service_account).map((s) => s.id as string)
  );
  // DM-reachable = linked chat AND delivery on (mirrors the send gate in reports/list). Group-reachable
  // is derived below from recent group_topic observations. A student reachable by NEITHER can't receive a
  // draft — we enqueue such runs as BLOCKED with a clear reason instead of piling up undeliverable cards
  // (Игорь: «хочу видеть в списке 'этому не могу написать', а не гадать»). Measured safe: 3/112 students
  // unreachable, 0 of 23 recently-delivered students falsely flagged.
  const dmCapableIds = new Set(
    (studRows ?? []).filter((s) => Boolean(s.telegram_chat_id) && s.telegram_delivery_enabled).map((s) => s.id as string)
  );
  // Group-reachable = has any group_topic message in the last 30d (the send path can share there even
  // without a linked-thread row). dmCapable OR group-reachable = can receive a draft.
  const groupTopicRows = await fetchIn<Record<string, unknown>>(
    supabase,
    "trainingpeaks_telegram_context_observations",
    "student_id",
    "student_id",
    [...activeIds],
    (q) => q.eq("source_type", "group_topic").gte("observed_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  );
  const groupReachableIds = new Set((groupTopicRows ?? []).map((o) => o.student_id as string));

  // 1. recognised reports in the lookback, attributed to an active student.
  // Paginated: a busy 48h window can exceed 1000 observations; the old .limit(5000)
  // silently capped at 1000 (server max-rows) and report_like reports past it were
  // dropped → those runs were never drafted.
  const obsRows = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      withSupabaseNetworkRetry(() =>
        supabase
          .from("trainingpeaks_telegram_context_observations")
          .select("id, student_id, observed_at, labels, text_preview, report_ai_label, source_type")
          .gte("observed_at", sinceIso)
          .order("id", { ascending: true })
          .range(from, to)
      ) as Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
    { label: "report-sweep:observations" }
  );
  // report_like → a full report. weak_report_confirmation → a bare "готово"/"сделала"/"✅": promoted
  // to a report ONLY when a run is time-correlated (has a run on [D-1,D] AND the message came after it
  // started — see the loop). Both flow through the same matching; `weak` marks the extra gate.
  // GENEROUS prefilter: forward anything that MIGHT be a report (misses are often keyword-less — the
  // AI arbiter below makes the final call). report_like/weak always qualify. `report_ai_label` carries
  // the cached arbiter verdict so each message is classified once, not every sweep.
  type ReportCandidate = { id: string; studentId: string; date: string; observedAt: string; text: string; isReportLike: boolean; isWeak: boolean; aiLabel: ReportVerdict | null; channel: "group_topic" | "business_dm" | null };
  const candidates: ReportCandidate[] = (obsRows ?? [])
    .map((o): ReportCandidate | null => {
      if (!o.student_id || !activeIds.has(o.student_id as string)) return null;
      const labels = Array.isArray(o.labels) ? (o.labels as unknown[]).map(String) : [];
      const text = (o.text_preview as string | null) ?? "";
      const isReportLike = labels.includes("report_like");
      // Weak = stored label OR fresh detection (catches messages ingested before that feature).
      const isWeak = !isReportLike && (labels.includes("weak_report_confirmation") || detectWeakConfirmation(normalizeObserverText(text)));
      if (!isReportLike && !isWeak && !isReportCandidate(text, labels)) return null;
      const cached = o.report_ai_label as string | null;
      const aiLabel = cached === "report" || cached === "clarification" || cached === "not_report" ? (cached as ReportVerdict) : null;
      const channel = o.source_type === "group_topic" || o.source_type === "business_dm" ? (o.source_type as "group_topic" | "business_dm") : null;
      return { id: o.id as string, studentId: o.student_id as string, date: (o.observed_at as string).slice(0, 10), observedAt: o.observed_at as string, text, isReportLike, isWeak, aiLabel, channel };
    })
    .filter((c): c is ReportCandidate => c !== null);

  const summary: FeedbackReportSweepSummary = {
    reports: 0,
    weakReports: 0,
    studentsReporting: 0,
    reportsMatchedRun: 0,
    reportsNoRunYet: 0,
    reportsWeakBeforeRun: 0,
    reportsRunAlreadyHandled: 0,
    reportsRunIsRace: 0,
    reportsRunTooOld: 0,
    runsEnqueued: 0,
    runsBlocked: 0,
    runsSkipped: 0,
    runsWithWords: 0,
  };
  if (candidates.length === 0) return summary;

  // 2. recent RUN rows for the candidate students (run-only gate here).
  const reportingIds = [...new Set(candidates.map((c) => c.studentId))];
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

  // 2b. AI arbiter — classify each candidate once (report / clarification / not_report) with the
  // "was there a run in [D-1,D]" context the sweep now knows. Cached verdicts are reused; fresh ones
  // are classified (concurrency-limited) and written back. classifyReport returns null on ANY failure
  // → resolveArbiterDecision falls back to the regex report_like/weak label, so a disabled or dead
  // model degrades softly (identical to the pre-arbiter sweep).
  const hadRunInWindow = (studentId: string, date: string): boolean => {
    const prev = shiftYmd(date, -REPORT_MATCH_WINDOW_DAYS);
    return (runsByStudent.get(studentId) ?? []).some((r) => {
      const wd = r.workout_date as string;
      return wd === date || wd === prev;
    });
  };
  const uncached = candidates.filter((c) => c.aiLabel === null);
  const freshVerdicts: Array<{ id: string; label: ReportVerdict }> = [];
  await runConcurrent(uncached, 5, async (c) => {
    const label = await classifyReport(c.text, hadRunInWindow(c.studentId, c.date));
    if (label) {
      c.aiLabel = label;
      freshVerdicts.push({ id: c.id, label });
    }
  });
  if (!dryRun && freshVerdicts.length > 0) await cacheReportAiVerdicts(supabase, freshVerdicts);

  // Split candidates: reports (create/refresh a card) vs enrichments (clarification → add words to an
  // EXISTING card, never create one). The decision is pure with the regex fallback baked in.
  const reports: Array<{ studentId: string; date: string; observedAt: string; weak: boolean; text: string; channel: "group_topic" | "business_dm" | null }> = [];
  const enrichments: Array<{ studentId: string; date: string; text: string }> = [];
  for (const c of candidates) {
    const decision = resolveArbiterDecision({ aiLabel: c.aiLabel, isReportLike: c.isReportLike, isWeak: c.isWeak });
    if (decision.kind === "report") reports.push({ studentId: c.studentId, date: c.date, observedAt: c.observedAt, weak: decision.weak, text: c.text, channel: c.channel });
    else if (decision.kind === "clarification") enrichments.push({ studentId: c.studentId, date: c.date, text: c.text });
  }
  summary.reports = reports.filter((r) => !r.weak).length;
  summary.weakReports = reports.filter((r) => r.weak).length;
  summary.studentsReporting = new Set(reports.map((r) => r.studentId)).size;

  // Workout START times (cache.start_time, e.g. "2026-07-26T06:58:04", naive local) — needed only to
  // gate WEAK acks: a "готово" is a report only if it came AFTER the run started. Naive-vs-UTC skew is
  // absorbed by a tolerance (WEAK_AFTER_START_TOLERANCE_MS); Block 4 (timezone recon) will tighten it.
  const runCacheIds = [...new Set(runRows.map((r) => r.workout_cache_id as string))];
  const cacheStartRows = await fetchIn<Record<string, unknown>>(supabase, "trainingpeaks_workout_cache", "id, start_time", "id", runCacheIds);
  const startMsByCacheId = new Map<string, number | null>();
  for (const c of cacheStartRows) {
    const st = c.start_time as string | null;
    const ms = st ? Date.parse(`${st}Z`) : NaN;
    startMsByCacheId.set(c.id as string, Number.isFinite(ms) ? ms : null);
  }

  // 3. block-state guard: a run with an active/done/sent/shared job is never re-enqueued; a run
  // whose only job is DISMISSED is re-enqueued only when THIS report is newer than the dismissal
  // (a fresh report after the coach cleared the card resurrects it; the same report doesn't loop).
  const blockState = await fetchWorkoutJobBlockState([...new Set(runRows.map((r) => r.workout_cache_id as string))]);

  // Races (from the calendar) are never drafted for the normal queue — a start has race-normal
  // high pulse / drift, and "hold an even pace" would be nonsense. Igor answers starts personally.
  const raceKeys = await fetchRaceKeys(supabase, reportingIds, runFloor);

  // 4. per report, pick the run it's about; dedupe so two reports about one run enqueue it once.
  const reportFreshFloor = shiftYmd(new Date().toISOString().slice(0, 10), -ENQUEUE_MAX_REPORT_AGE_DAYS);
  const chosen = new Map<string, { row: DerivedRow; reportDate: string; triggerObservedAt: string; reviveJobId: string | null; triggerChannel: "group_topic" | "business_dm" | null }>();
  for (const rep of reports) {
    const prevDay = shiftYmd(rep.date, -REPORT_MATCH_WINDOW_DAYS);
    let inWindow = (runsByStudent.get(rep.studentId) ?? []).filter((r) => {
      const wd = r.workout_date as string;
      return wd === rep.date || wd === prevDay;
    });
    // Weak ack: promote to a report only if a window run STARTED before the message (a report follows
    // the run). No run yet → wait for the sync (reportsNoRunYet, like Elvira's «Готово»). A run exists
    // but all started after the message → a pre-run "готово/поехали", not a report → dropped.
    if (rep.weak) {
      const observedMs = Date.parse(rep.observedAt);
      const afterStart = inWindow.filter((r) => {
        const st = startMsByCacheId.get(r.workout_cache_id as string);
        return st === null || st === undefined || observedMs > st - WEAK_AFTER_START_TOLERANCE_MS;
      });
      if (afterStart.length === 0) {
        if (inWindow.length === 0) summary.reportsNoRunYet += 1;
        else summary.reportsWeakBeforeRun += 1;
        continue;
      }
      inWindow = afterStart;
    }
    if (inWindow.length === 0) {
      summary.reportsNoRunYet += 1; // run not synced yet → next sweep will bind it
      continue;
    }
    // Freshness cap keyed to the REPORT, not the run: a report from the last couple of days queues its
    // matched run even if the run synced late (older workout_date). A stale report (older than the cap,
    // re-scanned each sweep) is skipped so a metrics recompute can't resurrect old cards.
    if (rep.date < reportFreshFloor) {
      summary.reportsRunTooOld += 1;
      continue;
    }
    const candidates = inWindow.filter((r) => !raceKeys.has(`${r.student_id as string}|${r.workout_date as string}`));
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
    // The run they're writing about: type-aware (interval report → interval run) latest at/before the
    // report. No wall-clock start time is stored, so a same-day tie breaks on updated_at.
    const winner = pickRunForReport(available, rep.text);
    const wbs = blockState.get(winner.workout_cache_id as string);
    // Resurrection without a duplicate: if the ONLY prior job is a dismissal (no active/done job), revive
    // THAT row in place rather than inserting a second card. reviveJobId carries the dismissed row's id.
    const reviveJobId = wbs && !wbs.blocked ? wbs.dismissedJobId : null;
    chosen.set(winner.workout_cache_id as string, { row: winner, reportDate: rep.date, triggerObservedAt: rep.observedAt, reviveJobId, triggerChannel: rep.channel });
    summary.reportsMatchedRun += 1;
  }
  // 5. build packets (windowStudentWords attaches the report as words) and enqueue — only when a run
  // matched. Even with zero matched runs we still fall through to clarification enrichment below.
  const details: NonNullable<FeedbackReportSweepSummary["details"]> = [];
  if (chosen.size > 0) {
    const chosenList = [...chosen.values()];
    // Privacy fix а: this card is GROUP-bound iff the trigger report came via the group topic (the reply
    // goes back where the student reported) OR the student can't be DM'd (only the group is reachable).
    // A group-bound packet is assembled from group-sourced, non-sensitive context only.
    const groupBoundByCacheId = new Map<string, boolean>(
      chosenList.map((c) => [c.row.workout_cache_id as string, c.triggerChannel === "group_topic" || !dmCapableIds.has(c.row.student_id as string)])
    );
    const packets = await assemblePlannerInputsForWorkouts(supabase, chosenList.map((c) => c.row), { groupBoundByCacheId });
    for (const { row, reportDate, triggerObservedAt, reviveJobId } of chosenList) {
      const cacheId = row.workout_cache_id as string;
      const studentId = row.student_id as string;
      const plannerInput = packets.get(cacheId);
      if (!plannerInput) {
        summary.runsSkipped += 1;
        continue;
      }
      // Reachability gate: a student with NO channel (not DM-capable AND no recent group topic) can't
      // receive a draft — enqueue BLOCKED with a clear reason so it surfaces as «этому не могу написать»
      // instead of a pending card that silently never sends. Only runs where a report was matched reach
      // here, so we never block a run the student didn't report on.
      if (!dmCapableIds.has(studentId) && !groupReachableIds.has(studentId)) {
        if (dryRun) {
          details.push({ studentId, workoutCacheId: cacheId, workoutDate: row.workout_date as string, reportDate, wordsCount: 0, blocked: true });
          summary.runsBlocked += 1;
        } else {
          const reason = "нет канала (Business-DM/группа) — не могу написать этому ученику";
          const res = reviveJobId
            ? await reviveDismissedFeedbackJob({ jobId: reviveJobId, blockedReason: reason })
            : await enqueueTrainingPeaksFeedbackJob({ workoutCacheId: cacheId, studentId, blockedReason: reason });
          if (res.skipped) summary.runsSkipped += 1;
          else summary.runsBlocked += 1;
        }
        continue;
      }
      // Anchor the student-words window to the TRIGGER (the report that matched this run), so yesterday's
      // report about a DIFFERENT run can't bleed in — see windowStudentWords.
      plannerInput.triggerObservedAt = triggerObservedAt;
      const built = buildFeedbackContextPacket(plannerInput);
      const wordsCount = built.blocked ? 0 : built.packet.studentWords.length;
      if (!built.blocked && wordsCount > 0) summary.runsWithWords += 1;
      if (dryRun) {
        details.push({ studentId, workoutCacheId: cacheId, workoutDate: row.workout_date as string, reportDate, wordsCount, blocked: built.blocked });
        if (built.blocked) summary.runsBlocked += 1;
        else summary.runsEnqueued += 1;
        continue;
      }
      // reviveJobId set → the only prior job was a dismissal: flip that row back in place (no duplicate
      // card). Otherwise a normal insert. Both return `.skipped` on a race with a concurrent sweep.
      const res = reviveJobId
        ? built.blocked
          ? await reviveDismissedFeedbackJob({ jobId: reviveJobId, blockedReason: built.reason })
          : await reviveDismissedFeedbackJob({ jobId: reviveJobId, packet: built.packet })
        : built.blocked
          ? await enqueueTrainingPeaksFeedbackJob({ workoutCacheId: cacheId, studentId, blockedReason: built.reason })
          : await enqueueTrainingPeaksFeedbackJob({ workoutCacheId: cacheId, studentId, packet: built.packet });
      if (res.skipped) summary.runsSkipped += 1;
      else if (built.blocked) summary.runsBlocked += 1;
      else summary.runsEnqueued += 1;
      if (reviveJobId && !res.skipped) summary.runsRevived = (summary.runsRevived ?? 0) + 1;
    }
  }

  // 6. clarification enrichment — a follow-up to an already-reported run adds its words to that run's
  // EXISTING pre-generation card, never creates a new one. Match the run the same way (latest in the
  // window, skip races); the queue helper no-ops when there's no pending/generating card for it.
  if (!dryRun) {
    for (const e of enrichments) {
      const cacheId = matchRunCacheId(e.studentId, e.date, e.text, runsByStudent, raceKeys);
      if (!cacheId) continue;
      // pending/generating card → fold the late words in (it hasn't generated yet).
      if (await enrichPendingCardStudentWords(cacheId, e.text)) summary.runsEnriched = (summary.runsEnriched ?? 0) + 1;
      // done-but-not-sent card → the draft is already written; don't change it, just FLAG the late report
      // for the coach panel. (no-op if the only card is pending — that was handled above.)
      else await flagDoneCardLateReport(cacheId, e.text);
    }
  }

  if (dryRun) {
    summary.details = details;
    summary.enrichmentsCount = enrichments.length;
  }
  return summary;
}
