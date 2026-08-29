import type { Metadata } from "next";
import { Manrope, Oswald } from "next/font/google";

import { clientCatalog } from "@/features/shoes/catalog";
import { publicPageMetadata } from "@/lib/site";

import ShoePicker from "./ShoePicker";
import styles from "./shoes.module.css";

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
  path: "/tools/shoes",
  title: "Подбор беговых кроссовок: ротация под твои тренировки | igorp.run",
  description:
    "16 вопросов — и набор пар под разные тренировки, а не одна модель на всё. Видно, какие свойства кроссовка привели к решению.",
});

export default function ShoesToolPage() {
  // База читается и проверяется на сервере: битая запись не доедет до браузера,
  // а цены физически не попадают в объект, который уходит на клиент.
  return (
    <div className={`${oswald.variable} ${manrope.variable} ${styles.page}`}>
      <ShoePicker catalog={clientCatalog} />
    </div>
  );
}
