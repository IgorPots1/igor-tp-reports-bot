// Club coach panel — data access (Phase 1). Read via server components, write via
// admin server actions. Service-role client; all functions throw on error.
// Additive: does not touch /m/desk, /m/n, or the student mini-app surface.

import { createSupabaseServerClient } from "@/features/supabase/server";
import { getTrainingPeaksWorkoutCacheFreshness } from "@/features/trainingpeaks/repository";
import {
  classifyRecordType,
  evaluateAllRecordsForValidation,
  loadCoachRecords,
  loadRaceDatesWithSource,
  type CoachRecord,
} from "@/features/club/service";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";
import type { RecordDistanceKey } from "@/features/club/records";

export function isClubAdminEnabled(): boolean {
  return process.env.CLUB_ADMIN_ENABLED === "true";
}

const DIST_METERS: Record<RecordDistanceKey, number> = { "5k": 5000, "10k": 10000, "21k": 21097, "42k": 42195 };
const KEYS = CLUB_RECORD_DISTANCES.map((d) => d.key) as RecordDistanceKey[];
export const DISTANCE_LABELS: Record<RecordDistanceKey, string> = {
  "5k": "5 км", "10k": "10 км", "21k": "21.1 км", "42k": "42.2 км",
};

// ---------------------------------------------------------------------------
// 1. Records revision
// ---------------------------------------------------------------------------

export type RevisionRecord = {
  distanceKey: RecordDistanceKey;
  durationSeconds: number | null;
  recordDate: string | null;
  type: "race" | "training_split" | null;
  trust: "verified" | "preliminary" | "hidden" | null;
  // Provenance: race_events / club_races = real-race date (source of the race typing);
  // reconstructed = training segment; coach_confirmed = coach override.
  source: "reconstructed" | "coach_confirmed" | "race_events" | "club_races" | null;
  raceName: string | null;
  hiddenReason: string | null;
};
export type RevisionStudent = {
  studentId: string;
  studentName: string;
  records: RevisionRecord[];
};

export async function loadClubResultsForRevision(): Promise<RevisionStudent[]> {
  const [run, coach, raceSource] = await Promise.all([
    evaluateAllRecordsForValidation({ useBestSplit: true }),
    loadCoachRecords(),
    loadRaceDatesWithSource(),
  ]);
  const out: RevisionStudent[] = [];
  for (const student of run.students.sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
    const perDist = run.byStudent.get(student.id);
    const records: RevisionRecord[] = [];
    for (const key of KEYS) {
      const coachRow = coach.get(`${student.id}|${key}`);
      if (coachRow) {
        records.push({
          distanceKey: key,
          durationSeconds: coachRow.trust === "hidden" ? null : coachRow.durationSeconds,
          recordDate: coachRow.recordDate,
          type: coachRow.trust === "hidden" ? null : "race",
          trust: coachRow.trust,
          source: "coach_confirmed",
          raceName: coachRow.raceName,
          hiddenReason: coachRow.trust === "hidden" ? "скрыт тренером" : null,
        });
        continue;
      }
      const res = perDist?.get(key);
      const best = res?.best ?? null;
      if (best) {
        const type = classifyRecordType(student.id, best.candidate.date, run.raceDatesByStudent);
        // Provenance: a race record shows which source declared its date; a training
        // segment stays "reconstructed".
        const source =
          type === "race" ? raceSource.get(student.id)?.get(best.candidate.date) ?? "reconstructed" : "reconstructed";
        records.push({
          distanceKey: key,
          durationSeconds: best.candidate.durationSeconds,
          recordDate: best.candidate.date,
          type,
          trust: best.trust === "verified" ? "verified" : "preliminary",
          source,
          raceName: null,
          hiddenReason: null,
        });
      } else {
        const reason = res?.evaluated.find((e) => e.trust === "hidden")?.hiddenReason ?? null;
        records.push({
          distanceKey: key, durationSeconds: null, recordDate: null, type: null, trust: null,
          source: null, raceName: null, hiddenReason: reason,
        });
      }
    }
    out.push({ studentId: student.id, studentName: student.name, records });
  }
  return out;
}

/** Compact per-student list (id + name) for the bulk mode navigation. */
export async function listActiveStudentsForRevision(): Promise<Array<{ id: string; name: string }>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, is_active, is_service_account")
    .order("student_name", { ascending: true });
  if (error) throw new Error(`club-admin: students: ${error.message}`);
  return (data as Array<{ id: string; student_name: string; is_active: boolean | null; is_service_account: boolean | null }>)
    .filter((r) => r.is_active !== false && r.is_service_account !== true)
    .map((r) => ({ id: r.id, name: r.student_name }));
}

export async function getStudentRevisionCard(studentId: string): Promise<{ name: string; coach: Map<string, CoachRecord> }> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("trainingpeaks_students").select("student_name").eq("id", studentId).maybeSingle();
  const coach = await loadCoachRecords();
  const scoped = new Map<string, CoachRecord>();
  for (const key of KEYS) {
    const c = coach.get(`${studentId}|${key}`);
    if (c) scoped.set(key, c);
  }
  return { name: (data as { student_name: string } | null)?.student_name ?? studentId.slice(0, 8), coach: scoped };
}

