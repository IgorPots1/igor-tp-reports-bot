/* Чтение view race_calendar для страницы /races и её превью-картинки. Одно
 * место, чтобы цифры на картинке совпадали с тем, что видно на странице. */

import { fieldCount, type FullRow } from "@/features/race-details/full";
import { importantLine } from "@/features/race-details/important";

import { prepare, type Race, type RaceRow } from "./races-logic";

const COLUMNS =
  "id,source,source_url,name,date_start,date_end,city,region,distances,dist_km,race_type,tags,site_url,reg_url,vk_url,sources,link_ok,alt_dates,checked_note,subject,lat,lon";
const PAGE = 1000;

/* Чтение view public.race_calendar публичным ключом (anon / publishable):
   view открыт на select для anon, и сайту больше ничего не нужно. Ключ
   сервисной роли сюда сознательно не берётся, хотя он есть в окружении:
   публичной странице хватает публичных прав.

   PostgREST отдаёт не больше 1000 строк за запрос и молча обрезает остальное,
   поэтому читаем страницами до короткой. */
export async function loadRows(): Promise<RaceRow[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("[races] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY не заданы");
    return null;
  }
  const rows: RaceRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(
      `${url}/rest/v1/race_calendar?select=${COLUMNS}&order=date_start.asc,name.asc`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}` },
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) {
      console.error(`[races] race_calendar: HTTP ${res.status}`);
      return null;
    }
    const chunk = (await res.json()) as RaceRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
  }
}

/** Для мини-приложения (16.10.2026): по каждому старту строка «Важное» и число заполненных полей
 *  выжимки (кнопка «Всё о старте» — от 3), плюс старты с правкой даты в race_overrides (их расхождение
 *  дат разрешено — оранжевое предупреждение не показываем). Сбой — пустые карты, список работает. */
export async function loadListExtras(): Promise<{ details: Map<string, { line: string | null; n: number }>; dateFixed: Set<string> }> {
  const out = { details: new Map<string, { line: string | null; n: number }>(), dateFixed: new Set<string>() };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return out;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const byRace = new Map<string, FullRow[]>();
    for (let from = 0; ; from += PAGE) {
      const res = await fetch(`${url}/rest/v1/race_details?select=race_id,distance,field,value,checked_at&order=race_id.asc,id.asc`, {
        headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
        next: { revalidate: 3600 },
      });
      if (!res.ok) throw new Error(`race_details HTTP ${res.status}`);
      const chunk = (await res.json()) as (FullRow & { race_id: string; distance: number | string | null })[];
      for (const r of chunk) byRace.set(r.race_id, [...(byRace.get(r.race_id) ?? []), { ...r, distance: r.distance == null ? null : Number(r.distance) }]);
      if (chunk.length < PAGE) break;
    }
    for (const [id, rows] of byRace) out.details.set(id, { line: importantLine(rows), n: fieldCount(rows) });
    const o = await fetch(`${url}/rest/v1/race_overrides?select=id&date_start=not.is.null`, { headers, next: { revalidate: 3600 } });
    if (o.ok) for (const r of (await o.json()) as { id: string }[]) out.dateFixed.add(r.id);
  } catch (e) {
    console.error(`[races] выжимка для списка недоступна: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

/** Страница старта /races/<id> (вариант Б, 15.10.2026): сам старт из race_calendar и его выжимка
 *  из race_details, тем же публичным ключом. Старта нет — null (страница 404); выжимки нет или чтение
 *  упало — пустой список, страница без блока «Что важно знать». */
export async function loadRacePage(id: string): Promise<{ race: Race; rows: FullRow[] } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  // Старт и выжимка — параллельно (18.10.2026: было по очереди, два обращения к базе подряд).
  const detailsP = fetch(`${url}/rest/v1/race_details?select=distance,field,value,source_url,checked_at&race_id=eq.${encodeURIComponent(id)}&order=id.asc`, { headers, next: { revalidate: 3600 } })
    .then(async (d) => {
      if (d.ok) return ((await d.json()) as (FullRow & { distance: number | string | null })[]).map((r) => ({ ...r, distance: r.distance == null ? null : Number(r.distance) }));
      console.error(`[races] race_details ${id}: HTTP ${d.status}`);
      return [] as FullRow[];
    })
    .catch((e) => {
      console.error(`[races] race_details недоступна: ${e instanceof Error ? e.message : String(e)}`);
      return [] as FullRow[];
    });
  const res = await fetch(`${url}/rest/v1/race_calendar?select=${COLUMNS}&id=eq.${encodeURIComponent(id)}`, { headers, next: { revalidate: 3600 } });
  if (!res.ok) {
    console.error(`[races] race_calendar ${id}: HTTP ${res.status}`);
    return null;
  }
  const found = (await res.json()) as RaceRow[];
  const race = prepare(found, todayIso())[0];
  if (!race) return null;
  const rows = await detailsP;
  return { race, rows };
}

/** Сегодня по Москве: большинство стартов в этом поясе. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
}


/** Предстоящие старты, как на странице; null, если база недоступна (сеть, ключ, ответ). */
export async function loadRaces(): Promise<Race[] | null> {
  try {
    const rows = await loadRows();
    return rows ? prepare(rows, todayIso()) : null;
  } catch (e) {
    console.error(`[races] race_calendar недоступен: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
