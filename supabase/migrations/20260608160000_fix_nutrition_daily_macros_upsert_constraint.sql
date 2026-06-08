-- Supabase/PostgREST upsert onConflict: "report_id,day" requires a non-partial unique
-- index on (report_id, day). The phase-1 migration used a partial index
-- (where report_id is not null), which PostgreSQL/PostgREST cannot infer for ON CONFLICT.

drop index if exists public.nutrition_daily_macros_report_day_uidx;

create unique index if not exists nutrition_daily_macros_report_day_uidx
  on public.nutrition_daily_macros (report_id, day);
