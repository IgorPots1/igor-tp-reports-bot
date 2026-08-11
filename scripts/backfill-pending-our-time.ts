/**
 * RULE (ongoing): every club_protocol_pending row must show OUR side (time + distance) so the coach
 * compares protocol-vs-us at a glance. The probeg stager (probeg-people-probe.ts loadOurRaces) fills
 * our_seconds correctly, but rows staged by hand / from the browser (foreign races: Montenegro, Chicago)
 * were inserted with our_seconds = NULL — the queue then shows "?" even though the day's GPS workout has
 * a real finish time. This self-heals ANY pending row missing our_seconds from that day's longest GPS run.
 *
 * our_seconds  = the day's longest completed run WITH a non-null completed_time_raw (hours -> seconds).
 * our_distance_km = that run's GPS distance when present (more accurate than the scanned race_event field).
 * distance_doubtful is re-derived for rows we touch: cleared when our GPS distance now agrees with the
 * protocol, kept/flagged when they genuinely disagree. Rows with NO workout that day stay "?" (honest —
 * the athlete has no recording on our side; nothing to show).
 *
 * DRY-RUN by default; --commit writes. Idempotent (only touches status='pending' rows with our_seconds
 * IS NULL). Wired into run-club-probeg-sync-weekly.sh after the reconcile step.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/backfill-pending-our-time.ts [--commit]
 */
import process from "node:process";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");

function hoursToSeconds(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "string" ? Number(raw) : (raw as number);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 3600);
}
function km(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 100 ? n / 1000 : n; // metres -> km
}
function fmt(sec: number | null): string {
  if (sec == null) return "?";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
// distances "agree" when within the larger of 1 km or 15% of the protocol distance
function distancesAgree(ourKm: number | null, protoKm: number | null): boolean | null {
  if (ourKm == null || protoKm == null) return null;
  return Math.abs(ourKm - protoKm) <= Math.max(1, 0.15 * protoKm);
}

type Pending = {
  id: string; student_id: string; race_date: string;
  our_seconds: number | null; our_distance_km: number | null; our_title: string | null;
  protocol_seconds: number | null; protocol_distance_km: number | null; protocol_event: string | null;
  distance_doubtful: boolean;
};

async function main(): Promise<void> {
  const sb = createSupabaseServerClient();
  const { data, error } = await sb
    .from("club_protocol_pending")
    .select("id, student_id, race_date, our_seconds, our_distance_km, our_title, protocol_seconds, protocol_distance_km, protocol_event, distance_doubtful")
    .eq("status", "pending")
    .is("our_seconds", null);
  if (error) { console.error(error.message); process.exit(1); }
  const rows = (data as Pending[]) ?? [];

  const names = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => r.student_id))];
  if (ids.length) {
    const { data: st } = await sb.from("trainingpeaks_students").select("id, student_name").in("id", ids);
    for (const s of (st as Array<{ id: string; student_name: string | null }> ?? [])) names.set(s.id, s.student_name ?? s.id);
  }

  console.log(`${COMMIT ? "COMMIT" : "DRY-RUN"} · pending rows with our_seconds IS NULL: ${rows.length}\n`);
  let filled = 0, noWorkout = 0, doubtCleared = 0, doubtSet = 0;

  for (const r of rows) {
    const who = names.get(r.student_id) ?? r.student_id;
    // the race workout = the longest completed run that day that actually has a finish time
    const { data: wk } = await sb
      .from("trainingpeaks_workout_cache")
      .select("completed_time_raw, completed_distance_raw")
      .eq("student_id", r.student_id)
      .eq("workout_date", r.race_date)
      .order("completed_distance_raw", { ascending: false, nullsFirst: false });
    const all = (wk as Array<{ completed_time_raw: unknown; completed_distance_raw: unknown }> ?? [])
      .filter((w) => hoursToSeconds(w.completed_time_raw) != null);
    const best = all[0]; // longest distance among rows that have a time
    if (!best) {
      noWorkout++;
      console.log(`  SKIP  ${who} · ${r.race_date} «${r.our_title ?? ""}» — no workout with a time that day → stays "?"`);
      continue;
    }
    const ourSec = hoursToSeconds(best.completed_time_raw)!;
    const gpsKm = km(best.completed_distance_raw);
    const ourKm = gpsKm != null ? Math.round(gpsKm * 100) / 100 : r.our_distance_km;
    const protoKm = km(r.protocol_distance_km);
    const agree = distancesAgree(ourKm, protoKm);
    let newDoubtful = r.distance_doubtful;
    if (agree === true && r.distance_doubtful) { newDoubtful = false; doubtCleared++; }
    if (agree === false && !r.distance_doubtful) { newDoubtful = true; doubtSet++; }

    filled++;
    const doubtNote = newDoubtful !== r.distance_doubtful ? ` · doubtful ${r.distance_doubtful}→${newDoubtful}` : (newDoubtful ? " · doubtful(kept)" : "");
    console.log(`  FILL  ${who} · ${r.race_date} «${r.our_title ?? ""}» → our ${fmt(ourSec)} / ${ourKm ?? "?"}km  (proto ${fmt(r.protocol_seconds)} / ${protoKm ?? "?"}km «${r.protocol_event ?? ""}»)${doubtNote}`);

    if (COMMIT) {
      const patch: Record<string, unknown> = { our_seconds: ourSec, distance_doubtful: newDoubtful };
      if (ourKm != null) patch.our_distance_km = ourKm;
      const up = await sb.from("club_protocol_pending").update(patch).eq("id", r.id).eq("status", "pending").is("our_seconds", null);
      if (up.error) console.error(`    ! update failed: ${up.error.message}`);
    }
  }

  console.log(`\nSUMMARY: filled ${filled}, no-workout(stays "?") ${noWorkout}, doubtful cleared ${doubtCleared}, doubtful set ${doubtSet}${COMMIT ? "" : "  [dry-run, nothing written]"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
