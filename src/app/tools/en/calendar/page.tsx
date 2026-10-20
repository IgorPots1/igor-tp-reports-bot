import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeaderEn from "@/components/SiteHeaderEn";
import { jetbrains, onest } from "@/lib/fonts";

import MarathonCalendarEn from "./MarathonCalendarEn";
import "../../calendar/calendar-page.css";
import styles from "../../calendar/calendar.module.css";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/en/calendar",
  title: "Marathon calendar: every date of your build | igorp.run",
  description:
    "Enter your marathon date and get every date: recovery, off-season, build start, key sessions and the taper.",
  lang: "en",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function CalendarToolPageEn() {
  return (
    <div lang="en" className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeaderEn />
      <MarathonCalendarEn />
    </div>
  );
}
