-- Bug found live 2026-09-16: claimPendingTranscriptionObservations (the B3 automatic
-- transcription CAS queue) sets transcript_status='processing' as its intermediate claimed
-- state, but the CHECK constraint on this column never included 'processing' — only
-- pending/done/failed/skipped. Every single claim attempt has been failing with a 400
-- (check constraint violation) since this queue went live; every row that ever reached
-- transcript_status='pending' has been stuck there forever, never actually transcribed.
-- Purely additive: widens the allowed value set, does not remove or rewrite any existing rows.

alter table public.trainingpeaks_telegram_context_observations
  drop constraint if exists trainingpeaks_telegram_context_observations_transcript_status_c;

alter table public.trainingpeaks_telegram_context_observations
  add constraint trainingpeaks_telegram_context_observations_transcript_status_c
  check (
    transcript_status is null
    or transcript_status = any (array['pending', 'processing', 'done', 'failed', 'skipped'])
  );
