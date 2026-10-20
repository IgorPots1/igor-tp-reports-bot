import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeaderEn from "@/components/SiteHeaderEn";
import { jetbrains, onest } from "@/lib/fonts";

import MarathonTestEn from "./MarathonTestEn";
import "../../marathon/marathon-page.css";
import styles from "../../marathon/marathon.module.css";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/en/marathon",
  title: "Is it time to train for a marathon? A 1-minute readiness test | igorp.run",
  description:
    "Seven questions about your running history, volume and how you feel: from which month a marathon is realistic, what to work on first and what time to expect.",
  lang: "en",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function MarathonToolPageEn() {
  return (
    <div lang="en" className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeaderEn />
      <MarathonTestEn />
    </div>
  );
}
