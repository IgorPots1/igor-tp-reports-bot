import type { Metadata } from "next";

import StartForm from "./StartForm";
import HtmlLang from "../HtmlLang";
import "../../camp/apply/apply.css";
import { jetbrains, onest } from "@/lib/fonts";

// Onboarding form for new 1:1 coaching clients (English, @runnigor).
// Same design as /trial/apply and /camp/apply (apply.css).
// Posts to /api/intensive/apply with source=coaching-en.
export const metadata: Metadata = {
  title: "Start coaching · 1:1 with coach Igor",
  description:
    "Onboarding form for 1:1 coaching: your goals, your training week, your tools and your health.",
  robots: { index: false, follow: false },
};

export default function CoachingStartPage() {
  return (
    <div lang="en" className={`apply-root ${onest.variable} ${jetbrains.variable}`}>
      <HtmlLang lang="en" />
      <StartForm />
    </div>
  );
}
