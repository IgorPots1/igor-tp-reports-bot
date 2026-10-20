import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { jetbrains, onest } from "@/lib/fonts";
import HtmlLang from "../coaching/HtmlLang";
import LinksTabs from "./LinksTabs";
import "./links.css";

// English link-in-bio page for the international Instagram account (@runnigor).
// Three tabs: 1:1 coaching, trial week, free materials. Every tab ends with
// a free consultation button that opens Igor's WhatsApp.

export const metadata: Metadata = publicPageMetadata({
  path: "/links",
  title: "Igor, running coach | Coaching, trial week and free guides",
  description:
    "1:1 online running coaching, a 7-day trial for 10 EUR and free guides: workouts, taper, strength, shoes and watches.",
  siteName: "Igor | Online Running Coach",
  lang: "en",
});

export default function LinksPage() {
  return (
    <div lang="en" className={`links-root ${onest.variable} ${jetbrains.variable}`}>
      <HtmlLang lang="en" />
      <main className="links-wrap">
        <header className="links-head">
          <div className="links-badge mono">@runnigor</div>
          <h1>
            Igor, <em>running coach</em>
          </h1>
          <p className="links-sub">
            10 years coaching. 500+ races finished by my athletes. From your first 5K to the marathon.
          </p>
        </header>
        <LinksTabs />
        <p className="links-foot mono">igorp.run · smart running, fewer injuries</p>
      </main>
    </div>
  );
}
