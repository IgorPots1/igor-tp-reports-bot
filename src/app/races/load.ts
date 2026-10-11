/* Чтение view race_calendar для страницы /races и её превью-картинки. Одно
 * место, чтобы цифры на картинке совпадали с тем, что видно на странице. */

import { prepare, type Race, type RaceRow } from "./races-logic";

const COLUMNS =
  "id,source,source_url,name,date_start,date_end,city,region,distances,dist_km,race_type,tags,site_url,reg_url,vk_url,sources,link_ok,alt_dates,checked_note";
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
