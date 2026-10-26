/** Что лежит в очереди — для --dry-run раннера. Только чтение. */
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

export async function listPendingForDryRun() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_notify_outbox")
    .select("id, kind, plan_week_id, coach_message_id, requested_by, requested_at")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`intervals_notify_outbox: ${describeSupabaseError(error)}`);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    planWeekId: (r.plan_week_id as string | null) ?? null,
    coachMessageId: (r.coach_message_id as string | null) ?? null,
    requestedBy: String(r.requested_by),
    requestedAt: String(r.requested_at),
  }));
}
