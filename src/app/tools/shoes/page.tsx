import type { Metadata } from "next";
import { JetBrains_Mono, Onest } from "next/font/google";

import { clientCatalog } from "@/features/shoes/catalog";
import { publicPageMetadata } from "@/lib/site";

import ShoePicker from "./ShoePicker";
import "./shoes-page.css";
import styles from "./shoes.module.css";

// Те же шрифты, что у хаба, /club и /camp: страница не заводит своей типографики.
const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
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
  path: "/tools/shoes",
  title: "Подбор беговых кроссовок: ротация под твои тренировки | igorp.run",
  description:
    "16 вопросов — и набор пар под разные тренировки, а не одна модель на всё. Видно, какие свойства кроссовка привели к решению.",
});

export default function ShoesToolPage() {
  // База читается и проверяется на сервере: битая запись не доедет до браузера,
  // а цены физически не попадают в объект, который уходит на клиент.
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <ShoePicker catalog={clientCatalog} />
    </div>
  );
}
