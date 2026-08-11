-- Постоянный след отклонённой привязки протокола. Раньше «отклонить» в очереди только помечало
-- club_protocol_pending.status='rejected', а строку в club_official_results (и рекорд) не трогало —
-- неверный результат оставался привязан и виден в ленте/рекордах, а следующий прогон синка МОГ
-- привязать его снова через upsert. Нужен tombstone, который синк проверяет ПЕРЕД записью.
--
-- Отдельная таблица, а не флаг на строке журнала: при отклонении строка журнала УДАЛЯЕТСЯ (тогда лента/
-- рекорды/топы её не показывают без правок читателей), а tombstone живёт независимо и переживает удаление.
-- Ключ (student_id, race_date, protocol_url) СОВПАДАЕТ с onConflict-ключом upsert в journal и с ключом
-- матчинга синка — поэтому синк молча пропустит отклонённое. Отмена = удалить строку отсюда (тренер
-- передумал → следующий прогон синка привяжет заново).
create table if not exists public.club_protocol_rejections (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  race_date date not null,
  protocol_url text,           -- совпадает с club_official_results.protocol_url (ключ upsert)
  distance_key text,           -- для отчётности (5k/10k/21k/42k или null)
  result_seconds integer,      -- что было отклонено, для истории
  reason text,
  rejected_by text,
  rejected_at timestamptz not null default now(),
  unique (student_id, race_date, protocol_url)
);

comment on table public.club_protocol_rejections is
  'Tombstone отклонённых привязок протокола. Синк пропускает (student_id,race_date,protocol_url) из этой таблицы ПЕРЕД записью. Отмена отклонения = удалить строку. Ключ совпадает с onConflict журнала.';

alter table public.club_protocol_rejections enable row level security;
-- service_role в этом проекте НЕ получает привилегий на новую public-таблицу по умолчанию — грантим явно.
grant select, insert, update, delete on table public.club_protocol_rejections to service_role;

create index if not exists club_protocol_rejections_lookup_idx
  on public.club_protocol_rejections (student_id, race_date);
