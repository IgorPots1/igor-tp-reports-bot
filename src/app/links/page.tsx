import type { Metadata } from "next";
import { Activity, BookOpen, Calculator, CalendarCheck, FileText, MessageCircle, UserRound } from "lucide-react";
import { publicPageMetadata } from "@/lib/site";
import { jetbrains, onest } from "@/lib/fonts";
import HtmlLang from "../coaching/HtmlLang";
import "../_hub/hub.css";
import "./links.css";

// English link-in-bio page for the international Instagram account (@runnigor).
// Same look as the root hub (src/app/page.tsx, _hub/hub.css): three simple
// cards, Coaching 1:1, Trial week and Free materials. No prices on the faces:
// they live on /coaching and /trial. The free list sits below (#free), then a
// free consultation button that opens Igor's WhatsApp.

export const metadata: Metadata = publicPageMetadata({
  path: "/links",
  title: "Igor, running coach | Coaching, trial week and free guides",
  description:
    "1:1 online running coaching, a 7-day trial week and free guides: workouts, taper, strength, shoes, watches and calculators.",
  siteName: "Igor | Online Running Coach",
  lang: "en",
});

const WA_URL =
  "https://wa.me/79157317090?text=" + encodeURIComponent("Hi Igor! I'd like a free consultation");

const GUIDES: { title: string; text: string; href: string; tag: string }[] = [
  {
    title: "6 workouts every runner needs",
    text: "Easy, tempo, threshold, VO2max, strides and the long run, with options for your level.",
    href: "/guides/6-workouts.pdf",
    tag: "PDF",
  },
  {
    title: "Race taper guide",
    text: "The last 3 weeks before a 5K, 10K, half or marathon: how much to run, what to eat, race morning.",
    href: "/guides/taper-guide-2026.pdf",
    tag: "PDF",
  },
  {
    title: "Strength training for runners",
    text: "6 exercises with videos, a weekly schedule and an 8-week plan, 2 times a week.",
    href: "/guides/strength.html",
    tag: "Guide",
  },
  {
    title: "Running shoes 2026",
    text: "Daily trainers, max cushion, stability, tempo, carbon racers and trail, with the numbers for every pair.",
    href: "/guides/shoes.html",
    tag: "Guide",
  },
  {
    title: "Running watches 2026",
    text: "Which watch fits your running and your budget, and what you really need from it.",
    href: "/guides/watch.html",
    tag: "Guide",
  },
  {
    title: "Warm-up before hard sessions",
    text: "A simple warm-up for intervals and races, so the first rep doesn't feel like a wall.",
    href: "/guides/intervals.html",
    tag: "Guide",
  },
  {
    title: "Marathon readiness test",
    text: "7 questions, 1 minute: from which month a marathon is realistic for you and what to work on first.",
    href: "/tools/en/marathon",
    tag: "Tool",
  },
  {
    title: "Marathon calendar",
    text: "Enter your race date and get every date of your build: off-season, key sessions and taper.",
    href: "/tools/en/calendar",
    tag: "Tool",
  },
  {
    title: "Week template and pace calculator",
    text: "A week for 3 or 4 runs and your paces for every session, from a recent 5K or 10K.",
    href: "/tools/en/plan",
    tag: "Tool",
  },
  {
    title: "Fuel calculator",
    text: "How many grams of carbs and protein to eat before and after your run, for your weight.",
    href: "/tools/en/nutrition",
    tag: "Tool",
  },
  {
    title: "What to wear for a run",
    text: "Set the weather and your session, get a full outfit from head to feet.",
    href: "/tools/en/dress",
    tag: "Tool",
  },
  {
    title: "Free Strava breakdown",
    text: "Comment STRAVA under any of my reels and I'll look at your training and your goal myself.",
    href: "https://www.instagram.com/runnigor/",
    tag: "Instagram",
  },
];

function GuideIcon({ tag }: { tag: string }) {
  if (tag === "Tool") return <Calculator size={20} strokeWidth={2} aria-hidden="true" />;
  if (tag === "Instagram") return <Activity size={20} strokeWidth={2} aria-hidden="true" />;
  return <FileText size={20} strokeWidth={2} aria-hidden="true" />;
}

export default function LinksPage() {
  return (
    <div lang="en" className={`start-root ${onest.variable} ${jetbrains.variable}`}>
      <HtmlLang lang="en" />
      <main>
        <div className="wrap">
          <div className="prof">
            <h1>Igor Potseluev</h1>
            <div className="role">Running coach · online</div>
            <div className="facts">
              <span>
                <b>10+ years</b> coaching
              </span>
              <span>
                <b>300+</b> athletes coached
              </span>
            </div>
          </div>

          <div className="links">
            <a className="card primary" href="/coaching">
              <span className="ic int">
                <UserRound size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="txt">
                <span className="t">Coaching 1:1</span>{" "}
                <span className="s">A plan built for you and a coach who checks every run</span>
              </span>
              <span className="ar">&rsaquo;</span>
            </a>

            <a className="card" href="/trial">
              <span className="ic club">
                <CalendarCheck size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="txt">
                <span className="t">Trial week</span>{" "}
                <span className="s">7 days of coaching to see how it works for you</span>
              </span>
              <span className="ar">&rsaquo;</span>
            </a>

            <a className="card" href="#free">
              <span className="ic free">
                <BookOpen size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="txt">
                <span className="t">Free materials</span>{" "}
                <span className="s">Guides, PDFs and calculators: workouts, taper, strength, shoes and more</span>
              </span>
              <span className="ar">&rsaquo;</span>
            </a>
          </div>

          <h2 className="sep" id="free">
            Free materials
          </h2>
          <div className="links">
            {GUIDES.map((g) => (
              <a key={g.href} className="card sm" href={g.href} target="_blank" rel="noopener noreferrer">
                <span className="ic free">
                  <GuideIcon tag={g.tag} />
                </span>
                <span className="txt">
                  <span className="t">{g.title}</span> <span className="s">{g.text}</span>
                </span>
                <span className="tag">{g.tag}</span>
              </a>
            ))}
          </div>

          <div className="consult">
            <p className="consult-t">Not sure where to start?</p>
            <p className="consult-s">
              Book a free consultation. We&apos;ll talk about your running, your goal and what to change first.
            </p>
            <a className="consult-btn" href={WA_URL} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={18} strokeWidth={2} aria-hidden="true" />
              Book a free consultation
            </a>
            <p className="consult-hint">opens WhatsApp</p>
          </div>
        </div>
      </main>

      <footer>© 2026 · Igor Potseluev · igorp.run</footer>
    </div>
  );
}
