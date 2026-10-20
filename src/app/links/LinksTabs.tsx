"use client";
import { useEffect, useState } from "react";

const WA_URL =
  "https://wa.me/79157317090?text=" + encodeURIComponent("Hi Igor! I'd like a free consultation");

type TabId = "coaching" | "trial" | "free";

const TABS: { id: TabId; label: string }[] = [
  { id: "coaching", label: "Coaching 1:1" },
  { id: "trial", label: "Trial week" },
  { id: "free", label: "Free guides" },
];

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
    title: "Free Strava breakdown",
    text: "Comment STRAVA under any of my reels and I'll look at your training and your goal myself.",
    href: "https://www.instagram.com/runnigor/",
    tag: "Instagram",
  },
];

function Consult() {
  return (
    <div className="links-consult">
      <p>Not sure what fits you? Let&apos;s talk about your running and your goal.</p>
      <a className="links-btn" href={WA_URL} target="_blank" rel="noopener noreferrer">
        Book a free consultation
      </a>
      <span className="links-hint mono">opens WhatsApp</span>
    </div>
  );
}

export default function LinksTabs() {
  const [tab, setTab] = useState<TabId>("coaching");

  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (h === "coaching" || h === "trial" || h === "free") setTab(h);
  }, []);

  function pick(id: TabId) {
    setTab(id);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      /* ignore */
    }
  }

  return (
    <section>
      <div className="links-tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "on" : ""}
            onClick={() => pick(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "coaching" && (
        <div className="links-panel" role="tabpanel">
          <div className="links-card big">
            <div className="links-price">
              <b>€60</b> <span>a month · cancel anytime</span>
            </div>
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
          </div>
          <Consult />
        </div>
      )}

      {tab === "trial" && (
        <div className="links-panel" role="tabpanel">
          <div className="links-card big">
            <div className="links-price">
              <b>€10</b> <span>for 7 days</span>
            </div>
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
          </div>
          <Consult />
        </div>
      )}

      {tab === "free" && (
        <div className="links-panel" role="tabpanel">
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
          <Consult />
        </div>
      )}
    </section>
  );
}
