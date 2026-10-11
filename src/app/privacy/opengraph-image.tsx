import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/og-card";

export const alt = "Политика конфиденциальности. Какие данные получает igorp.run, зачем они нужны и как их удалить";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    label: "IGORP.RUN",
    title: "Политика конфиденциальности",
    subtitle: "Какие данные получает igorp.run, зачем они нужны и как их удалить",
    motif: "doc",
  });
}
