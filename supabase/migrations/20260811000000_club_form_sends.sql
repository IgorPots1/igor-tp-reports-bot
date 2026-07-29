-- Club — outbound form broadcasts log (first outbound path of the club).
--
-- Every send attempt to a student is one row: who, which form, when, result. Powers:
--   * reliability: a durable record of successes AND failures (bot blocked / not started / API);
--   * dedup: refuse a second send of the SAME form to the SAME student on the SAME day
--     (partial guard, checked in code + supported by the (form_type, student_id, sent_at) index);
--   * "remind non-responders": for the schedule form, `target_week` marks which week the form
--     was for, so reminders target students who were sent it but created no calendar entry that week.
--
-- Nothing here sends anything — sending is a coach tap in the admin, gated by
-- CLUB_FORMS_BROADCAST_ENABLED. Additive, non-destructive. NOT applied by this task.

create table if not exists public.club_form_sends (
  id uuid primary key default gen_random_uuid(),
  form_type text not null check (form_type in ('starts', 'schedule')),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  -- The bot-DM target used (Telegram user id). The broadcast is a BOT message, not a
  -- business-DM, so the target is telegram_user_id, not telegram_chat_id.
  telegram_user_id bigint,
  -- Monday of the week the form is for (schedule form). NULL for the starts form.
  target_week date,
  is_reminder boolean not null default false,
  status text not null check (status in ('sent', 'failed')),
  error text,
  message_text text,
  created_by text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Dedup + "already sent today" lookups.
create index if not exists club_form_sends_form_student_sent_idx
  on public.club_form_sends (form_type, student_id, sent_at desc);

-- Non-responder / reminder computation for a given form + week.
create index if not exists club_form_sends_form_week_idx
  on public.club_form_sends (form_type, target_week);

comment on table public.club_form_sends is
  'Club outbound form-broadcast log: one row per send attempt (bot DM). Powers reliability (success/failure record), dedup (same form+student+day), and reminders (schedule form by target_week vs calendar entries).';
