/**
 * Block B backfill — bring existing club_records into line with the new precedence rule:
 * a personal record is the FASTEST legitimate result, with the OFFICIAL PROTOCOL as the
 * authority. Two classes of understatement are corrected:
 *
 *   (1) coach_confirmed slot shadows a faster-or-equal official_protocol — the record shows a
 *       slower hand-entered time even though the organiser's protocol is faster (e.g. a rough
 *       coach entry for a race whose faster official arrived later, often same date).
 *   (2) an official_protocol slot that is not the FASTEST captured official for that distance —
 *       an older/slower protocol sits in the record while a faster confirmed protocol exists.
 *
 * Guards (never overstate, never trust an uncertain bucket):
 *   • a STRICTLY FASTER coach_confirmed slot is kept — never understate a record by discarding a
 *     faster hand-passed time the coach holds and we have no protocol for.
 *   • only NON-doubtful official_protocol rows are candidates (a doubtful distance is the wrong
 *     bucket — that path is the queue, block D).
 *   • strava_best_effort / reconstructed slots are LEFT ALONE here (block C owns Strava records);
 *     this backfill only ever replaces a coach_confirmed or official_protocol slot.
 *
 * Mirrors confirmProtocolMatch's record write (source/trust/pace/protocol fields). DRY-RUN by
 * default — prints the plan and writes NOTHING. Pass --commit to upsert club_records.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local scripts/club-record-precedence-backfill.ts [--commit]
 */
import { distanceKeyOf } from "@/features/club/probeg-parse";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const PROTO_KM_OF_KEY: Record<string, number> = { "5k": 5, "10k": 10, "21k": 21.0975, "42k": 42.195 };

const fmt = (s: number | null): string => {
  if (s == null) return "—";
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), ss = t % 60;
  const p = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
};

type Rec = { student_id: string; distance_key: string; duration_seconds: number; source: string };
type Off = { student_id: string; race_date: string; distance_km: number | null; result_seconds: number; protocol_url: string | null; event: string | null; distance_doubtful: boolean };

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();

  const { data: recsData, error: rErr } = await supabase
    .from("club_records")
    .select("student_id,distance_key,duration_seconds,source");
  if (rErr) throw new Error(`club_records: ${rErr.message}`);
  const recs = (recsData ?? []) as Rec[];

  const { data: offData, error: oErr } = await supabase
    .from("club_official_results")
    .select("student_id,race_date,distance_km,result_seconds,protocol_url,event,distance_doubtful")
    .eq("source", "official_protocol");
  if (oErr) throw new Error(`club_official_results: ${oErr.message}`);
  const offs = (offData ?? []) as Off[];

  const { data: stu } = await supabase.from("trainingpeaks_students").select("id,student_name");
  const nameById = Object.fromEntries(((stu ?? []) as Array<{ id: string; student_name: string | null }>).map((s) => [s.id, s.student_name ?? s.id.slice(0, 8)]));

  // fastest NON-doubtful official per (student, distance bucket)
  const fastestOff = new Map<string, Off>();
  for (const o of offs) {
    if (o.distance_doubtful) continue;
    const dk = distanceKeyOf(o.distance_km);
    if (!dk) continue;
    const key = `${o.student_id}|${dk}`;
    const cur = fastestOff.get(key);
    if (!cur || Number(o.result_seconds) < Number(cur.result_seconds)) fastestOff.set(key, o);
  }

  const plan: Array<{ studentId: string; dk: string; fromSource: string; fromSec: number; toSec: number; date: string; url: string | null; event: string | null; klass: string }> = [];
  for (const rec of recs) {
    if (rec.source !== "coach_confirmed" && rec.source !== "official_protocol") continue; // strava/reconstructed → block C
    const best = fastestOff.get(`${rec.student_id}|${rec.distance_key}`);
    if (!best) continue;
    const bestSec = Number(best.result_seconds);
    const slotSec = Number(rec.duration_seconds);
    if (rec.source === "coach_confirmed") {
      if (slotSec <= bestSec) continue;         // coach strictly faster (or equal) → keep coach
      plan.push({ studentId: rec.student_id, dk: rec.distance_key, fromSource: rec.source, fromSec: slotSec, toSec: bestSec, date: best.race_date, url: best.protocol_url, event: best.event, klass: "coach→official" });
    } else { // official_protocol slot
      if (bestSec >= slotSec) continue;         // already the fastest official (or tie) → nothing to do
      plan.push({ studentId: rec.student_id, dk: rec.distance_key, fromSource: rec.source, fromSec: slotSec, toSec: bestSec, date: best.race_date, url: best.protocol_url, event: best.event, klass: "stale-official" });
    }
  }

  plan.sort((a, b) => (nameById[a.studentId] ?? "").localeCompare(nameById[b.studentId] ?? "") || a.dk.localeCompare(b.dk));
  console.log(`=== Block B record-precedence backfill — ${plan.length} correction(s) ${COMMIT ? "(COMMIT)" : "(DRY-RUN)"} ===\n`);
  console.log("student".padEnd(26), "dist".padEnd(5), "class".padEnd(15), "now".padEnd(10), "→ becomes".padEnd(12), "date");
  for (const p of plan) {
    console.log(
      (nameById[p.studentId] ?? "").padEnd(26),
      p.dk.padEnd(5),
      p.klass.padEnd(15),
      `${p.fromSource === "coach_confirmed" ? "coach" : "off"} ${fmt(p.fromSec)}`.padEnd(10),
      `→ off ${fmt(p.toSec)}`.padEnd(12),
      p.date
    );
  }

  if (!COMMIT) { console.log("\nDRY-RUN: nothing written. Re-run with --commit to apply."); return; }

  let ok = 0;
  const nowIso = new Date().toISOString();
  for (const p of plan) {
    const dkm = PROTO_KM_OF_KEY[p.dk];
    const { error } = await supabase.from("club_records").upsert({
      student_id: p.studentId, distance_key: p.dk, duration_seconds: p.toSec,
      pace_sec_per_km: dkm ? Math.round(p.toSec / dkm) : null,
      record_date: p.date, trust: "verified", source: "official_protocol",
      protocol_url: p.url, protocol_result_time_seconds: p.toSec, verified_at: nowIso, race_name: p.event,
    }, { onConflict: "student_id,distance_key" });
    if (error) { console.log(`  FAIL ${nameById[p.studentId]} ${p.dk}: ${error.message}`); continue; }
    ok++;
  }
  console.log(`\nCOMMIT done: ${ok}/${plan.length} club_records rows updated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
