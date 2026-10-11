import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Посчитай свой бег. Темп, раскладка, питание, одежда и кроссовки. Бесплатно, за минуту";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · БЕСПЛАТНО",
    title: "Посчитай свой бег",
    subtitle: "Темп, раскладка, питание, одежда и кроссовки. Бесплатно, за минуту",
    motif: "track",
  });
}
