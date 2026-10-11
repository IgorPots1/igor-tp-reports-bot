import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Что надеть на пробежку. Комплект одежды по температуре, ветру и осадкам";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · БЕСПЛАТНО",
    title: "Что надеть на пробежку",
    subtitle: "Комплект одежды по температуре, ветру и осадкам",
    motif: "track",
  });
}
