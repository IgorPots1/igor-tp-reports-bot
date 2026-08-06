-- Предложения о смещении порога (рост/падение), которые ночной пересчёт кладёт тренеру.
--
-- Назначение:
--   * ОДНА строка = ОДНО решение по атлету (правка Игоря: если у человека и забег, и лёгкий, и
--     перерыв — это одна история про форму, не три). Все сработавшие сигналы лежат в `signals` (jsonb).
--   * Разметка для анализа: пара `proposed_sec → decided_sec` + статус + `signals` — через 2 месяца
--     это выборка «система предложила X — поставили Y» для калибровки порогов срабатывания и весов.
--   * Анти-спам: индекс (athlete, direction, detected_at desc) — «не чаще раза в N дней по человеку+
--     направлению» и «не повторять уже отклонённое».
--
-- Значения порога/якоря — в с/км (integer), как их видит тренер. Порог здесь НЕ применяется: строка
-- лишь ПРЕДЛАГАЕТ; применяет тренер копи-блоком через tp-threshold-restore (его гейты целы).
-- Posture как у tp_threshold_applications: service_role, RLS on. Но update РАЗРЕШЁН — строка живёт от
-- 'proposed' до решения ('applied'/'declined'/'expired'/'superseded').

create table if not exists public.tp_threshold_signals (
  id                        uuid primary key default gen_random_uuid(),
  trainingpeaks_athlete_id  bigint not null,
  athlete_name              text,
  detected_at               timestamptz not null default now(),
  run_id                    uuid,                         -- прогон ночного пересчёта, в котором родилось

  direction                 text not null check (direction in ('up', 'down')),
  current_sec               integer not null,             -- порог на момент детекта (с/км)
  proposed_sec              integer,                      -- предложение системы; NULL если только не-числовые сигналы (перерыв)
  confidence                text not null check (confidence in ('strong', 'medium', 'weak')),

  anchor_sec                integer,                      -- лёгкий якорь на момент детекта (с/км)
  projected_ratio           numeric,                      -- якорь/порог ПОСЛЕ предложения (или якорь/текущий, если числа нет)
  ratio_in_band             boolean,                      -- projected_ratio в полосе 1.20–1.38 (быстрая проверка на разумность)

  signals                   jsonb not null,               -- ВСЕ сработавшие: [{type,direction,proposed_sec,magnitude_sec,evidence,features{...}}]
  summary_line              text not null,                -- точная строка тренеру (основание + отношение) — аудит и воспроизводимость

  status                    text not null default 'proposed'
                              check (status in ('proposed', 'applied', 'declined', 'expired', 'superseded')),
  notified_at               timestamptz,                  -- когда ушло в Telegram (курсор анти-спама)
  decided_at                timestamptz,
  decided_sec               integer,                      -- ЧТО тренер реально поставил (может ≠ proposed) — разметка
  decision_note             text,
  application_id            uuid,                         -- ссылка на tp_threshold_applications.id при применении

  created_at                timestamptz not null default now()
);

create index if not exists tp_threshold_signals_athlete_dir_idx
  on public.tp_threshold_signals (trainingpeaks_athlete_id, direction, detected_at desc);
create index if not exists tp_threshold_signals_status_idx
  on public.tp_threshold_signals (status, detected_at desc);

revoke all on table public.tp_threshold_signals from anon, authenticated, public;
grant select, insert, update on table public.tp_threshold_signals to service_role;
alter table public.tp_threshold_signals enable row level security;
