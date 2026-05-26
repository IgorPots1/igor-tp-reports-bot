create table if not exists public.billing_payer_identities (
  id uuid primary key default gen_random_uuid(),
  billing_client_id uuid not null references public.billing_clients(id) on delete cascade,
  identity_type text not null,
  identity_hash text not null,
  display_hint text null,
  source_imported_payment_id uuid null references public.billing_imported_payments(id) on delete set null,
  confidence text not null default 'trusted_manual',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  match_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_payer_identities_confidence_check check (confidence in ('trusted_manual')),
  constraint billing_payer_identities_match_count_check check (match_count >= 1),
  constraint billing_payer_identities_identity_type_check check (
    identity_type in ('payer_hint', 'description_hint', 'payment_description')
  ),
  constraint billing_payer_identities_display_hint_len_check check (
    display_hint is null or char_length(display_hint) <= 120
  )
);

create unique index if not exists billing_payer_identities_identity_type_hash_uidx
  on public.billing_payer_identities (identity_type, identity_hash);

create index if not exists billing_payer_identities_billing_client_id_idx
  on public.billing_payer_identities (billing_client_id);

create index if not exists billing_payer_identities_identity_hash_idx
  on public.billing_payer_identities (identity_hash);

create or replace function public.set_billing_payer_identities_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_billing_payer_identities_updated_at
  on public.billing_payer_identities;

create trigger set_billing_payer_identities_updated_at
before update on public.billing_payer_identities
for each row
execute function public.set_billing_payer_identities_updated_at();

revoke all on table public.billing_payer_identities from anon, authenticated, public;
grant select, insert, update, delete on table public.billing_payer_identities to service_role;

alter table public.billing_payer_identities enable row level security;
