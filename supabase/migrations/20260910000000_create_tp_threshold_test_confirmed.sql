-- Пороги, подтверждённые 30-минутным тестом (ПРЯМОЕ измерение). Для таких атлетов ЗАБЕГОВЫЙ сигнал
-- смещения порога НЕ поднимается: тест меряет порог напрямую, забег — лишь оценка через конверсию
-- VDOT→FTPa. Иначе забег-оценка спорит с тестом каждую ночь, и тренер отклоняет её снова и снова.
-- Прочие сигналы (перерыв и т.д.) остаются — они не про конверсию забега.
--
-- Как tp_manual_anchors / tp_threshold_holds: service_role, RLS on, снимаемо (active=false при
-- перепроверке теста, строки не удаляем — аудит).
create table if not exists public.tp_threshold_test_confirmed (
  id                        uuid primary key default gen_random_uuid(),
  trainingpeaks_athlete_id  bigint not null,
  confirmed_at              timestamptz not null default now(),
  test_note                 text,        -- чем подтверждён (напр. «30-мин темповый сходится с порогом 3:56»)
  set_by                    text,        -- кто пометил, напр. 'igor'
  active                    boolean not null default true, -- false = снято (тест устарел/пересмотрен)
  created_at                timestamptz not null default now()
);
create index if not exists tp_threshold_test_confirmed_active_idx
  on public.tp_threshold_test_confirmed (trainingpeaks_athlete_id) where active;

revoke all on table public.tp_threshold_test_confirmed from anon, authenticated, public;
grant select, insert, update on table public.tp_threshold_test_confirmed to service_role;
alter table public.tp_threshold_test_confirmed enable row level security;

-- Григорьева (5649691): 30-мин темповый сходится с порогом 3:56 (тренер). Забег-сигнал не поднимать.
insert into public.tp_threshold_test_confirmed (trainingpeaks_athlete_id, test_note, set_by)
values (5649691, '30-мин темповый сходится с порогом 3:56 (тренер, 2026-08-05)', 'igor');
