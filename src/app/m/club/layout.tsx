import { Oswald } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";

// Club surface adds Oswald for headings (naryad: Oswald + Montserrat, dark theme,
// yellow accent). Self-hosted at build time — no runtime Google Fonts request.
// Montserrat (--font-montserrat) is already provided by the parent /m/layout;
// this nested layout only layers Oswald on top and does NOT touch /m/desk or /m/n.
const oswald = Oswald({
  subsets: ["latin", "cyrillic"],
  variable: "--font-oswald",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata = {
  title: "Клуб",
  robots: "noindex,nofollow",
};

export default function ClubLayout({ children }: { children: ReactNode }) {
  return (
    <div className={oswald.variable}>
      {/* Load the Telegram SDK EXPLICITLY on the club branch too (not only via the
          parent /m/layout beforeInteractive, which Next only honours in the ROOT
          layout). Idempotent — Telegram's script is safe to include twice. The
          client also polls, so a slow load still resolves. */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      {children}
    </div>
  );
}
