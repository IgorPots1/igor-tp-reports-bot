// Club Mini App — cabinet sections: races, day-off requests, wishes, billing.
// All gated by their own flags at the route layer. Every write is self-scoped
// (the student's OWN rows only; student_id comes from the resolver). Nothing is
// sent to students, nothing is written to TrainingPeaks. Tables ship as migration
// files (not applied) — reads/writes are inert until applied.

import { createSupabaseServerClient } from "@/features/supabase/server";
import { logClubDbError, CLUB_DB_ERROR_STUDENT_MESSAGE } from "./db-errors";
import { getBillingClientForStudent, getBillingClientDetail, getEffectiveBillingRowStatus } from "@/features/billing/admin";
import type { BillingMonthStatusRow } from "@/features/billing/types";

import { formatRuDate } from "./service";
import { createCalendarEntry } from "./calendar";
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
): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const raceDate = ymd(input.raceDate);
  if (!name || !raceDate) {
    return { ok: false, error: "Укажи название и дату старта." };
  }
  // CONSOLIDATION (step 2): the «Старты» form now writes to the CALENDAR path
  // (club_calendar_entries kind='race'), the one that actually executes to TP via
  // club-execute-one.ts. createCalendarEntry handles auto-approve, dedup and distance_meters.
  // club_races is no longer written (kept read-only legacy until the transfer + Igor's word).
  // Note: the calendar path is future-or-today only (forward-looking); a past race date is
  // rejected here (club_races used to allow any date); declaring is a forward action.
  return createCalendarEntry(studentId, {
    date: raceDate,
    kind: "race",
    raceName: name,
    raceCity: input.city,
    raceDistanceLabel: input.distanceLabel,
    raceDistanceMeters: input.distanceMeters,
    raceTargetSeconds: input.targetResultSeconds,
  });
}

/** Map a calendar race entry's status (+ TP anchor) to the ClubRace status the tab shows. */
function mapCalRaceStatus(status: string | null, hasTpAnchor: boolean, rollbackRequested: boolean): ClubRace["status"] {
  // A pending rollback wins over everything: the start is being taken out of TP, then removed.
  if (rollbackRequested) return "removing";
  if (status === "applied" || hasTpAnchor) return "synced_to_tp";
  if (status === "rejected") return "rejected";
  if (status === "approved") return "approved";
  return "declared";
}

export async function listClubRaces(studentId: string): Promise<ClubRace[]> {
  const supabase = createSupabaseServerClient();
  // Step 4: reads collapsed to the calendar (the transfer moved legacy club_races in). The
  // consolidated source is club_calendar_entries kind='race'; club_races is read-only legacy
  // and no longer read here.
  const { data } = await supabase
    .from("club_calendar_entries")
    .select("id, entry_date, race_name, race_city, race_distance_label, distance_meters, race_target_seconds, status, applied_tp_workout_id, tp_rollback_requested_at")
    .eq("student_id", studentId)
    .eq("kind", "race");
  const kmLabel = (label: unknown, meters: unknown): string | null =>
    (label as string | null) ?? (typeof meters === "number" && meters > 0 ? `${(meters / 1000).toFixed(1)} км` : null);
  const out: ClubRace[] = ((data as Array<Record<string, unknown>> | null) ?? [])
    .filter((r) => String(r.entry_date ?? ""))
    .map((r) => ({
      id: r.id as string,
      name: String(r.race_name ?? ""),
      raceDate: String(r.entry_date ?? ""),
      dateLabel: formatRuDate(String(r.entry_date ?? "")),
      distanceLabel: kmLabel(r.race_distance_label, r.distance_meters),
      city: (r.race_city as string | null) ?? null,
      targetResultSeconds: intOrNull(r.race_target_seconds),
      status: mapCalRaceStatus(r.status as string | null, r.applied_tp_workout_id != null, r.tp_rollback_requested_at != null),
    }));
  out.sort((a, b) => (a.raceDate < b.raceDate ? 1 : a.raceDate > b.raceDate ? -1 : 0));
  return out.slice(0, 50);
}

/**
 * Cancel a student's own declared start. Two paths, mirroring the coach admin (deleteClubRace):
 *   - NOT yet in TP (applied_tp_workout_id IS NULL) → delete the declaration directly. No TP entity
 *     exists, so nothing to roll back.
 *   - ALREADY in TP → the web app cannot mutate TrainingPeaks (no creds here), so record a rollback
 *     INTENT (tp_rollback_requested_at). The Mac runner deletes the TP entity and removes the row.
 * Idempotent: cancelling a start whose rollback is already requested is a no-op. Scoped to the
 * student's OWN race rows (student_id + kind='race') so one student can never touch another's.
 */
export async function cancelClubRace(
  studentId: string,
  entryId: string
): Promise<{ ok: boolean; error?: string; pending?: boolean }> {
  if (!studentId || !entryId) return { ok: false, error: "Не указан старт." };
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("club_calendar_entries")
    .select("applied_tp_workout_id, tp_rollback_requested_at")
    .eq("id", entryId)
    .eq("student_id", studentId)
    .eq("kind", "race")
    .maybeSingle();
  if (!data) return { ok: false, error: "Старт не найден." };
  const row = data as { applied_tp_workout_id: number | null; tp_rollback_requested_at: string | null };
  if (row.applied_tp_workout_id != null) {
    if (row.tp_rollback_requested_at) return { ok: true, pending: true };
    const { error } = await supabase
      .from("club_calendar_entries")
      .update({ tp_rollback_requested_at: new Date().toISOString(), tp_rollback_requested_by: "student" })
      .eq("id", entryId)
      .eq("student_id", studentId)
      .eq("kind", "race");
    if (error) return { ok: false, error: error.message };
    return { ok: true, pending: true };
  }
  const { error } = await supabase
    .from("club_calendar_entries")
    .delete()
    .eq("id", entryId)
    .eq("student_id", studentId)
    .eq("kind", "race");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
    const kind = logClubDbError("createDayoffRequest", error);
    return { ok: false, error: kind === "missing_table" ? "Раздел выходных ещё не настроен. Напиши тренеру." : CLUB_DB_ERROR_STUDENT_MESSAGE };
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
    const kind = logClubDbError("createWish", error);
    return { ok: false, error: kind === "missing_table" ? "Раздел пожеланий ещё не настроен. Напиши тренеру." : CLUB_DB_ERROR_STUDENT_MESSAGE };
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

/**
 * "Я оплатил" (Phase E) — records a self-scoped payment claim into the coach inbox.
 * NEVER auto-matches to billing and NEVER confirms a payment; the coach reconciles it
 * manually. Rate-guarded: at most one open (pending) claim per student at a time, so a
 * double-tap or repeat visit does not flood the inbox. Nothing is sent to anyone.
 */
export async function createPaymentClaim(
  studentId: string,
  note?: unknown
): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  const supabase = createSupabaseServerClient();
  const { data: open } = await supabase
    .from("club_payment_claims")
    .select("id")
    .eq("student_id", studentId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (open) {
    return { ok: true, duplicate: true };
  }
  const text = typeof note === "string" ? note.trim().slice(0, 300) || null : null;
  const { error } = await supabase
    .from("club_payment_claims")
    .insert({ student_id: studentId, note: text, status: "pending" });
  if (error) {
    const kind = logClubDbError("createPaymentClaim", error);
    return { ok: false, error: kind === "missing_table" ? "Раздел оплаты ещё не настроен. Напиши тренеру." : CLUB_DB_ERROR_STUDENT_MESSAGE };
  }
  return { ok: true };
}
