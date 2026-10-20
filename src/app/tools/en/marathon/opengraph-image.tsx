import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Marathon readiness test: when a marathon is realistic for you";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · MARATHON TEST",
    title: "Is it time for a marathon?",
    subtitle: "A 1-minute readiness test: when, what to work on, what time to expect",
    motif: "track",
  });
}
