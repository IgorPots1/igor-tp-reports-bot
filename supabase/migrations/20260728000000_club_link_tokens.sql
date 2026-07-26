-- Club Mini App — one-time binding tokens (safe entry links).
--
-- WHY: /m/n passes the student ROW id straight in `startapp`. For the club that is
-- unsafe — the link lands in a shared chat, gets forwarded, and whoever opens it can
-- tap «это я» and bind to someone else's row. Binding is one-time and only a coach can
-- fix it. So the club link carries an OPAQUE one-time TOKEN instead: it resolves to a
-- student, is shown for confirmation (name only), and BURNS on successful bind or expiry.
--
-- A token is VALID iff: used_at IS NULL AND revoked_at IS NULL AND expires_at > now().
-- TTL default 7 days (CLUB_LINK_TOKEN_TTL_DAYS). Coach can revoke.
--
-- NOT applied by this task — file-of-record; apply via the rollout.

create table if not exists public.club_link_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_telegram_user_id bigint,
  revoked_at timestamptz,
  created_by text,                                  -- coach identifier who generated it
  created_at timestamptz not null default now()
);

-- Admin list per student; token lookup is served by the UNIQUE index on token.
create index if not exists club_link_tokens_student_idx on public.club_link_tokens (student_id);

-- Deny-by-default for anon/authenticated (mirrors other club tables); the app
-- reads/writes server-side via service_role, which bypasses RLS.
alter table public.club_link_tokens enable row level security;

grant select, insert, update, delete on public.club_link_tokens to service_role;
