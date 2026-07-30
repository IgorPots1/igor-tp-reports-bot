/**
 * Batch drain of ROLLBACK-REQUESTED club_calendar_entries: delete the TP entity we created, then
 * remove the row. This is the runner half of "cancel a start" — the mini-app / admin only record the
 * intent (tp_rollback_requested_at); TP mutation stays out of the web app (no creds there).
 *
 * Queue = tp_rollback_requested_at IS NOT NULL AND applied_tp_workout_id IS NOT NULL. For each:
 *   1. delete the TP entity by applied_entity_type (event/note/availability/workout);
 *   2. on success (2xx) OR 404 (already gone) → hard-delete the calendar row;
 *   3. on any other status / exception → keep the row, record tp_send_error + increment attempts
 *      (this is the reverse-discrepancy signal: the app queued a removal but TP still has it), retry
 *      next run. Nothing is lost, nothing lies.
 *
 * SAFETY: dry-run by DEFAULT (prints, deletes nothing). Real execution needs BOTH --apply AND
 * CLUB_TP_EXECUTION_ENABLED=true — the SAME master switch as the send runner. Off → nothing happens.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-rollback-requested-once.ts [--student=<uuid>] [--apply]
 */
import { createSupabaseServerClient } from "@/features/supabase/server";
import { isDeleteEffectivelyGone } from "@/features/club/tp-rollback";
import { parseAthleteIdFromUrl } from "@/features/trainingpeaks/athlete-roster-import";
import { deleteAvailability, deleteEvent, deleteNote, deleteWorkout } from "@/features/trainingpeaks/tp-api-client";

const APPLY = process.argv.includes("--apply");
const STUDENT = process.argv.find((a) => a.startsWith("--student="))?.slice("--student=".length).trim() || null;

type EntityType = "workout" | "event" | "note" | "availability";

type Loaded = {
  id: string;
  studentId: string;
  tpId: number;
  entity: EntityType;
  athleteId: number | null;
  label: string;
};

async function loadRollbackRequested(): Promise<Loaded[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("club_calendar_entries")
    .select("id, student_id, entry_date, kind, race_name, applied_tp_workout_id, applied_entity_type")
    .not("tp_rollback_requested_at", "is", null)
    .not("applied_tp_workout_id", "is", null)
    .order("entry_date", { ascending: true });
  if (STUDENT) query = query.eq("student_id", STUDENT);
  const { data, error } = await query;
  if (error) throw new Error(`load rollback-requested failed: ${error.message}`);
  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  const studentIds = [...new Set(rows.map((r) => r.student_id as string))];
  const urlById = new Map<string, string | null>();
  const nameById = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: st } = await supabase
      .from("trainingpeaks_students")
      .select("id, student_name, trainingpeaks_athlete_url")
      .in("id", studentIds);
    for (const s of (st as Array<{ id: string; student_name: string | null; trainingpeaks_athlete_url: string | null }> | null) ?? []) {
      urlById.set(s.id, s.trainingpeaks_athlete_url);
      nameById.set(s.id, s.student_name ?? s.id);
    }
  }
  return rows.map((r) => {
    const sid = r.student_id as string;
    const url = urlById.get(sid) ?? null;
    return {
      id: r.id as string,
      studentId: sid,
      tpId: r.applied_tp_workout_id as number,
      // applied_entity_type is written at apply time so the RIGHT delete endpoint is chosen without
      // re-planning by (possibly different) current flags. Default 'event' (races go as Events).
      entity: ((r.applied_entity_type as EntityType | null) ?? "event"),
      athleteId: url ? parseAthleteIdFromUrl(url) : null,
      label: `${nameById.get(sid) ?? sid} · ${(r.entry_date as string | null) ?? "?"} · ${(r.race_name as string | null) ?? r.kind}`,
    };
  });
}

async function recordFailure(entryId: string, message: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("club_calendar_entries").select("tp_send_attempts").eq("id", entryId).maybeSingle();
  const attempts = Number((data as { tp_send_attempts?: number } | null)?.tp_send_attempts ?? 0) + 1;
  await supabase
    .from("club_calendar_entries")
    .update({ tp_send_attempts: attempts, tp_send_attempted_at: new Date().toISOString(), tp_send_error: message.slice(0, 500) })
    .eq("id", entryId);
}

async function deleteTpEntity(entity: EntityType, athleteId: number, tpId: number): Promise<{ status: number }> {
  if (entity === "event") return deleteEvent(athleteId, tpId);
  if (entity === "note") return deleteNote(athleteId, tpId);
  if (entity === "availability") return deleteAvailability(athleteId, tpId);
  return deleteWorkout("tpapi", athleteId, tpId);
}

async function main(): Promise<void> {
  const gated = APPLY && process.env.CLUB_TP_EXECUTION_ENABLED === "true";
  const entries = await loadRollbackRequested();

  console.log(`[club-rollback] очередь (rollback запрошен, ещё в TP): ${entries.length}${STUDENT ? ` (student=${STUDENT})` : ""}`);
  console.log(gated ? "== ИСПОЛНЕНИЕ (--apply + CLUB_TP_EXECUTION_ENABLED=true) ==" : "== DRY-RUN (в TP НЕ пишу; --apply + CLUB_TP_EXECUTION_ENABLED=true для реального) ==");

  let removed = 0;
  let failed = 0;
  let skipped = 0;

  for (const e of entries) {
    if (!e.athleteId || !Number.isFinite(e.athleteId)) {
      skipped += 1;
      console.log(`  SKIP ${e.label}: нет trainingpeaks_athlete_id`);
      continue;
    }
    if (!gated) {
      console.log(`  PLAN ${e.label} → delete TP ${e.entity} ${e.tpId}, затем удалить строку`);
      continue;
    }
    try {
      const del = await deleteTpEntity(e.entity, e.athleteId, e.tpId);
      if (!isDeleteEffectivelyGone(del.status)) {
        failed += 1;
        await recordFailure(e.id, `TP delete ${e.entity} ${e.tpId} вернул статус ${del.status} — событие в TP осталось, строка сохранена, повтор в следующий прогон.`);
        console.log(`  FAIL ${e.label}: delete ${e.entity} status=${del.status} (строка сохранена)`);
        continue;
      }
      const supabase = createSupabaseServerClient();
      const { error } = await supabase.from("club_calendar_entries").delete().eq("id", e.id);
      if (error) {
        failed += 1;
        await recordFailure(e.id, `TP ${e.entity} ${e.tpId} удалён (status ${del.status}), но строку удалить не удалось: ${error.message}`);
        console.log(`  ROW-DELETE FAIL ${e.label}: TP снят (status=${del.status}), строка осталась (${error.message})`);
        continue;
      }
      removed += 1;
      console.log(`  OK ${e.label} → TP ${e.entity} снят (status=${del.status}), строка удалена`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await recordFailure(e.id, message);
      console.log(`  FAIL ${e.label}: ${message}`);
    }
  }

  console.log("");
  console.log(`[club-rollback] итог: очередь=${entries.length} ${gated ? `снято=${removed} провалов=${failed} ` : ""}пропущено=${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
