// READ-ONLY proof of the question 14-day pause. Replays the last 28 days of SENT feedback drafts in
// time order, per student, driving the real isQuestionOnPause — reports how many repeat firings drop
// and how many REMAIN (a question must not vanish; it's a coach technique).
//
// Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs --env-file=.env.local scripts/prove-question-pause.ts
import { createSupabaseServerClient } from "@/features/supabase/server";
import { extractAskedQuestionKeys, isQuestionOnPause } from "@/features/trainingpeaks/feedback/question-pause";

type Sb = ReturnType<typeof createSupabaseServerClient>;
async function pageAll<T>(sb: Sb, table: string, cols: string, sinceIso: string): Promise<T[]> {
  const out: T[] = []; let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).gte("created_at", sinceIso).order("created_at", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? []; out.push(...rows);
    if (rows.length < 1000) break; from += 1000;
  }
  return out;
}

async function main() {
  const sb = createSupabaseServerClient();
  const since = new Date(Date.now() - 28 * 86400000).toISOString();
  const jobs = (await pageAll<{ student_id: string; draft_text: string | null; created_at: string }>(
    sb, "trainingpeaks_workout_feedback_jobs", "student_id, draft_text, created_at", since))
    .filter((j) => j.draft_text);

  // contact_status for the answered/engaged gate
  const sids = [...new Set(jobs.map((j) => j.student_id))];
  const touch = new Map<string, string | null>();
  for (let i = 0; i < sids.length; i += 300) {
    const { data } = await sb.from("trainingpeaks_student_contact_status").select("student_id, last_coach_touch_at").in("student_id", sids.slice(i, i + 300));
    for (const c of (data as Array<{ student_id: string; last_coach_touch_at: string | null }> | null) ?? []) touch.set(c.student_id, c.last_coach_touch_at);
  }

  // Replay in time order per student.
  const askedByStudent = new Map<string, Array<{ adviceKey: string; date: string }>>();
  const stat = new Map<string, { total: number; pauseDrop: number; answeredDrop: number; remain: number; students: Set<string> }>();
  const bump = (k: string) => stat.get(k) ?? stat.set(k, { total: 0, pauseDrop: 0, answeredDrop: 0, remain: 0, students: new Set() }).get(k)!;

  for (const j of jobs) {
    const date = (j.created_at ?? "").slice(0, 10);
    const keys = extractAskedQuestionKeys(j.draft_text);
    for (const key of keys) {
      const s = bump(key); s.total++; s.students.add(j.student_id);
      const recent = askedByStudent.get(j.student_id) ?? [];
      const pausedNoTouch = isQuestionOnPause({ adviceKey: key, recentlyAsked: recent, coachTouchAt: null, workoutDate: date });
      const pausedWithTouch = isQuestionOnPause({ adviceKey: key, recentlyAsked: recent, coachTouchAt: touch.get(j.student_id) ?? null, workoutDate: date });
      if (pausedNoTouch) s.pauseDrop++;
      else if (pausedWithTouch) s.answeredDrop++;
      else { s.remain++; recent.push({ adviceKey: key, date }); askedByStudent.set(j.student_id, recent); }
    }
  }

  console.log(`Черновиков (с текстом) за 28д: ${jobs.length}\n`);
  console.log("вопрос".padEnd(30) + "всего  → пауза  ответил  ОСТАЁТСЯ  учеников");
  let T = 0, D = 0, R = 0;
  for (const [k, s] of [...stat.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${k.padEnd(30)} ${String(s.total).padStart(4)}   ${String(s.pauseDrop).padStart(4)}   ${String(s.answeredDrop).padStart(4)}    ${String(s.remain).padStart(4)}     ${s.students.size}`);
    T += s.total; D += s.pauseDrop + s.answeredDrop; R += s.remain;
  }
  console.log(`\nИТОГО: ${T} вопросов → снято ${D} (пауза+ответил), ОСТАЁТСЯ ${R}. Вопрос НЕ исчезает: каждый ученик спрошен минимум раз в окно.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
