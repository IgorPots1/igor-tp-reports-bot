import type { Metadata } from "next";
import { Manrope, Oswald } from "next/font/google";

import styles from "./plan.module.css";
import ThreeRunsTool from "./ThreeRunsTool";

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

export const metadata: Metadata = {
  title: "Три типа тренировок — шаблон недели и калькулятор темпа | igorp.run",
  description:
    "Готовый шаблон беговой недели на 3–4 тренировки и расчёт темпов под твой недавний результат на 5 или 10 км.",
};

export default function PlanToolPage() {
  return (
    <div className={`${oswald.variable} ${manrope.variable} ${styles.page}`}>
      <ThreeRunsTool />
    </div>
  );
}
