import type { Metadata, Viewport } from "next";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";

import PacingTool from "./PacingTool";
import "./raskladka-page.css";
import styles from "./raskladka.module.css";
import { jetbrains, onest } from "@/lib/fonts";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/raskladka",
  title: "Раскладка Московского марафона: калькулятор темпа на 10 км и 42,2 км | igorp.run",
  description:
    "Целевое время на Московском марафоне превращается в раскладку по полосам с поправкой на рельеф: спуск с Косыгина, сверка по часам, пункты питания.",
});

// viewport-fit=cover — под безопасные отступы на вырезе экрана, дальше их
// отрабатывает env(safe-area-inset-*) в raskladka.module.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RaskladkaToolPage() {
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <PacingTool />
    </div>
  );
}
