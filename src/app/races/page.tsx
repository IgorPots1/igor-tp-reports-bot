import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import { jetbrains, onest } from "@/lib/fonts";

import RacesCalendar from "./RacesCalendar";
import { loadExpected } from "./expected";
import { loadListExtras, loadRaces } from "./load";
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
  // На сайте строки «Важное» в списке нет (вариант Б, 15.10.2026). Данные едут в браузер для
  // мини-приложения: там «Важное» и «Всё о старте» в блоке старта (16.10.2026).
  const [loaded, expected, extras] = await Promise.all([loadRaces(), loadExpected(), loadListExtras()]);
  const races = (loaded ?? []).map((r) => {
    const d = extras.details.get(r.id);
    return { ...r, important: d?.line ?? null, detailsN: d?.n ?? 0, dateFixed: extras.dateFixed.has(r.id) };
  });

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
