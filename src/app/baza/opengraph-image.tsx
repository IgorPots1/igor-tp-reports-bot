import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Бег с тренером за 3000 ₽ в месяц: план на неделю и разбор раз в неделю";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · ТРЕНЕР",
    title: "Бег с тренером",
    subtitle: "План на неделю под твою цель и разбор раз в неделю. 3000 ₽ в месяц",
    motif: "calendar",
  });
}
