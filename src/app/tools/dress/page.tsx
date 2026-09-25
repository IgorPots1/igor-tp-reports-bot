import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";

import DressCalculator from "./DressCalculator";
import "./dress-page.css";
import styles from "./dress.module.css";
import { jetbrains, onest } from "@/lib/fonts";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/dress",
  title: "Что надеть на пробежку: калькулятор одежды по погоде | igorp.run",
  description:
    "Температура, ветер, осадки и тип тренировки: готовый комплект от головы до стоп с поправкой на то, что бег греет.",
});

// viewport-fit=cover — под безопасные отступы на вырезе экрана, дальше их
// отрабатывает env(safe-area-inset-*) в dress.module.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function DressToolPage() {
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <DressCalculator />
    </div>
  );
}
