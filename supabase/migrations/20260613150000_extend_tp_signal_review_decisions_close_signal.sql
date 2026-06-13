alter table public.trainingpeaks_operational_signal_review_decisions
  drop constraint if exists trainingpeaks_operational_signal_review_decisions_decision_check;

alter table public.trainingpeaks_operational_signal_review_decisions
  add constraint trainingpeaks_operational_signal_review_decisions_decision_check
  check (
    decision in (
      'acknowledged',
      'keep_visible',
      'hide_from_queue',
      'close_candidate_seen',
      'needs_manual_followup',
      'close_signal'
    )
  );

comment on column public.trainingpeaks_operational_signal_review_decisions.decision is
  'Coach review decision for queue visibility and optional guarded signal close/hide actions.';
