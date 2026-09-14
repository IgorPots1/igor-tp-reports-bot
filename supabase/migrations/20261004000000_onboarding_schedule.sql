-- Вход в приложение — настройка ГРАФИКА, а не знакомство.
--
-- ПРИНЦИП [решение 14.09.2026]. Развёрнутая анкета живёт ДО приложения: интенсив
-- или форма, которую тренер даёт человеку сам. Опыт, травмы, история, цели —
-- туда, и тренер закрывает их предзаполнением. В приложении спрашиваем ровно
-- то, чего генератор не может узнать из данных И чего тренер не знает про
-- человека. Расписание — единственное, что попадает под оба условия.
--
-- Поля, ушедшие ИЗ ФОРМЫ, из базы НЕ УДАЛЕНЫ: can_run_continuously,
-- self_reported_weekly_minutes, coach_note остаются и заполняются
-- предзаполнением. Удалять их значило бы потерять уже собранные ответы и
-- сломать генератор, который читает can_run_continuously.
--
-- Всё аддитивное: add column, drop not null (ослабление), comment.

-- ── 1. Стабильна ли неделя ───────────────────────────────────────────────────
--
-- ПЕРВЫЙ ВОПРОС, И ОН МЕНЯЕТ ОСТАЛЬНЫЕ. У человека со сменным графиком или
-- маленькими детьми «удобные дни» не существуют как факт: он назовёт их, а
-- через неделю они будут другими. Дальше спрашивать его про день длительной
-- значит собирать ответ, который не переживёт первую неделю, и строить на нём
-- план, который человек нарушит и сочтёт себя виноватым.
--
-- varies — расписанием дальше не мучаем, закладываемся на переносы.
alter table public.intervals_onboarding_answers
  add column if not exists week_stability text;

alter table public.intervals_onboarding_answers
  drop constraint if exists intervals_onboarding_week_stability_check;
alter table public.intervals_onboarding_answers
  add constraint intervals_onboarding_week_stability_check
  check (week_stability is null or week_stability in ('stable', 'varies'));

comment on column public.intervals_onboarding_answers.week_stability is
  'stable — неделя повторяется, расписание имеет смысл спрашивать; varies — меняется, план закладывается на переносы, а день длительной и день работы не спрашиваются вовсе.';

-- ── 2. Дни: три состояния, а не два ──────────────────────────────────────────
--
-- unavailable_weekdays отвечал только на «когда точно нельзя». Но «точно
-- свободен» и «не сказал» — разные вещи: по первому можно ставить тренировку
-- уверенно, по второму приходится гадать. Две колонки дают три состояния:
-- свободен / занят / не уточнял.
alter table public.intervals_onboarding_answers
  add column if not exists available_weekdays smallint[] not null default '{}';

comment on column public.intervals_onboarding_answers.available_weekdays is
  'Дни, про которые человек сказал «точно свободен» (0=Пн … 6=Вс). День, которого нет ни здесь, ни в unavailable_weekdays, — «не уточнял»: ставить на него можно, но в последнюю очередь.';

-- ── 3. День длительной и день работы — РАЗНЫЕ ограничения ───────────────────
--
-- Длительную планируют вокруг жизни: это самая долгая тренировка недели, под
-- неё выделяют утро выходного. Тяжёлую работу планируют вокруг ВОССТАНОВЛЕНИЯ:
-- после неё нужен лёгкий день. Одним полем это не выражается: удобный день и
-- день, после которого есть куда восстанавливаться, совпадают редко.
alter table public.intervals_onboarding_answers
  add column if not exists preferred_quality_weekday smallint;

alter table public.intervals_onboarding_answers
  drop constraint if exists intervals_onboarding_quality_weekday_check;
alter table public.intervals_onboarding_answers
  add constraint intervals_onboarding_quality_weekday_check
  check (preferred_quality_weekday is null or preferred_quality_weekday between 0 and 6);

comment on column public.intervals_onboarding_answers.preferred_quality_weekday is
  'Удобный день для более тяжёлой тренировки. Отдельно от preferred_long_weekday: длительную планируют вокруг жизни, тяжёлую — вокруг дня восстановления после неё.';

-- ── 4. Время суток ───────────────────────────────────────────────────────────
--
-- Влияет на две вещи сразу: на переносимость нагрузки (утро натощак и вечер
-- после рабочего дня — разные условия) и на то, когда имеет смысл ждать чек-ин.
alter table public.intervals_onboarding_answers
  add column if not exists time_of_day text;

alter table public.intervals_onboarding_answers
  drop constraint if exists intervals_onboarding_time_of_day_check;
alter table public.intervals_onboarding_answers
  add constraint intervals_onboarding_time_of_day_check
  check (time_of_day is null or time_of_day in ('morning', 'evening', 'varies'));

-- ── 5. Где обычно бегает ─────────────────────────────────────────────────────
--
-- Не справка. Отрезки в холмистом парке и на стадионе — разные тренировки при
-- одинаковой записи в плане: в парке темп на подъёме падает, и человек считает,
-- что не справился, хотя работа сделана.
alter table public.intervals_onboarding_answers
  add column if not exists run_surfaces text[] not null default '{}';

comment on column public.intervals_onboarding_answers.run_surfaces is
  'Где человек обычно бегает. Значения совпадают с анкетой интенсива (surfaces), чтобы предзаполнение из неё ложилось без перевода.';

