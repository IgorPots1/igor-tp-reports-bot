create table if not exists public.billing_email_import_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  status text not null,
  mode text not null,
  scanned_messages_count integer not null default 0,
  found_attachments_count integer not null default 0,
  imported_payments_count integer not null default 0,
  duplicate_payments_count integer not null default 0,
  auto_matched_count integer not null default 0,
  review_required_count integer not null default 0,
  error_message text null,
  created_at timestamptz not null default now(),
  constraint billing_email_import_runs_status_check check (
    status in ('running', 'success', 'failed', 'dry_run')
  ),
  constraint billing_email_import_runs_mode_check check (
    mode in ('dry_run', 'apply')
  ),
  constraint billing_email_import_runs_counts_check check (
    scanned_messages_count >= 0
    and found_attachments_count >= 0
    and imported_payments_count >= 0
    and duplicate_payments_count >= 0
    and auto_matched_count >= 0
    and review_required_count >= 0
  )
);

create table if not exists public.billing_email_import_attachments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid null references public.billing_email_import_runs(id) on delete set null,
  message_uid text not null,
  attachment_filename text not null,
  attachment_hash text not null,
  status text not null,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_message text null,
  created_at timestamptz not null default now(),
  constraint billing_email_import_attachments_status_check check (
    status in ('found', 'imported', 'duplicate', 'failed', 'skipped')
  ),
  constraint billing_email_import_attachments_counts_check check (
    imported_count >= 0 and duplicate_count >= 0
  ),
  constraint billing_email_import_attachments_message_uid_hash_key
    unique (message_uid, attachment_hash)
);

create index if not exists billing_email_import_runs_started_at_idx
  on public.billing_email_import_runs (started_at desc);

create index if not exists billing_email_import_runs_status_idx
  on public.billing_email_import_runs (status, created_at desc);

create index if not exists billing_email_import_attachments_run_id_idx
  on public.billing_email_import_attachments (run_id);

create index if not exists billing_email_import_attachments_message_uid_idx
  on public.billing_email_import_attachments (message_uid);

revoke all on table public.billing_email_import_runs from anon, authenticated, public;
grant select, insert, update, delete on table public.billing_email_import_runs to service_role;

revoke all on table public.billing_email_import_attachments from anon, authenticated, public;
grant select, insert, update, delete on table public.billing_email_import_attachments to service_role;

alter table public.billing_email_import_runs enable row level security;
alter table public.billing_email_import_attachments enable row level security;
