// READ-ONLY proof of per-type memory freshness windows. Pulls every ACTIVE coach-memory item
// (is_active=true, not explicitly expired), applies isMemoryItemFresh as of today, and reports how
// many stale items get hidden from the reply-draft prompt — globally, by type, and for the students
// most affected. Nothing is mutated. Shows that short-lived states (illness/mood/travel) drop while
// durable prefs/goals/comm-style stay.
//
// Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs --env-file=.env.local scripts/prove-memory-freshness.ts
import { createSupabaseServerClient } from "@/features/supabase/server";
import { getTrainingPeaksStudentById } from "@/features/trainingpeaks/repository";
import {
  MEMORY_FRESHNESS_WINDOW_DAYS,
  daysBetweenIso,
  isMemoryItemFresh,
} from "@/features/trainingpeaks/memory-freshness";

type Row = {
  student_id: string;
  memory_type: string;
  summary_text: string | null;
  last_seen_at: string;
  valid_until: string | null;
};

async function main() {
  const sb = createSupabaseServerClient();
  const asOf = new Date().toISOString().slice(0, 10);

  // Pull all active, non-expired items (mirrors the list query the prompt uses).
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("trainingpeaks_student_memory_items")
      .select("student_id, memory_type, summary_text, last_seen_at, valid_until")
      .eq("is_active", true)
      .or(`valid_until.is.null,valid_until.gte.${asOf}`)
      .order("student_id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data as Row[]) ?? [];
    rows.push(...page);
    if (page.length < 1000) break;
    from += 1000;
  }

  const fresh = (r: Row) =>
    isMemoryItemFresh(
      { memoryType: r.memory_type as never, lastSeenAt: r.last_seen_at, validUntil: r.valid_until },
      asOf
    );

  // Global + per-type
  const byType = new Map<string, { total: number; stale: number }>();
  const staleByStudent = new Map<string, number>();
  let total = 0;
  let stale = 0;
  for (const r of rows) {
    total++;
    const t = byType.get(r.memory_type) ?? { total: 0, stale: 0 };
    t.total++;
    if (!fresh(r)) {
      stale++;
      t.stale++;
      staleByStudent.set(r.student_id, (staleByStudent.get(r.student_id) ?? 0) + 1);
    }
    byType.set(r.memory_type, t);
  }

  console.log(`Дата отсчёта: ${asOf}`);
  console.log(`Активных заметок памяти: ${total} у ${new Set(rows.map((r) => r.student_id)).size} учеников\n`);
  console.log("ПО ТИПАМ (окно дней):");
  console.log("тип".padEnd(26) + "окно  всего  протухло  %");
  for (const [t, s] of [...byType.entries()].sort((a, b) => b[1].stale - a[1].stale)) {
    const win = MEMORY_FRESHNESS_WINDOW_DAYS[t as keyof typeof MEMORY_FRESHNESS_WINDOW_DAYS];
    const pct = s.total ? Math.round((s.stale / s.total) * 100) : 0;
    console.log(`${t.padEnd(26)} ${String(win ?? "—").padStart(4)}  ${String(s.total).padStart(5)}  ${String(s.stale).padStart(8)}  ${pct}%`);
  }
  console.log(`\nИТОГО скрывается как протухшее: ${stale} из ${total} (${Math.round((stale / total) * 100)}%). БД не трогается — только промпт.`);

  // Students most affected
  console.log(`\nТОП-8 учеников по числу протухших заметок:`);
  const top = [...staleByStudent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [sid, n] of top) {
    const student = await getTrainingPeaksStudentById(sid).catch(() => null);
    const active = rows.filter((r) => r.student_id === sid);
    const keep = active.filter(fresh).length;
    console.log(`  ${(student?.name ?? sid).padEnd(24)} активно ${active.length} → показываем ${keep}, скрыто ${n}`);
  }

  // One concrete student: before/after list
  if (top.length > 0) {
    const sid = top[0][0];
    const student = await getTrainingPeaksStudentById(sid).catch(() => null);
    console.log(`\n═══ ${student?.name ?? sid}: ЧТО УХОДИТ, ЧТО ОСТАЁТСЯ ═══`);
    const items = rows
      .filter((r) => r.student_id === sid)
      .sort((a, b) => (b.last_seen_at > a.last_seen_at ? 1 : -1));
    for (const r of items) {
      const age = daysBetweenIso(r.last_seen_at, asOf);
      const mark = fresh(r) ? "✅ ОСТАЁТСЯ" : "🚫 скрыто  ";
      const sum = (r.summary_text ?? "").replace(/\s+/g, " ").slice(0, 60);
      console.log(`  ${mark} ${String(age).padStart(3)}д  ${r.memory_type.padEnd(22)} ${sum}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
