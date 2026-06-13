create table if not exists public.trainingpeaks_operational_signal_review_decisions (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.trainingpeaks_student_operational_signals(id) on delete cascade,
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  bucket text not null check (
    bucket in (
      'review_required',
      'close_candidate_review'
    )
  ),
  decision text not null check (
    decision in (
      'acknowledged',
      'keep_visible',
      'hide_from_queue',
      'close_candidate_seen',
      'needs_manual_followup'
    )
  ),
  decision_source text not null check (
    decision_source in (
      'telegram_button',
      'diagnostic',
      'manual'
    )
  ),
  coach_telegram_user_id text,
  callback_short_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trainingpeaks_operational_signal_review_decisions_signal_created_at_desc_idx
  on public.trainingpeaks_operational_signal_review_decisions (signal_id, created_at desc);

create index if not exists trainingpeaks_operational_signal_review_decisions_student_created_at_desc_idx
  on public.trainingpeaks_operational_signal_review_decisions (student_id, created_at desc);

comment on table public.trainingpeaks_operational_signal_review_decisions is
  'Coach review queue acknowledgements for TP operational signals. Append-only review journal; does not mutate signal lifecycle/status.';

comment on column public.trainingpeaks_operational_signal_review_decisions.bucket is
  'Review queue bucket at decision time: review_required or close_candidate_review.';

comment on column public.trainingpeaks_operational_signal_review_decisions.decision is
  'Coach review decision for queue visibility only.';

revoke all on table public.trainingpeaks_operational_signal_review_decisions from anon, authenticated, public;
grant select, insert on table public.trainingpeaks_operational_signal_review_decisions to service_role;

alter table public.trainingpeaks_operational_signal_review_decisions enable row level security;
