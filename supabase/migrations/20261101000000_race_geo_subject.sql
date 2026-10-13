-- Города и области (наряд 12.10.2026): субъект РФ и координаты города в race_calendar.
--
-- race_geo.subject — каноническое название субъекта («Тверская область», «Москва», «Республика
-- Татарстан»). Заполняется скриптом scripts/races-geo-fill.ts из ответа геокодера (сегмент перед
-- «… федеральный округ»). Исходные city/region стартов не меняются: по subject только группируем.
--
-- Сайт читает race_calendar публичным ключом, а представление security_invoker: прямой join с
-- race_geo потребовал бы публичного чтения таблицы (это отклонено 12.10.2026). Поэтому точка берётся
-- функцией с правами владельца, которая отдаёт ровно три поля для пары «город, регион»;
-- сама race_geo остаётся закрытой (RLS без политик, только service_role).
--
-- Ключ — как geoKey в src/features/races-bot/core.ts: lower, ё → е, пробелы схлопнуты, «город, регион».

alter table public.race_geo add column if not exists subject text;

create or replace function public.race_geo_point(p_city text, p_region text)
returns table (subject text, lat double precision, lon double precision)
language sql
stable
security definer
set search_path = public
as $$
  select g.subject, g.lat, g.lon
  from public.race_geo g
  where g.key = btrim(regexp_replace(replace(lower(coalesce(p_city, '')), 'ё', 'е'), '\s+', ' ', 'g'))
             || ', '
             || btrim(regexp_replace(replace(lower(coalesce(p_region, '')), 'ё', 'е'), '\s+', ' ', 'g'))
$$;

revoke all on function public.race_geo_point(text, text) from public;
grant execute on function public.race_geo_point(text, text) to anon, authenticated, service_role;

-- Все прежние поля в прежнем порядке; subject, lat, lon — в конце (create or replace view это позволяет,
-- права и security_invoker сохраняются).
create or replace view public.race_calendar with (security_invoker = true) as
 select e.id,
    e.source,
    e.source_url,
    e.name,
    e.date_start,
    e.date_end,
    e.date_text,
    e.city,
    e.region,
    e.location,
    e.distances,
    e.dist_km,
    e.race_type,
    e.tags,
    e.site_url,
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
     left join lateral public.race_geo_point(e.city, e.region) gp(subject, lat, lon) on true
  where e.status = 'active'::text and e.merged_into is null and e.date_end >= current_date and not coalesce(o.hidden, false);
