// Per-student payment links admin (наряд ч.5.1). Self-contained repo for the
// /admin/club/payment-links screen: list students with their current link, and set a
// student's payment_url. Kept in its own file so it never collides with the actively-worked
// billing modules. Nothing here touches billing allocation — payment_url is a plain contact link.
import { createSupabaseServerClient } from "@/features/supabase/server";

export type StudentPaymentLink = {
  id: string;
  name: string;
  paymentUrl: string | null;
};

/** Active, non-service students with their current payment link, name-sorted. Resilient to the
 *  payment_url column not yet existing (migration pending): falls back to listing without it so the
 *  admin page still renders instead of 500-ing. */
export async function listStudentsForPaymentLinks(): Promise<StudentPaymentLink[]> {
  const supabase = createSupabaseServerClient();
  type Row = { id: string; student_name: string | null; is_active: boolean | null; is_service_account: boolean | null; payment_url?: string | null };
  let rows: Row[] | null = null;
  const full = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, is_active, is_service_account, payment_url")
    .order("student_name", { ascending: true });
  if (full.error) {
    // payment_url column may not be migrated yet — list without it (all links empty).
    const bare = await supabase
      .from("trainingpeaks_students")
      .select("id, student_name, is_active, is_service_account")
      .order("student_name", { ascending: true });
    rows = (bare.data as Row[] | null) ?? null;
  } else {
    rows = (full.data as Row[] | null) ?? null;
  }
  if (!rows) return [];
  return rows
    .filter((r) => r.is_active !== false && r.is_service_account !== true)
    .map((r) => ({ id: r.id, name: (r.student_name ?? "").trim() || r.id.slice(0, 8), paymentUrl: (r.payment_url ?? null) || null }));
}

/** Set (or clear with null) one student's payment_url. Returns whether a row was updated. */
export async function updateStudentPaymentUrl(studentId: string, url: string | null): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("trainingpeaks_students")
    .update({ payment_url: url })
    .eq("id", studentId);
  return !error;
}
