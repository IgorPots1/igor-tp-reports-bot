import type { Metadata } from "next";

import TrialApplyForm from "./TrialApplyForm";
import HtmlLang from "../../coaching/HtmlLang";
import "../../camp/apply/apply.css";
import { jetbrains, onest } from "@/lib/fonts";

// English application form for /trial. Same design as /camp/apply.
// Posts to /api/intensive/apply with source=trial-en.
export const metadata: Metadata = {
  title: "Apply · 7-day running trial with coach Igor",
  description:
    "Application form for the 7-day running trial: your goal, your running now and your health.",
  robots: { index: false, follow: false },
};

export default function TrialApplyPage() {
  return (
    <div lang="en" className={`apply-root ${onest.variable} ${jetbrains.variable}`}>
      <HtmlLang lang="en" />
      <TrialApplyForm />
    </div>
  );
}
