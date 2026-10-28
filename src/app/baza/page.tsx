import type { Metadata } from "next";

import { SITE_NAME, publicPageMetadata } from "@/lib/site";
import { jetbrains, onest } from "@/lib/fonts";

import { BAZA_HTML } from "./content";

export const metadata: Metadata = publicPageMetadata({
  path: "/baza",
  title: "База: бег с тренером за 3000 ₽ в месяц",
  description:
    "Выбираешь цель, тренер составляет план на неделю и раз в неделю корректирует его по твоей обратной связи. 3000 ₽ в месяц.",
  siteName: SITE_NAME,
  clubImage: true,
});

/* Разметка статичная и своя (не пользовательский ввод), поэтому вставляется как есть. */
export default function BazaPage() {
  return (
    <div
      className={`${onest.variable} ${jetbrains.variable}`}
      style={{ background: "#F6F4EF", minHeight: "100vh" }}
      dangerouslySetInnerHTML={{ __html: BAZA_HTML }}
    />
  );
}
