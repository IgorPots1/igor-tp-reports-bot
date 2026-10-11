import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Питание вокруг тренировки. Сколько углеводов и белка съесть до и после под твой вес";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · БЕСПЛАТНО",
    title: "Питание вокруг тренировки",
    subtitle: "Сколько углеводов и белка съесть до и после под твой вес",
    motif: "track",
  });
}
