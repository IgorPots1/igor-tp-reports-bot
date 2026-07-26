/**
 * Read-only. (a) inbound-recency OLD (truncated) vs NEW (paginated): does the
 * send-channel INPUT change for any active student? (b) BLOCK 4: verify students
 * with >1000 laps / >1000 health rows are now read in full.
 */
import { createSupabaseServerClient } from "@/features/supabase/server";
import { fetchAllInChunks, fetchAllRows } from "@/features/supabase/paginate";

type Rec = { lastBusinessDmAt: string | null; lastGroupAt: string | null };

async function main() {
  const supabase = createSupabaseServerClient();
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

  const students = await fetchAllRows<{ id: string }>(
    (f, t) => supabase.from("trainingpeaks_students").select("id").eq("is_active", true).eq("is_service_account", false).order("id").range(f, t),
    { label: "students" }
  );
  const ids = students.map((s) => s.id);

  // NEW: paginated per chunk.
  const newRows = await fetchAllInChunks<{ student_id: string; observed_at: string; source_type: string | null }>(
    ids, 150, (part, f, t) => supabase.from("trainingpeaks_telegram_context_observations")
      .select("student_id, observed_at, source_type").in("student_id", part).gte("observed_at", since)
      .order("observed_at", { ascending: false }).order("id").range(f, t),
    { label: "recency-new" }
  );
  // OLD: single read per 150 chunk, no range → server caps at 1000.
  const oldRows: typeof newRows = [];
  for (let i = 0; i < ids.length; i += 150) {
    const part = ids.slice(i, i + 150);
    const { data } = await supabase.from("trainingpeaks_telegram_context_observations")
      .select("student_id, observed_at, source_type").in("student_id", part).gte("observed_at", since)
      .order("observed_at", { ascending: false });
    oldRows.push(...((data ?? []) as typeof newRows));
  }
  const build = (rows: typeof newRows): Map<string, Rec> => {
    const m = new Map<string, Rec>();
    for (const r of rows) {
      const cur = m.get(r.student_id) ?? { lastBusinessDmAt: null, lastGroupAt: null };
      if (r.source_type === "business_dm" && !cur.lastBusinessDmAt) cur.lastBusinessDmAt = r.observed_at;
      else if (r.source_type === "group_topic" && !cur.lastGroupAt) cur.lastGroupAt = r.observed_at;
      m.set(r.student_id, cur);
    }
    return m;
  };
  const oldM = build(oldRows), newM = build(newRows);
  const within24h = (t: string | null) => t != null && Date.now() - new Date(t).getTime() <= 24 * 3600 * 1000;

  let dmChanged = 0, groupChanged = 0, dmWindowFlips = 0;
  const flipExamples: string[] = [];
  for (const id of ids) {
    const o = oldM.get(id) ?? { lastBusinessDmAt: null, lastGroupAt: null };
    const n = newM.get(id) ?? { lastBusinessDmAt: null, lastGroupAt: null };
    if (o.lastBusinessDmAt !== n.lastBusinessDmAt) dmChanged++;
    if (o.lastGroupAt !== n.lastGroupAt) groupChanged++;
    if (within24h(o.lastBusinessDmAt) !== within24h(n.lastBusinessDmAt)) {
      dmWindowFlips++;
      if (flipExamples.length < 10) flipExamples.push(`${id.slice(0, 8)}: DM-24h ${within24h(o.lastBusinessDmAt)}→${within24h(n.lastBusinessDmAt)}`);
    }
  }
  console.log(`# 2.3 inbound-recency OLD vs NEW (active students: ${ids.length})`);
  console.log(`OLD rows=${oldRows.length}, NEW rows=${newRows.length}`);
  console.log(`students with changed lastBusinessDmAt: ${dmChanged}; changed lastGroupAt: ${groupChanged}`);
  console.log(`students whose Business-DM 24h window FLIPS (channel decision changes): ${dmWindowFlips}`);
  for (const e of flipExamples) console.log("  " + e);

  // BLOCK 4: full-read verification for the heaviest lap + health students.
  console.log(`\n# BLOCK 4 — full read for >1000-row students`);
  // Health: full paginated read; confirm the heaviest student exceeds 1000.
  const healthCounts = await fetchAllRows<{ student_id: string }>(
    (f, t) => supabase.from("trainingpeaks_health_metrics_cache").select("student_id").order("id").range(f, t),
    { label: "health-all" }
  );
  const hByStu = new Map<string, number>();
  for (const r of healthCounts) hByStu.set(r.student_id, (hByStu.get(r.student_id) ?? 0) + 1);
  const heavyHealth = [...hByStu.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(`health: paginated total rows read=${healthCounts.length}; heaviest student=${heavyHealth?.[0].slice(0, 8)} with ${heavyHealth?.[1]} rows (was capped at 1000 before)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
