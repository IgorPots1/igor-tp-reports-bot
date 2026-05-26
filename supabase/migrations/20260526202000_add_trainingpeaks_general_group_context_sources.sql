alter table public.trainingpeaks_telegram_context_observations
  drop constraint if exists trainingpeaks_telegram_context_observations_source_type_check;

alter table public.trainingpeaks_telegram_context_observations
  add constraint trainingpeaks_telegram_context_observations_source_type_check
  check (source_type in ('business_dm', 'private_dm', 'group_topic', 'group_general'));

alter table public.trainingpeaks_student_contact_events
  drop constraint if exists trainingpeaks_student_contact_events_source_check;

alter table public.trainingpeaks_student_contact_events
  add constraint trainingpeaks_student_contact_events_source_check
  check (
    source in (
      'telegram_business_dm',
      'telegram_private_dm',
      'telegram_group_topic',
      'telegram_group_general',
      'admin_report_send',
      'admin_action'
    )
  );
