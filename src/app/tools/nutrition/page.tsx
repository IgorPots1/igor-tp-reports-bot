import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";

import "./nutrition-page.css";
import styles from "./nutrition.module.css";
import NutritionCalculator from "./NutritionCalculator";
import { jetbrains, onest } from "@/lib/fonts";

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