-- ── 6. Что регулярно ломает неделю ───────────────────────────────────────────
--
-- Заменяет абстрактное «что важно знать тренеру» КОНКРЕТНЫМ вопросом. На общий
-- вопрос человек отвечает общими словами; на «что срывает вам неделю» —
-- командировками, сменами и детьми, то есть тем, подо что действительно можно
-- спланировать.
alter table public.intervals_onboarding_answers
  add column if not exists week_breakers text;

comment on column public.intervals_onboarding_answers.week_breakers is
  'Что регулярно срывает неделю: командировки, сменный график, дети. Конкретный вопрос вместо абстрактного «что важно знать» — на общий вопрос приходят общие ответы.';

-- ── 7. Цель становится необязательной ────────────────────────────────────────
--
-- У выпускника интенсива цель задаёт тренер предзаполнением; человек с улицы
-- напишет сам; а кто-то просто хочет бегать. NULL здесь означает «не спрашивали
-- и не задали» — читатель трактует это как поддерживающий цикл, но САМ ФАКТ
-- отсутствия ответа сохраняется. Дефолт вместо NULL стёр бы эту разницу.
--
-- Ослабление ограничения: строк в таблице ноль (проверено), ни одна не задета.
alter table public.intervals_onboarding_answers
  alter column goal_kind drop not null;

comment on column public.intervals_onboarding_answers.goal_kind is
  'Цель. NULL — не спрашивали и тренер не задал; читается как поддерживающий цикл. Дефолт вместо NULL стёр бы разницу между «просто бегать» и «не ответил».';

-- ── 8. Откуда взялось число беговых дней ─────────────────────────────────────
--
-- Форма больше НЕ СПРАШИВАЕТ «сколько дней в неделю»: человек называет
-- конкретные дни, а не количество. Значит число либо задал тренер, либо оно
-- выведено из свободных дней — и тренер обязан видеть, что перед ним.
alter table public.intervals_onboarding_answers
  add column if not exists days_per_week_source text not null default 'answer';

alter table public.intervals_onboarding_answers
  drop constraint if exists intervals_onboarding_days_source_check;
alter table public.intervals_onboarding_answers
  add constraint intervals_onboarding_days_source_check
  check (days_per_week_source in ('answer', 'coach', 'derived'));

comment on column public.intervals_onboarding_answers.days_per_week_source is
  'answer — человек назвал число сам (старая форма); coach — задал тренер предзаполнением; derived — выведено из свободных дней с потолком методики.';

-- ── 9. Те же поля в предзаполнении ───────────────────────────────────────────
alter table public.intervals_onboarding_prefill
  add column if not exists week_stability text;
alter table public.intervals_onboarding_prefill
  drop constraint if exists intervals_onboarding_prefill_week_stability_check;
alter table public.intervals_onboarding_prefill
  add constraint intervals_onboarding_prefill_week_stability_check
  check (week_stability is null or week_stability in ('stable', 'varies'));

alter table public.intervals_onboarding_prefill
  add column if not exists available_weekdays smallint[];
alter table public.intervals_onboarding_prefill
  add column if not exists preferred_quality_weekday smallint;
alter table public.intervals_onboarding_prefill
  drop constraint if exists intervals_onboarding_prefill_quality_weekday_check;
alter table public.intervals_onboarding_prefill
  add constraint intervals_onboarding_prefill_quality_weekday_check
  check (preferred_quality_weekday is null or preferred_quality_weekday between 0 and 6);

alter table public.intervals_onboarding_prefill
  add column if not exists time_of_day text;
alter table public.intervals_onboarding_prefill
  drop constraint if exists intervals_onboarding_prefill_time_of_day_check;
alter table public.intervals_onboarding_prefill
  add constraint intervals_onboarding_prefill_time_of_day_check
  check (time_of_day is null or time_of_day in ('morning', 'evening', 'varies'));

alter table public.intervals_onboarding_prefill
  add column if not exists run_surfaces text[];
alter table public.intervals_onboarding_prefill
  add column if not exists week_breakers text;

-- ── 10. Контекст тренера, которого не было нигде ─────────────────────────────
--
-- ОГРАНИЧЕНИЯ ПО ЗДОРОВЬЮ. В анкете интенсива есть три медицинских поля, но в
-- онбординге не было ни одного, и травма никак не доезжала до плана. Здесь
-- лежит НЕ копия медицинских ответов, а вывод тренера: что нельзя и чего
-- беречься. Наружу не отдаётся: ни ученику, ни в Telegram, ни в логи.
alter table public.intervals_onboarding_prefill
  add column if not exists health_limits text;

comment on column public.intervals_onboarding_prefill.health_limits is
  'ВЫВОД тренера об ограничениях по здоровью, а не копия медицинских ответов анкеты интенсива. Читает только тренер: в приложение ученика, в Telegram и в логи не попадает никогда.';

-- ОПЫТ И ИСТОРИЯ. То, что тренер знает про человека до первой тренировки:
-- сколько бегал, какая максимальная дистанция, результаты стартов. Для
-- пришедшего с историей это считается из Intervals; для выпускника интенсива
-- без подключения — единственный источник.
alter table public.intervals_onboarding_prefill
  add column if not exists experience_note text;

comment on column public.intervals_onboarding_prefill.experience_note is
  'Что тренер знает про беговой опыт до первой тренировки: объём, максимальная дистанция, результаты. Для пришедшего с историей это считается из Intervals и поле не нужно.';
