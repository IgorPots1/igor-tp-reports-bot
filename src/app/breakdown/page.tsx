import type { Metadata } from "next";
import { Suspense } from "react";

import BreakdownForm from "./BreakdownForm";
import HtmlLang from "../coaching/HtmlLang";
import "./breakdown.css";
import { jetbrains, onest } from "@/lib/fonts";
import { SITE_URL } from "@/lib/site";

const TITLE = "Free Strava breakdown · Igor, running coach";
const DESCRIPTION = "6 quick questions and your Strava link. I'll go through your training myself.";
// Own link preview: without it the page inherits the club card from the root layout.
// metadataBase in the layout turns the image path into an absolute URL.
const OG_IMAGE = "/og-breakdown-1200x630.png";

// Free Strava breakdown form for @runnigor (English). Opened from the
// "Fill the form" button in Instagram DMs (ChatPlace passes ?c=<client id>).
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Igor · running coach",
    url: `${SITE_URL}/breakdown`,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function BreakdownPage() {
  return (
    <div className={`bd-root ${onest.variable} ${jetbrains.variable}`}>
      <HtmlLang lang="en" />
      <Suspense>
        <BreakdownForm />
      </Suspense>
    </div>
  );
}
