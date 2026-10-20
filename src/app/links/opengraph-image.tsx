import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Igor, running coach: 1:1 coaching, a trial week and free guides for runners";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · @RUNNIGOR",
    title: "Igor, running coach",
    subtitle: "1:1 coaching, a trial week and free guides",
    motif: "track",
  });
}
