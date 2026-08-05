/**
 * RULE (ongoing): a CONFIRMED official result's distance overrides the race_event distance.
 * TP's scanned distance is unreliable; a protocol (probeg / coach-confirmed) is ground truth.
 * So whenever club_official_results has a race distance for a (student, date), reconcile the
 * matching trainingpeaks_race_events.distance_km to it. Fixes cases the title-parser can't
 * (Пушкин 30 stored 21.1, ЗаБег 5 stored 10) and keeps fixing them as new protocols arrive.
 *
 * ONLY source in (official_protocol, coach_confirmed) — strava_best_effort split distances
 * (400m/1k/15k…) are NOT the race and are excluded. Pending queue rows do NOT override until
 * confirmed (they are not in club_official_results yet). Idempotent.
 *
 * DRY-RUN by default; --commit writes. Wired into run-club-probeg-sync-weekly.sh after the probe.
 */
import process from "node:process";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const PAGE = 1000;
function km(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 100 ? n / 1000 : n;
}
function d2(a: string, b: string): number {
  return Math.abs((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 864e5);
}
async function fetchAll<T>(sb: ReturnType<typeof createSupabaseServerClient>, table: string, select: string, refine?: (q: unknown) => unknown): Promise<T[]> {
  const out: T[] = []; let from = 0;
  for (;;) {
    let q: unknown = sb.from(table).select(select).range(from, from + PAGE - 1);
    if (refine) q = refine(q);
    const { data, error } = (await q) as { data: T[] | null; error: { message: string } | null };
    if (error) { console.error(`${table}: ${error.message}`); break; }
    const b = data ?? []; out.push(...b); if (b.length < PAGE) break; from += PAGE;
  }
  return out;
}

async function main(): Promise<void> {
  const sb = createSupabaseServerClient();
  const students = await fetchAll<{ id: string; student_name: string | null }>(sb, "trainingpeaks_students", "id, student_name");
  const nameById = new Map(students.map((s) => [s.id, s.student_name ?? s.id]));

  const off = await fetchAll<{ student_id: string; race_date: string; distance_km: number | null; source: string }>(
    sb, "club_official_results", "student_id, race_date, distance_km, source",
    (q) => (q as { in: (c: string, v: string[]) => unknown }).in("source", ["official_protocol", "coach_confirmed"]),
  );
  // race distance per (student|date) = max official distance that day (splits already excluded by source)
  const raceKmByKey = new Map<string, { kmv: number; multi: boolean }>();
  for (const o of off) {
    const kv = km(o.distance_km); if (kv == null) continue;
    const key = `${o.student_id}|${o.race_date}`;
    const cur = raceKmByKey.get(key);
    if (!cur) raceKmByKey.set(key, { kmv: kv, multi: false });
    else raceKmByKey.set(key, { kmv: Math.max(cur.kmv, kv), multi: cur.multi || Math.abs(cur.kmv - kv) > 1 });
  }

  const evs = await fetchAll<{ id: string; student_id: string; event_date: string | null; title: string | null; distance_km: number | null }>(
    sb, "trainingpeaks_race_events", "id, student_id, event_date, title, distance_km",
  );

  let changed = 0; const notes: string[] = [];
  for (const e of evs) {
    const d = (e.event_date ?? "").slice(0, 10); if (!d) continue;
    // find the official race distance for this event: same student, date within ±3d
    let best: { kmv: number; multi: boolean } | null = null; let bestDelta = 99;
    for (const [key, v] of raceKmByKey) {
      const [sid, odate] = key.split("|");
      if (sid !== e.student_id) continue;
      const dd = d2(d, odate);
      if (dd <= 3 && dd < bestDelta) { best = v; bestDelta = dd; }
    }
    if (!best) continue;
    const cur = e.distance_km;
    const disagrees = cur == null || Math.abs(cur - best.kmv) > Math.max(1, 0.12 * Math.max(cur, best.kmv));
    if (!disagrees) continue;
    notes.push(`  ${nameById.get(e.student_id)} ${d} "${(e.title ?? "").slice(0, 32)}" | ${cur ?? "НЕТ"} → ${best.kmv}${best.multi ? " (в этот день несколько дистанций — взят max)" : ""}`);
    changed++;
    if (COMMIT) {
      const { error } = await sb.from("trainingpeaks_race_events").update({ distance_km: best.kmv, updated_at: new Date().toISOString() }).eq("id", e.id);
      if (error) notes.push(`     ERR ${error.message}`);
    }
  }
  console.log(notes.join("\n"));
  console.log(`\n${COMMIT ? "ПРИМЕНЕНО" : "DRY-RUN (--commit чтобы записать)"} · race_events сверено с протоколом, правок: ${changed}`);
}
main().then(() => process.exit(0)).catch((e: unknown) => { console.error(String((e as { message?: string })?.message ?? e)); process.exit(1); });
