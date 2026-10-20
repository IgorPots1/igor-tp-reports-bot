import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "What to wear for a run: weather clothing calculator";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · WHAT TO WEAR",
    title: "What to wear for a run",
    subtitle: "A full outfit for the weather, from head to feet",
    motif: "doc",
  });
}
