import type { Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { montserrat } from "@/lib/fonts";

// Self-hosted by Next.js at build time — no external Google Fonts request at runtime.
// Required for reliable font loading inside Telegram Mini App webview.
export const metadata = {
  title: "Недельный отчёт",
  robots: "noindex,nofollow",
};

// viewport-fit=cover — без него env(safe-area-inset-*) равен 0 и нижняя панель
// /m/* не получает отступ под жестовую полосу. Layout покрывает все страницы /m/*.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Telegram Web App SDK — must load before React hydration so initData is ready */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {/* Font variable wrapper — cascades --font-montserrat to all /m/* children */}
      <div className={montserrat.variable}>{children}</div>
    </>
  );
}
