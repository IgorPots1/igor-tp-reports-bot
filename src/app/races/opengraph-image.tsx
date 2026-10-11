import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

import { loadRaces } from "./load";
import { plural } from "./races-logic";

export const alt = "Календарь забегов России: шоссе, трейлы и триатлоны по месяцам";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
// Как у страницы: цифры на картинке обновляются вместе с ней.
export const revalidate = 3600;

/* Живые цифры из view race_calendar: столько же стартов и городов, сколько на
   странице. База недоступна: картинка без цифр, но не ошибка. */
export default async function Image() {
  const races = await loadRaces();
  let stats: string | null = null;
  if (races && races.length) {
    const cities = new Set(races.map((r) => r.city).filter(Boolean)).size;
    const y1 = races[0].ds.slice(0, 4);
    const y2 = races.reduce((m, r) => (r.ds > m ? r.ds : m), races[0].ds).slice(0, 4);
    stats = `${races.length} ${plural(races.length, "старт", "старта", "стартов")} · ${cities} ${plural(cities, "город", "города", "городов")} · ${y1 === y2 ? y1 : `${y1}-${y2}`}`;
  }
  return renderOgCard({
    title: "Календарь забегов России",
    subtitle: "Шоссе · Трейлы · Триатлоны",
    stats,
    motif: "calendar",
  });
}
