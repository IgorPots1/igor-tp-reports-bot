import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import { jetbrains, onest } from "@/lib/fonts";

import RacesCalendar from "./RacesCalendar";
import RacesFooter from "./RacesFooter";
import { raceContext } from "./race-data";
import { metaOf, summary } from "./race-query";
import { NO_FILTERS } from "./races-logic";
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

export default async function RacesPage() {
  // В HTML — сводка и первая порция ближайшего месяца (наряд 30.10.2026, второй этап защиты): весь
  // список больше не уезжает браузеру одним документом. Остальное — /api/races/query порциями, под
  // лимитом частоты. Источники, «Важное» и прошлые проведения не отдаются с 20.10.2026 (race-data.ts).
  const ctx = await raceContext();
  const meta = ctx ? metaOf(ctx) : { total: 0, nCities: 0, subjects: [], cities: [], today: "" };
  const initial = ctx ? summary(ctx, { ...NO_FILTERS, ids: null }) : null;

  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <RacesCalendar
        meta={meta}
        initial={initial}
        failed={ctx === null}
        botUsername={(process.env.RACES_BOT_USERNAME || "ruruns_bot").trim().replace(/^@/, "") || null}
      />
      <RacesFooter />
    </div>
  );
}
