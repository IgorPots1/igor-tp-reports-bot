// Club Mini App — cabinet sections: races, day-off requests, wishes, billing.
// All gated by their own flags at the route layer. Every write is self-scoped
// (the student's OWN rows only; student_id comes from the resolver). Nothing is
// sent to students, nothing is written to TrainingPeaks. Tables ship as migration
// files (not applied) — reads/writes are inert until applied.

import { createSupabaseServerClient } from "@/features/supabase/server";
import { getBillingClientForStudent, getBillingClientDetail, getEffectiveBillingRowStatus } from "@/features/billing/admin";
import type { BillingMonthStatusRow } from "@/features/billing/types";

import { formatRuDate } from "./service";
import { buildClubTbankPayUrl } from "./billing-links";
import type {
  ClubBillingView,
  ClubDayoffRequest,
  ClubRace,
  ClubWish,
} from "./types";

function ymd(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/u.test(v) ? v.slice(0, 10) : null;
}
function intOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function clampScale(v: unknown): number | null {
  const n = intOrNull(v);
  return n !== null && n >= 1 && n <= 10 ? n : null;
}

// ---------------------------------------------------------------------------
// Races (Block 6)
// ---------------------------------------------------------------------------

export async function createClubRace(
  studentId: string,
  input: { name?: unknown; raceDate?: unknown; distanceLabel?: unknown; distanceMeters?: unknown; city?: unknown; country?: unknown; targetResultSeconds?: unknown }
): Promise<{ ok: boolean; error?: string }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const raceDate = ymd(input.raceDate);
  if (!name || !raceDate) {
    return { ok: false, error: "Укажи название и дату старта." };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_races").insert({
    student_id: studentId,
    name,
    race_date: raceDate,
    distance_meters: intOrNull(input.distanceMeters),
    distance_label: typeof input.distanceLabel === "string" ? input.distanceLabel.trim() || null : null,
    city: typeof input.city === "string" ? input.city.trim() || null : null,
    country: typeof input.country === "string" ? input.country.trim() || null : null,
    target_result_seconds: intOrNull(input.targetResultSeconds),
    status: "declared",
  });
  if (error) {
    return { ok: false, error: "Раздел стартов пока не активен." };
  }
  return { ok: true };
}

export async function listClubRaces(studentId: string): Promise<ClubRace[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_races")
    .select("id, name, race_date, distance_label, distance_meters, city, target_result_seconds, status")
    .eq("student_id", studentId)
    .order("race_date", { ascending: false })
    .limit(50);
  if (error || !data) {
    return [];
  }
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? "",
    raceDate: r.race_date as string,
    dateLabel: formatRuDate(r.race_date as string),
    distanceLabel:
      (r.distance_label as string | null) ??
      (r.distance_meters ? `${((r.distance_meters as number) / 1000).toFixed(1)} км` : null),
    city: (r.city as string | null) ?? null,
    targetResultSeconds: intOrNull(r.target_result_seconds),
    status: (r.status as ClubRace["status"]) ?? "declared",
  }));
}

// ---------------------------------------------------------------------------
// Day-off requests (Block 8)
// ---------------------------------------------------------------------------

export async function createDayoffRequest(
  studentId: string,
  input: { fromDate?: unknown; toDate?: unknown; reason?: unknown }
): Promise<{ ok: boolean; error?: string }> {
  const fromDate = ymd(input.fromDate);
  const toDate = ymd(input.toDate) ?? fromDate;
  if (!fromDate || !toDate || fromDate > toDate) {
    return { ok: false, error: "Укажи корректные даты." };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_dayoff_requests").insert({
    student_id: studentId,
    from_date: fromDate,
    to_date: toDate,
    reason: typeof input.reason === "string" ? input.reason.trim() || null : null,
    status: "pending",
  });
  if (error) {
    return { ok: false, error: "Раздел выходных пока не активен." };
  }
  return { ok: true };
}

