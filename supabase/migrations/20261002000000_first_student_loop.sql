-- Минимальный рабочий контур первой ученицы Intervals: подтверждение плана,
-- чек-ин после тренировки, перенос тренировки, текст тренера.
--
-- ПРИМЕНЕНА 14.09.2026 агентом по протоколу применения миграций (глобальный
-- CLAUDE.md). Схема прочитана до и после; ни одна существующая строка не
-- изменена и не удалена: 126 карточек учеников получили новую колонку
-- coaching_platform со значением 'trainingpeaks' — то самое, которое у них и
-- было по смыслу.
--
-- Всё аддитивное: add column с дефолтом, create table, create index, comment,
-- grant, enable rls. Ни одного delete/drop table/drop column/truncate и ни
-- одного ослабления not null.

-- ── 1. Карточка ученика, которого нет в TrainingPeaks ────────────────────────
--
-- ПОЧЕМУ ЭТО ПРИШЛОСЬ ТРОНУТЬ. trainingpeaks_students — это НЕ «ростер TP», это
-- единственная таблица людей в системе: на неё завязаны Telegram-привязка,
-- резолвер мини-приложений, биллинг, формальность обращения. Ученица Intervals
-- в TrainingPeaks не заведена и заводиться не будет, но человеком быть от этого
-- не перестаёт.
--
-- ПОЧЕМУ НЕ СДЕЛАЛИ ССЫЛКУ NULLABLE, ХОТЯ ЭТО НАПРАШИВАЛОСЬ. Проверили фактом:
-- в tools/ ДВА ДЕСЯТКА собственных копий parseAthleteIdFromUrl(value: string) и
-- normalizeUrl(value: string) — каждая падает на null («Cannot read properties
-- of null»). Среди читателей боевые раннеры: tp-scan-events, tp-fit-ingest-scan,
-- tp-health-metrics-scan, tp-workouts-cache-scan. Одна NULL-строка положила бы
-- их все, причём НЕЗАМЕТНО: раннер умирает на импорте, а пустая таблица логов
-- читается как «событий не было» (авария 11.08.2026, § 7 CLAUDE.md).
--
-- Поэтому ссылка остаётся ОБЯЗАТЕЛЬНОЙ, а ученик не из TP получает маркер
-- intervals://athlete/<id> — строку, которая:
--   · регулярному выражению /\/athletes\/(\d+)/ НЕ соответствует, значит ни в
--     один путь, ключуемый по athlete_id, человек не попадёт;
--   · остаётся строкой, значит ни одна из двадцати копий не падает;
--   · читается человеком как «это не TrainingPeaks».
--
-- Настоящий признак площадки — отдельная колонка ниже, а не форма ссылки.
alter table public.trainingpeaks_students
  add column if not exists coaching_platform text not null default 'trainingpeaks';

alter table public.trainingpeaks_students
  drop constraint if exists trainingpeaks_students_coaching_platform_check;

alter table public.trainingpeaks_students
  add constraint trainingpeaks_students_coaching_platform_check
  check (coaching_platform in ('trainingpeaks', 'intervals'));

comment on column public.trainingpeaks_students.coaching_platform is
  'Где ученик ведётся: trainingpeaks — планы и тренировки в TP, попадает в ростер автопланировщика; intervals — план в нашей базе, тренировки приезжают из Intervals.icu, в ростер TP НЕ попадает (loadRoster фильтрует по этой колонке). Дефолт trainingpeaks — все существующие 126 карточек получают ровно тот смысл, который у них и был.';

comment on column public.trainingpeaks_students.trainingpeaks_athlete_url is
  'Ссылка на атлета. ОБЯЗАТЕЛЬНА: два десятка читателей в tools/ разбирают её как строку и падают на null. Ученик не из TP несёт маркер intervals://athlete/<id> — он не подходит под /athletes/<digits>, поэтому ни в один путь по athlete_id не попадает. Площадку определяет coaching_platform, а не форма ссылки.';

create index if not exists trainingpeaks_students_platform_idx
  on public.trainingpeaks_students (coaching_platform);

-- ── 2. План показывается ученику только после подтверждения тренером ─────────
--
-- Сгенерированный цикл и ПОКАЗАННЫЙ цикл — разные вещи. Первые недели тренер
-- хочет видеть каждый план раньше ученицы, поэтому состояние публикации живёт
-- в строке, а не в env: флаг снимается один раз для всех, а решение по каждому
-- плану остаётся отдельным.
alter table public.intervals_plan_cycles
  add column if not exists status text not null default 'draft';

alter table public.intervals_plan_cycles
  drop constraint if exists intervals_plan_cycles_status_check;

alter table public.intervals_plan_cycles
  add constraint intervals_plan_cycles_status_check
  check (status in ('draft', 'published', 'superseded'));

