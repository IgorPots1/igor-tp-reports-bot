alter table public.trainingpeaks_student_operational_signals
  drop constraint if exists trainingpeaks_student_operational_signals_signal_type_check;

alter table public.trainingpeaks_student_operational_signals
  add constraint trainingpeaks_student_operational_signals_signal_type_check
  check (
    signal_type in (
      'schedule_availability_window',
      'schedule_unavailability_window',
      'resume_training',
      'pause_training',
      'health_issue_started',
      'health_issue_resolved',
      'health_issue_improving',
      'move_workout_candidate',
      'plan_generation_constraint',
      'pain_injury',
      'external_training_context',
      'race_load_context'
    )
  );
