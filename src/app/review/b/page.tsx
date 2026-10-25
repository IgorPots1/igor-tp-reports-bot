import type { Metadata } from "next";

import ReviewLanding from "../ReviewLanding";
import { SITE_URL } from "@/lib/site";

// Price test variant B: $10. Codeword CHECK on @runnigor leads here.
const TITLE = "Strava breakdown · Igor, running coach";
const DESCRIPTION = "I go through a year of your Strava and tell you the one thing to change. Within 24 hours.";
const OG_IMAGE = "/og-breakdown-1200x630.png";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Igor · running coach",
    url: `${SITE_URL}/review/b`,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

export default function ReviewPageB() {
  return <ReviewLanding variant="b" />;
}