alter table public.intervals_plan_cycles
  add column if not exists published_at timestamptz;

alter table public.intervals_plan_cycles
  add column if not exists published_by text;

-- Опубликованный цикл обязан помнить, когда его показали: без отметки времени
-- нельзя отличить «тренер подтвердил» от «кто-то проставил статус».
alter table public.intervals_plan_cycles
  drop constraint if exists intervals_plan_cycles_published_check;

alter table public.intervals_plan_cycles
  add constraint intervals_plan_cycles_published_check
  check (status <> 'published' or published_at is not null);

comment on column public.intervals_plan_cycles.status is
  'draft — сгенерирован, ученику НЕ показывается; published — тренер подтвердил, ученик видит; superseded — заменён более новым циклом. Ученику отдаётся ровно один published-цикл.';

create index if not exists intervals_plan_cycles_published_idx
  on public.intervals_plan_cycles (source_id, status, published_at desc);

-- ── 3. Перенос тренировки учеником ───────────────────────────────────────────
--
-- Перенос — САМАЯ ЧАСТАЯ причина, по которой пишут тренеру. Запоминаем исходный
-- день, а не просто переписываем дату: без него нельзя ни отменить перенос, ни
-- увидеть, что человек системно не попадает в назначенный день (а это сигнал,
-- что неверна анкета, а не дисциплина).
alter table public.intervals_plan_sessions
  add column if not exists original_session_date date;

alter table public.intervals_plan_sessions
  add column if not exists original_day_idx smallint;

alter table public.intervals_plan_sessions
  add column if not exists moved_at timestamptz;

alter table public.intervals_plan_sessions
  add column if not exists moved_by text;

comment on column public.intervals_plan_sessions.original_session_date is
  'День, на который сессия была назначена генератором. Заполняется ТОЛЬКО при переносе: NULL = сессия стоит там, куда её поставили.';

-- ── 4. Чек-ин после тренировки ───────────────────────────────────────────────
--
-- Несущая связь всего контура: ответ ученицы двигает состояние прогрессии.
--
-- ЧЕК-ИН НЕ ЗАВИСИТ ОТ ПРИХОДА АКТИВНОСТИ. Человек может пробежать и не
-- записать, записать с задержкой, записать на часы без синхронизации. Поэтому
-- и activity_id, и plan_session_id — необязательные: единственное, что обязано
-- быть, это день и ответ.
create table if not exists public.intervals_checkins (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,

  -- Сессия плана, к которой относится ответ. NULL — человек пробежал то, чего
  -- в плане не было. Такой ответ всё равно двигает прогрессию: это отработанная
  -- сессия, а не помеха учёту.
  plan_session_id uuid references public.intervals_plan_sessions(id) on delete set null,

  -- Тренировка из Intervals, если она уже приехала. NULL — не приехала или её
  -- не будет вовсе. Ссылка МЯГКАЯ (текстом, без внешнего ключа): чек-ин может
  -- прийти раньше активности, и не пустить его из-за порядка событий нельзя.
  activity_id text,

  session_date date not null,

  -- Усилие по шкале методики (RPE 1..10). Слова, которые видит ученица, к
  -- числам приводит один модуль (features/intervals/loop/effort-scale.ts):
  -- в базе хранится ЧИСЛО, потому что правило перехода считает по числу, а
  -- формулировки со временем поменяются.
  effort_rpe numeric(3,1) check (effort_rpe is null or effort_rpe between 1 and 10),
  -- Что именно она нажала. Хранится рядом с числом: когда формулировки
  -- поменяются, старые ответы должны остаться читаемыми.
  effort_label text,

  -- Боль или выраженный дискомфорт. БЛОКИРУЕТ ПРОГРЕССИЮ (decideNextStep →
  -- hold_for_coach). Не «понизить ступень», а остановиться и позвать тренера.
  pain boolean not null default false,
  pain_note text,

  comment_text text,
  -- file_id голосового в Telegram. Само аудио не храним: оно живёт у Telegram,
  -- а тащить его к себе — это хранение персональных данных без нужды.
  voice_file_id text,

  -- Что решило правило прогрессии на этом ответе и куда сдвинулась ступень.
  -- Сохраняется вместе с ответом: иначе «почему она на 3-й ступени» можно
  -- только реконструировать, а реконструкция врёт.
  step_before integer,
  step_after integer,
  progression_action text
    check (progression_action is null or progression_action in ('progress', 'repeat', 'step_back', 'hold_for_coach')),
  progression_reason text,

  created_at timestamptz not null default now()
);

comment on table public.intervals_checkins is
  'Ответ ученицы после тренировки: усилие словами (в базе — числом RPE), была ли боль, свободный текст/голосовое. Двигает intervals_beginner_progression. Намеренно НЕ требует активности из Intervals: человек может пробежать и не записать.';

