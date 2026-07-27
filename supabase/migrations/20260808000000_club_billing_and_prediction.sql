-- Club Mini App Phase E: prediction visibility toggle + billing claims + reminder drafts.
-- Additive, idempotent. NOT applied by this task; apply before enabling the flags.
--
-- Flags (all OFF by default, unchanged): CLUB_PREDICTION_ENABLED, CLUB_BILLING_ENABLED,
-- CLUB_BILLING_REMINDERS_ENABLED, CLUB_BILLING_REMINDER_AUTOSEND_ENABLED.
-- NOTHING is ever sent to students by this migration or the code behind it.

-- 1. Per-student prediction visibility (coach-controlled). Some athletes should not
--    see a result forecast (e.g. beginners who would fixate on it). Default: visible.
alter table public.trainingpeaks_students
  add column if not exists club_prediction_visible boolean not null default true;

comment on column public.trainingpeaks_students.club_prediction_visible is
  'Coach toggle: when false, the club prediction tab shows "unavailable" for this student. Default true.';

-- 2. Payment claims: the student taps "я оплатил" -> a claim lands in the coach inbox.
--    NO auto-matching, NO auto-confirmation; the coach reconciles manually against the
--    bank statement (billing allocation logic is untouched).
create table if not exists public.club_payment_claims (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  note text,
  status text not null default 'pending' check (status in ('pending', 'reviewed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
create index if not exists club_payment_claims_status_idx
  on public.club_payment_claims (status, created_at desc);
create index if not exists club_payment_claims_student_idx
  on public.club_payment_claims (student_id, created_at desc);
comment on table public.club_payment_claims is
  'Student "я оплатил" claims from /m/club. Coach-reviewed only; never auto-matched to billing. No notifications.';

-- 3. Reminder drafts: coach prepares reminders for overdue students and batch-confirms
--    them. Autosend stays OFF (CLUB_BILLING_REMINDER_AUTOSEND_ENABLED); confirming a draft
--    only marks it ready in the coach queue. One draft per (student, billing_month).
create table if not exists public.club_payment_reminders (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  billing_month text not null,
  draft_text text not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  created_by text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint club_payment_reminders_unique unique (student_id, billing_month)
);
create index if not exists club_payment_reminders_month_idx
  on public.club_payment_reminders (billing_month, status);
comment on table public.club_payment_reminders is
  'Coach-prepared payment reminder drafts (/admin/club/billing). Batch-confirmed by the coach; autosend gated by CLUB_BILLING_REMINDER_AUTOSEND_ENABLED (off). Nothing is sent to students by this table.';

-- Defense-in-depth: RLS default-deny for anon/authenticated (app writes via service_role,
-- which bypasses RLS). Mirrors club_reactions / club_comments.
alter table public.club_payment_claims enable row level security;
alter table public.club_payment_reminders enable row level security;
-- (Deliberately no CREATE POLICY: default-deny.)

grant select, insert, update, delete on table public.club_payment_claims to service_role;
grant select, insert, update, delete on table public.club_payment_reminders to service_role;
