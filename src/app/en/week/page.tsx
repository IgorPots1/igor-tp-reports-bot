import type { Metadata } from "next";
import { Suspense } from "react";

import { isEnWeekEnabled } from "@/features/en-week/logic";
import { publicPageMetadata } from "@/lib/site";

import { ComingSoon, Shell } from "./Shell";
import WeekForm from "./WeekForm";

// Free training week for @runnigor (English). Opened from the Instagram DM button
// (ChatPlace passes ?c=<client id>&u=<username>, both optional). Behind EN_WEEK_ENABLED.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...publicPageMetadata({
    path: "/en/week",
    title: "Free training week · Igor, running coach",
    description: "4 quick questions and you get a week of workouts built around your goal. Check-ins in your Instagram DMs.",
    siteName: "Igor | Online Running Coach",
    lang: "en",
  }),
  robots: { index: false, follow: false },
};

export default function EnWeekPage() {
  if (!isEnWeekEnabled()) return <ComingSoon />;
  return (
    <Shell>
      <Suspense>
        <WeekForm />
      </Suspense>
    </Shell>
  );
}
