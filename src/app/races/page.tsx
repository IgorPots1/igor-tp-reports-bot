import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import { jetbrains, onest } from "@/lib/fonts";

import { publicExpected } from "@/features/races-bot/core";

import RacesCalendar from "./RacesCalendar";
import RacesFooter from "./RacesFooter";
import { loadExpected } from "./expected";
import { loadDateFixed, loadRaces } from "./load";
import { publicRace } from "./races-logic";
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
  // В HTML — только то, что показывается (наряд 20.10.2026, защита от выкачивания): предстоящие
  // старты (прошедшие отсекает prepare) и ожидаемые, без ссылок на страницы-источники и прошлые
  // проведения. «Важное» и число полей выжимки мини-приложение берёт из /api/races/list по initData.
  const [loaded, expected, dateFixed] = await Promise.all([loadRaces(), loadExpected(), loadDateFixed()]);
  const races = (loaded ?? []).map((r) => ({ ...publicRace(r), dateFixed: dateFixed.has(r.id) }));

  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <RacesCalendar
        races={races}
        failed={loaded === null}
        expected={expected.map(publicExpected)}
        botUsername={(process.env.RACES_BOT_USERNAME || "ruruns_bot").trim().replace(/^@/, "") || null}
      />
      <RacesFooter />
    </div>
  );
}
