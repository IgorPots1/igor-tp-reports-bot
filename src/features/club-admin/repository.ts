// Club coach panel — data access (Phase 1). Read via server components, write via
// admin server actions. Service-role client; all functions throw on error.
// Additive: does not touch /m/desk, /m/n, or the student mini-app surface.

import { createSupabaseServerClient } from "@/features/supabase/server";
import { getTrainingPeaksWorkoutCacheFreshness } from "@/features/trainingpeaks/repository";
import {
  classifyRecordType,
  evaluateAllRecordsForValidation,
  loadClubWorkoutRows,
  loadCoachRecords,
  loadRaceDatesWithSource,
  type CoachRecord,
} from "@/features/club/service";
import { classifyRaceEventFill, type RaceFillEvent, type RaceFillWorkout } from "@/features/club/race-fill";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";
import type { RecordDistanceKey } from "@/features/club/records";
import { resolveClubBotUsername } from "@/features/club/entry-links";
import {
  clubMiniAppShortName,
  clubTokenLinkStr,
  clubGeneralLinkStr,
} from "@/features/club/entry-links";
import {
  createClubLinkToken,
  listAllActiveClubLinkTokens,
} from "@/features/club/link-tokens";
import { listPendingClubAccessRequests, type ClubAccessRequest } from "@/features/club/access-requests";
import { nameSim } from "@/features/club/name-match";
import { fetchAllRows } from "@/features/supabase/paginate";

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
        subtitle: `${r.from_date}${r.to_date && r.to_date !== r.from_date ? ` - ${r.to_date}` : ""}${r.reason ? ` · ${r.reason}` : ""}`,
        status: (r.status as string) ?? "pending", createdAt: r.created_at as string, actionable: (r.status as string) === "pending" });
    }
  }
  if (wantKind("wish")) {
    const { data } = await supabase.from("club_wishes").select("id, student_id, load_scale, wellbeing_scale, schedule_scale, note, created_at").order("created_at", { ascending: false }).limit(300);
    for (const r of (data as Array<Record<string, unknown>> | null) ?? []) {
      items.push({ kind: "wish", id: r.id as string, studentId: r.student_id as string, title: "Пожелание",
        subtitle: `нагрузка ${r.load_scale ?? "-"} · самочувствие ${r.wellbeing_scale ?? "-"} · расписание ${r.schedule_scale ?? "-"}${r.note ? ` · ${r.note}` : ""}`,
        status: "-", createdAt: r.created_at as string, actionable: false });
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
// Phase 5 — unified calendar inbox (club_calendar_entries), next 45 days
// ---------------------------------------------------------------------------

export type ClubCalendarAdminEntry = {
  id: string;
  studentId: string;
  studentName: string;
  date: string;
  kind: "day_off" | "preference" | "note" | "race";
  detail: string;
  status: "pending" | "approved" | "rejected" | "applied";
};

const CAL_PREF_LABEL: Record<string, string> = { long: "длительная", intervals: "интервальная", rest: "отдых" };

/** All calendar entries for the next 45 days (any status), with student names. */
export async function listClubCalendarAdmin(): Promise<ClubCalendarAdminEntry[]> {
  const supabase = createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("club_calendar_entries")
    .select("id, student_id, entry_date, kind, preferred_workout_type, note, race_name, race_city, race_distance_label, race_target_seconds, status")
    .gte("entry_date", today)
    .lte("entry_date", to)
    .order("entry_date", { ascending: true });
  if (error || !data) return [];
  const rows = data as Array<Record<string, unknown>>;
  const ids = [...new Set(rows.map((r) => r.student_id as string))];
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: studs } = await supabase.from("trainingpeaks_students").select("id, student_name").in("id", ids);
    for (const s of (studs as Array<{ id: string; student_name: string }> | null) ?? []) nameById.set(s.id, s.student_name);
  }
  return rows.map((r) => {
    const kind = (r.kind as ClubCalendarAdminEntry["kind"]) ?? "note";
    let detail = "";
    if (kind === "day_off") detail = "Выходной";
    else if (kind === "preference") detail = `Тип: ${CAL_PREF_LABEL[r.preferred_workout_type as string] ?? r.preferred_workout_type}`;
    else if (kind === "note") detail = (r.note as string) ?? "";
    else if (kind === "race") detail = `${r.race_name ?? "Забег"}${r.race_city ? ` · ${r.race_city}` : ""}${r.race_distance_label ? ` · ${r.race_distance_label}` : ""}`;
    return {
      id: r.id as string,
      studentId: r.student_id as string,
      studentName: nameById.get(r.student_id as string) ?? (r.student_id as string).slice(0, 8),
      date: r.entry_date as string,
      kind,
      detail,
      status: (r.status as ClubCalendarAdminEntry["status"]) ?? "pending",
    };
  });
}

