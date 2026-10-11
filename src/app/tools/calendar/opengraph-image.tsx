import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Календарь до марафона. Все даты: восстановление, межсезонье, подготовка, ключевые тренировки, подводка";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · БЕСПЛАТНО",
    title: "Календарь до марафона",
    subtitle: "Все даты: восстановление, межсезонье, подготовка, ключевые тренировки, подводка",
    motif: "calendar",
  });
}
