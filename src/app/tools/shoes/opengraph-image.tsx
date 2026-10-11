import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Подбор беговых кроссовок. Ротация пар под твои тренировки и бюджет";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · БЕСПЛАТНО",
    title: "Подбор беговых кроссовок",
    subtitle: "Ротация пар под твои тренировки и бюджет",
    motif: "track",
  });
}
