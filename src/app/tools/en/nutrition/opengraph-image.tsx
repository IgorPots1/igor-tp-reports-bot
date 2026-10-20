import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "What to eat before and after a run: calculator";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · FUEL CALCULATOR",
    title: "Fuel for your run",
    subtitle: "Grams of carbs and protein before and after, for your weight",
    motif: "doc",
  });
}
