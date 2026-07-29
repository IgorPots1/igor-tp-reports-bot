// Club — record a real "opened the club" event and read it for the admin. Written on every
// SUCCESSFUL club resolve (miniapp-guard), best-effort. One row per student per day (upsert),
// so it stays bounded. Fills the gap where opens were never stored (clientlog → console only).

import { createSupabaseServerClient } from "@/features/supabase/server";

/** Map the deep-link start_param to a human section label; anything else = the home screen. */
export function deriveOpenSection(startParam: string | null): string {
  const p = (startParam ?? "").trim();
  if (p === "starts") return "Старты";
  if (p === "schedule") return "Расписание";
  return "главная";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Upsert today's open row for a student. Best-effort: never throws (an open-log failure must
 * not break a club API call), tolerant of the table being absent (migration not yet applied).
 */
export async function recordClubOpen(studentId: string, telegramUserId: number | null, section: string): Promise<void> {
  try {
    const s = createSupabaseServerClient();
    await s
      .from("club_open_events")
      .upsert(
        { student_id: studentId, open_date: todayIso(), telegram_user_id: telegramUserId, last_section: section, last_seen_at: new Date().toISOString() },
        { onConflict: "student_id,open_date" }
      );
  } catch {
    /* best-effort */
  }
}

export type ClubOpenAdmin = {
  everOpenedCount: number;
  uniqueThisWeek: number;
  openedTodayCount: number;
  recent: Array<{ studentId: string; name: string; lastSeenAt: string; lastSection: string | null }>;
};

/**
 * Admin view of opens: how many distinct students ever opened, how many unique in the last 7
 * days, how many today, and the most-recently-seen students (name + when + from which section).
 */
export async function getClubOpenAdmin(limit = 60): Promise<ClubOpenAdmin> {
  const s = createSupabaseServerClient();
  const empty: ClubOpenAdmin = { everOpenedCount: 0, uniqueThisWeek: 0, openedTodayCount: 0, recent: [] };
  const { data, error } = await s
    .from("club_open_events")
    .select("student_id, open_date, last_section, last_seen_at")
    .order("last_seen_at", { ascending: false });
  if (error || !data) return empty;
  const rows = data as Array<{ student_id: string; open_date: string; last_section: string | null; last_seen_at: string }>;

  const weekCutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const today = todayIso();
  const everStudents = new Set<string>();
  const weekStudents = new Set<string>();
  const todayStudents = new Set<string>();
  // most-recent row per student (rows are already sorted by last_seen desc)
  const latestByStudent = new Map<string, { last_seen_at: string; last_section: string | null }>();
  for (const r of rows) {
    everStudents.add(r.student_id);
    if (r.open_date >= weekCutoff) weekStudents.add(r.student_id);
    if (r.open_date === today) todayStudents.add(r.student_id);
    if (!latestByStudent.has(r.student_id)) latestByStudent.set(r.student_id, { last_seen_at: r.last_seen_at, last_section: r.last_section });
  }

  const ids = [...latestByStudent.keys()].slice(0, limit);
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: studs } = await s.from("trainingpeaks_students").select("id, student_name").in("id", ids);
    for (const st of (studs as Array<{ id: string; student_name: string }> | null) ?? []) nameById.set(st.id, st.student_name);
  }
  const recent = ids.map((id) => {
    const l = latestByStudent.get(id)!;
    return { studentId: id, name: nameById.get(id) ?? id.slice(0, 8), lastSeenAt: l.last_seen_at, lastSection: l.last_section };
  });

  return { everOpenedCount: everStudents.size, uniqueThisWeek: weekStudents.size, openedTodayCount: todayStudents.size, recent };
}
