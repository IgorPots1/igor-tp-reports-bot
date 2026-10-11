import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Беговой интенсив. 10 дней: личный план, техника, силовые и разбор каждой тренировки";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · ИНТЕНСИВ",
    title: "Беговой интенсив",
    subtitle: "10 дней: личный план, техника, силовые и разбор каждой тренировки",
    motif: "track",
  });
}