-- ОДИН ЧЕК-ИН НА ДЕНЬ. Повторное нажатие правит ответ, а не добавляет вторую
-- отработанную сессию — иначе двойной тап двигал бы ступень на ровном месте.
--
-- Индекс ОБЫЧНЫЙ, не частичный, и это не стилистика: PostgREST не может целиться
-- ON CONFLICT в частичный индекс (42P10) — предикат в запрос не попадает, и
-- апсерт падает. Поймано прогоном, а не вычитано.
--
-- Правило заодно стало одно вместо двух: новичок бегает не чаще раза в день, и
-- «плановый ответ плюс внеплановый в тот же день» — это не два события, а один
-- человек, нажавший кнопку дважды.
create unique index if not exists intervals_checkins_source_day_uidx
  on public.intervals_checkins (source_id, session_date);

create index if not exists intervals_checkins_source_date_idx
  on public.intervals_checkins (source_id, session_date desc);

-- ── 5. Текст тренера ученице ─────────────────────────────────────────────────
--
-- ГЕНЕРАЦИИ ЗДЕСЬ НЕТ И НЕ ПРЕДПОЛАГАЕТСЯ ЭТИМ НАРЯДОМ. Текст пишет тренер
-- руками. Таблица нужна не ради доставки (её можно было бы сделать и без
-- таблицы), а ради КОРПУСА: пара «контекст → текст тренера» — это обучающий
-- пример, и собрать его задним числом из переписки нельзя, потому что контекст
-- на момент ответа уже не восстановить.
create table if not exists public.intervals_coach_messages (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,

  plan_session_id uuid references public.intervals_plan_sessions(id) on delete set null,
  checkin_id uuid references public.intervals_checkins(id) on delete set null,
  activity_id text,

  -- СНИМОК КОНТЕКСТА на момент написания: что было в чек-ине, какие были цифры
  -- тренировки, на какой ступени человек был. Снимок, а не ссылки: ступень
  -- сдвинется, план перегенерируется, и через месяц ссылки будут указывать на
  -- другое состояние. Корпус должен переживать это без потерь.
  context jsonb not null default '{}'::jsonb,

  body text not null check (length(btrim(body)) > 0),

  -- draft — написан, не отправлен; sent — доставлен; prepared — отправка была
  -- выключена killswitch-ем, текст проверен и готов, но наружу не ушёл.
  status text not null default 'draft'
    check (status in ('draft', 'prepared', 'sent')),
  sent_at timestamptz,
  sent_chat_id text,
  sent_message_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Отправленное обязано помнить когда: без отметки нельзя отличить доставку от
  -- проставленного руками статуса.
  constraint intervals_coach_messages_sent_check
    check (status <> 'sent' or sent_at is not null)
);

comment on table public.intervals_coach_messages is
  'Текст тренера ученице плюс СНИМОК контекста на момент написания (чек-ин, цифры тренировки, ступень). Снимок нужен для корпуса «контекст → ответ тренера»: задним числом его не восстановить.';

create index if not exists intervals_coach_messages_source_idx
  on public.intervals_coach_messages (source_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Как во всех таблицах контура: политик для anon/authenticated НЕТ вообще,
-- пишет и читает только серверный код под service_role.
alter table public.intervals_checkins enable row level security;
alter table public.intervals_coach_messages enable row level security;

grant all on public.intervals_checkins to service_role;
grant all on public.intervals_coach_messages to service_role;

drop trigger if exists set_intervals_coach_messages_updated_at
  on public.intervals_coach_messages;
create trigger set_intervals_coach_messages_updated_at
  before update on public.intervals_coach_messages
  for each row execute function public.set_intervals_ingest_updated_at();

-- ── 6. «Что важно знать тренеру» ─────────────────────────────────────────────
--
-- Единственное поле анкеты, которого не было. Наряд требует его прямо, и это
-- не украшение: в анкете из восьми полей человек не может сказать, что у него
-- было кесарево полгода назад, что он боится темноты и бегает только утром, что
-- в среду тренировка возможна, но раз в две недели. Всё это меняет план, и
-- ничего из этого не выводится из цифр.
--
-- Поле СВОБОДНОЕ и НЕ разбирается кодом. Его читает тренер. Попытка вытащить
-- отсюда структуру автоматически — это отдельная задача с отдельной ценой
-- ошибки, а молчаливое игнорирование того, что человек написал, хуже, чем
-- отсутствие поля.
alter table public.intervals_onboarding_answers
  add column if not exists coach_note text;

comment on column public.intervals_onboarding_answers.coach_note is
  'Свободный текст ученика «что важно знать тренеру». Кодом НЕ разбирается — читает человек. Всё, что не влезло в восемь структурных полей и при этом меняет план.';
