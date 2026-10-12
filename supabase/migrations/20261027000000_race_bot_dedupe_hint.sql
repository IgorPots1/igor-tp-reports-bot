-- Бот «Забеги России»: защита от повторов и одноразовая подсказка про ⭐ (наряд 12.10.2026).
--
-- race_bot_seen: ключи уже обработанного. «u:<update_id>» — Telegram повторил то же обновление;
-- «cb:<tg_id>:<callback_data>» — человек дважды нажал одну кнопку за пару секунд (было: два
-- unsubscribe за секунду). race_bot_seen_once атомарно: true — ключ новый (или старше окна), можно
-- обрабатывать; false — уже было в окне, пропустить. Одна вставка с ON CONFLICT ... WHERE, без гонок
-- между параллельными запросами webhook.

create table if not exists public.race_bot_seen (
  key text primary key,
  at timestamptz not null default now()
);

alter table public.race_bot_seen enable row level security;
revoke all on public.race_bot_seen from public, anon, authenticated;
grant select, insert, update, delete on public.race_bot_seen to service_role;

create or replace function public.race_bot_seen_once(p_key text, p_window_sec integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  with ins as (
    insert into public.race_bot_seen as s (key, at) values (p_key, now())
    on conflict (key) do update set at = excluded.at
      where s.at < now() - make_interval(secs => p_window_sec)
    returning 1
  )
  select exists (select 1 from ins);
$$;

revoke all on function public.race_bot_seen_once(text, integer) from public, anon, authenticated;
grant execute on function public.race_bot_seen_once(text, integer) to service_role;

-- Подсказка «Нажми ⭐, и я напомню…» один раз, после первого показанного списка.
alter table public.race_bot_users add column if not exists star_hint_at timestamptz;

-- Кого не считать в статистике: tg_id через запятую (фейковые тестовые). Тренер (coach_chat_id)
-- исключается всегда и сюда не пишется.
insert into public.race_bot_config (key, value) values ('stats_exclude', '')
on conflict (key) do nothing;
