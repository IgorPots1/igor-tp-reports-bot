/**
 * Measure what the feedback assemble truncation was dropping, on a realistic recent
 * sweep (read-only). Simulates the OLD single-chunk .limit()/1000-cap vs the NEW
 * paginated full read. Shows: history/health rows lost, and lap chunks that exceeded
 * 1000 (→ target-workout pace/duration were computed on incomplete laps).
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/measure-feedback-pagination.ts
 */

import { createSupabaseServerClient } from "@/features/supabase/server";
import { fetchAllInChunks, fetchAllRows, chunkIds } from "@/features/supabase/paginate";

const CAP = 1000;

async function main() {
  const supabase = createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const floor = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

  // Sweep targets: recent run derived rows (like sweepAndEnqueueFeedbackJobs age floor).
  const targets = await fetchAllRows<{ student_id: string; workout_cache_id: string }>(
    (f, t) => supabase.from("trainingpeaks_workout_derived_metrics")
      .select("student_id, workout_cache_id").eq("workout_type", "run")
      .gte("workout_date", floor).lte("workout_date", today).order("id").range(f, t),
    { label: "targets" }
  );
  const studentIds = [...new Set(targets.map((r) => r.student_id))];
  console.log(`recent run targets (${floor}..${today}): ${targets.length}; distinct students: ${studentIds.length}`);
  if (studentIds.length === 0) { console.log("no recent targets — nothing to measure"); return; }

  // History: NEW full vs OLD (single .limit(6000) → capped 1000 per 150-student chunk).
  const historyFull = await fetchAllInChunks<{ workout_cache_id: string; student_id: string }>(
    studentIds, 150, (c, f, t) => supabase.from("trainingpeaks_workout_derived_metrics")
      .select("workout_cache_id, student_id").in("student_id", c).eq("workout_type", "run").order("id").range(f, t),
    { label: "history" }
  );
  // OLD simulation: per 150-student chunk, at most 1000 rows.
  let historyOld = 0;
  for (const c of chunkIds(studentIds, 150)) {
    const { data } = await supabase.from("trainingpeaks_workout_derived_metrics")
      .select("workout_cache_id").in("student_id", c).eq("workout_type", "run").limit(6000);
    historyOld += (data ?? []).length;
  }
  console.log(`\nHISTORY (derived run) for these students: NEW full=${historyFull.length}, OLD(.limit6000→cap)=${historyOld}, LOST=${historyFull.length - historyOld}`);

  // Health: NEW full vs OLD (.limit(40000) → cap 1000 per chunk).
  const healthFull = await fetchAllInChunks<{ id: string }>(
    studentIds, 150, (c, f, t) => supabase.from("trainingpeaks_health_metrics_cache")
      .select("id").in("student_id", c).in("metric_key", ["pulse", "sleep_hours", "hrv", "body_battery"]).order("id").range(f, t),
    { label: "health" }
  );
  let healthOld = 0;
  for (const c of chunkIds(studentIds, 150)) {
    const { data } = await supabase.from("trainingpeaks_health_metrics_cache")
      .select("id").in("student_id", c).in("metric_key", ["pulse", "sleep_hours", "hrv", "body_battery"]).limit(40000);
    healthOld += (data ?? []).length;
  }
  console.log(`HEALTH for these students: NEW full=${healthFull.length}, OLD(.limit40000→cap)=${healthOld}, LOST=${healthFull.length - healthOld}`);

  // Laps: for allCacheIds (targets + full history), which 150-chunks exceed 1000 laps?
  const allCacheIds = [...new Set([...targets, ...historyFull].map((r) => r.workout_cache_id))];
  let lapsFull = 0, lapsLost = 0, overCapChunks = 0, chunksTotal = 0;
  const overCapWorkoutSets: Set<string>[] = [];
  for (const c of chunkIds(allCacheIds, 150)) {
    chunksTotal += 1;
    const rows = await fetchAllRows<{ workout_cache_id: string }>(
      (f, t) => supabase.from("trainingpeaks_workout_laps").select("workout_cache_id").in("workout_cache_id", c).eq("source", "fit").order("id").range(f, t),
      { label: "laps-chunk" }
    );
    lapsFull += rows.length;
    if (rows.length > CAP) { overCapChunks += 1; lapsLost += rows.length - CAP; overCapWorkoutSets.push(new Set(c)); }
  }
  // Targets sitting in an over-cap chunk → their laps (hence avgPace/durationS) were at risk under OLD.
  const targetIds = new Set(targets.map((r) => r.workout_cache_id));
  const targetsAtRisk = [...targetIds].filter((id) => overCapWorkoutSets.some((s) => s.has(id))).length;

  console.log(`\nLAPS over allCacheIds (${allCacheIds.length} workouts, ${chunksTotal} chunks of 150):`);
  console.log(`  full laps=${lapsFull}; chunks exceeding ${CAP}=${overCapChunks}/${chunksTotal}; laps that OLD would drop≈${lapsLost}`);
  console.log(`  RECENT TARGET workouts sitting in an over-cap chunk (pace/duration were at risk): ${targetsAtRisk}/${targetIds.size}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
