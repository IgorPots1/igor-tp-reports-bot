import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import { jetbrains, onest } from "@/lib/fonts";

import RacesCalendar from "./RacesCalendar";
import { prepare, type RaceRow } from "./races-logic";
import "./races-page.css";
import styles from "./races.module.css";

export const metadata: Metadata = publicPageMetadata({
  path: "/races",
  title: "Календарь забегов России 2026-2027 | igorp.run",
  description:
    "Шоссейные забеги, трейлы и триатлоны России по месяцам. Поиск по городу и региону, фильтры по дистанции, ссылки на регистрацию и сайты организаторов.",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// База обновляется раз в неделю, страница перечитывает её раз в час.
export const revalidate = 3600;

const COLUMNS =
  "id,source,source_url,name,date_start,date_end,city,region,distances,dist_km,race_type,tags,site_url,reg_url,vk_url,sources,link_ok,alt_dates,checked_note";
const PAGE = 1000;

/* Чтение view public.race_calendar публичным ключом (anon / publishable):
   view открыт на select для anon, и сайту больше ничего не нужно. Ключ
   сервисной роли сюда сознательно не берётся, хотя он есть в окружении:
   публичной странице хватает публичных прав.

   PostgREST отдаёт не больше 1000 строк за запрос и молча обрезает остальное,
   поэтому читаем страницами до короткой. */
async function loadRows(): Promise<RaceRow[] | null> {
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
        next: { revalidate },
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
function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
}

export default async function RacesPage() {
  const rows = await loadRows();
  const races = rows ? prepare(rows, todayIso()) : [];

  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <RacesCalendar races={races} failed={rows === null} />
    </div>
  );
}
