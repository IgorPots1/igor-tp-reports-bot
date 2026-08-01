-- A month deliberately not billed because an earlier payment still covers it.
--
-- Billing counts in calendar months, but a paid period is really "N days of work".
-- When training pauses (illness), the paid period slides forward and the next
-- calendar month can fall entirely inside the window the client already paid for.
-- Larionova is the first case: her 14.06 payment bought 30 working days, 19 of
-- which were consumed after a 24.06–12.07 illness pause, so July was covered and
-- showed up as a false debt.
--
-- Distinct from waived_presystem: that one is a closed historical cohort (months
-- before the billing admin existed, 2026-04). This one recurs, so it needs its own
-- value rather than a note on a borrowed status.
--
-- Debt aggregates use an allowlist (pending/overdue/manual_review), so the new
-- value is excluded by construction. Same caveat as waived_presystem:
-- computeReminderCandidates (src/features/billing/club-reminders.ts) skips only
-- 'paid', so it needs both waived_* values added to its guard when it gets wired
-- to a caller — it currently has none.

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
    'waived_presystem',
    'waived_covered'
  ]));
