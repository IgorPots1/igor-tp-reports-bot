import type { Metadata } from "next";
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

// Home-screen identity for the CLUB mini-app only (scoped to /m/club — parent /m/layout is
// untouched, so /m/n and /m/desk keep their own name/icon). NOTE: the PRIMARY home-screen name+icon
// for a Telegram Mini App come from Telegram itself (the bot / mini-app set in BotFather), NOT from
// this metadata. These fields cover the direct-URL / iOS-Safari "Add to Home Screen" (PWA) path.
// The referenced icon files under /public/icons are placeholders until the XO Runners logo is added.
export const metadata: Metadata = {
  title: "Клуб",
  applicationName: "XO Runners",
  robots: "noindex,nofollow",
  manifest: "/club.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "XO Runners" },
  icons: {
    icon: [
      { url: "/icons/xo-runners-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/xo-runners-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/xo-runners-apple-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function ClubLayout({ children }: { children: ReactNode }) {
  return (
    <div className={oswald.variable}>
      {/* Load the Telegram SDK EXPLICITLY on the club branch too (not only via the
          parent /m/layout beforeInteractive, which Next only honours in the ROOT
          layout). Idempotent - Telegram's script is safe to include twice. The
          client also polls, so a slow load still resolves. */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      {children}
    </div>
  );
}
