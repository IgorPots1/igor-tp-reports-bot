import type { Metadata } from "next";
import { JetBrains_Mono, Onest } from "next/font/google";
import { Footprints, Gauge, HeartPulse, Thermometer, Utensils } from "lucide-react";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";

import "./tools-page.css";
import styles from "./tools.module.css";

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-onest",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = publicPageMetadata({
  path: "/tools",
  title: "Калькуляторы | igorp.run",
  description:
    "Бесплатные инструменты для бега: темп, погода на пробежку, питание вокруг тренировки, подбор кроссовок.",
});

type Card = {
  href: string;
  icon: typeof Gauge;
  title: string;
  text: string;
  external?: boolean;
};

const CARDS: Card[] = [
  {
    href: "/tools/plan",
    icon: Gauge,
    title: "Три пробежки",
    text: "Темпы для лёгкого бега, темповой работы и интервалов по твоему результату на 5 или 10 км.",
  },
  {
    href: "/tools/dress",
    icon: Thermometer,
    title: "Что надеть на пробежку",
    text: "Комплект одежды по температуре, ветру и осадкам.",
  },
  {
    href: "/tools/nutrition",
    icon: Utensils,
    title: "Питание вокруг тренировки",
    text: "Сколько углеводов и белка съесть до и после под твой вес.",
  },
  {
    href: "/tools/shoes",
    icon: Footprints,
    title: "Подбор кроссовок",
    text: "Ротация пар под твой бег и бюджет.",
  },
  {
    href: "https://igorpots1.github.io/pulse-zone-calculator/",
    icon: HeartPulse,
    title: "Пульсовые зоны",
    text: "Расчёт зон по пульсу для разной интенсивности тренировок.",
    external: true,
  },
];

export default function ToolsShowcasePage() {
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <SiteHeader />
      <div className={styles.wrap}>
        <h1 className={styles.title}>Калькуляторы</h1>
        <p className={styles.lede}>
          Бесплатные инструменты, которыми я пользуюсь сам и которые даю ученикам.
        </p>

        <div className={styles.list}>
          {CARDS.map((card) => (
            <a
              key={card.href}
              href={card.href}
              className={styles.card}
              {...(card.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              <span className={styles.ic}>
                <card.icon size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className={styles.txt}>
                <span className={styles.t}>
                  {card.title}
                  {card.external ? <span className={styles.external}> · внешний сайт</span> : null}
                </span>
                <span className={styles.s}>{card.text}</span>
              </span>
              <span className={styles.ar} aria-hidden="true">
                &rsaquo;
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
