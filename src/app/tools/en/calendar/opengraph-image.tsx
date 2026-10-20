import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Marathon calendar: every date of your build";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · MARATHON CALENDAR",
    title: "Marathon calendar",
    subtitle: "Every date of your build: off-season, key sessions, taper",
    motif: "calendar",
  });
}
