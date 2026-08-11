-- Статус гонки «результата нет — вернуться позже». Раньше у race_events не было состояния, и синк не
-- знал, за кем возвращаться; вместе с постоянным кэшем это замораживало непривязанные гонки навсегда.
-- Минимальное решение — колонка на самой race_events (1:1 с гонкой, синк её и так читает; отдельная
-- таблица дала бы join без пользы). Значения:
--   awaiting_protocol   — гонка есть, официального результата пока нет, продолжаем перепроверять (default);
--   linked              — официальный результат привязан (club_official_results), больше не дёргаем;
--   no_public_protocol  — прошло >90 дней И >=3 пустых перепроверки → публичного протокола не будет, закрыто;
--   foreign_manual      — зарубежная гонка, probeg-источника нет → только ручной браузерный путь.
-- result_checks / result_checked_at ведут счётчик перепроверок для правила закрытия.
--
-- Additive и идемпотентно. Чтения устойчивы к непринятой миграции: синк определяет наличие колонки и без
-- неё работает по-старому (никакого 500). Правило закрытия и запись статуса включаются только под --commit.
alter table public.trainingpeaks_race_events
  add column if not exists result_status text not null default 'awaiting_protocol'
    check (result_status in ('awaiting_protocol', 'linked', 'no_public_protocol', 'foreign_manual')),
  add column if not exists result_checks integer not null default 0,
  add column if not exists result_checked_at timestamptz;

comment on column public.trainingpeaks_race_events.result_status is
  'awaiting_protocol | linked | no_public_protocol | foreign_manual — состояние перепроверки протокола гонки.';

create index if not exists trainingpeaks_race_events_result_status_idx
  on public.trainingpeaks_race_events (result_status);
