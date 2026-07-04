-- Append-only log of every Anthropic/Haiku API call.
-- Lets the coach see token spend, waste rate (shouldRemember=false), and dedup hits.
-- No student names, no message text — only ids/hashes.
CREATE TABLE ai_call_logs (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  call_site        text         NOT NULL CHECK (call_site IN ('memory', 'intent', 'parser')),
  model            text         NOT NULL,
  labels           text[]       NOT NULL DEFAULT '{}',
  should_remember  boolean,
  input_tokens     integer,
  output_tokens    integer,
  telegram_update_id bigint,
  message_id       text,
  student_ref      text
);

CREATE INDEX ai_call_logs_created_at_idx ON ai_call_logs (created_at DESC);
CREATE INDEX ai_call_logs_call_site_idx  ON ai_call_logs (call_site);

COMMENT ON TABLE ai_call_logs IS
  'One row per Anthropic API call. Diagnostic only — no PII, no message text.';

COMMENT ON COLUMN ai_call_logs.call_site IS
  'memory=coach-memory-extraction, intent=move-intent classifier, parser=move-workout parser';

COMMENT ON COLUMN ai_call_logs.student_ref IS
  'First 8 chars of student UUID — enough to group by student, not enough to identify.';

COMMENT ON COLUMN ai_call_logs.message_id IS
  'For memory calls: first 8 chars of observation UUID. For intent/parser: Telegram message_id.';
