/**
 * One-off transfer for the club-races consolidation (step 3 of 4). Copies non-rejected
 * rows from the legacy `club_races` table into `club_calendar_entries` kind='race': the
 * path that actually executes to TP. Idempotent + dedup-safe:
 *   - skips a legacy race already present in the calendar (student + date + normalized name);
 *   - dedups within the batch;
 *   - tolerates the unique index (migration 20260816000000) on --apply (23505 -> skip).
 *
 * DRY-RUN BY DEFAULT: prints what WOULD be inserted, writes nothing. Add --apply to write.
 * club_races is NOT modified or dropped (kept read-only legacy until Igor's word).
 * Requires migration 20260816000000 applied first (distance_meters column + dedup index).
 *
 * Run:  npm run club-races-migrate-to-calendar            (dry-run)
 *       npm run club-races-migrate-to-calendar -- --apply (write)
 */
import { createSupabaseServerClient } from "@/features/supabase/server";

const APPLY = process.argv.includes("--apply");

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/gu, " ");
}

type LegacyRace = {
  id: string;
  student_id: string;
  name: string;
  race_date: string;
  distance_label: string | null;
  distance_meters: number | null;
  city: string | null;
  target_result_seconds: number | null;
  status: string | null;
};

async function main() {
  const supabase = createSupabaseServerClient();

  const { data: legacy, error: le } = await supabase
    .from("club_races")
    .select("id, student_id, name, race_date, distance_label, distance_meters, city, target_result_seconds, status");
  if (le) throw new Error(`club_races read failed: ${le.message}`);
  const src = ((legacy as LegacyRace[] | null) ?? []).filter((r) => r.status !== "rejected");

  const { data: cal, error: ce } = await supabase
    .from("club_calendar_entries")
    .select("student_id, entry_date, race_name")
    .eq("kind", "race");
  if (ce) throw new Error(`calendar read failed: ${ce.message}`);
  const seen = new Set(
    ((cal as Array<{ student_id: string; entry_date: string; race_name: string | null }> | null) ?? []).map(
      (r) => `${r.student_id}|${r.entry_date}|${norm(r.race_name)}`
    )
  );

  const toInsert: Array<Record<string, unknown>> = [];
  let alreadyInCalendar = 0;
  for (const r of src) {
    const key = `${r.student_id}|${r.race_date}|${norm(r.name)}`;
    if (seen.has(key)) {
      alreadyInCalendar += 1;
      continue;
    }
    seen.add(key);
    toInsert.push({
      student_id: r.student_id,
      entry_date: r.race_date,
      kind: "race",
      race_name: r.name,
      race_city: r.city ?? null,
      race_distance_label: r.distance_label ?? null,
      distance_meters: r.distance_meters ?? null,
      race_target_seconds: r.target_result_seconds ?? null,
      status: "approved", // consolidated races are auto-approved
      source: "club",
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "APPLY" : "DRY-RUN",
        legacy_non_rejected: src.length,
        already_in_calendar_skipped: alreadyInCalendar,
        to_insert: toInsert.length,
        sample: toInsert.slice(0, 5).map((x) => ({ date: x.entry_date, name: x.race_name, meters: x.distance_meters })),
      },
      null,
      2
    )
  );

  if (!APPLY) {
    console.log("Ничего не записано (dry-run). Запусти с --apply, когда готов.");
    return;
  }

  let inserted = 0;
  let dupSkipped = 0;
  for (const row of toInsert) {
    const { error } = await supabase.from("club_calendar_entries").insert(row);
    if (error) {
      if (error.code === "23505") {
        dupSkipped += 1;
        continue;
      }
      throw new Error(`insert failed for ${String(row.race_name)}: ${error.message}`);
    }
    inserted += 1;
  }
  console.log(`Записано ${inserted} гонок в club_calendar_entries (пропущено дублей по индексу: ${dupSkipped}). club_races не тронут.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String((e as { message?: string })?.message ?? e));
    process.exit(1);
  });