export async function upsertCoachConfirmedResult(input: {
  studentId: string; distanceKey: RecordDistanceKey; durationSeconds: number; recordDate: string | null;
  raceName: string | null; enteredBy: string;
}): Promise<void> {
  const supabase = createSupabaseServerClient();
  const pace = DIST_METERS[input.distanceKey] > 0 ? input.durationSeconds / (DIST_METERS[input.distanceKey] / 1000) : null;
  const { error } = await supabase.from("club_records").upsert(
    {
      student_id: input.studentId, distance_key: input.distanceKey, duration_seconds: input.durationSeconds,
      pace_sec_per_km: pace, record_date: input.recordDate, trust: "verified", source: "coach_confirmed",
      race_name: input.raceName, entered_by: input.enteredBy, verified_at: new Date().toISOString(),
    },
    { onConflict: "student_id,distance_key" }
  );
  if (error) throw new Error(`club-admin: confirm result: ${error.message}`);
}

export async function hideStudentRecord(input: { studentId: string; distanceKey: RecordDistanceKey; enteredBy: string }): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_records").upsert(
    { student_id: input.studentId, distance_key: input.distanceKey, duration_seconds: 1, trust: "hidden", source: "coach_confirmed", entered_by: input.enteredBy },
    { onConflict: "student_id,distance_key" }
  );
  if (error) throw new Error(`club-admin: hide record: ${error.message}`);
}

export async function clearCoachRecord(input: { studentId: string; distanceKey: RecordDistanceKey }): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_records").delete().eq("student_id", input.studentId).eq("distance_key", input.distanceKey);
  if (error) throw new Error(`club-admin: clear record: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 2. Unified request queue (races / day-off / wishes)
// ---------------------------------------------------------------------------

export type QueueItem = {
  kind: "race" | "dayoff" | "wish";
  id: string;
  studentId: string;
  title: string;
  subtitle: string;
  status: string;
  createdAt: string;
  actionable: boolean;
};

export async function listClubQueue(filter: { kind?: string; status?: string }): Promise<QueueItem[]> {
  const supabase = createSupabaseServerClient();
  const items: QueueItem[] = [];
  const wantKind = (k: string) => !filter.kind || filter.kind === "all" || filter.kind === k;

  if (wantKind("race")) {
    const { data } = await supabase.from("club_races").select("id, student_id, name, race_date, distance_label, status, created_at").order("created_at", { ascending: false }).limit(300);
    for (const r of (data as Array<Record<string, unknown>> | null) ?? []) {
      items.push({ kind: "race", id: r.id as string, studentId: r.student_id as string, title: (r.name as string) ?? "Старт",
        subtitle: `${r.race_date}${r.distance_label ? ` · ${r.distance_label}` : ""}`, status: (r.status as string) ?? "declared",
        createdAt: r.created_at as string, actionable: (r.status as string) === "declared" });
    }
  }
  if (wantKind("dayoff")) {
    const { data } = await supabase.from("club_dayoff_requests").select("id, student_id, from_date, to_date, reason, status, created_at").order("created_at", { ascending: false }).limit(300);
    for (const r of (data as Array<Record<string, unknown>> | null) ?? []) {
      items.push({ kind: "dayoff", id: r.id as string, studentId: r.student_id as string, title: "Выходной",
        subtitle: `${r.from_date}${r.to_date && r.to_date !== r.from_date ? ` — ${r.to_date}` : ""}${r.reason ? ` · ${r.reason}` : ""}`,
        status: (r.status as string) ?? "pending", createdAt: r.created_at as string, actionable: (r.status as string) === "pending" });
    }
  }
  if (wantKind("wish")) {
    const { data } = await supabase.from("club_wishes").select("id, student_id, load_scale, wellbeing_scale, schedule_scale, note, created_at").order("created_at", { ascending: false }).limit(300);
    for (const r of (data as Array<Record<string, unknown>> | null) ?? []) {
      items.push({ kind: "wish", id: r.id as string, studentId: r.student_id as string, title: "Пожелание",
        subtitle: `нагрузка ${r.load_scale ?? "—"} · самочувствие ${r.wellbeing_scale ?? "—"} · расписание ${r.schedule_scale ?? "—"}${r.note ? ` · ${r.note}` : ""}`,
        status: "—", createdAt: r.created_at as string, actionable: false });
    }
  }
  const withNames = await attachStudentNames(items);
  return withNames
    .filter((i) => !filter.status || filter.status === "all" || i.status === filter.status)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function attachStudentNames(items: QueueItem[]): Promise<QueueItem[]> {
  const ids = [...new Set(items.map((i) => i.studentId))];
  if (ids.length === 0) return items;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("trainingpeaks_students").select("id, student_name").in("id", ids);
  const nameById = new Map((data as Array<{ id: string; student_name: string }> | null ?? []).map((s) => [s.id, s.student_name]));
  return items.map((i) => ({ ...i, title: `${i.title} · ${nameById.get(i.studentId) ?? i.studentId.slice(0, 8)}` }));
}

export async function setRaceStatus(id: string, status: "approved" | "rejected", coach: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_races").update({ status, approved_by: coach, approved_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`club-admin: race status: ${error.message}`);
}
export async function setDayoffStatus(id: string, status: "approved" | "rejected", coach: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_dayoff_requests").update({ status, status_by: coach, status_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`club-admin: dayoff status: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 3. Telegram links
// ---------------------------------------------------------------------------

export type LinkRow = { studentId: string; name: string; telegramUserId: number | null; username: string | null };
export async function listTelegramLinks(): Promise<LinkRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("trainingpeaks_students").select("id, student_name, telegram_user_id, telegram_username, is_active, is_service_account").order("student_name", { ascending: true });
  if (error) throw new Error(`club-admin: links: ${error.message}`);
  return (data as Array<Record<string, unknown>>)
    .filter((r) => r.is_active !== false && r.is_service_account !== true)
    .map((r) => ({ studentId: r.id as string, name: r.student_name as string, telegramUserId: (r.telegram_user_id as number | null) ?? null, username: (r.telegram_username as string | null) ?? null }));
}

