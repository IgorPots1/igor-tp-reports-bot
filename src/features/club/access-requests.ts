// Club Mini App — access requests. An unbound account opening the general link
// records a request (name captured from initData) and sees «Заявка отправлена».
// The coach matches it to a student in the admin. Server-side (service_role).
// Nothing is sent to students. See migration 20260729000000_club_access_requests.sql.

import { createSupabaseServerClient } from "@/features/supabase/server";

export type ClubAccessRequestStatus = "pending" | "approved" | "rejected";

export type ClubAccessRequest = {
  id: string;
  telegramUserId: number;
  telegramUsername: string | null;
  firstName: string | null;
  lastName: string | null;
  status: ClubAccessRequestStatus;
  studentId: string | null;
  createdAt: string;
};

export type TgUserLite = { id: number; username?: string | null; first_name?: string | null; last_name?: string | null };

/**
 * Record (or refresh) a pending access request for a Telegram user. One row per
 * telegram_user_id (unique) — re-opening does NOT create a duplicate; it refreshes
 * the captured name/updated_at and keeps the existing status. Inert if the table
 * is absent (returns "unavailable" so the caller still shows the waiting screen).
 */
export async function recordClubAccessRequest(user: TgUserLite): Promise<"ok" | "unavailable"> {
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from("club_access_requests")
      .upsert(
        {
          telegram_user_id: user.id,
          telegram_username: user.username ?? null,
          first_name: user.first_name ?? null,
          last_name: user.last_name ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "telegram_user_id" }
      );
    return error ? "unavailable" : "ok";
  } catch {
    return "unavailable";
  }
}

function mapRow(r: Record<string, unknown>): ClubAccessRequest {
  return {
    id: r.id as string,
    telegramUserId: Number(r.telegram_user_id ?? 0),
    telegramUsername: (r.telegram_username as string | null) ?? null,
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    status: (r.status as ClubAccessRequestStatus) ?? "pending",
    studentId: (r.student_id as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/** Pending requests, oldest first. Empty if the table is absent. */
export async function listPendingClubAccessRequests(): Promise<ClubAccessRequest[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("club_access_requests")
      .select("id, telegram_user_id, telegram_username, first_name, last_name, status, student_id, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map(mapRow);
  } catch {
    return [];
  }
}

/** Mark a request approved + attach the bound student (binding itself is done by the caller). */
export async function markClubAccessRequestApproved(id: string, studentId: string, coach: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("club_access_requests")
    .update({ status: "approved", student_id: studentId, handled_by: coach, handled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`club: approve request: ${error.message}`);
}

/** Reject a request (outsider). No binding. */
export async function markClubAccessRequestRejected(id: string, coach: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("club_access_requests")
    .update({ status: "rejected", handled_by: coach, handled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`club: reject request: ${error.message}`);
}
