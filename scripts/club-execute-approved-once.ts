/**
 * Batch drain of APPROVED, not-yet-applied club_calendar_entries into TrainingPeaks, using the
 * SAME plan → create → markApplied path as club-execute-one. This is:
 *   - the "send everything accumulated at once" command,
 *   - the FIRST-RUN dry-run (see what would go before flipping the flag),
 *   - the auto-enqueue runner (launchd every 30 min drains the queue).
 *
 * The queue is simply status='approved' AND applied_tp_workout_id IS NULL. An APPLIED entry is
 * never re-processed, so re-runs cannot duplicate in TP (idempotent per naryad §4). A failed entry
 * stays 'approved', records tp_send_error/attempts, and is retried next run (nothing is lost §5).
 *
 * SAFETY: dry-run by DEFAULT (prints the plan + a summary, writes nothing). Real execution needs
 * BOTH --apply AND CLUB_TP_EXECUTION_ENABLED=true — the master switch. Off → nothing goes anywhere.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-execute-approved-once.ts [--student=<uuid>] [--apply]
 *
 * NOTE: day_off entries are executed one Availability per day here (no range-grouping); the
 * grouped variant stays in club-execute-dayoff-group.ts. The dry-run shows exactly what each entry
 * would create, so this is reviewable before enabling the flag.
 */
import { markCalendarEntryApplied } from "@/features/club/calendar";
import {
  isClubDayoffAsAvailabilityEnabled,
  isClubNotesAsNoteEnabled,
  isClubRaceAsEventEnabled,
} from "@/features/club/constants";
import { planCalendarEntryAction, type ClubCalendarEntryRow } from "@/features/club/tp-execution";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { parseAthleteIdFromUrl } from "@/features/trainingpeaks/athlete-roster-import";
import { createAvailability, createEvent, createNote, createWorkout } from "@/features/trainingpeaks/tp-api-client";

const APPLY = process.argv.includes("--apply");
const STUDENT = process.argv.find((a) => a.startsWith("--student="))?.slice("--student=".length).trim() || null;

type EntityType = "workout" | "event" | "note" | "availability";

