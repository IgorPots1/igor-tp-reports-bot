import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  // Корень всех относительных ссылок в метаданных: без него Next не может
  // развернуть og:image и canonical в абсолютные адреса, а Telegram и
  // Instagram принимают в карточке ТОЛЬКО абсолютные.
  metadataBase: new URL(SITE_URL),
  // title/description намеренно оставлены служебными: их видит только админка
  // и прочие страницы без своих метаданных. Публичные страницы задают свои
  // через publicPageMetadata, а карточка по умолчанию — брендовая, ниже.
  title: "TrainingPeaks Reports Bot",
  description: "Web Admin and Telegram delivery for TrainingPeaks weekly reports.",
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE_PATH,
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE_PATH],
  },
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