export async function setCalendarEntryStatus(id: string, status: "approved" | "rejected"): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_calendar_entries").update({ status }).eq("id", id);
  if (error) throw new Error(`club-admin: calendar status: ${error.message}`);
}

/** Batch-approve every currently pending calendar entry in the 45-day window. */
export async function approveAllPendingCalendar(): Promise<number> {
  const supabase = createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("club_calendar_entries")
    .update({ status: "approved" })
    .eq("status", "pending")
    .gte("entry_date", today)
    .lte("entry_date", to)
    .select("id");
  if (error) throw new Error(`club-admin: calendar batch approve: ${error.message}`);
  return (data as Array<unknown> | null)?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Phase C — admin challenges (club_challenges, extended 20260806)
// ---------------------------------------------------------------------------

export type ClubChallengeAdminRow = {
  id: string;
  title: string;
  goalType: "km" | "workouts";
  goalValue: number;
  startsAt: string;
  endsAt: string;
  participantScope: "all" | "selected";
  participantCount: number;
  status: "active" | "completed" | "archived";
};

export async function listClubChallengesAdmin(): Promise<ClubChallengeAdminRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_challenges")
    .select("id, title, goal_type, goal_value, goal_km, starts_at, ends_at, participant_scope, participant_ids, status")
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    title: ((r.title as string | null) ?? "").trim() || "Челлендж",
    goalType: r.goal_type === "workouts" ? "workouts" : "km",
    goalValue: Number(r.goal_value ?? r.goal_km ?? 0),
    startsAt: r.starts_at as string,
    endsAt: r.ends_at as string,
    participantScope: r.participant_scope === "selected" ? "selected" : "all",
    participantCount: Array.isArray(r.participant_ids) ? (r.participant_ids as unknown[]).length : 0,
    status: (["active", "completed", "archived"].includes(r.status as string) ? r.status : "active") as ClubChallengeAdminRow["status"],
  }));
}

export async function createClubChallenge(input: {
  title: string;
  goalType: "km" | "workouts";
  goalValue: number;
  startsAt: string;
  endsAt: string;
  participantScope: "all" | "selected";
  participantIds: string[];
  coach: string;
}): Promise<void> {
  if (!(input.goalValue > 0)) throw new Error("Значение цели должно быть > 0.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsAt) || input.endsAt < input.startsAt) {
    throw new Error("Неверный период.");
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_challenges").insert({
    title: input.title.trim() || null,
    goal_type: input.goalType,
    goal_value: input.goalValue,
    // Keep legacy goal_km populated for a km challenge (the manual-km path still reads it);
    // null for a workouts challenge (column is now nullable).
    goal_km: input.goalType === "km" ? input.goalValue : null,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    participant_scope: input.participantScope,
    participant_ids: input.participantScope === "selected" ? input.participantIds : [],
    status: "active",
    created_by: input.coach,
  });
  if (error) throw new Error(`club-admin: create challenge: ${error.message}`);
}

