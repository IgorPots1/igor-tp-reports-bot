import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Running week template and pace calculator";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · PACE CALCULATOR",
    title: "Week template and paces",
    subtitle: "3 or 4 runs a week and your paces from a recent 5K or 10K",
    motif: "track",
  });
}
