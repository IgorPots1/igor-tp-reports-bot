-- Free Strava breakdown requests from @runnigor (English Instagram).
-- The form at igorp.run/breakdown is opened from a ChatPlace button; the button
-- passes only the opaque ChatPlace client id (?c=), never a name or username.
-- Read by the strava-breakdown agent; nobody but the service role touches it.
create table if not exists public.strava_breakdown_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  chatplace_client_id text,
  instagram text,
  goal_type text,
  goal_details text,
  runs_week text,
  age integer,
  best_recent text,
  injury text,
  injury_details text,
  hr_strap text,
  strava_link text not null,
  user_agent text,
  status text not null default 'new',
  notes text
);

create index if not exists strava_breakdown_requests_created_idx
  on public.strava_breakdown_requests (created_at desc);
create index if not exists strava_breakdown_requests_status_idx
  on public.strava_breakdown_requests (status);

alter table public.strava_breakdown_requests enable row level security;
