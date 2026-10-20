import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeaderEn from "@/components/SiteHeaderEn";

import DressCalculatorEn from "./DressCalculatorEn";
import "../../dress/dress-page.css";
import styles from "../../dress/dress.module.css";
import { jetbrains, onest } from "@/lib/fonts";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/en/dress",
  title: "What to wear for a run: weather clothing calculator | igorp.run",
  description:
    "Temperature, wind, rain and type of session: a full outfit from head to feet, with the warm-up from running taken into account.",
  lang: "en",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function DressToolPageEn() {
  return (
    <div lang="en" className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeaderEn />
      <DressCalculatorEn />
    </div>
  );
}
