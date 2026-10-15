-- Ручные правки стартов, которые не перезапишет еженедельный сбор (наряд 15.10.2026).
--
-- ЗАЧЕМ. Сбор (race-calendar-sync) при каждом проходе пишет строку источника заново: status = 'active'
-- и все поля как у источника. Правка прямо в race_events живёт до воскресенья. Правки и пометки
-- живут в race_overrides, представление race_calendar берёт значение правки, если оно есть.
--
--   status:  'cancelled'    — старт отменён: строка остаётся, в календаре не показывается;
--            'questionable' — под вопросом: показывается, note объясняет, recheck_after — когда
--                             еженедельная проверка смотрит его снова;
--   date_start, date_end, city, distances, dist_km — исправленное значение (null — как у источника);
--   site_url — исправленная ссылка; '' — ссылки нет (старая мёртвая или чужая).
-- Только добавление колонок и пересоздание представления с теми же колонками в том же порядке.

alter table public.race_overrides
  add column if not exists status text check (status in ('cancelled', 'questionable')),
  add column if not exists date_start date,
  add column if not exists date_end date,
  add column if not exists city text,
  add column if not exists site_url text,
  add column if not exists distances text[],
  add column if not exists dist_km numeric[],
  add column if not exists reason text,
  add column if not exists source_url text,
  add column if not exists recheck_after date,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.race_overrides.status is 'cancelled — отменён (не показываем, строку не удаляем); questionable — под вопросом (показываем, перепроверка раз в неделю)';
comment on column public.race_overrides.site_url is 'исправленная ссылка на сайт; пустая строка — ссылки нет';

create or replace view public.race_calendar with (security_invoker = true) as
 select e.id,
    e.source,
    e.source_url,
    e.name,
    coalesce(o.date_start, e.date_start) as date_start,
    coalesce(o.date_end, o.date_start, e.date_end) as date_end,
    case when o.date_start is not null then to_char(o.date_start, 'DD.MM.YYYY') else e.date_text end as date_text,
    coalesce(o.city, e.city) as city,
    e.region,
    e.location,
    coalesce(o.distances, e.distances) as distances,
    coalesce(o.dist_km, e.dist_km) as dist_km,
    e.race_type,
    e.tags,
    case when o.site_url = '' then null else coalesce(o.site_url, e.site_url) end as site_url,
    e.reg_url,
    e.vk_url,
    array_prepend(e.source, e.confirmed_by) as sources,
    e.link_ok,
    e.first_seen,
    e.last_seen,
    e.alt_dates,
    e.updated_at,
    o.note as checked_note,
    gp.subject,
    gp.lat,
    gp.lon
   from race_events e
     left join race_overrides o on o.id = e.id
     left join lateral race_geo_point(coalesce(o.city, e.city), e.region) gp(subject, lat, lon) on true
  where e.status = 'active'::text
    and e.merged_into is null
    and coalesce(o.date_end, o.date_start, e.date_end) >= current_date
    and not coalesce(o.hidden, false)
    and coalesce(o.status, '') <> 'cancelled';
