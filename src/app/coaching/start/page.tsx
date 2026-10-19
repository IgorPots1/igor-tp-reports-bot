import type { Metadata } from "next";
import { Suspense } from "react";

import StartForm from "./StartForm";
import HtmlLang from "../HtmlLang";
import "../../camp/apply/apply.css";
import { jetbrains, onest } from "@/lib/fonts";

// Onboarding form for new 1:1 coaching clients (English, @runnigor).
// Same design as /trial/apply and /camp/apply (apply.css).
// Posts to /api/intensive/apply with source=coaching-en. Igor sends the link
// in DMs, optionally with ?c=<chat id> (read in StartForm via useSearchParams,
// hence the Suspense boundary, same as /breakdown).
export const metadata: Metadata = {
  title: "Start coaching · 1:1 with coach Igor",
  description:
    "Onboarding form for 1:1 coaching: your goals, your training week, your tools and your health.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Start your coaching with Igor",
    description: "A short form: your goals, your training week and your health.",
    url: "https://igorp.run/coaching/start",
    siteName: "igorp.run",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Start your coaching with Igor",
    description: "A short form: your goals, your training week and your health.",
  },
};

export default function CoachingStartPage() {
  return (
    <div lang="en" className={`apply-root ${onest.variable} ${jetbrains.variable}`}>
      <HtmlLang lang="en" />
      <Suspense>
        <StartForm />
      </Suspense>
    </div>
  );
}
