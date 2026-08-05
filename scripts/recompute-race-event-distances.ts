/**
 * Recompute trainingpeaks_race_events.distance_km/distance_raw from the EXPLICIT distance in
 * the title, correcting the scanner defect where TP's structured Distance field was trusted
 * blindly ("Bokeski 10 km" stored 21.1; a 50/65 km ultra stored 100; missing distances).
 *
 * Same rule as tp-scan-events.ts titleDistanceKm(): ONLY an explicit number+unit in the title
 * overrides — keyword-only ("марафон"/"полумарафон") is left alone (names the event, not the
 * athlete's distance). Fills a missing distance or corrects a disagreeing one.
 *
 * DRY-RUN by default (prints the diff); pass --commit to write.
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/recompute-race-event-distances.ts [--commit]
 */
import process from "node:process";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");

/** EXPLICIT distance from the title, or null. Mirrors tp-scan-events.ts titleDistanceKm(). */
function titleDistanceKm(title: string | null): number | null {
  if (!title) return null;
  const s = title.toLowerCase();
  const km = s.match(/(\d{1,3}(?:[.,]\d+)?)\s*(?:км|km|k(?![a-zа-яe-z]))/u);
  if (km) {
    const n = Number(km[1].replace(",", "."));
    if (n > 0 && n <= 100) return n;
  }
  const m = s.match(/(\d{3,5})\s*(?:м|m)(?![a-zа-яe-zи])/u);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1000 && n <= 100000) return n / 1000;
  }
  return null;
}
function kmToLabel(km: number): string {
  const r = Math.round(km * 10) / 10;
  return `${Number.isInteger(r) ? String(r) : r.toFixed(1)} км`;
}

async function main(): Promise<void> {
  const sb = createSupabaseServerClient();
  const out: { student_id: string; event_date: string | null; title: string | null; distance_km: number | null }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("trainingpeaks_race_events")
      .select("id, student_id, event_date, title, distance_km")
      .range(from, from + 999);
    if (error) { console.error(error.message); break; }
    const batch = (data ?? []) as (typeof out[number] & { id: string })[];
    // process this batch
    for (const r of batch) {
      const titleKm = titleDistanceKm(r.title);
      if (titleKm === null) continue;
      const tpKm = r.distance_km;
      const missing = tpKm === null || tpKm === 0;
      const disagrees = !missing && Math.abs(titleKm - (tpKm as number)) > Math.max(1, 0.12 * Math.max(titleKm, tpKm as number));
      if (!missing && !disagrees) continue;
      const reason = missing ? "title_filled" : "title_override";
      console.log(`  ${reason.padEnd(14)} ${(r.event_date ?? "").slice(0, 10)} "${(r.title ?? "").slice(0, 40)}" | ${tpKm ?? "НЕТ"} → ${titleKm}`);
      if (COMMIT) {
        const { error: uErr } = await sb
          .from("trainingpeaks_race_events")
          .update({ distance_km: titleKm, distance_raw: kmToLabel(titleKm), updated_at: new Date().toISOString() })
          .eq("id", r.id);
        if (uErr) console.log(`     ERR ${uErr.message}`);
      }
    }
    out.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  console.log(`\n${COMMIT ? "ПРИМЕНЕНО" : "DRY-RUN (диф выше, --commit чтобы записать)"} · всего race_events прочитано: ${out.length}`);
}
main().then(() => process.exit(0)).catch((e: unknown) => { console.error(String((e as { message?: string })?.message ?? e)); process.exit(1); });
