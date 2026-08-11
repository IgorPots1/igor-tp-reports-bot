"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";
import { listStudentsForPaymentLinks, updateStudentPaymentUrl } from "@/features/club-admin/payment-links";

const SELF = "/admin/club/payment-links";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensureAdminAccess(): Promise<void> {
  if (isAdminAccessBypassedForLocalDev()) return;
  const cookieStore = await cookies();
  if (hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value)) return;
  redirect(`/admin/login?next=${encodeURIComponent(normalizeAdminRedirectPath(SELF))}`);
}
function withNotice(key: "notice" | "error", value: string): string {
  const params = new URLSearchParams();
  params.set(key, value);
  return `${SELF}?${params.toString()}`;
}

// Split a bulk line into key + url. Accepts tab, " | ", " = ", "," or 2+ spaces as the separator.
// Left = student id or exact name; right = the url (empty right → clear that student's link).
function splitLine(line: string): { key: string; url: string } | null {
  const m = line.match(/^(.*?)(?:\t+|\s*[|=,]\s*|\s{2,})(.*)$/);
  if (m) return { key: m[1].trim(), url: m[2].trim() };
  // no separator but a bare "id url" with a single space
  const sp = line.trim().match(/^(\S+)\s+(\S.*)$/);
  if (sp) return { key: sp[1].trim(), url: sp[2].trim() };
  return null;
}

/**
 * Bulk-set per-student payment links (наряд ч.5.1). Textarea `bulk`: one «ученик → ссылка» per line.
 * Left side is the student id (UUID) or the EXACT name (case-insensitive); right side is the url.
 * Empty right side clears that student's link. Ambiguous names (two students share it) are skipped and
 * reported — never guessed. Nothing here touches billing; only trainingpeaks_students.payment_url.
 */
export async function setPaymentLinksAction(formData: FormData): Promise<void> {
  await ensureAdminAccess();
  const bulk = typeof formData.get("bulk") === "string" ? (formData.get("bulk") as string) : "";
  const lines = bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) redirect(withNotice("error", "Пусто — вставь строки «ученик → ссылка»."));

  const students = await listStudentsForPaymentLinks();
  const byId = new Map(students.map((s) => [s.id, s]));
  const byName = new Map<string, string[]>(); // lowercased name → student ids (to catch ambiguity)
  for (const s of students) {
    const k = s.name.toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), s.id]);
  }

  let updated = 0;
  let cleared = 0;
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  const badUrl: string[] = [];

  for (const line of lines) {
    const parsed = splitLine(line);
    if (!parsed) { unmatched.push(line.slice(0, 40)); continue; }
    const { key, url } = parsed;

    let studentId: string | null = null;
    if (UUID_RE.test(key)) {
      studentId = byId.has(key) ? key : null;
    } else {
      const ids = byName.get(key.toLowerCase()) ?? [];
      if (ids.length === 1) studentId = ids[0];
      else if (ids.length > 1) { ambiguous.push(key); continue; }
    }
    if (!studentId) { unmatched.push(key.slice(0, 40)); continue; }

    if (url === "") {
      if (await updateStudentPaymentUrl(studentId, null)) cleared += 1;
      continue;
    }
    if (!/^https?:\/\//i.test(url)) { badUrl.push(key.slice(0, 40)); continue; }
    if (await updateStudentPaymentUrl(studentId, url)) updated += 1;
  }

  revalidatePath(SELF);
  const parts = [`Обновлено ссылок: ${updated}`];
  if (cleared) parts.push(`очищено: ${cleared}`);
  if (ambiguous.length) parts.push(`неоднозначных имён (пропущено): ${ambiguous.length} — ${ambiguous.slice(0, 5).join(", ")}`);
  if (unmatched.length) parts.push(`не найдено: ${unmatched.length} — ${unmatched.slice(0, 5).join(", ")}`);
  if (badUrl.length) parts.push(`ссылка не http(s): ${badUrl.length} — ${badUrl.slice(0, 5).join(", ")}`);
  redirect(withNotice(ambiguous.length || unmatched.length || badUrl.length ? "error" : "notice", parts.join(" · ")));
}