export type LinkEvent = { id: string; telegramUserId: number | null; username: string | null; studentId: string | null; result: string; reason: string | null; createdAt: string };
export async function listLinkEvents(): Promise<LinkEvent[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("club_link_events").select("id, telegram_user_id, telegram_username, student_id, result, reason, created_at").order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(`club-admin: link events: ${error.message}`);
  return (data as Array<Record<string, unknown>>).map((r) => ({ id: r.id as string, telegramUserId: (r.telegram_user_id as number | null) ?? null, username: (r.telegram_username as string | null) ?? null, studentId: (r.student_id as string | null) ?? null, result: r.result as string, reason: (r.reason as string | null) ?? null, createdAt: r.created_at as string }));
}

export async function unbindStudent(studentId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { data: before } = await supabase.from("trainingpeaks_students").select("telegram_user_id, telegram_username").eq("id", studentId).maybeSingle();
  const { error } = await supabase.from("trainingpeaks_students").update({ telegram_user_id: null }).eq("id", studentId);
  if (error) throw new Error(`club-admin: unbind: ${error.message}`);
  // Log (inert if the extended result enum isn't applied yet).
  try {
    await supabase.from("club_link_events").insert({
      telegram_user_id: (before as { telegram_user_id?: number | null } | null)?.telegram_user_id ?? null,
      telegram_username: (before as { telegram_username?: string | null } | null)?.telegram_username ?? null,
      student_id: studentId, result: "unbound", reason: "coach unbind (admin panel)",
    });
  } catch { /* enum not extended yet */ }
}

export async function relinkStudent(studentId: string, telegramUserId: number): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("trainingpeaks_students").update({ telegram_user_id: telegramUserId }).eq("id", studentId);
  if (error) throw new Error(`club-admin: relink: ${error.message}`);
  try {
    await supabase.from("club_link_events").insert({ telegram_user_id: telegramUserId, student_id: studentId, result: "relinked", reason: "coach relink (admin panel)" });
  } catch { /* enum not extended yet */ }
}

// ---------------------------------------------------------------------------
// 4. Club management panel
// ---------------------------------------------------------------------------

export async function getClubManagementData(): Promise<{
  goalMode: string; freshnessLabel: string; latestScannedAt: string | null; cacheRows: number;
  activeStudents: number; lapDensityPct: number; peaksCoverage: string;
}> {
  const supabase = createSupabaseServerClient();
  const fresh = await getTrainingPeaksWorkoutCacheFreshness();
  const [{ count: withLaps }, { count: totalCompleted }, { count: activeStudents }] = await Promise.all([
    supabase.from("trainingpeaks_workout_derived_metrics").select("id", { count: "exact", head: true }).eq("has_fit", true),
    supabase.from("trainingpeaks_workout_cache").select("id", { count: "exact", head: true }).eq("is_completed", true),
    supabase.from("trainingpeaks_students").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  const lapDensityPct = totalCompleted && totalCompleted > 0 ? Math.round(((withLaps ?? 0) / totalCompleted) * 100) : 0;
  const scanned = fresh.latestScannedAt ? new Date(fresh.latestScannedAt) : null;
  const label = scanned ? `${Math.round((Date.now() - scanned.getTime()) / 60000)} мин назад` : "нет данных";
  return {
    goalMode: (process.env.CLUB_CHALLENGE_GOAL_MODE ?? "auto"),
    freshnessLabel: label, latestScannedAt: fresh.latestScannedAt, cacheRows: fresh.rowCount,
    activeStudents: activeStudents ?? 0, lapDensityPct,
    peaksCoverage: "нет данных (TP-пики не ингестятся; CLUB_RECORDS_TP_PEAKS не включён)",
  };
}
