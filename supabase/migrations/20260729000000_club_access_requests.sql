-- Club Mini App — access requests (replaces per-student token links for the main flow).
--
-- An unbound account opens the general link t.me/<bot>/XOclub → a request is recorded
-- and the person sees «Заявка отправлена, тренер подтвердит». No club data is shown.
-- The coach matches the request to a student in /admin/club/requests (one Telegram =
-- one student). One PENDING request per telegram_user_id (unique) — re-opening does
-- not create a duplicate, only refreshes the captured name.
--
-- NOT applied by this task — file-of-record; apply via the rollout.

create table if not exists public.club_access_requests (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  telegram_username text,
  first_name text,
  last_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  handled_by text,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists club_access_requests_status_idx on public.club_access_requests (status, created_at);

alter table public.club_access_requests enable row level security;

grant select, insert, update, delete on public.club_access_requests to service_role;