function distanceLabelToMeters(label: string | null): number | null {
  if (!label) return null;
  const m = label.replace(",", ".").match(/([\d.]+)\s*км/iu);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

function entityTypeOf(actionType: "create_workout" | "create_event" | "create_note" | "create_availability"): EntityType {
  return actionType === "create_event"
    ? "event"
    : actionType === "create_note"
      ? "note"
      : actionType === "create_availability"
        ? "availability"
        : "workout";
}

type Loaded = { row: ClubCalendarEntryRow; athleteId: number | null; studentName: string };

async function loadApproved(): Promise<Loaded[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("club_calendar_entries")
    .select(
      "id, student_id, entry_date, kind, preferred_workout_type, note, day_off_reason, race_name, race_city, race_distance_label, race_target_seconds, status, applied_tp_workout_id"
    )
    .eq("status", "approved")
    .is("applied_tp_workout_id", null)
    .order("entry_date", { ascending: true });
  if (STUDENT) query = query.eq("student_id", STUDENT);
  const { data, error } = await query;
  if (error) throw new Error(`load approved failed: ${error.message}`);
  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  const studentIds = [...new Set(rows.map((r) => r.student_id as string))];
  const students = new Map<string, { url: string | null; name: string }>();
  if (studentIds.length > 0) {
    const { data: st } = await supabase
      .from("trainingpeaks_students")
      .select("id, student_name, trainingpeaks_athlete_url")
      .in("id", studentIds);
    for (const s of (st as Array<{ id: string; student_name: string | null; trainingpeaks_athlete_url: string | null }> | null) ?? []) {
      students.set(s.id, { url: s.trainingpeaks_athlete_url, name: s.student_name ?? s.id });
    }
  }
  return rows.map((r) => {
    const st = students.get(r.student_id as string);
    const row: ClubCalendarEntryRow = {
      id: r.id as string,
      studentId: r.student_id as string,
      date: (r.entry_date as string | null) ?? null,
      kind: (r.kind as ClubCalendarEntryRow["kind"]) ?? "note",
      preferredType: (r.preferred_workout_type as ClubCalendarEntryRow["preferredType"]) ?? null,
      note: (r.note as string | null) ?? null,
      dayOffReason: (r.day_off_reason as string | null) ?? null,
      raceName: (r.race_name as string | null) ?? null,
      raceCity: (r.race_city as string | null) ?? null,
      raceDistanceLabel: (r.race_distance_label as string | null) ?? null,
      raceDistanceMeters: distanceLabelToMeters((r.race_distance_label as string | null) ?? null),
      raceTargetSeconds: (r.race_target_seconds as number | null) ?? null,
      status: (r.status as string) ?? "",
      appliedTpWorkoutId: null,
    };
    return { row, athleteId: st?.url ? parseAthleteIdFromUrl(st.url) : null, studentName: st?.name ?? (r.student_id as string) };
  });
}

async function recordFailure(entryId: string, message: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  // Increment attempts + record the reason so the coach admin can list failures. Best-effort.
  const { data } = await supabase.from("club_calendar_entries").select("tp_send_attempts").eq("id", entryId).maybeSingle();
  const attempts = Number((data as { tp_send_attempts?: number } | null)?.tp_send_attempts ?? 0) + 1;
  await supabase
    .from("club_calendar_entries")
    .update({ tp_send_attempts: attempts, tp_send_attempted_at: new Date().toISOString(), tp_send_error: message.slice(0, 500) })
    .eq("id", entryId);
}

async function main(): Promise<void> {
  const planOptions = {
    raceAsEvent: isClubRaceAsEventEnabled(),
    notesAsNote: isClubNotesAsNoteEnabled(),
    dayoffAsAvailability: isClubDayoffAsAvailabilityEnabled(),
  };
  const gated = APPLY && process.env.CLUB_TP_EXECUTION_ENABLED === "true";
  const entries = await loadApproved();

  console.log(`[club-execute-approved] очередь (approved, не applied): ${entries.length}${STUDENT ? ` (student=${STUDENT})` : ""}`);
  console.log(gated ? "== ИСПОЛНЕНИЕ (--apply + CLUB_TP_EXECUTION_ENABLED=true) ==" : "== DRY-RUN (в TP НЕ пишу; --apply + CLUB_TP_EXECUTION_ENABLED=true для реального) ==");

  let planned = 0;
  let created = 0;
  let failed = 0;
  let skipped = 0;
  const byKind: Record<string, number> = {};

  for (const { row, athleteId, studentName } of entries) {
    const label = `${studentName} · ${row.date ?? "?"} · ${row.kind}`;
    const plan = planCalendarEntryAction(row, athleteId, planOptions);
    if (!plan.ok) {
      skipped += 1;
      console.log(`  SKIP ${label}: ${plan.reason}`);
      continue;
    }
    planned += 1;
    byKind[plan.actionType] = (byKind[plan.actionType] ?? 0) + 1;
    if (!gated) {
      console.log(`  PLAN ${label} → ${plan.actionType}${plan.unresolved.length ? ` (unresolved: ${plan.unresolved.join(", ")})` : ""}`);
      continue;
    }
    try {
      let createdId: number;
      if (plan.actionType === "create_event") {
        createdId = (await createEvent(athleteId as number, plan.eventPayload as unknown as Record<string, unknown>)).eventId;
      } else if (plan.actionType === "create_note") {
        createdId = (await createNote(athleteId as number, plan.notePayload as unknown as Record<string, unknown>)).noteId;
      } else if (plan.actionType === "create_availability") {
        createdId = (await createAvailability(athleteId as number, plan.availabilityPayload as unknown as Record<string, unknown>)).availabilityId;
      } else {
        createdId = (await createWorkout(plan.payload)).workoutId;
      }
      const entityType = entityTypeOf(plan.actionType);
      const mark = await markCalendarEntryApplied(row.id, createdId, entityType);
      if (!mark.ok) {
        // TP entity created but the write-back failed: record LOUDLY with the id so it is not
        // silently re-created next run — a human reconciles (rare edge, same as club-execute-one).
        failed += 1;
        await recordFailure(row.id, `TP ${entityType} создан id=${createdId}, но write-back не удался: ${mark.error}. НЕ перезапускать до сверки.`);
        console.log(`  WRITE-BACK FAIL ${label}: TP ${entityType} id=${createdId}, но applied не записан (${mark.error})`);
        continue;
      }
      created += 1;
      console.log(`  OK ${label} → TP ${entityType} id=${createdId}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await recordFailure(row.id, message);
      console.log(`  FAIL ${label}: ${message}`);
    }
  }

  console.log("");
  console.log(
    `[club-execute-approved] итог: очередь=${entries.length} планируется=${planned} ` +
      (gated ? `создано=${created} провалов=${failed} ` : "") +
      `пропущено=${skipped} по типам=${JSON.stringify(byKind)}`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
