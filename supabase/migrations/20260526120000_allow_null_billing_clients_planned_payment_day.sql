alter table public.billing_clients
  alter column planned_payment_day drop not null;

alter table public.billing_clients
  drop constraint if exists billing_clients_planned_payment_day_check;

alter table public.billing_clients
  add constraint billing_clients_planned_payment_day_check
  check (planned_payment_day is null or planned_payment_day between 1 and 31);
