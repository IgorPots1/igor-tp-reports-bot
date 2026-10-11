import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import { jetbrains, onest } from "@/lib/fonts";

import MarathonCalendar from "./MarathonCalendar";
import "./calendar-page.css";
import styles from "./calendar.module.css";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/calendar",
  title: "Календарь до марафона: все даты подготовки | igorp.run",
  description:
    "Вводишь дату марафона и получаешь все даты: восстановление, межсезонье, старт подготовки, ключевые тренировки, подводка.",
});

// viewport-fit=cover — под безопасные отступы на вырезе экрана, дальше их
// отрабатывает env(safe-area-inset-*) в calendar.module.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function CalendarToolPage() {
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <MarathonCalendar />
    </div>
  );
}
