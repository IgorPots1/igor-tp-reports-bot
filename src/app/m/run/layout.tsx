import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Мой план",
  robots: "noindex,nofollow",
};

export default function RunAppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* SDK грузим ЯВНО и на этой ветке: beforeInteractive из родительского
          /m/layout Next честно применяет только в корневом layout. Скрипт
          Telegram идемпотентен, второе подключение безопасно. */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      {children}
    </>
  );
}
