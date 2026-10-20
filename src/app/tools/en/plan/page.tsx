import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import SiteHeaderEn from "@/components/SiteHeaderEn";

import "../../plan/plan-page.css";
import styles from "../../plan/plan.module.css";
import ThreeRunsToolEn from "./ThreeRunsToolEn";
import { jetbrains, onest } from "@/lib/fonts";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/en/plan",
  title: "Running week template and pace calculator | igorp.run",
  description:
    "A ready running week for 3 or 4 runs, and your training paces from a recent 5K or 10K result.",
  lang: "en",
});

export default function PlanToolPageEn() {
  return (
    <div lang="en" className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeaderEn />
      <ThreeRunsToolEn />
    </div>
  );
}
