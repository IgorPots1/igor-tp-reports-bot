/**
 * Demote strava_best_effort club_records off their auto-`verified` trust (Phase-1 decision).
 * Graduated (because `preliminary` is STILL shown; only `hidden` is suppressed):
 *   - a race_event that day (±3d)      → keep VERIFIED (real race, mostly foreign)
 *   - physiologically IMPOSSIBLE        → HIDDEN (the phantom PRs: Krylova 5k 18:57, Larionova 5k,
 *       (faster than the athlete's own real/other records imply, Riegel)   Klimovich 10k 35:36)
 *   - everything else                   → PRELIMINARY (unconfirmed Strava best-effort, shown as such)
 * DRY-RUN by default (prints the split + diff); --commit writes.
 */
import process from "node:process";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const KM: Record<string, number> = { "5k": 5, "10k": 10, "21k": 21.0975, "42k": 42.195 };
const PAGE = 1000;
function fmt(s: number): string { const x = Math.round(s), h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), ss = x % 60; return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`; }
function pace(s: number, km: number): string { return fmt(s / km).replace(/^0:/, "") + "/км"; }
function riegel(t1: number, d1: number, d2: number): number { return t1 * Math.pow(d2 / d1, 1.06); }
function d2(a: string, b: string): number { return Math.abs((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 864e5); }
async function fetchAll<T>(sb: ReturnType<typeof createSupabaseServerClient>, t: string, s: string): Promise<T[]> {
  const o: T[] = []; let f = 0;
  for (;;) { const { data, error } = await sb.from(t).select(s).range(f, f + PAGE - 1) as { data: T[] | null; error: { message: string } | null };
    if (error) { console.error(t, error.message); break; } const b = data ?? []; o.push(...b); if (b.length < PAGE) break; f += PAGE; }
  return o;
}
type Rec = { id: string; student_id: string; distance_key: string; duration_seconds: number; record_date: string | null; trust: string; source: string };

async function main(): Promise<void> {
  const sb = createSupabaseServerClient();
  const students = await fetchAll<{ id: string; student_name: string | null }>(sb, "trainingpeaks_students", "id, student_name");
  const nameById = new Map(students.map((s) => [s.id, s.student_name ?? s.id]));
  const recs = await fetchAll<Rec>(sb, "club_records", "id, student_id, distance_key, duration_seconds, record_date, trust, source");
  const evs = await fetchAll<{ student_id: string; event_date: string | null }>(sb, "trainingpeaks_race_events", "student_id, event_date");
  const evDays = evs.map((e) => ({ sid: e.student_id, d: (e.event_date ?? "").slice(0, 10) })).filter((e) => e.d);

  // anchors per athlete = real (official/coach) records + race-day-verified records, at standard distances
  const realByStudent = new Map<string, { km: number; sec: number }[]>();
  const stravaByStudent = new Map<string, { km: number; sec: number }[]>();
  for (const r of recs) {
    const km = KM[r.distance_key]; if (!km) continue;
    if (r.source === "strava_best_effort") (stravaByStudent.get(r.student_id) ?? stravaByStudent.set(r.student_id, []).get(r.student_id)!).push({ km, sec: r.duration_seconds });
    else (realByStudent.get(r.student_id) ?? realByStudent.set(r.student_id, []).get(r.student_id)!).push({ km, sec: r.duration_seconds });
  }

  const strava = recs.filter((r) => r.source === "strava_best_effort");
  const plan: { r: Rec; to: string; why: string }[] = [];
  for (const r of strava) {
    const km = KM[r.distance_key]; const d = (r.record_date ?? "").slice(0, 10);
    const raceDay = evDays.some((e) => e.sid === r.student_id && d2(e.d, d) <= 3);
    if (raceDay) { if (r.trust !== "verified") plan.push({ r, to: "verified", why: "гонка в этот день" }); continue; }
    // anchor: real records first; else the athlete's OTHER strava records (internal consistency)
    const real = (realByStudent.get(r.student_id) ?? []).filter((a) => Math.abs(a.km - km) > 1e-6);
    const others = (stravaByStudent.get(r.student_id) ?? []).filter((a) => Math.abs(a.km - km) > 1e-6);
    const anchors = real.length ? real : others;
    let impossible = false; let detail = "нет якоря";
    if (anchors.length) {
      const best = anchors.reduce((b, a) => (Math.abs(a.km - km) < Math.abs(b.km - km) ? a : b));
      const pred = riegel(best.sec, best.km, km); const ratio = r.duration_seconds / pred;
      detail = `якорь ${best.km.toFixed(1)}к ${fmt(best.sec)} → прогноз ${fmt(pred)}; факт ${fmt(r.duration_seconds)} = ${(ratio * 100).toFixed(0)}%${real.length ? "" : " (внутр. по strava)"}`;
      // HIDE only if BOTH Riegel-impossible AND the pace is absolutely elite (< 4:40/km) — a
      // GPS/vehicle artifact. A slow "impossible" (beginner's fresh 5k beating a slow 10k) stays
      // preliminary, not hidden (Igor's call: don't hide a possibly-real record).
      impossible = ratio < 0.90 && r.duration_seconds / km < 280;
    }
    plan.push({ r, to: impossible ? "hidden" : "preliminary", why: detail });
  }

  const byTo: Record<string, typeof plan> = { verified: [], hidden: [], preliminary: [] };
  for (const p of plan) byTo[p.to].push(p);
  console.log(`strava_best_effort club_records: ${strava.length}. План изменений трэста:\n`);
  console.log(`  → verified (гонка в день, оставить): ${strava.filter((r)=>evDays.some((e)=>e.sid===r.student_id&&d2(e.d,(r.record_date??"").slice(0,10))<=3)).length} (правок ${byTo.verified.length})`);
  console.log(`  → HIDDEN (невозможные фантомы): ${byTo.hidden.length}`);
  for (const p of byTo.hidden) console.log(`      ${nameById.get(p.r.student_id)} ${p.r.distance_key} ${fmt(p.r.duration_seconds)} (${pace(p.r.duration_seconds, KM[p.r.distance_key])}) ${(p.r.record_date??"").slice(0,10)} | ${p.why}`);
  console.log(`  → preliminary (неподтверждённые strava): ${byTo.preliminary.length}`);

  if (COMMIT) {
    let n = 0;
    for (const p of plan) { const { error } = await sb.from("club_records").update({ trust: p.to, updated_at: new Date().toISOString() }).eq("id", p.r.id); if (error) console.log(`ERR ${error.message}`); else n++; }
    console.log(`\nПРИМЕНЕНО: ${n} строк.`);
  } else {
    console.log(`\nDRY-RUN. --commit чтобы записать.`);
  }
}
main().then(() => process.exit(0)).catch((e: unknown) => { console.error(String((e as { message?: string })?.message ?? e)); process.exit(1); });
