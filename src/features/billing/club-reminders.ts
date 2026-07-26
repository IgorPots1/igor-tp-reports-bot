// Phase 4 — payment-reminder DRAFTS for the coach. PURE: no I/O, no sending.
//
// Given the billing month-status rows (the existing source of due dates), decide
// WHO is due a reminder (N days before the planned date, or already overdue) and
// draft a short message with amount + date. The coach reviews the list and confirms
// in one action; only then do messages go out. There is NO auto-send — that stays
// behind CLUB_BILLING_REMINDER_AUTOSEND_ENABLED (OFF) and is not wired here. A
// send-log (to avoid reminding twice per cycle) is applied at the send step, not here.
//
// NO new source of due dates is introduced: everything comes from BillingMonthStatusRow.

import type { BillingMonthStatusRow } from "./types";

export type ReminderCandidate = {
  clientId: string;
  studentId: string | null;
  clientName: string;
  billingMonth: string | null;
  dueDate: string | null;
  amountLabel: string | null;
  /** >0 = due in N days; 0 = due today; <0 not returned (only due-soon/overdue). */
  daysUntilDue: number | null;
  overdueDays: number | null;
  draftText: string;
};

function amountLabel(amount: number | null, currency: string): string {
  if (amount == null || !Number.isFinite(amount)) return "";
  const sign = currency === "RUB" ? "₽" : currency;
  return `${Math.round(amount)} ${sign}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00.000Z`).getTime();
  const b = new Date(`${toIso}T12:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Short, editable reminder in a plain concise voice. Amount + date, no fluff. */
export function draftReminderText(row: BillingMonthStatusRow, overdue: boolean): string {
  const amt = amountLabel(row.plannedAmount, row.currency);
  const date = row.plannedPaymentDate ?? "";
  if (overdue) {
    return `Напоминаю про оплату${amt ? ` ${amt}` : ""}${date ? ` — срок был ${date}` : ""}. Скинь, как оплатишь 🙏`;
  }
  return `Напоминаю про оплату${amt ? ` ${amt}` : ""}${date ? ` до ${date}` : ""}. Спасибо!`;
}

/**
 * Reminder candidates from month-status rows: unpaid rows that are due within
 * `daysBefore` days OR already overdue. Paid rows are skipped. Pure.
 */
export function computeReminderCandidates(
  rows: BillingMonthStatusRow[],
  opts: { daysBefore: number; todayIso: string }
): ReminderCandidate[] {
  const out: ReminderCandidate[] = [];
  for (const row of rows) {
    if (row.status === "paid") continue;
    const due = row.plannedPaymentDate;
    const overdueDays = row.daysOverdue ?? (due && due < opts.todayIso ? daysBetween(due, opts.todayIso) : null);
    const isOverdue = (overdueDays ?? 0) > 0;
    const daysUntilDue = due && !isOverdue ? daysBetween(opts.todayIso, due) : null;

    const dueSoon = daysUntilDue != null && daysUntilDue >= 0 && daysUntilDue <= opts.daysBefore;
    if (!isOverdue && !dueSoon) continue;

    out.push({
      clientId: row.clientId,
      studentId: row.studentId,
      clientName: row.clientName,
      billingMonth: row.billingMonth ?? null,
      dueDate: due,
      amountLabel: amountLabel(row.plannedAmount, row.currency) || null,
      daysUntilDue,
      overdueDays: isOverdue ? overdueDays : null,
      draftText: draftReminderText(row, isOverdue),
    });
  }
  // Overdue first (largest overdue on top), then soonest due.
  out.sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1) || (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999));
  return out;
}
