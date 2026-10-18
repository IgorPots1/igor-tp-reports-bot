import type { Metadata } from "next";
import { Suspense } from "react";

import BreakdownForm from "./BreakdownForm";
import HtmlLang from "../coaching/HtmlLang";
import "./breakdown.css";
import { jetbrains, onest } from "@/lib/fonts";

// Free Strava breakdown form for @runnigor (English). Opened from the
// "Fill the form" button in Instagram DMs (ChatPlace passes ?c=<client id>).
export const metadata: Metadata = {
  title: "Free Strava breakdown · Igor, running coach",
  description: "6 quick questions and your Strava link. I'll go through your training myself.",
  robots: { index: false, follow: false },
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
