/**
 * Reconcile the club calendar with TrainingPeaks: direction "deleted in TP → reflected in the app".
 * A start we pushed to TP can be deleted DIRECTLY in TP by a human; the app would otherwise keep
 * showing it as "в TP" forever (it lies). This probes each applied Event by id (GET, read-only) and,
 * when TP returns 404 (gone), resets the row to the SAME terminal state as a cancel: clears the TP
 * link and sets status='rejected' with a "СВЕРКА:" marker — NOT 'approved' (that would make the send
 * runner re-create it). The coach sees the result in the admin ("Снято в TP вручную (сверка)").
 *
 * SCOPE (per Igor): only status='applied' AND applied_entity_type='event' (there are few), and only
 * entry_date within the last N days (default 31) — a finished race removed in TP is not actionable.
 *
 * SAFETY: TP side is READ-ONLY (GET only — never mutates TP). The DB reset is dry-run by DEFAULT;
 * pass --apply to write. Only a clean 404 rejects a row; any 5xx/transient/other status leaves it
 * untouched (fetchJsonWithRetry already retries transient), so a blip never rejects a live race.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-reconcile-tp-once.ts [--student=<uuid>] [--days=31] [--apply]
 */
import { createSupabaseServerClient } from "@/features/supabase/server";
import { isEventGone, isEventPresent, RECONCILE_REMOVED_MARKER, reconcileCutoffIso } from "@/features/club/tp-reconcile";
import { getTrainingPeaksAttentionDigestBelgradeTodayIso } from "@/features/trainingpeaks/attention-digest-run";
import { parseAthleteIdFromUrl } from "@/features/trainingpeaks/athlete-roster-import";
import { getEventStatus } from "@/features/trainingpeaks/tp-api-client";

const APPLY = process.argv.includes("--apply");
const STUDENT = process.argv.find((a) => a.startsWith("--student="))?.slice("--student=".length).trim() || null;
const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.slice("--days=".length)) || 31;

type Loaded = { id: string; studentId: string; tpId: number; date: string | null; athleteId: number | null; label: string };

async function loadAppliedEvents(cutoffIso: string): Promise<Loaded[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("club_calendar_entries")
    .select("id, student_id, entry_date, race_name, applied_tp_workout_id")
    .eq("status", "applied")
    .eq("applied_entity_type", "event")
    .not("applied_tp_workout_id", "is", null)
    .is("tp_rollback_requested_at", null) // a cancel is already handling these — don't double-touch
    .gte("entry_date", cutoffIso)
    .order("entry_date", { ascending: true });
  if (STUDENT) query = query.eq("student_id", STUDENT);
  const { data, error } = await query;
  if (error) throw new Error(`load applied events failed: ${error.message}`);
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
    const date = (r.entry_date as string | null) ?? null;
    return {
      id: r.id as string,
      studentId: sid,
      tpId: r.applied_tp_workout_id as number,
      date,
      athleteId: url ? parseAthleteIdFromUrl(url) : null,
      label: `${nameById.get(sid) ?? sid} · ${date ?? "?"} · ${(r.race_name as string | null) ?? "старт"}`,
    };
  });
}

async function markRemovedInTp(entryId: string, tpId: number, dateIso: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("club_calendar_entries")
    .update({
      applied_tp_workout_id: null,
      applied_entity_type: null,
      applied_at: null,
      status: "rejected",
      tp_send_attempted_at: new Date().toISOString(),
      tp_send_error: `${RECONCILE_REMOVED_MARKER} событие ${tpId} удалено в TP вручную (сверка ${dateIso})`,
    })
    .eq("id", entryId)
    .eq("status", "applied"); // only reset a still-applied row (guards against a concurrent change)
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function main(): Promise<void> {
  const today = getTrainingPeaksAttentionDigestBelgradeTodayIso();
  const cutoff = reconcileCutoffIso(today, DAYS);
  const entries = await loadAppliedEvents(cutoff);

  console.log(`[club-reconcile] applied-события (event, ${cutoff}..): ${entries.length}${STUDENT ? ` (student=${STUDENT})` : ""}`);
  console.log(APPLY ? "== ИСПОЛНЕНИЕ (--apply: сброшу исчезнувшие в БД) ==" : "== DRY-RUN (в БД НЕ пишу; --apply для реального) ==");

  let gone = 0;
  let present = 0;
  let unknown = 0;
  let skipped = 0;

  for (const e of entries) {
    if (!e.athleteId || !Number.isFinite(e.athleteId)) {
      skipped += 1;
      console.log(`  SKIP ${e.label}: нет trainingpeaks_athlete_id`);
      continue;
    }
    let status: number;
    try {
      status = (await getEventStatus(e.athleteId, e.tpId)).status;
    } catch (error) {
      unknown += 1;
      console.log(`  UNKNOWN ${e.label}: ошибка запроса (${error instanceof Error ? error.message : String(error)}) — не трогаю`);
      continue;
    }
    if (isEventGone(status)) {
      gone += 1;
      if (!APPLY) {
        console.log(`  GONE ${e.label}: TP event ${e.tpId} = 404 → сбросил бы applied + rejected`);
        continue;
      }
      const res = await markRemovedInTp(e.id, e.tpId, today);
      console.log(res.ok ? `  GONE ${e.label}: TP event ${e.tpId} = 404 → сброшено (rejected, помечено сверкой)` : `  GONE ${e.label}: сброс не удался: ${res.error}`);
    } else if (isEventPresent(status)) {
      present += 1;
    } else {
      unknown += 1;
      console.log(`  UNKNOWN ${e.label}: TP статус ${status} — не трогаю`);
    }
  }

  console.log("");
  console.log(`[club-reconcile] итог: проверено=${entries.length} на_месте=${present} исчезло=${gone} неясно=${unknown} пропущено=${skipped}${APPLY ? "" : " (dry-run)"}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
