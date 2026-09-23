import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { JetBrains_Mono, Onest } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";

import "./nutrition-page.css";
import styles from "./nutrition.module.css";
import NutritionCalculator from "./NutritionCalculator";

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
  path: "/tools/nutrition",
  title: "Питание под тренировку — калькулятор | igorp.run",
  description:
    "Сколько углеводов и белка съесть до и после беговой тренировки. Конкретные граммы под твой вес и тип тренировки.",
});

export default function NutritionToolPage() {
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <NutritionCalculator />
    </div>
  );
}
