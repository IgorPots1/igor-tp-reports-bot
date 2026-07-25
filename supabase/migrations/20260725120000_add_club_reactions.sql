-- Club Mini App (/m/club) STUB: reactions on workouts.
-- Gated at runtime by CLUB_REACTIONS_ENABLED (OFF by default). NOT applied by this
-- task — apply manually before enabling reactions. One row per (workout, student,
-- kind); a student can like AND fire the same workout, but not twice the same kind.

create table if not exists public.club_reactions (
  id uuid primary key default gen_random_uuid(),
  workout_cache_id uuid not null
    references public.trainingpeaks_workout_cache(id) on delete cascade,
  student_id uuid not null
    references public.trainingpeaks_students(id) on delete cascade,
  kind text not null check (kind in ('like', 'fire')),
  created_at timestamptz not null default now(),
  constraint club_reactions_unique unique (workout_cache_id, student_id, kind)
);

create index if not exists club_reactions_workout_idx
  on public.club_reactions (workout_cache_id);

comment on table public.club_reactions is
  'Student reactions on club workouts (/m/club). Self-scoped writes only; read-only aggregate counts shown to others.';
