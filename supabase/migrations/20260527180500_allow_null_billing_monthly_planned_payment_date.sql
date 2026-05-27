alter table public.billing_monthly_payments
  alter column planned_payment_date drop not null;

comment on column public.billing_monthly_payments.planned_payment_date is
  'Planned payment date for the month. Can be null when planned payment day is unknown and row requires manual review.';
