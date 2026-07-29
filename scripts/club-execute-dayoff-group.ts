/**
 * Group consecutive approved day_off entries for ONE student into single Availability RANGES
 * and apply/rollback them. TP Availability takes startDate..endDate, so 22-26 marked as five
 * day_off entries becomes ONE record, not five — and all five club_calendar_entries link to
 * that one availability id (rolled back together).
 *
 * SAFETY GATES (all required to actually write to TP):
 *   --apply|--rollback  +  CLUB_TP_EXECUTION_ENABLED=true  +  CLUB_DAYOFF_AS_AVAILABILITY=true
 * Without them it is a DRY-RUN (prints the groups + payloads, touches nothing). Igor's hand.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local \
 *     scripts/club-execute-dayoff-group.ts [studentUuid] [--apply|--rollback]
 * Default student = Igor's row.
 */
import { createSupabaseServerClient } from "@/features/supabase/server";
import { groupConsecutiveDayoffs, buildDayoffGroupAvailability } from "@/features/club/tp-execution";
import { isClubDayoffAsAvailabilityEnabled } from "@/features/club/constants";
import { markCalendarEntryApplied, rollbackCalendarEntryApplied } from "@/features/club/calendar";
import { createAvailability, deleteAvailability } from "@/features/trainingpeaks/tp-api-client";
import { parseAthleteIdFromUrl } from "@/features/trainingpeaks/athlete-roster-import";

const IGOR = "7cb54839-7e3b-4726-8023-1f49bd004168";
const arg1 = process.argv[2];
const STUDENT = arg1 && !arg1.startsWith("--") ? arg1 : IGOR;
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

async function athleteId(supabase: ReturnType<typeof createSupabaseServerClient>): Promise<number | null> {
  const { data } = await supabase.from("trainingpeaks_students").select("trainingpeaks_athlete_url").eq("id", STUDENT).maybeSingle();
  const url = (data as { trainingpeaks_athlete_url: string | null } | null)?.trainingpeaks_athlete_url ?? null;
  return url ? parseAthleteIdFromUrl(url) : null;
}

async function main(): Promise<void> {
  if (!isClubDayoffAsAvailabilityEnabled()) {
    console.error("CLUB_DAYOFF_AS_AVAILABILITY!=true — этот executor только для availability-режима выходных.");
    process.exit(1);
  }
  const supabase = createSupabaseServerClient();
  const aid = await athleteId(supabase);
  const gated = (APPLY || ROLLBACK) && process.env.CLUB_TP_EXECUTION_ENABLED === "true";

  if (ROLLBACK) {
    // All applied day_off availability entries, grouped by the shared availability id.
    const { data } = await supabase
      .from("club_calendar_entries")
      .select("id, entry_date, applied_tp_workout_id, applied_entity_type")
      .eq("student_id", STUDENT)
      .eq("kind", "day_off")
      .eq("status", "applied")
      .eq("applied_entity_type", "availability");
    const rows = (data as Array<Record<string, unknown>>) ?? [];
    const byAvail = new Map<number, string[]>();
    for (const r of rows) {
      const avid = r.applied_tp_workout_id as number;
      byAvail.set(avid, [...(byAvail.get(avid) ?? []), r.id as string]);
    }
    console.log(`откат: availability-записей=${byAvail.size} (охватывают ${rows.length} записей календаря)`);
    for (const [avid, entryIds] of byAvail) {
      if (!gated) { console.log(`  DRY: удалил бы availability ${avid} (athlete ${aid}) и откатил ${entryIds.length} записей`); continue; }
      const del = await deleteAvailability(aid as number, avid);
      console.log(`  deleteAvailability ${avid} status=${del.status}`);
      for (const id of entryIds) { const rb = await rollbackCalendarEntryApplied(id); console.log(`    entry ${id}: ${rb.ok ? "approved" : rb.error}`); }
    }
    process.exit(0);
  }

  // apply / dry-run: group approved unapplied day_off entries into ranges.
  const { data } = await supabase
    .from("club_calendar_entries")
    .select("id, entry_date, day_off_reason")
    .eq("student_id", STUDENT)
    .eq("kind", "day_off")
    .eq("status", "approved")
    .is("applied_tp_workout_id", null)
    .order("entry_date", { ascending: true });
  const entries = ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({ id: r.id as string, date: (r.entry_date as string | null) ?? null, reason: (r.day_off_reason as string | null) ?? null }));
  const groups = groupConsecutiveDayoffs(entries);
  console.log(`approved day_off=${entries.length} → групп (диапазонов)=${groups.length}`);
  for (const g of groups) {
    const payload = aid != null ? buildDayoffGroupAvailability(g, aid) : null;
    console.log(`\nгруппа ${g.startDate}..${g.endDate} reason=${JSON.stringify(g.reason)} записей=${g.entryIds.length}`);
    console.log(`  payload: ${JSON.stringify(payload)}`);
    if (!gated) { console.log("  DRY-RUN — в TP не записано."); continue; }
    const res = await createAvailability(aid as number, payload as unknown as Record<string, unknown>);
    console.log(`  создан availability id=${res.availabilityId} — связываю ${g.entryIds.length} записей`);
    for (const id of g.entryIds) { const m = await markCalendarEntryApplied(id, res.availabilityId, "availability"); console.log(`    entry ${id}: ${m.ok ? "applied" : m.error}`); }
  }
  if (!gated) console.log("\nDRY-RUN. Для реального создания: --apply + CLUB_TP_EXECUTION_ENABLED=true + CLUB_DAYOFF_AS_AVAILABILITY=true.");
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
