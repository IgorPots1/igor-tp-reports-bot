import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Раскладка Московского марафона. Темп по отрезкам на 10 км и 42,2 км с поправкой на рельеф";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · БЕСПЛАТНО",
    title: "Раскладка Московского марафона",
    subtitle: "Темп по отрезкам на 10 км и 42,2 км с поправкой на рельеф",
    motif: "track",
  });
}
