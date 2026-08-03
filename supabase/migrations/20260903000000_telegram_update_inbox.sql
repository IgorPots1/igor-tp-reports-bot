-- Telegram raw-update inbox: durable landing spot for an update BEFORE any business logic.
--
-- WHY (2026-08-03): Supabase was unreachable 10:12-13:30 UTC. The webhook kept accepting updates,
-- threw while writing, swallowed the error and still answered 200. Telegram treats 200 as delivered
-- and stops retrying, so ~36 business messages were lost outright — measured: business observations
-- fell from 25/h and 20/h before the outage to 2, 2 and 1 during it, with ZERO duplicates in
-- trainingpeaks_telegram_context_observations. Nothing was double-written; things were simply gone.
--
-- The fail-closed 503 shipped alongside this migration removes the "lost forever" case for as long
-- as Telegram keeps retrying. This table removes the dependency on Telegram retrying at all: one
-- tiny insert (no joins, no jsonb parsing, no reads) is the only thing that must succeed to make an
-- update recoverable. Processing then happens FROM this table and can be replayed by hand.
--
-- NOT APPLIED. Igor applies this manually.

create table if not exists public.telegram_update_inbox (
  -- Telegram's own update_id is the natural key: it is unique per bot and monotonically increasing,
  -- which is exactly the dedup token the webhook never had. A redelivery collides here and is
  -- recognised without reading any business table.
  update_id bigint primary key,

  -- The untouched payload. Stored whole and unparsed so a replay can rebuild any interpretation,
  -- including one whose parsing code did not exist when the update arrived.
  payload jsonb not null,

  received_at timestamptz not null default now(),

  -- Processing lifecycle, deliberately separate from arrival. 'pending' the moment it lands;
  -- the handler moves it on. An update stuck in 'pending' or 'failed' is the recovery work-list.
  status text not null default 'pending',
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text,

  -- Cheap triage columns, denormalised on insert so the work-list can be read without digging
  -- through jsonb. Nullable: not every update kind has them.
  update_kind text,
  chat_id text,
  message_id text,

  created_at timestamptz not null default now(),

  constraint telegram_update_inbox_status_check
    check (status in ('pending', 'processed', 'failed', 'skipped'))
);

-- The work-list query: what still needs handling, oldest first.
create index if not exists telegram_update_inbox_pending_idx
  on public.telegram_update_inbox (received_at)
  where status in ('pending', 'failed');

-- Triage by conversation when reconstructing an incident.
create index if not exists telegram_update_inbox_chat_message_idx
  on public.telegram_update_inbox (chat_id, message_id);

create index if not exists telegram_update_inbox_received_at_idx
  on public.telegram_update_inbox (received_at desc);

comment on table public.telegram_update_inbox is
  'Raw Telegram updates, written before any business logic. Survives a DB-side failure of the '
  'processing path and makes a lost update replayable. See 2026-08-03 outage.';

-- Server-side only: the webhook runs as service_role. No anon/authenticated access — payloads
-- contain private student correspondence.
alter table public.telegram_update_inbox enable row level security;

grant select, insert, update on public.telegram_update_inbox to service_role;
