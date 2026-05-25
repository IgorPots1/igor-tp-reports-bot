create table if not exists public.billing_clients (
  id uuid primary key default gen_random_uuid(),
  student_id uuid null references public.trainingpeaks_students(id) on delete set null,
  client_name text not null,
  group_name text null,
  monthly_amount integer not null,
  currency text not null default 'RUB',
  planned_payment_day smallint not null,
  payment_method text not null,
  is_active boolean not null default true,
  notes text null,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_clients_monthly_amount_check check (monthly_amount > 0),
  constraint billing_clients_currency_check check (currency in ('RUB', 'EUR', 'OTHER')),
  constraint billing_clients_planned_payment_day_check check (planned_payment_day between 1 and 28),
  constraint billing_clients_payment_method_check check (
    payment_method in ('tbank_link_a', 'tbank_link_b', 'manual_eur', 'manual_other')
  )
);

comment on table public.billing_clients is
  'Billing client ledger rows. student_id is optional because payer/client may not map 1:1 to a TrainingPeaks student.';

comment on column public.billing_clients.group_name is
  'Display/filter tag only, not a billing entity.';

comment on column public.billing_clients.is_active is
  'When false, future monthly rows should not be generated.';

create index if not exists billing_clients_is_active_idx
  on public.billing_clients (is_active);

create index if not exists billing_clients_client_name_idx
  on public.billing_clients (client_name);

create table if not exists public.billing_monthly_payments (
  id uuid primary key default gen_random_uuid(),
  billing_client_id uuid not null references public.billing_clients(id) on delete cascade,
  billing_month date not null,
  planned_payment_date date not null,
  actual_payment_date date null,
  planned_amount integer not null,
  paid_amount integer null,
  currency text not null default 'RUB',
  status text not null default 'pending',
  source text not null default 'manual',
  external_payment_hash text null,
  overdue_reminded_at timestamptz null,
  marked_paid_by text null,
  notes text null,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_monthly_payments_billing_client_id_billing_month_key
    unique (billing_client_id, billing_month),
  constraint billing_monthly_payments_billing_month_month_start_check check (
    billing_month = date_trunc('month', billing_month)::date
  ),
  constraint billing_monthly_payments_planned_amount_check check (planned_amount > 0),
  constraint billing_monthly_payments_paid_amount_check check (
    paid_amount is null or paid_amount >= 0
  ),
  constraint billing_monthly_payments_currency_check check (currency in ('RUB', 'EUR', 'OTHER')),
  constraint billing_monthly_payments_status_check check (
    status in ('pending', 'paid', 'overdue', 'paused', 'manual_review', 'refunded')
  ),
  constraint billing_monthly_payments_source_check check (
    source in ('manual', 'email_import')
  )
);

comment on table public.billing_monthly_payments is
  'One billing row per client per month. Imported payments never auto-confirm here in MVP.';

comment on column public.billing_monthly_payments.billing_month is
  'Always the first day of the month, for example 2026-05-01.';

comment on column public.billing_monthly_payments.status is
  'pending=expected; paid=coach-confirmed; overdue=pending after grace period; paused=intentionally skipped; manual_review=needs coach decision; refunded=manually reversed.';

create index if not exists billing_monthly_payments_billing_month_idx
  on public.billing_monthly_payments (billing_month);

create index if not exists billing_monthly_payments_status_planned_payment_date_idx
  on public.billing_monthly_payments (status, planned_payment_date);

create index if not exists billing_monthly_payments_external_payment_hash_idx
  on public.billing_monthly_payments (external_payment_hash)
  where external_payment_hash is not null;

create table if not exists public.billing_imported_payments (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null,
  payment_date date not null,
  amount integer not null,
  currency text not null default 'RUB',
  payer_hint text null,
  description text null,
  raw_row jsonb not null,
  external_hash text not null unique,
  status text not null default 'new',
  matched_monthly_payment_id uuid null references public.billing_monthly_payments(id) on delete set null,
  matched_at timestamptz null,
  matched_by_coach_chat_id text null,
  source_file_name text null,
  email_message_id text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_imported_payments_amount_check check (amount > 0),
  constraint billing_imported_payments_currency_check check (currency in ('RUB', 'EUR', 'OTHER')),
  constraint billing_imported_payments_status_check check (
    status in ('new', 'matched', 'ignored')
  )
);

comment on table public.billing_imported_payments is
  'Staging table for payments parsed from T-Bank daily Excel statements. Rows here are not confirmed until the coach assigns them.';

comment on column public.billing_imported_payments.raw_row is
  'Original parsed Excel row payload for audit and matching review.';

create index if not exists billing_imported_payments_status_created_at_desc_idx
  on public.billing_imported_payments (status, created_at desc);

create index if not exists billing_imported_payments_import_batch_id_idx
  on public.billing_imported_payments (import_batch_id);

create index if not exists billing_imported_payments_payment_date_idx
  on public.billing_imported_payments (payment_date);

create or replace function public.set_billing_clients_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_billing_clients_updated_at on public.billing_clients;

create trigger set_billing_clients_updated_at
before update on public.billing_clients
for each row
execute function public.set_billing_clients_updated_at();

create or replace function public.set_billing_monthly_payments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_billing_monthly_payments_updated_at
  on public.billing_monthly_payments;

create trigger set_billing_monthly_payments_updated_at
before update on public.billing_monthly_payments
for each row
execute function public.set_billing_monthly_payments_updated_at();

create or replace function public.set_billing_imported_payments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_billing_imported_payments_updated_at
  on public.billing_imported_payments;

create trigger set_billing_imported_payments_updated_at
before update on public.billing_imported_payments
for each row
execute function public.set_billing_imported_payments_updated_at();

-- "Current month" here follows Europe/Belgrade for parity with coach-facing billing views.
-- App/service queries should still prefer explicit month filtering where possible.
create or replace view public.v_billing_current_month as
select
  clients.id as client_id,
  clients.group_name,
  clients.client_name as name,
  clients.monthly_amount,
  clients.currency,
  clients.planned_payment_day,
  monthly_payments.planned_payment_date,
  monthly_payments.actual_payment_date,
  monthly_payments.paid_amount,
  monthly_payments.status as payment_status,
  monthly_payments.id as last_payment_id,
  clients.notes
from public.billing_clients as clients
left join public.billing_monthly_payments as monthly_payments
  on monthly_payments.billing_client_id = clients.id
 and monthly_payments.billing_month = date_trunc(
   'month',
   now() at time zone 'Europe/Belgrade'
 )::date
where clients.is_active = true;

comment on view public.v_billing_current_month is
  'Spreadsheet-shaped billing read model for the current Europe/Belgrade month. Service queries should prefer explicit month filtering when possible.';

revoke all on table public.billing_clients from anon, authenticated, public;
grant select, insert, update, delete on table public.billing_clients to service_role;

revoke all on table public.billing_monthly_payments from anon, authenticated, public;
grant select, insert, update, delete on table public.billing_monthly_payments to service_role;

revoke all on table public.billing_imported_payments from anon, authenticated, public;
grant select, insert, update, delete on table public.billing_imported_payments to service_role;

revoke all on table public.v_billing_current_month from anon, authenticated, public;
grant select on table public.v_billing_current_month to service_role;

alter table public.billing_clients enable row level security;
alter table public.billing_monthly_payments enable row level security;
alter table public.billing_imported_payments enable row level security;
