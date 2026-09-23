import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { JetBrains_Mono, Onest } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";

import "./plan-page.css";
import styles from "./plan.module.css";
import ThreeRunsTool from "./ThreeRunsTool";

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-onest",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/plan",
  title: "Три типа тренировок, шаблон недели и калькулятор темпа | igorp.run",
  description:
    "Готовый шаблон беговой недели на 3–4 тренировки и расчёт темпов под твой недавний результат на 5 или 10 км.",
});

export default function PlanToolPage() {
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <ThreeRunsTool />
    </div>
  );
}
