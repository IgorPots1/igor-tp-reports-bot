-- Включаем RLS на двух служебных таблицах, у которых он был выключен
-- (предупреждение Supabase advisors, 26.10.2026).
--
-- Политик не добавляем намеренно: anon и authenticated доступа к этим таблицам
-- не должны иметь вовсе. Код пишет в ai_call_logs только серверным клиентом на
-- SUPABASE_SERVICE_ROLE_KEY (src/features/supabase/server.ts), а service_role
-- обходит RLS, поэтому запись логов продолжает работать.
-- desk_perf_log_temp в коде не используется.

alter table public.ai_call_logs enable row level security;
alter table public.desk_perf_log_temp enable row level security;
