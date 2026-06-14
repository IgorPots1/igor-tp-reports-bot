# TP Signals Non-Run Constraint Cleanup

- generated_at: 2026-06-14T06:17:36.765Z
- as_of_date: 2026-06-14
- mode: dry-run
- signal_id_filter: (none)
- report_dir: reports/tp-signals-nonrun-constraint-cleanup/2026-06-14T06-17-36-765Z

## Counts

- total_active_plan_constraints_scanned: 8
- eligible: 3
- not_safe: 0
- not_eligible: 5
- would_write: 3
- actual_written: 0

## Safety

- No Telegram sends.
- No TrainingPeaks mutations.
- No row deletes.
- Pain/illness/return rows are never auto-closed.
- Apply requires exact confirm string and only updates active rows.

## Target rows

### Yulia Kuznetsova | 850ee961-a8ca-46d0-95aa-42d6c9824502

- classification: (none)
- source_observation_id: 3152fd6f-31f5-40ec-b086-fe98d8229ccd
- source_preview: Игорь, доброе утро! Можно мне в лес побежать, такая погода, а завтра побегу а сегодня около часа получится.
- eligibility: not_eligible
- proposed_action: no_action
- cleanup_reason: (none)
- guards_passed: status_active, signal_type_plan_generation_constraint, not_protected_health_signal, lifecycle_not_resolved, source_text_available, no_negative_health_evidence
- guards_failed: phase3_nonrun_suppression_class

### Aleksandra Tararova | 32d4114e-33a9-4a5a-803b-be1474b001f6

- classification: (none)
- source_observation_id: f9f62f8a-8ea6-4b81-9d40-cd6482b87290
- source_preview: Привет. Вчера был непростой прием. Надо прийти в себя после него🙈 Можно ли я пробегу по плану сб и вс, стадион побегу …
- eligibility: not_eligible
- proposed_action: no_action
- cleanup_reason: (none)
- guards_passed: status_active, signal_type_plan_generation_constraint, not_protected_health_signal, lifecycle_not_resolved, source_text_available, no_negative_health_evidence
- guards_failed: phase3_nonrun_suppression_class

### grigori bereznoi | 5fd87a12-e2e8-4622-a606-1df5ef24a54f

- classification: non_training_errand
- source_observation_id: 2694935c-1487-40f5-ae42-4446713d08df
- source_preview: Но я только в понедельник поеду за новой машиной
- eligibility: eligible
- proposed_action: dismiss
- cleanup_reason: phase3_nonrun_false_positive:non_training_errand
- guards_passed: status_active, signal_type_plan_generation_constraint, not_protected_health_signal, lifecycle_not_resolved, source_text_available, no_negative_health_evidence, phase3_nonrun_suppression_class, no_partial_stale_schedule_dates, no_future_actionable_schedule_dates, forward_classifier_no_longer_captures_schedule_constraint
- guards_failed: (none)

### Katerina Melnikova | 29bcac43-f4b9-4f1a-a3c6-25fed850eae3

- classification: strength_only_reshuffle
- source_observation_id: 8237cd03-37bb-47e0-b97d-aecb907d186b
- source_preview: Привет !) А можно мне силовые на сегодня переставить, а то вот к бегу стабильно я привыкаю, а к силовым ещё нет 😅 Сего…
- eligibility: eligible
- proposed_action: dismiss
- cleanup_reason: phase3_nonrun_false_positive:strength_only_reshuffle
- guards_passed: status_active, signal_type_plan_generation_constraint, not_protected_health_signal, lifecycle_not_resolved, source_text_available, no_negative_health_evidence, phase3_nonrun_suppression_class, no_partial_stale_schedule_dates, no_future_actionable_schedule_dates, forward_classifier_no_longer_captures_schedule_constraint
- guards_failed: (none)

### Sofia Vlasova | 3af9a632-dd2b-4a3a-b527-33596edbe58b

- classification: soft_session_question
- source_observation_id: c09da3b5-9f44-4ef7-8796-d82baa5f6847
- source_preview: А можно сегодня обычную тренировку? Восстановиться 🙏🏾
- eligibility: eligible
- proposed_action: dismiss
- cleanup_reason: phase3_nonrun_false_positive:soft_session_question
- guards_passed: status_active, signal_type_plan_generation_constraint, not_protected_health_signal, lifecycle_not_resolved, source_text_available, no_negative_health_evidence, phase3_nonrun_suppression_class, no_partial_stale_schedule_dates, no_future_actionable_schedule_dates, forward_classifier_no_longer_captures_schedule_constraint
- guards_failed: (none)

### Naida Volkova | 6b46fde4-5b83-4944-b498-414b4a08c58f

- classification: (none)
- source_observation_id: 3fcf566b-3306-4310-9dcb-8bd719ec6b8e
- source_preview: Да, все хорошо. На этой неделе смогу завтра - вторник и четверг
- eligibility: not_eligible
- proposed_action: no_action
- cleanup_reason: (none)
- guards_passed: status_active, signal_type_plan_generation_constraint, not_protected_health_signal, lifecycle_not_resolved, source_text_available, no_negative_health_evidence
- guards_failed: phase3_nonrun_suppression_class

### Alexander Lavrentyev | 2e9db013-d317-4d90-9ec1-f21284bd2ec6

- classification: (none)
- source_observation_id: fdcdf7b9-7c3e-438e-b4cc-524db6f11f14
- source_preview: Игорь, привет! По поводу тренировок на этой неделе - в среду я не смогу найти время для тренировки. То есть варианты сл…
- eligibility: not_eligible
- proposed_action: no_action
- cleanup_reason: (none)
- guards_passed: status_active, signal_type_plan_generation_constraint, not_protected_health_signal, lifecycle_not_resolved, source_text_available, no_negative_health_evidence
- guards_failed: phase3_nonrun_suppression_class

### Anna Denisova | 85256508-e4ae-4b3a-887d-e41fdd0c54a6

- classification: (none)
- source_observation_id: 49f35489-51f9-47af-8c75-0fae0dd22a16
- source_preview: На следующей неделе: Во вторник вечер занят, не смогу тренироваться. В четверг вечером уезжаю (успею, может, коротеньку…
- eligibility: not_eligible
- proposed_action: no_action
- cleanup_reason: (none)
- guards_passed: status_active, signal_type_plan_generation_constraint, not_protected_health_signal, lifecycle_not_resolved, source_text_available, no_negative_health_evidence
- guards_failed: phase3_nonrun_suppression_class