export async function setClubChallengeStatus(id: string, status: "active" | "completed" | "archived"): Promise<void> {
  const supabase = createSupabaseServerClient();
  const patch: Record<string, unknown> = { status };
  if (status === "completed") patch.completed_at = new Date().toISOString();
  const { error } = await supabase.from("club_challenges").update(patch).eq("id", id);
  if (error) throw new Error(`club-admin: challenge status: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 2b. Comments moderation (Phase D). Coach sees every comment and can delete any.
// Tolerant of a missing table (migration 20260807 not applied) -> empty list.
// ---------------------------------------------------------------------------

export type ClubCommentAdminRow = {
  id: string;
  authorName: string;
  workoutId: string;
  workoutLabel: string;
  body: string;
  createdAtLabel: string;
};

export async function listClubCommentsAdmin(): Promise<ClubCommentAdminRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_comments")
    .select("id, student_id, workout_cache_id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error || !data) return [];
  const rows = data as Array<{ id: string; student_id: string; workout_cache_id: string; body: string; created_at: string }>;
  if (rows.length === 0) return [];

  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const workoutIds = [...new Set(rows.map((r) => r.workout_cache_id))];
  const [{ data: studentData }, { data: workoutData }] = await Promise.all([
    supabase.from("trainingpeaks_students").select("id, student_name, club_display_name").in("id", studentIds),
    supabase.from("trainingpeaks_workout_cache").select("id, student_name, workout_date, title").in("id", workoutIds),
  ]);
  const nameById = new Map(
    ((studentData as Array<{ id: string; student_name: string; club_display_name: string | null }> | null) ?? []).map((s) => {
      const override = (s.club_display_name ?? "").trim();
      return [s.id, override || s.student_name || "Участник клуба"] as const;
    })
  );
  const workoutById = new Map(
    ((workoutData as Array<{ id: string; student_name: string | null; workout_date: string; title: string | null }> | null) ?? []).map(
      (w) => [w.id, { date: w.workout_date, owner: w.student_name ?? "", title: (w.title ?? "").trim() }] as const
    )
  );

  return rows.map((r) => {
    const w = workoutById.get(r.workout_cache_id);
    const wLabel = w ? [w.date, w.owner, w.title].filter(Boolean).join(" · ") : r.workout_cache_id;
    return {
      id: r.id,
      authorName: nameById.get(r.student_id) ?? "Участник клуба",
      workoutId: r.workout_cache_id,
      workoutLabel: wLabel,
      body: r.body,
      createdAtLabel: r.created_at.replace("T", " ").slice(0, 16),
    };
  });
}

export async function deleteClubCommentAdmin(id: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_comments").delete().eq("id", id);
  if (error) throw new Error(`club-admin: delete comment: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 2c. Prediction visibility (Phase E). Coach toggle per student; default visible.
// ---------------------------------------------------------------------------

export type ClubPredictionRosterRow = { studentId: string; name: string; predictionVisible: boolean };

export async function listClubPredictionRoster(): Promise<ClubPredictionRosterRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, club_display_name, club_prediction_visible")
    .eq("is_active", true)
    .order("student_name", { ascending: true });
  if (error || !data) return [];
  return (data as Array<{ id: string; student_name: string; club_display_name: string | null; club_prediction_visible: boolean | null }>).map((r) => ({
    studentId: r.id,
    name: (r.club_display_name ?? "").trim() || r.student_name || "Ученик",
    predictionVisible: r.club_prediction_visible !== false,
  }));
}

export async function setClubPredictionVisible(studentId: string, visible: boolean): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("trainingpeaks_students").update({ club_prediction_visible: visible }).eq("id", studentId);
  if (error) throw new Error(`club-admin: prediction visibility: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 2d. Billing: payment claims inbox + reminder drafts (Phase E). Read-only over the
// Coach OS billing module; never mutates billing allocation. Tolerant of missing
// tables (migration 20260808 not applied) and of billing not being wired -> empty.
// ---------------------------------------------------------------------------

export type ClubPaymentClaimRow = { id: string; studentName: string; note: string | null; status: string; createdAtLabel: string };

export async function listClubPaymentClaims(includeReviewed = false): Promise<ClubPaymentClaimRow[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("club_payment_claims")
    .select("id, student_id, note, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (!includeReviewed) query = query.eq("status", "pending");
  const { data, error } = await query;
  if (error || !data) return [];
  const rows = data as Array<{ id: string; student_id: string; note: string | null; status: string; created_at: string }>;
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.student_id))];
  const { data: students } = await supabase.from("trainingpeaks_students").select("id, student_name, club_display_name").in("id", ids);
  const nameById = new Map(
    ((students as Array<{ id: string; student_name: string; club_display_name: string | null }> | null) ?? []).map((s) => [s.id, (s.club_display_name ?? "").trim() || s.student_name || "Ученик"] as const)
  );
  return rows.map((r) => ({
    id: r.id,
    studentName: nameById.get(r.student_id) ?? "Ученик",
    note: r.note,
    status: r.status,
    createdAtLabel: r.created_at.replace("T", " ").slice(0, 16),
  }));
}

export async function reviewClubPaymentClaim(id: string, coach: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_payment_claims").update({ status: "reviewed", reviewed_at: new Date().toISOString(), reviewed_by: coach }).eq("id", id);
  if (error) throw new Error(`club-admin: review claim: ${error.message}`);
}

export type ClubDebtorRow = { studentId: string; name: string; daysOverdue: number | null; amountLabel: string | null };

/** Overdue students for the current billing month (read-only over the billing module). */
export async function listClubDebtors(): Promise<{ billingMonth: string; debtors: ClubDebtorRow[] }> {
  const { getAdminBillingMonthOverview } = await import("@/features/billing/admin");
  let overview;
  try {
    overview = await getAdminBillingMonthOverview(undefined, "overdue");
  } catch {
    return { billingMonth: "", debtors: [] };
  }
  const debtors: ClubDebtorRow[] = overview.rows
    .filter((r) => r.studentId)
    .map((r) => ({
      studentId: r.studentId as string,
      name: r.clientName || "Ученик",
      daysOverdue: r.daysOverdue,
      amountLabel: Number.isFinite(r.plannedAmount) ? `${Math.round(r.plannedAmount)} ${r.currency === "RUB" ? "₽" : r.currency}` : null,
    }));
  return { billingMonth: overview.billingMonth, debtors };
}

export type ClubReminderRow = { id: string; studentName: string; billingMonth: string; draftText: string; status: string };

export async function listClubPaymentReminders(billingMonth: string): Promise<ClubReminderRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_payment_reminders")
    .select("id, student_id, billing_month, draft_text, status")
    .eq("billing_month", billingMonth)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error || !data) return [];
  const rows = data as Array<{ id: string; student_id: string; billing_month: string; draft_text: string; status: string }>;
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.student_id))];
  const { data: students } = await supabase.from("trainingpeaks_students").select("id, student_name, club_display_name").in("id", ids);
  const nameById = new Map(
    ((students as Array<{ id: string; student_name: string; club_display_name: string | null }> | null) ?? []).map((s) => [s.id, (s.club_display_name ?? "").trim() || s.student_name || "Ученик"] as const)
  );
  return rows.map((r) => ({ id: r.id, studentName: nameById.get(r.student_id) ?? "Ученик", billingMonth: r.billing_month, draftText: r.draft_text, status: r.status }));
}

/** Generate one draft reminder per current overdue student (idempotent per month). */
export async function createReminderDrafts(coach: string): Promise<number> {
  const { billingMonth, debtors } = await listClubDebtors();
  if (!billingMonth || debtors.length === 0) return 0;
  const supabase = createSupabaseServerClient();
  let created = 0;
  for (const d of debtors) {
    const amount = d.amountLabel ? ` на сумму ${d.amountLabel}` : "";
    const draft = `Напоминание об оплате за ${billingMonth}${amount}. Оплатить можно в мини-аппе клуба, кнопка «Оплатить».`;
    // Upsert-by-unique: skip if a draft already exists for this (student, month).
    const { error } = await supabase
      .from("club_payment_reminders")
      .insert({ student_id: d.studentId, billing_month: billingMonth, draft_text: draft, status: "draft", created_by: coach });
    if (!error) created += 1;
  }
  return created;
}

export async function confirmReminderDrafts(ids: string[], coach: string): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createSupabaseServerClient();
  void coach; // confirmation keeps the original created_by; coach is the shared admin token
  const { error, count } = await supabase
    .from("club_payment_reminders")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() }, { count: "exact" })
    .in("id", ids)
    .eq("status", "draft");
  if (error) throw new Error(`club-admin: confirm reminders: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// 2e. Race-fill suggestions (Phase F). For the mass-entry pass: pre-fill the coach's
// "confirm race" form from a race_events row whose date matches a completed run, taking
// the finish time from the workout SUMMARY. Read-only; the coach still confirms each.
// ---------------------------------------------------------------------------

export type RaceFillSuggestion = { distanceKey: RecordDistanceKey; timeSeconds: number; timeLabel: string; date: string; raceName: string };

function hms(sec: number): string {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export async function getRaceFillSuggestions(studentId: string): Promise<RaceFillSuggestion[]> {
  const supabase = createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("trainingpeaks_race_events")
    .select("event_date, title")
    .eq("student_id", studentId)
    .lte("event_date", today)
    .order("event_date", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  const events: RaceFillEvent[] = (data as Array<{ event_date: string; title: string | null }>)
    .filter((e) => e.event_date)
    .map((e) => ({ studentId, eventDate: e.event_date.slice(0, 10), title: e.title }));
  if (events.length === 0) return [];

  const dates = events.map((e) => e.eventDate).sort();
  const rows = await loadClubWorkoutRows({ from: dates[0], to: today, studentIds: [studentId] });
  const byDate = new Map<string, RaceFillWorkout[]>();
  for (const r of rows) {
    const arr = byDate.get(r.workoutDate) ?? [];
    arr.push({ studentId: r.studentId, workoutDate: r.workoutDate, distanceKm: r.distanceKm, durationSeconds: r.durationSeconds, isCompleted: r.isCompleted, isRunning: r.isRunning });
    byDate.set(r.workoutDate, arr);
  }

  // Keep at most one suggestion per distance (the most recent, since events are date-desc).
  const byDist = new Map<RecordDistanceKey, RaceFillSuggestion>();
  for (const ev of events) {
    const outcome = classifyRaceEventFill(ev, byDate.get(ev.eventDate) ?? [], today);
    if (outcome.reason === "fillable" && outcome.candidate && !byDist.has(outcome.candidate.distanceKey)) {
      byDist.set(outcome.candidate.distanceKey, {
        distanceKey: outcome.candidate.distanceKey,
        timeSeconds: outcome.candidate.timeSeconds,
        timeLabel: hms(outcome.candidate.timeSeconds),
        date: outcome.candidate.date,
        raceName: outcome.candidate.raceName,
      });
    }
  }
  return [...byDist.values()];
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

// ── Entry links (one-time binding tokens) ──────────────────────────────────

export type ClubLinkTokenView = { id: string; token: string; link: string | null; expiresAt: string };
export type ClubLinksAdminData = {
  bound: LinkRow[];
  unbound: LinkRow[];
  generalLink: string | null;
  /** false when CLUB_MINIAPP_SHORT_NAME / bot username can't be resolved. */
  configured: boolean;
  configError: string | null;
  tokensByStudent: Record<string, ClubLinkTokenView[]>;
};

/**
 * Everything the /admin/club/links page needs: bind status + active tokens with
 * their copy-ready links + the general link. Resolves the bot username + short name
 * ONCE. Read-only; never sends anything to students.
 */
export async function getClubLinksAdminData(): Promise<ClubLinksAdminData> {
  const links = await listTelegramLinks();
  const bound = links.filter((l) => l.telegramUserId);
  const unbound = links.filter((l) => !l.telegramUserId);

  const shortName = clubMiniAppShortName();
  let username: string | null = null;
  let configError: string | null = null;
  if (!shortName) {
    configError = "CLUB_MINIAPP_SHORT_NAME не задан (BotFather /newapp короткое имя, напр. club).";
  } else {
    username = await resolveClubBotUsername().catch(() => null);
    if (!username) configError = "Не удалось получить username бота (TELEGRAM_BOT_TOKEN).";
  }
  const configured = Boolean(shortName && username);

  const tokensMap = await listAllActiveClubLinkTokens();
  const tokensByStudent: Record<string, ClubLinkTokenView[]> = {};
  for (const [studentId, rows] of tokensMap) {
    tokensByStudent[studentId] = rows.map((r) => ({
      id: r.id,
      token: r.token,
      link: configured ? clubTokenLinkStr(username!, shortName!, r.token) : null,
      expiresAt: r.expiresAt,
    }));
  }

  return {
    bound,
    unbound,
    generalLink: configured ? clubGeneralLinkStr(username!, shortName!) : null,
    configured,
    configError,
    tokensByStudent,
  };
}

export type BulkLinkRow = { studentId: string; name: string; link: string | null; expiresAt: string };

/** Generate a fresh one-time link for every UNBOUND student — for a copy/export list. No send. */
export async function generateClubLinksForUnbound(coach: string): Promise<BulkLinkRow[]> {
  const links = await listTelegramLinks();
  const unbound = links.filter((l) => !l.telegramUserId);
  const shortName = clubMiniAppShortName();
  const username = shortName ? await resolveClubBotUsername().catch(() => null) : null;
  const configured = Boolean(shortName && username);

  const out: BulkLinkRow[] = [];
  for (const s of unbound) {
    const { token, expiresAt } = await createClubLinkToken(s.studentId, coach);
    out.push({
      studentId: s.studentId,
      name: s.name,
      link: configured ? clubTokenLinkStr(username!, shortName!, token) : null,
      expiresAt,
    });
  }
  return out;
}

// ── Access requests (coach-approved club entry) ────────────────────────────

export type AccessCandidate = {
  studentId: string;
  name: string;
  tpAthleteId: string | null;
  active: boolean;
  service: boolean;
  lastWorkoutDate: string | null;
  count30d: number;
  boundTelegramUserId: number | null;
  duplicateTp: boolean;
};
export type AccessRequestView = {
  request: ClubAccessRequest;
  suggestions: Array<{ studentId: string; name: string; sim: number }>;
};
export type ClubAccessAdminData = { requests: AccessRequestView[]; candidates: AccessCandidate[] };

function reqFullName(r: ClubAccessRequest): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || r.telegramUsername || "";
}

/** Pending requests + full candidate list (with TP id, last workout, 30d count, status, dup). */
export async function getClubAccessRequestsAdminData(): Promise<ClubAccessAdminData> {
  const supabase = createSupabaseServerClient();
  const [requests, studentsRes] = await Promise.all([
    listPendingClubAccessRequests(),
    // student_id (text) is the TrainingPeaks athlete identifier; id (uuid) is the local row.
    supabase.from("trainingpeaks_students").select("id, student_name, student_id, is_active, is_service_account, telegram_user_id").order("student_name", { ascending: true }),
  ]);
  const students = ((studentsRes.data as Array<Record<string, unknown>> | null) ?? []);

  // Workout aggregates from the last 90 days (bounded): last workout + 30-day count.
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const wrows = await fetchAllRows<{ student_id: string; workout_date: string; is_completed: boolean | null }>(
    async (from, to) =>
      supabase.from("trainingpeaks_workout_cache").select("student_id, workout_date, is_completed").gte("workout_date", since90).eq("is_completed", true).order("id", { ascending: true }).range(from, to),
    { label: "access:workouts90" }
  );
  const lastByStudent = new Map<string, string>();
  const count30 = new Map<string, number>();
  for (const w of wrows) {
    const cur = lastByStudent.get(w.student_id);
    if (!cur || w.workout_date > cur) lastByStudent.set(w.student_id, w.workout_date);
    if (w.workout_date >= since30) count30.set(w.student_id, (count30.get(w.student_id) ?? 0) + 1);
  }
  // Duplicate TP athlete ids (one athlete as several rows).
  const tpCount = new Map<string, number>();
  for (const s of students) {
    const tp = s.student_id != null ? String(s.student_id) : null;
    if (tp) tpCount.set(tp, (tpCount.get(tp) ?? 0) + 1);
  }

  const candidates: AccessCandidate[] = students.map((s) => {
    const id = s.id as string;
    const tp = s.student_id != null ? String(s.student_id) : null;
    return {
      studentId: id,
      name: (s.student_name as string) ?? "",
      tpAthleteId: tp,
      active: s.is_active !== false,
      service: s.is_service_account === true,
      lastWorkoutDate: lastByStudent.get(id) ?? null,
      count30d: count30.get(id) ?? 0,
      boundTelegramUserId: (s.telegram_user_id as number | null) ?? null,
      duplicateTp: tp ? (tpCount.get(tp) ?? 0) > 1 : false,
    };
  });

  // Autosuggest: active, non-service candidates most similar to the request's name.
  const pool = candidates.filter((c) => c.active && !c.service);
  const views: AccessRequestView[] = requests.map((r) => {
    const rn = reqFullName(r);
    const ranked = pool
      .map((c) => ({ studentId: c.studentId, name: c.name, sim: rn ? nameSim(rn, c.name) : 0 }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3);
    return { request: r, suggestions: ranked };
  });

  return { requests: views, candidates };
}

/** Short post-bind summary for the coach: last workout + completed count in last 7 days. */
export async function getBoundStudentSummary(studentId: string): Promise<{ name: string; lastWorkoutDate: string | null; count7d: number }> {
  const supabase = createSupabaseServerClient();
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: s }, { data: w }] = await Promise.all([
    supabase.from("trainingpeaks_students").select("student_name").eq("id", studentId).maybeSingle(),
    supabase.from("trainingpeaks_workout_cache").select("workout_date, is_completed").eq("student_id", studentId).eq("is_completed", true).order("workout_date", { ascending: false }).limit(60),
  ]);
  const rows = (w as Array<{ workout_date: string }> | null) ?? [];
  const last = rows.length ? rows[0].workout_date : null;
  const count7d = rows.filter((r) => r.workout_date >= since7).length;
  return { name: (s as { student_name: string } | null)?.student_name ?? studentId.slice(0, 8), lastWorkoutDate: last, count7d };
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

/**
 * Phase 3.2 — coach sets any student's club display name. Empty string clears the
 * override (falls back to the real first+last name). Writes only club_display_name
 * (migration 20260802000000); no other surface reads it.
 */
export async function setClubDisplayName(studentId: string, displayName: string | null): Promise<void> {
  const supabase = createSupabaseServerClient();
  const value = (displayName ?? "").trim().slice(0, 40) || null;
  const { error } = await supabase.from("trainingpeaks_students").update({ club_display_name: value }).eq("id", studentId);
  if (error) throw new Error(`club-admin: setClubDisplayName: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 4. Club management panel
// ---------------------------------------------------------------------------

/** Access health of a club table — surfaces 42501 (permission denied) / 42P01 (missing) LOUDLY. */
export type ClubTableHealth = { table: string; ok: boolean; code: string | null; message: string | null };

const CLUB_TABLES = [
  "club_records",
  "club_record_snapshots",
  "club_races",
  "club_tp_peaks",
  "club_reactions",
  "club_wishes",
  "club_dayoff_requests",
  "club_link_events",
  "club_challenges",
] as const;

/**
 * Probe every club table with a HEAD count. A read that hits a missing GRANT
 * returns Postgres 42501 (permission denied) — WITHOUT this the mini-app tab would
 * just render EMPTY and hide the misconfiguration. Here it becomes a loud red row
 * in /admin/club/manage. 42P01 = table not created (migration not applied).
 */
export async function probeClubTablesHealth(): Promise<ClubTableHealth[]> {
  const supabase = createSupabaseServerClient();
  const out: ClubTableHealth[] = [];
  for (const table of CLUB_TABLES) {
    const { error } = await supabase.from(table).select("id", { count: "exact", head: true });
    if (error) {
      out.push({
        table,
        ok: false,
        code: (error as { code?: string }).code ?? null,
        message: error.message,
      });
    } else {
      out.push({ table, ok: true, code: null, message: null });
    }
  }
  return out;
}

/** Humanise an age in minutes → «N мин / N ч / N дн назад». */
function humanAge(minutes: number): string {
  if (minutes < 90) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}

export async function getClubManagementData(): Promise<{
  goalMode: string; freshnessLabel: string; latestScannedAt: string | null; cacheRows: number;
  activeStudents: number; lapDensityPct: number; peaksCoverage: string; clubTablesHealth: ClubTableHealth[];
  snapshotFreshnessLabel: string; snapshotStale: boolean; snapshotComputedAt: string | null;
}> {
  const supabase = createSupabaseServerClient();
  const fresh = await getTrainingPeaksWorkoutCacheFreshness();
  const clubTablesHealth = await probeClubTablesHealth();
  const [{ count: withLaps }, { count: totalCompleted }, { count: activeStudents }, snap] = await Promise.all([
    supabase.from("trainingpeaks_workout_derived_metrics").select("id", { count: "exact", head: true }).eq("has_fit", true),
    supabase.from("trainingpeaks_workout_cache").select("id", { count: "exact", head: true }).eq("is_completed", true),
    supabase.from("trainingpeaks_students").select("id", { count: "exact", head: true }).eq("is_active", true),
    // Snapshot freshness (Phase 1.5): newest computed_at across club_record_snapshots.
    // If materialize never ran (CLUB_MATERIALIZE_ENABLED off on the scan runner) the
    // Results tab silently serves stale/empty snapshots — surface it loudly.
    supabase.from("club_record_snapshots").select("computed_at").order("computed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const lapDensityPct = totalCompleted && totalCompleted > 0 ? Math.round(((withLaps ?? 0) / totalCompleted) * 100) : 0;
  const scanned = fresh.latestScannedAt ? new Date(fresh.latestScannedAt) : null;
  const label = scanned ? humanAge(Math.round((Date.now() - scanned.getTime()) / 60000)) : "нет данных";

  const snapComputedAt = (snap.data as { computed_at?: string } | null)?.computed_at ?? null;
  const snapAgeMin = snapComputedAt ? Math.round((Date.now() - new Date(snapComputedAt).getTime()) / 60000) : null;
  // Stale = never computed OR older than 24h (scans should refresh several times a day).
  const snapshotStale = snapAgeMin === null || snapAgeMin > 24 * 60;
  const snapshotFreshnessLabel =
    snapAgeMin === null ? "никогда - пересчёт не запускался (CLUB_MATERIALIZE_ENABLED?)" : humanAge(snapAgeMin);

  return {
    goalMode: (process.env.CLUB_CHALLENGE_GOAL_MODE ?? "auto"),
    freshnessLabel: label, latestScannedAt: fresh.latestScannedAt, cacheRows: fresh.rowCount,
    activeStudents: activeStudents ?? 0, lapDensityPct,
    peaksCoverage: "нет данных (TP-пики не ингестятся; CLUB_RECORDS_TP_PEAKS не включён)",
    clubTablesHealth,
    snapshotFreshnessLabel, snapshotStale, snapshotComputedAt: snapComputedAt,
  };
}
