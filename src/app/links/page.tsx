import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { jetbrains, onest } from "@/lib/fonts";
import HtmlLang from "../coaching/HtmlLang";
import "./links.css";

// English link-in-bio page for the international Instagram account (@runnigor).
// The earlier card design (99f11bd), stacked vertically instead of tabs, with no
// prices on the page (they live on /coaching and /trial). Sections: 1:1 coaching,
// trial week, then all free guides and tools, open by default at the bottom.
// Consultation buttons open Igor's WhatsApp.

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

function Consult({ text }: { text: string }) {
  return (
    <div className="links-consult">
      <p>{text}</p>
      <a className="links-btn" href={WA_URL} target="_blank" rel="noopener noreferrer">
        Book a free consultation
      </a>
      <span className="links-hint mono">opens WhatsApp</span>
    </div>
  );
}

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
            10+ years coaching. 300+ athletes coached. From your first 5K to the marathon.
          </p>
        </header>

        <nav className="links-tabs" aria-label="Sections">
          <a href="#coaching">Coaching 1:1</a>
          <a href="#trial">Trial week</a>
          <a href="#free">Free guides</a>
        </nav>

        <div className="links-panel">
          <section id="coaching" className="links-card big">
            <div className="links-kicker mono">Monthly · cancel anytime</div>
            <h2>1:1 online coaching</h2>
            <ul>
              <li>A personal plan built around your goal and your week</li>
              <li>Feedback on every run</li>
              <li>I&apos;m in touch every day and adjust the plan when life gets in the way</li>
              <li>Technique and strength work without overload</li>
            </ul>
            <a className="links-btn" href="/coaching">
              See how coaching works
            </a>
          </section>

          <section id="trial" className="links-card big">
            <div className="links-kicker mono">7 days · then you decide</div>
            <h2>Trial week</h2>
            <ul>
              <li>A personal week of training for your goal and level</li>
              <li>Technique and strength work</li>
              <li>Feedback on every run, 1:1 on WhatsApp</li>
              <li>After the week you decide if you want to continue</li>
            </ul>
            <a className="links-btn" href="/trial">
              Try a week
            </a>
          </section>

          <Consult text={"Not sure what fits you? Let's talk about your running and your goal."} />

          <section id="free" className="links-free">
            <h2 className="links-section">Free guides and tools</h2>
            <div className="links-grid">
              {GUIDES.map((g) => (
                <a key={g.href} className="links-card guide" href={g.href} target="_blank" rel="noopener noreferrer">
                  <span className="links-tag mono">{g.tag}</span>
                  <h3>{g.title}</h3>
                  <p>{g.text}</p>
                  <span className="links-open">Open &rarr;</span>
                </a>
              ))}
            </div>
          </section>

          <Consult text="Questions about your training? Write me, the first talk is free." />
        </div>

        <p className="links-foot mono">igorp.run · smart running, fewer injuries</p>
      </main>
    </div>
  );
}
