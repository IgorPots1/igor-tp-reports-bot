/**
 * Club race-fill analysis (Phase F). READ-ONLY: writes nothing, sends nothing.
 * Measures how many of the filtered-out race_events can be recovered by taking the
 * finish time from the workout SUMMARY (completed time/distance) matched to the event
 * date, how many stay unreachable, and club race coverage (students with >=1 real race
 * + which standard distances are empty).
 *
 * Run:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-race-fill.ts
 */

import { createSupabaseServerClient } from "@/features/supabase/server";
import { loadClubWorkoutRows } from "@/features/club/service";
import { loadCoachRecords } from "@/features/club/service";
import { classifyRaceEventFill, type RaceFillWorkout, type RaceFillEvent } from "@/features/club/race-fill";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const today = todayIso();

  // 1. All race_events (past + future).
  const { data: eventData, error: eventErr } = await supabase
    .from("trainingpeaks_race_events")
    .select("student_id, event_date, title")
    .order("event_date", { ascending: true });
  if (eventErr) {
    console.error("Failed to load race_events:", eventErr.message);
    process.exit(1);
  }
  const events: RaceFillEvent[] = ((eventData as Array<{ student_id: string; event_date: string; title: string | null }> | null) ?? [])
    .filter((e) => e.student_id && e.event_date)
    .map((e) => ({ studentId: e.student_id, eventDate: e.event_date.slice(0, 10), title: e.title }));

  const dates = events.map((e) => e.eventDate).sort();
  const fromDate = dates[0] ?? today;
  const toDate = today;

  // 2. Completed running workouts across the span (marker workouts already excluded).
  const rows = await loadClubWorkoutRows({ from: fromDate, to: toDate });
  const byStudentDate = new Map<string, RaceFillWorkout[]>();
  for (const r of rows) {
    const key = `${r.studentId}|${r.workoutDate}`;
    const arr = byStudentDate.get(key) ?? [];
    arr.push({ studentId: r.studentId, workoutDate: r.workoutDate, distanceKm: r.distanceKm, durationSeconds: r.durationSeconds, isCompleted: r.isCompleted, isRunning: r.isRunning });
    byStudentDate.set(key, arr);
  }

  // 3. Classify each event; dedup by (student, date) so one race day counts once.
  const seen = new Set<string>();
  const counts = { total: events.length, future: 0, no_workout: 0, nonstandard: 0, no_time: 0, fillable: 0, dupe: 0 };
  const fillableByStudent = new Map<string, Set<string>>(); // studentId -> set(distanceKey)
  for (const ev of events) {
    const dedupKey = `${ev.studentId}|${ev.eventDate}`;
    if (seen.has(dedupKey)) {
      counts.dupe += 1;
      continue;
    }
    seen.add(dedupKey);
    const outcome = classifyRaceEventFill(ev, byStudentDate.get(dedupKey) ?? [], today);
    if (outcome.reason === "future") counts.future += 1;
    else if (outcome.reason === "no_workout") counts.no_workout += 1;
    else if (outcome.reason === "nonstandard_distance") counts.nonstandard += 1;
    else if (outcome.reason === "no_time") counts.no_time += 1;
    else if (outcome.reason === "fillable" && outcome.candidate) {
      counts.fillable += 1;
      const set = fillableByStudent.get(ev.studentId) ?? new Set<string>();
      set.add(outcome.candidate.distanceKey);
      fillableByStudent.set(ev.studentId, set);
    }
  }

  // 4. Coverage. A "real race" = a past race_event matched to a completed run (fillable OR
  //    nonstandard-but-timed) OR a coach_confirmed race. Count students with >=1, and per
  //    standard distance how many active students have NONE.
  // loadCoachRecords -> Map keyed "studentId|distanceKey"; every entry is a
  // coach_confirmed race. A hidden override is a deliberate "no race", so skip it.
  const coach = await loadCoachRecords().catch(() => new Map<string, { trust?: string }>());
  const coachRaceStudents = new Set<string>();
  const coachByStudentDist = new Map<string, Set<string>>();
  for (const [flatKey, rec] of coach as Map<string, { trust?: string }>) {
    if (rec && rec.trust === "hidden") continue;
    const [sid, distKey] = flatKey.split("|");
    if (!sid || !distKey) continue;
    coachRaceStudents.add(sid);
    const s = coachByStudentDist.get(sid) ?? new Set<string>();
    s.add(distKey);
    coachByStudentDist.set(sid, s);
  }

  const { count: activeCount } = await supabase
    .from("trainingpeaks_students")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  const studentsWithRealRace = new Set<string>([...fillableByStudent.keys(), ...coachRaceStudents]);

  const distKeys = CLUB_RECORD_DISTANCES.map((d) => d.key);
  const perDistanceHave = new Map<string, number>();
  for (const dk of distKeys) {
    let have = 0;
    for (const sid of studentsWithRealRace) {
      const hasFill = fillableByStudent.get(sid)?.has(dk);
      const hasCoach = coachByStudentDist.get(sid)?.has(dk);
      if (hasFill || hasCoach) have += 1;
    }
    perDistanceHave.set(dk, have);
  }

  // 5. Report.
  console.log("=== race_events fill funnel (dedup by student+date) ===");
  console.log(`total race_events rows:        ${counts.total}`);
  console.log(`  dupes (same student+date):   ${counts.dupe}`);
  console.log(`  future (no result yet):      ${counts.future}`);
  console.log(`  no completed run that day:   ${counts.no_workout}   [unreachable now]`);
  console.log(`  nonstandard distance:        ${counts.nonstandard}   [unreachable via bucket]`);
  console.log(`  matched run but no time:     ${counts.no_time}`);
  console.log(`  FILLABLE from summary:       ${counts.fillable}   [<-- recoverable]`);
  const unreachableNow = counts.no_workout + counts.nonstandard + counts.no_time;
  console.log("");
  console.log(`ADDED (fillable, past):        ${counts.fillable}`);
  console.log(`UNREACHABLE now (past):        ${unreachableNow}  (no_workout ${counts.no_workout} + nonstandard ${counts.nonstandard} + no_time ${counts.no_time})`);
  console.log(`FUTURE (will self-fill):       ${counts.future}`);
  console.log("");
  console.log("=== club race coverage ===");
  console.log(`active students:               ${activeCount ?? "?"}`);
  console.log(`students with >=1 real race:   ${studentsWithRealRace.size}  (fillable ${fillableByStudent.size} + coach_confirmed ${coachRaceStudents.size}, union)`);
  console.log("per standard distance (students that HAVE a real race at it / empty among those-with-any-race):");
  for (const dk of distKeys) {
    const have = perDistanceHave.get(dk) ?? 0;
    const empty = studentsWithRealRace.size - have;
    console.log(`  ${dk.padEnd(4)}  have ${have}   empty ${empty}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("club-race-fill failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
