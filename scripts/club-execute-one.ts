/**
 * Phase 1.5 — create EXACTLY ONE club marker in TrainingPeaks for a single approved
 * club_calendar_entries row, then persist the link (idempotency + rollback anchor).
 *
 * SAFETY GATES (all required to actually write to TP):
 *   - pass the entry id as arg 1
 *   - pass --apply
 *   - CLUB_TP_EXECUTION_ENABLED=true in the environment
 * Without ALL THREE it is a DRY-RUN: it prints the exact CreateWorkoutPayload and does
 * NOT touch TrainingPeaks. This is Igor's hand — the assistant only prepares + dry-runs.
 *
 * Modes:
 *   <entryId>                      dry-run (print payload, no write)
 *   <entryId> --apply              create in TP (needs CLUB_TP_EXECUTION_ENABLED=true),
 *                                  then markCalendarEntryApplied(id, newTpWorkoutId)
 *   <entryId> --rollback           delete the created TP workout by applied_tp_workout_id,
 *                                  then clear the link + return status to 'approved'
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-execute-one.ts <entryId> [--apply|--rollback]
 */
import { createSupabaseServerClient } from "@/features/supabase/server";
import { planCalendarEntryAction, type ClubCalendarEntryRow } from "@/features/club/tp-execution";
import { markCalendarEntryApplied, rollbackCalendarEntryApplied } from "@/features/club/calendar";
import { createWorkout, deleteWorkout } from "@/features/trainingpeaks/tp-api-client";
import { parseAthleteIdFromUrl } from "@/features/trainingpeaks/athlete-roster-import";

const entryId = process.argv[2];
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

function distanceLabelToMeters(label: string | null): number | null {
  if (!label) return null;
  const m = label.replace(",", ".").match(/([\d.]+)\s*км/iu);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

async function loadEntry(id: string): Promise<{ row: ClubCalendarEntryRow; athleteId: number | null } | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("club_calendar_entries")
    .select("id, student_id, entry_date, kind, preferred_workout_type, note, race_name, race_city, race_distance_label, race_target_seconds, status, applied_tp_workout_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const { data: st } = await supabase.from("trainingpeaks_students").select("trainingpeaks_athlete_url").eq("id", r.student_id as string).maybeSingle();
  const athUrl = (st as { trainingpeaks_athlete_url: string | null } | null)?.trainingpeaks_athlete_url ?? null;
  const row: ClubCalendarEntryRow = {
    id: r.id as string,
    studentId: r.student_id as string,
    date: (r.entry_date as string | null) ?? null,
    kind: (r.kind as ClubCalendarEntryRow["kind"]) ?? "note",
    preferredType: (r.preferred_workout_type as ClubCalendarEntryRow["preferredType"]) ?? null,
    note: (r.note as string | null) ?? null,
    raceName: (r.race_name as string | null) ?? null,
    raceCity: (r.race_city as string | null) ?? null,
    raceDistanceLabel: (r.race_distance_label as string | null) ?? null,
    raceDistanceMeters: distanceLabelToMeters((r.race_distance_label as string | null) ?? null),
    raceTargetSeconds: (r.race_target_seconds as number | null) ?? null,
    status: (r.status as string) ?? "",
    appliedTpWorkoutId: (r.applied_tp_workout_id as number | null) ?? null,
  };
  return { row, athleteId: athUrl ? parseAthleteIdFromUrl(athUrl) : null };
}

async function main(): Promise<void> {
  if (!entryId) { console.error("usage: club-execute-one.ts <entryId> [--apply|--rollback]"); process.exit(1); }
  const loaded = await loadEntry(entryId);
  if (!loaded) { console.error(`entry ${entryId} не найдена`); process.exit(1); }
  const { row, athleteId } = loaded;

  if (ROLLBACK) {
    if (!row.appliedTpWorkoutId) { console.error("у записи нет applied_tp_workout_id — нечего откатывать"); process.exit(1); }
    if (!APPLY || process.env.CLUB_TP_EXECUTION_ENABLED !== "true") {
      console.log(`DRY-RUN rollback: удалил бы TP workout ${row.appliedTpWorkoutId} (athlete ${athleteId}) и вернул статус в approved. Для реального отката: --apply + CLUB_TP_EXECUTION_ENABLED=true.`);
      process.exit(0);
    }
    const del = await deleteWorkout("tpapi", athleteId as number, row.appliedTpWorkoutId);
    console.log(`deleteWorkout status=${del.status}`);
    const rb = await rollbackCalendarEntryApplied(entryId);
    console.log(rb.ok ? `откат БД ok: статус approved, ссылка очищена (был tp=${rb.tpWorkoutId})` : `откат БД ошибка: ${rb.error}`);
    process.exit(rb.ok ? 0 : 1);
  }

  const plan = planCalendarEntryAction(row, athleteId);
  if (!plan.ok) { console.error(`не планируется: ${plan.reason}`); process.exit(1); }
  console.log("== ПЛАН (payload) ==");
  console.log(JSON.stringify(plan.payload, null, 2));
  if (plan.unresolved.length) console.log("unresolved:", plan.unresolved.join("; "));

  const gated = APPLY && process.env.CLUB_TP_EXECUTION_ENABLED === "true";
  if (!gated) {
    console.log("\nDRY-RUN — в TP НЕ записано. Для реального создания: добавь --apply и выставь CLUB_TP_EXECUTION_ENABLED=true.");
    process.exit(0);
  }

  console.log("\n== ИСПОЛНЕНИЕ (CLUB_TP_EXECUTION_ENABLED=true, --apply) ==");
  const res = await createWorkout(plan.payload);
  console.log(`создан TP workout id=${res.workoutId}`);
  const mark = await markCalendarEntryApplied(entryId, res.workoutId);
  console.log(mark.ok ? `записан applied_tp_workout_id=${res.workoutId}, статус applied` : `write-back ошибка: ${mark.error}`);
  console.log("проверь в TP-календаре ученика; на следующем скане guard отсечёт эту строку из ленты/подсчётов.");
  process.exit(mark.ok ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
