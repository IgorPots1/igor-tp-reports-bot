import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import { jetbrains, onest } from "@/lib/fonts";

import MarathonTest from "./MarathonTest";
import "./marathon-page.css";
import styles from "./marathon.module.css";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/marathon",
  title: "Пора готовиться к марафону: тест готовности за минуту | igorp.run",
  description:
    "Семь вопросов про стаж, объём и самочувствие: с какого месяца реально стартовать марафон, что подтянуть до подготовки и на какое время рассчитывать.",
});

// viewport-fit=cover — под безопасные отступы на вырезе экрана, дальше их
// отрабатывает env(safe-area-inset-*) в marathon.module.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function MarathonToolPage() {
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <MarathonTest />
    </div>
  );
}
