import type { Metadata } from "next";

import { clientCatalog } from "@/features/shoes/catalog";
import { publicPageMetadata } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";

import ShoePicker from "./ShoePicker";
import "./shoes-page.css";
import styles from "./shoes.module.css";
import { jetbrains, onest } from "@/lib/fonts";

// Те же шрифты, что у хаба, /club и /camp: страница не заводит своей типографики.
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
      <SiteHeader />
      <ShoePicker catalog={clientCatalog} />
    </div>
  );
}
