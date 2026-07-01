import { Montserrat } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";

// Self-hosted by Next.js at build time — no external Google Fonts request at runtime.
// Required for reliable font loading inside Telegram Mini App webview.
const montserrat = Montserrat({
  subsets: ["latin", "cyrillic"],
  variable: "--font-montserrat",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata = {
  title: "Недельный отчёт",
  robots: "noindex,nofollow",
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
