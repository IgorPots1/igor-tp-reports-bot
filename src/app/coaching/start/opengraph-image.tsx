import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Start 1:1 coaching with coach Igor: a short form about your goals, your week and your health";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · 1:1 COACHING",
    title: "Start your coaching",
    subtitle: "A short form: your goals, your week and your health",
    motif: "track",
  });
}
