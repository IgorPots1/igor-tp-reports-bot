import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Пора готовиться к марафону?. 7 вопросов: с какого месяца стартовать и на какое время рассчитывать";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · БЕСПЛАТНО",
    title: "Пора готовиться к марафону?",
    subtitle: "7 вопросов: с какого месяца стартовать и на какое время рассчитывать",
    motif: "calendar",
  });
}
