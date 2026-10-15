import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import { jetbrains, onest } from "@/lib/fonts";

import RacesCalendar from "./RacesCalendar";
import { loadExpected } from "./expected";
import { loadImportant, loadRaces } from "./load";
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
  const [loaded, expected, important] = await Promise.all([loadRaces(), loadExpected(), loadImportant()]);
  const races = (loaded ?? []).map((r) => ({ ...r, important: important.get(r.id) ?? null }));

  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <RacesCalendar
        races={races}
        failed={loaded === null}
        expected={expected}
        botUsername={(process.env.RACES_BOT_USERNAME || "ruruns_bot").trim().replace(/^@/, "") || null}
      />
    </div>
  );
}
