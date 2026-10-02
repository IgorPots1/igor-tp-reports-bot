import type { Metadata } from "next";
import {
  CalendarCheck,
  Footprints,
  Gauge,
  HeartPulse,
  Thermometer,
  TrendingDown,
  Utensils,
} from "lucide-react";

import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";

import "./tools-page.css";
import styles from "./tools.module.css";
import { jetbrains, onest } from "@/lib/fonts";

export const metadata: Metadata = publicPageMetadata({
  path: "/tools",
  title: "Посчитай свой бег | igorp.run",
  description:
    "Темп, раскладка, питание, одежда и кроссовки. Бесплатно, за минуту.",
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
    href: "/tools/marathon",
    icon: CalendarCheck,
    title: "Пора готовиться к марафону?",
    text:
      "7 вопросов: узнаешь, с какого месяца тебе реально стартовать марафон и на какое время рассчитывать.",
  },
  {
    href: "/tools/plan",
    icon: Gauge,
    title: "Три пробежки",
    text: "Темпы для лёгкого бега, темповой работы и интервалов по твоему результату на 5 или 10 км.",
  },
  {
    href: "/tools/raskladka",
    icon: TrendingDown,
    title: "Раскладка Московского марафона",
    text: "Целевое время на 10 км или 42,2 км превращается в темп по полосам с поправкой на рельеф.",
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
        <h1 className={styles.title}>Посчитай свой бег</h1>
        <p className={styles.lede}>
          Темп, раскладка, питание, одежда и кроссовки. Бесплатно, за минуту.
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
