import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Как устроена работа с тренером. Что входит, что нужно от вас и что делать, если тренировка не пошла";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN",
    title: "Как устроена работа с тренером",
    subtitle: "Что входит, что нужно от вас и что делать, если тренировка не пошла",
    motif: "doc",
  });
}
