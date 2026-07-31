-- Pre-system billing months.
--
-- The billing admin was launched 2026-05. Months before that were never actually
-- billed through the system: April rows exist only because the month-generator
-- created them, and their "pending" state reads as debt that was never owed.
-- Worse, an empty April absorbed later payments (May/June/July money landed on
-- April rows because the amount matched and the row was open).
--
-- This adds a status meaning "this month predates the billing system", so those
-- rows stop counting as debt while remaining visible and auditable. Existing
-- status values are preserved verbatim; nothing is renamed or removed.
--
-- Debt aggregates use an allowlist (pending/overdue/manual_review), so the new
-- value is excluded automatically. One exception is documented and NOT changed
-- here: computeReminderCandidates (src/features/billing/club-reminders.ts) skips
-- only 'paid', so it would let waived rows through — it currently has no caller;
-- add the guard when it gets wired.

alter table billing_monthly_payments
  drop constraint billing_monthly_payments_status_check;

alter table billing_monthly_payments
  add constraint billing_monthly_payments_status_check
  check (status = any (array[
    'pending',
    'paid',
    'overdue',
    'paused',
    'manual_review',
    'refunded',
    'waived_presystem'
  ]));
