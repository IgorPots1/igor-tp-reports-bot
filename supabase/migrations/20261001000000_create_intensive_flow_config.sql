-- intensive_flow_config: настройки текущего потока интенсива — из кода в базу.
--
-- НЕ ПРИМЕНЯЕТСЯ ЭТИМ НАРЯДОМ — только файл. Применяет Игорь.
--
-- ЗАЧЕМ. Номер потока, дата старта, число мест и цена лежали константами в
-- src/lib/flow.ts. Смена даты требовала правки кода и деплоя, а потоки идут
-- раз в 2-3 недели — ради одной даты это слишком тяжело. Теперь активная
-- строка этой таблицы читается на каждый показ /,  /camp и админки, а меняет
-- её тренер формой в /admin/intensive, без участия разработчика.
--
-- МОДЕЛЬ: ОДНА АКТИВНАЯ СТРОКА. Таблица не хранит историю потоков как
-- отдельные версии — «Открыть новый поток» в админке просто обновляет
-- flow_number и start_date той же активной строки. Заявки прошлых потоков
-- при этом НЕ трогаются: их flow_number — обычный текст в
-- intensive_applications, простановленный на момент подачи, и от смены
-- конфига не меняется. Кто в каком потоке — видно по этому полю, а не по
-- тому, что сейчас в intensive_flow_config.
--
-- is_active + индекс по нему заведены на вырост (второй, неактивный набор
-- настроек уже можно держать в таблице параллельно), но код сейчас всегда
-- берёт единственную активную строку и не проверяет, что она ровно одна —
-- это ответственность админки, не констрейнт базы.
--
-- ФОРМАТ ДАТЫ: start_date — обычный date, БЕЗ названия месяца по-русски.
-- Человекочитаемый вид («11 сентября») собирается в коде (formatFlowStartDate
-- в src/lib/flow.ts) из ISO-даты, а не хранится готовой строкой — иначе базе
-- пришлось бы знать русскую грамматику дат.

create table if not exists public.intensive_flow_config (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  flow_number int not null,
  start_date date not null,
  seats_total int not null default 10,
  price_rub text not null default '999 ₽',
  price_eur text not null default '10 €',
  is_active boolean not null default true
);

comment on table public.intensive_flow_config is
  'Настройки текущего потока интенсива (номер, дата старта, места, цена). Одна активная строка читается на каждый показ /, /camp и админки. Меняется формой в /admin/intensive, без деплоя. Заявки прошлых потоков не трогаются при смене строки — их flow_number зафиксирован на момент подачи.';

comment on column public.intensive_flow_config.flow_number is
  'Номер потока, число. Склонения («29-й», «в 29-м потоке») считаются в коде, в базе только число.';

comment on column public.intensive_flow_config.start_date is
  'Дата старта потока. Хранится как date, без названия месяца — человекочитаемый вид («11 сентября») собирается в коде на русском.';

comment on column public.intensive_flow_config.is_active is
  'Какая строка сейчас действующая. Код берёт последнюю активную по updated_at; таблица не гарантирует единственность активной строки констрейнтом — это на совести админки.';

create index if not exists intensive_flow_config_is_active_idx
  on public.intensive_flow_config (is_active);

alter table public.intensive_flow_config enable row level security;

-- Политик для anon/authenticated нет намеренно: читает и пишет только
-- service_role с сервера (getFlowConfig / server actions в /admin/intensive),
-- как и у intensive_applications.
grant all on public.intensive_flow_config to service_role;

-- Сид: текущее состояние на день миграции — открывается 30-й поток, старт
-- 11.09.2026. 29-й (старт 31.08.2026) продолжает жить в intensive_applications
-- своими заявками, эта таблица его не описывает и не обязана.
insert into public.intensive_flow_config
  (flow_number, start_date, seats_total, price_rub, price_eur, is_active)
values
  (30, '2026-09-11', 10, '999 ₽', '10 €', true);
