do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'trainingpeaks_coach_actions_taken_action_kind_check'
      and conrelid = 'public.trainingpeaks_coach_actions_taken'::regclass
  ) then
    alter table public.trainingpeaks_coach_actions_taken
      drop constraint trainingpeaks_coach_actions_taken_action_kind_check;
  end if;
end $$;

alter table public.trainingpeaks_coach_actions_taken
  add constraint trainingpeaks_coach_actions_taken_action_kind_check
  check (
    action_kind in (
      'case_resolved',
      'case_dismissed',
      'reply_draft_used',
      'reply_draft_edited',
      'reply_draft_ignored'
    )
  );
