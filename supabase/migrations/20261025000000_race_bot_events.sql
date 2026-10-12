-- События бота «Забеги России» для статистики: воронка, источники, клики (наряд 2026-10-12).
-- Только аддитивное. Доступ только service role: RLS включён, политик нет.
--
-- tg_id может быть пустым: «delete» пишется уже после удаления данных человека (/delete стирает
-- и его события), а клик по /go/ без подписанной ссылки — анонимный.

create table if not exists public.race_bot_events (
  id bigint generated always as identity primary key,
  tg_id bigint,
  event text not null check (event in (
    'start', 'city_chosen', 'filters_done', 'list_shown', 'search', 'follow', 'unfollow', 'open_calendar',
    'click_registration', 'click_site', 'consult_offer_shown', 'consult_click', 'digest_sent',
    'digest_opened_list', 'settings_less', 'pause', 'unsubscribe', 'delete', 'blocked',
    'expected_watch', 'expected_announced'
  )),
  race_id text,
  source text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.race_bot_events is
  'События бота «Забеги России» для /stats и админки. Удаляются вместе с данными человека по /delete.';

create index if not exists race_bot_events_created_idx on public.race_bot_events (created_at desc);
create index if not exists race_bot_events_event_created_idx on public.race_bot_events (event, created_at desc);
create index if not exists race_bot_events_tg_idx on public.race_bot_events (tg_id);

alter table public.race_bot_events enable row level security;
revoke all on public.race_bot_events from anon, authenticated;
grant select, insert, delete on public.race_bot_events to service_role;
