import Script from "next/script";
import type { ReactNode } from "react";

export const metadata = {
  title: "Недельный отчёт",
  robots: "noindex,nofollow",
};

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Telegram Web App SDK — must load before React hydration so initData is ready */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {children}
    </>
  );
}
