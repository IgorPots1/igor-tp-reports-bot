import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Три пробежки. Темпы для лёгкого бега, темповой работы и интервалов по твоему результату";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN · БЕСПЛАТНО",
    title: "Три пробежки",
    subtitle: "Темпы для лёгкого бега, темповой работы и интервалов по твоему результату",
    motif: "track",
  });
}
