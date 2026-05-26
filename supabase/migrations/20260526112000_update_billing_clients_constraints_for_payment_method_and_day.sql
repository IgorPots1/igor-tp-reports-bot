alter table public.billing_clients
  drop constraint if exists billing_clients_planned_payment_day_check;

alter table public.billing_clients
  add constraint billing_clients_planned_payment_day_check
  check (planned_payment_day between 1 and 31);

alter table public.billing_clients
  drop constraint if exists billing_clients_payment_method_check;

alter table public.billing_clients
  add constraint billing_clients_payment_method_check
  check (
    payment_method in ('tbank_link_a', 'tbank_link_b', 'tbank_link_c', 'manual_eur', 'manual_other')
  );
