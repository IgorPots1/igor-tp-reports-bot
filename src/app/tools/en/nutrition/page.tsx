import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import SiteHeaderEn from "@/components/SiteHeaderEn";

import "../../nutrition/nutrition-page.css";
import styles from "../../nutrition/nutrition.module.css";
import NutritionCalculatorEn from "./NutritionCalculatorEn";
import { jetbrains, onest } from "@/lib/fonts";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools/en/nutrition",
  title: "What to eat before and after a run: calculator | igorp.run",
  description:
    "How many grams of carbs and protein to eat before and after your run, for your body weight and type of session.",
  lang: "en",
});

export default function NutritionToolPageEn() {
  return (
    <div lang="en" className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeaderEn />
      <NutritionCalculatorEn />
    </div>
  );
}
