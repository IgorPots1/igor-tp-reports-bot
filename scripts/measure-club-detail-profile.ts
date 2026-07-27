/**
 * UI-polish items 6 & 7 — measure REAL latency of the workout-detail and the
 * other-member public-profile builders on production data. READ-ONLY.
 *
 * Picks one real active+visible student with a recent completed workout, then times
 * getClubWorkoutDetail (one workout) and getClubPublicProfile (that member), median of 5.
 *
 * Run:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local scripts/measure-club-detail-profile.ts
 */
import { getClubWorkoutDetail, getClubPublicProfile } from "@/features/club/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

async function timeIt<T>(fn: () => Promise<T>, runs = 5): Promise<{ cold: number; median: number }> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    await fn();
    samples.push(Date.now() - t);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { cold: samples[0], median: sorted[Math.floor(sorted.length / 2)] };
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { data: sData } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name")
    .eq("is_active", true)
    .order("student_name", { ascending: true })
    .limit(1);
  const student = (sData as Array<{ id: string; student_name: string }> | null)?.[0];
  if (!student) {
    console.error("no active student");
    process.exit(1);
  }
  // A recent completed workout for the detail path (fallback: any completed workout).
  const { data: wData } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("id, student_id")
    .eq("is_completed", true)
    .order("workout_date", { ascending: false })
    .limit(1);
  const workout = (wData as Array<{ id: string; student_id: string }> | null)?.[0];

  console.log(`student: ${student.student_name} (${student.id})`);
  if (workout) {
    const detail = await timeIt(() => getClubWorkoutDetail({ currentStudentId: workout.student_id, workoutId: workout.id }));
    console.log(`getClubWorkoutDetail:  cold ${detail.cold} ms   median ${detail.median} ms`);
  } else {
    console.log("getClubWorkoutDetail:  no completed workout to time");
  }
  const profile = await timeIt(() => getClubPublicProfile({ currentStudentId: student.id, targetStudentId: student.id }));
  console.log(`getClubPublicProfile:  cold ${profile.cold} ms   median ${profile.median} ms`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
