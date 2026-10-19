import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt =
  "7-day running trial with coach Igor: personal plan, technique, strength and feedback on every run";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · TRIAL WEEK",
    title: "7-day running trial",
    subtitle: "Personal plan, technique, strength and feedback on every run. 10 EUR",
    motif: "track",
  });
}
