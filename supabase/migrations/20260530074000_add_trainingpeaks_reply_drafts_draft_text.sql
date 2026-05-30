alter table public.trainingpeaks_reply_drafts
  add column if not exists draft_text text;

comment on column public.trainingpeaks_reply_drafts.draft_text is
  'Stores the full coach-approved reply draft body for future explicit send flow.';
