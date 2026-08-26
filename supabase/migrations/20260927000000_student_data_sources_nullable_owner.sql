-- Источник данных без владельца: аккаунт тренера и тестовые подключения.
--
-- НЕ ПРИМЕНЯЕТСЯ ЭТИМ НАРЯДОМ — только файл. Применяет Игорь.
--
-- ЗАЧЕМ. В первой миграции источник обязан был принадлежать ученику
-- (student_id not null → trainingpeaks_students). На пилоте это упёрлось в
-- простое: аккаунт тренера — законный источник данных, но тренер НЕ ученик, и
-- заводить ему карточку нельзя — она всплывёт в биллинге, клубе и рассылках.
-- Единственной альтернативой было привязать ключ тренера к карточке чужого
-- человека, то есть записать 1688 чужих тренировок в его историю. Это хуже.
--
-- ЧТО МЕНЯЕТСЯ. Владелец становится необязательным, а вид источника —
-- обязательным и явным. Читатели больше не гадают «а чей это источник» по
-- наличию student_id, а фильтруют по kind.
--
-- БЕЗОПАСНОСТЬ ДЛЯ СУЩЕСТВУЮЩИХ СТРОК: на момент правки в student_data_sources
-- и intervals_activities ноль строк (проверено). Но и на непустых таблицах
-- миграция безопасна: not null снимается (ограничение только ослабляется),
-- новая колонка приходит с default 'student' — то есть все имеющиеся строки
-- получают ровно тот смысл, который у них и был.

-- ── Вид источника ────────────────────────────────────────────────────────────
alter table public.student_data_sources
  add column if not exists kind text not null default 'student';

alter table public.student_data_sources
  drop constraint if exists student_data_sources_kind_check;

alter table public.student_data_sources
  add constraint student_data_sources_kind_check
  check (kind in ('student', 'self', 'test'));

comment on column public.student_data_sources.kind is
  'student — источник ученика, боевые данные; self — личный аккаунт тренера (владельца-ученика нет и не должно быть); test — техническое подключение. Читатели боевых данных обязаны фильтровать kind = ''student'' ЯВНО, а не выводить это из наличия student_id.';

-- ── Владелец необязателен ────────────────────────────────────────────────────
alter table public.student_data_sources
  alter column student_id drop not null;

comment on column public.student_data_sources.student_id is
  'Владелец источника. NULL допустим ТОЛЬКО для kind self/test: у аккаунта тренера карточки ученика нет. Для kind = ''student'' обязателен — это стережёт констрейнт ниже.';

-- Единственная комбинация, которая не имеет смысла: боевой источник без
-- владельца. Такая строка означала бы, что чьи-то тренировки лежат ничьи —
-- и всплыла бы позже, когда по ним пойдут разборы и счета.
--
-- Обратное НЕ запрещаем: тестовое подключение вполне может висеть на реальном
-- ученике (проверка на живой карточке), и запрет мешал бы без всякой пользы.
alter table public.student_data_sources
  drop constraint if exists student_data_sources_owner_check;

alter table public.student_data_sources
  add constraint student_data_sources_owner_check
  check (kind <> 'student' or student_id is not null);

-- ВНИМАНИЕ на будущее: unique (student_id, provider) из первой миграции для
-- строк с NULL-владельцем НЕ работает — Postgres считает NULL-ы различными,
-- поэтому два источника self с одним провайдером этот индекс пропустит. От
-- дублей защищает unique (provider, external_athlete_id): athlete_id есть
-- всегда и всегда осмыслен. По нему и надо делать upsert.

-- ── Активности без владельца ─────────────────────────────────────────────────
-- Тренировки, привезённые из источника без ученика, тоже не имеют владельца.
-- Без этой правки первый же боевой прогон по аккаунту тренера упал бы на
-- вставке — not null не пустил бы NULL в student_id.
alter table public.intervals_activities
  alter column student_id drop not null;

comment on column public.intervals_activities.student_id is
  'Владелец тренировки; NULL — привезена из источника без ученика (kind self/test). Выборки боевых данных должны отбирать по источнику с kind = ''student'' или явно требовать student_id is not null.';
