/**
 * Phase 1.1 helper — seed FOUR approved test calendar entries (day_off / preference /
 * note / race) on the coach's own student row (CLUB_COACH_PARTICIPANT_STUDENT_ID), so
 * the TP dry-run runs on real DB rows instead of an empty calendar. Writes ONLY to
 * club_calendar_entries (a club table); nothing goes to TrainingPeaks or to students.
 *
 * Reversible: `--clean` deletes exactly these test rows (matched by the test dates on
 * that student). Test dates are far-future (2027-01-11..14) so they never collide with a
 * real plan. Does NOT set applied_tp_workout_id (they stay executable in the dry-run).
 *
 *   ...seed:  node ... scripts/club-calendar-seed-test.ts
 *   ...clean: node ... scripts/club-calendar-seed-test.ts --clean
 */
import { createSupabaseServerClient } from "@/features/supabase/server";

const CLEAN = process.argv.includes("--clean");
const DATES = { day_off: "2027-01-11", preference: "2027-01-12", note: "2027-01-13", race: "2027-01-14" };
const TEST_DATES = Object.values(DATES);

async function main(): Promise<void> {
  const studentId = process.env.CLUB_COACH_PARTICIPANT_STUDENT_ID?.trim();
  if (!studentId) {
    console.error("CLUB_COACH_PARTICIPANT_STUDENT_ID не задан в окружении — не знаю, на чью строку сеять. Стоп.");
    process.exit(1);
  }
  const supabase = createSupabaseServerClient();

  if (CLEAN) {
    const { error, count } = await supabase
      .from("club_calendar_entries")
      .delete({ count: "exact" })
      .eq("student_id", studentId)
      .in("entry_date", TEST_DATES);
    if (error) { console.error("clean failed:", error.message); process.exit(1); }
    console.log(`removed test entries: ${count ?? "?"}`);
    process.exit(0);
  }

  const rows = [
    { student_id: studentId, entry_date: DATES.day_off, kind: "day_off", note: "ТЕСТ Фаза1: выходной", status: "approved", source: "club" },
    { student_id: studentId, entry_date: DATES.preference, kind: "preference", preferred_workout_type: "intervals", status: "approved", source: "club" },
    { student_id: studentId, entry_date: DATES.note, kind: "note", note: "ТЕСТ Фаза1: вечерняя тренировка удобнее", status: "approved", source: "club" },
    { student_id: studentId, entry_date: DATES.race, kind: "race", race_name: "ТЕСТ Клуб Полумарафон", race_city: "Сочи", race_distance_label: "21.1 км", race_target_seconds: 5400, status: "approved", source: "club" },
  ];
  const { error, data } = await supabase.from("club_calendar_entries").insert(rows).select("id, kind, entry_date");
  if (error) { console.error("seed failed:", error.message); process.exit(1); }
  console.log(`seeded ${(data as unknown[])?.length ?? 0} approved test entries on student ${studentId.slice(0, 8)}… (dates ${TEST_DATES.join(", ")})`);
  console.log("теперь: dry-run покажет их; после проверки — этот же скрипт с --clean удалит.");
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