export async function listDayoffRequests(studentId: string): Promise<ClubDayoffRequest[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_dayoff_requests")
    .select("id, from_date, to_date, reason, status")
    .eq("student_id", studentId)
    .order("from_date", { ascending: false })
    .limit(50);
  if (error || !data) {
    return [];
  }
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    fromDate: r.from_date as string,
    toDate: r.to_date as string,
    reason: (r.reason as string | null) ?? null,
    status: (r.status as ClubDayoffRequest["status"]) ?? "pending",
  }));
}

// ---------------------------------------------------------------------------
// Wishes (Block 7.1) — mirrors the nutrition check-in: 1–10 scales + free text
// ---------------------------------------------------------------------------

export async function createWish(
  studentId: string,
  input: { load?: unknown; wellbeing?: unknown; schedule?: unknown; note?: unknown }
): Promise<{ ok: boolean; error?: string }> {
  const load = clampScale(input.load);
  const wellbeing = clampScale(input.wellbeing);
  const schedule = clampScale(input.schedule);
  const note = typeof input.note === "string" ? input.note.trim() || null : null;
  if (load === null && wellbeing === null && schedule === null && !note) {
    return { ok: false, error: "Заполни хотя бы одно поле." };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("club_wishes").insert({
    student_id: studentId,
    load_scale: load,
    wellbeing_scale: wellbeing,
    schedule_scale: schedule,
    note,
  });
  if (error) {
    return { ok: false, error: "Раздел пожеланий пока не активен." };
  }
  return { ok: true };
}

export async function listWishes(studentId: string): Promise<ClubWish[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_wishes")
    .select("id, created_at, load_scale, wellbeing_scale, schedule_scale, note")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) {
    return [];
  }
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    dateLabel: formatRuDate((r.created_at as string).slice(0, 10)),
    loadScale: intOrNull(r.load_scale),
    wellbeingScale: intOrNull(r.wellbeing_scale),
    scheduleScale: intOrNull(r.schedule_scale),
    note: (r.note as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Billing (Block 7.2) — read-only. Stub until a read-only view of the Coach OS
// billing module is wired. NO payment fields ever live in the mini app.
// ---------------------------------------------------------------------------

function billingAmountLabel(amount: number | null, currency: string): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const sign = currency === "RUB" ? "₽" : currency;
  return `${Math.round(amount)} ${sign}`;
}

function billingStatusLabel(row: BillingMonthStatusRow): { label: string; kind: ClubBillingView["statusKind"] } {
  const eff = getEffectiveBillingRowStatus(row);
  if (eff === "paid") return { label: "Оплачено", kind: "paid" };
  if (eff === "overdue") {
    return { label: row.daysOverdue ? `Просрочено ${row.daysOverdue} дн.` : "Просрочено", kind: "overdue" };
  }
  return { label: "Ожидается", kind: "due" };
}

/**
 * READ-ONLY projection of the Coach OS billing module for one student. Surfaces
 * status / next due date / amount / short history + a T-Bank pay link. Never
 * exposes payer identities, card data, or requisites (PII stays in /admin/billing).
 */
export async function getClubBilling(studentId: string): Promise<ClubBillingView> {
  const empty = (note: string): ClubBillingView => ({
    available: false, note, status: null, statusKind: "unknown", nextDueDate: null, amountLabel: null, history: [], payUrl: null,
  });

  const client = await getBillingClientForStudent(studentId);
  if (!client) {
    return empty("Оплата не привязана. Обратись к тренеру, чтобы связать профиль с биллингом.");
  }
  const detail = await getBillingClientDetail(client.id);
  if (!detail) {
    return empty("Данные оплаты пока недоступны.");
  }

  const current = detail.currentMonthStatus;
  const status = current ? billingStatusLabel(current) : null;
  const payUrl = buildClubTbankPayUrl(client.clientName ?? studentId);

  const history = detail.paymentHistory
    .slice(-6)
    .reverse()
    .map((row) => ({
      label: row.billingMonth ?? "",
      amount: billingAmountLabel(row.paidAmount ?? row.plannedAmount, row.currency),
    }));

  return {
    available: true,
    note: "",
    status: status?.label ?? null,
    statusKind: status?.kind ?? "unknown",
    nextDueDate: current?.plannedPaymentDate ?? null,
    amountLabel: current ? billingAmountLabel(current.plannedAmount, current.currency) : null,
    history,
    payUrl,
  };
}
