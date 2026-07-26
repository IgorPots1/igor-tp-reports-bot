/**
 * Coach-memory dedupe — DRY-RUN ONLY. Never deletes. Reports rows that would be
 * removed. Deletion is Igor's hand.
 *
 * Conservative rule: a row is a deletable duplicate ONLY if another row shares the
 * SAME (student_id, source_observation_id, memory_type, summary_text) — an EXACT
 * copy. Keep the earliest (min created_at); the rest are the deletable copies.
 * Rows that share (student, source, type) but have DIFFERENT summary_text are NOT
 * touched — a single message legitimately yields multiple/ refined facts; merging
 * them is a human decision, not an automatic delete.
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/dedupe-coach-memory-dry-run.ts
 */

import { createSupabaseServerClient } from "@/features/supabase/server";
import { fetchAllRows } from "@/features/supabase/paginate";

type Row = {
  id: string;
  student_id: string;
  source_observation_id: string | null;
  memory_type: string;
  summary_text: string;
  created_at: string;
};

async function main() {
  const supabase = createSupabaseServerClient();
  const rows = await fetchAllRows<Row>(
    (from, to) =>
      supabase
        .from("trainingpeaks_student_memory_items")
        .select("id, student_id, source_observation_id, memory_type, summary_text, created_at")
        .not("source_observation_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    { label: "dedupe:memory-items" }
  );

  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.student_id}|${r.source_observation_id}|${r.memory_type}|${(r.summary_text ?? "").trim()}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }

  const toDelete: Row[] = [];
  for (const list of byKey.values()) {
    if (list.length <= 1) continue;
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    toDelete.push(...list.slice(1)); // keep earliest, delete the rest (exact copies)
  }

  console.log(`# Coach-memory dedupe — DRY RUN (no deletes)`);
  console.log(`scanned rows with source_observation_id: ${rows.length}`);
  console.log(`exact-copy groups: ${[...byKey.values()].filter((l) => l.length > 1).length}`);
  console.log(`rows that WOULD be deleted (exact copies, keeping earliest): ${toDelete.length}`);
  if (toDelete.length > 0) {
    console.log(`\n| id | student_id | memory_type | created_at | summary |`);
    console.log(`|---|---|---|---|---|`);
    for (const r of toDelete) {
      console.log(`| ${r.id.slice(0, 8)} | ${r.student_id.slice(0, 8)} | ${r.memory_type} | ${r.created_at.slice(0, 10)} | ${(r.summary_text ?? "").slice(0, 50)} |`);
    }
    console.log(`\nTo actually delete, Igor runs a DELETE on these ids by hand after review.`);
  } else {
    console.log(`\nNothing qualifies for safe deletion (no exact-text copies). No action.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
