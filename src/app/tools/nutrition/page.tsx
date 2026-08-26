import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { Manrope, Oswald } from "next/font/google";

import styles from "./nutrition.module.css";
import NutritionCalculator from "./NutritionCalculator";

const oswald = Oswald({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
  variable: "--font-oswald",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
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
    <div className={`${oswald.variable} ${manrope.variable} ${styles.page}`}>
      <NutritionCalculator />
    </div>
  );
}
