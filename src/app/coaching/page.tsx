import type { Metadata } from "next";
import Image from "next/image";
import { publicPageMetadata } from "@/lib/site";
import { CLUB } from "@/lib/club";
import { jetbrains, onest } from "@/lib/fonts";
import Carousel from "../club/Carousel";
import LeadFormEn from "./LeadFormEn";
import "../club/club.css";

// English version of /club for the international Instagram account (@runnigor).
// Same design (club.css), same structure, shorter. Price lives in CLUB.priceMonthlyEur.
// Reviews carousel from /club is not here on purpose: those screenshots are in Russian.

export const metadata: Metadata = publicPageMetadata({
  path: "/coaching",
  title: "Online running coaching with Igor | 1:1 plan and daily feedback",
  description:
    "A personal training plan, feedback on every run and a coach in touch every day. From your first 5K to the marathon.",
  siteName: "Igor | Online Running Coach",
  clubImage: true,
});

const RESULTS: { img: string; delta: React.ReactNode; sub: string }[] = [
  { img: "/landing/05-result-nadya.jpg", delta: <>1:52 <span className="ar">&rarr;</span> 1:44</>, sub: "Half marathon · 8 minutes faster · 1st in group" },
  { img: "/landing/06-result-2-10-to-1-52.jpg", delta: <>2:10 <span className="ar">&rarr;</span> 1:52</>, sub: "Half marathon · 18 minutes faster" },
  { img: "/landing/07-result-2-16-to-1-50.jpg", delta: <>2:16 <span className="ar">&rarr;</span> 1:50</>, sub: "Half marathon · 26 minutes faster" },
  { img: "/landing/09-result-sochi-marathon.jpg", delta: <>First marathon</>, sub: "42.2 km in 4:21 · “barely tired”" },
  { img: "/landing/10-result-10k-47-43.jpg", delta: <>10K in 47:43</>, sub: "New personal best" },
  { img: "/landing/11-result-capcity-1-51-47.jpg", delta: <>1:51:47</>, sub: "Second half marathon · 15 minutes faster (USA)" },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "How much is it and how do I pay?",
    a: `${CLUB.priceMonthlyEur} a month for everything: your plan, feedback on every run and daily contact with me. You pay monthly and can stop at any time.`,
  },
  {
    q: "Is it for beginners?",
    a: "Yes. I take runners at any level, even if one kilometre feels hard right now. We start gently and build step by step.",
  },
  {
    q: "Do I need a running watch?",
    a: "No. You can start with a phone app and I'll help you set it up. A watch is handy, but not required at the start.",
  },
  {
    q: "How many runs a week?",
    a: "Usually 3 to 5, depending on your goal and your time. Three 30-minute runs a week is a perfectly good start. Consistency matters more than volume.",
  },
  {
    q: "How fast do you reply?",
    a: "I'm in touch every day and review workouts the same day. This is real coaching, not weekly auto-replies.",
  },
  {
    q: "I have a busy job and a family. Will it work?",
    a: "Yes, that's most of my athletes. The plan adapts to your week, and we move days or cut volume when life gets in the way.",
  },
  {
    q: "I've had injuries. Is that a problem?",
    a: "No. I take your history into account: a gradual build-up, technique work and strength training without overload.",
  },
  {
    q: "Can I run on a treadmill?",
    a: "Yes, the plan adapts to a treadmill easily.",
  },
];

export default function CoachingPage() {
  return (
    <div lang="en" className={`landing-root ${onest.variable} ${jetbrains.variable}`}>
      {/* NAV */}
      <nav className="top">
        <div className="wrap">
          <div className="brand">
            <span className="dot"></span>Igor · Online Running Coach
          </div>
          <a href="#join" className="btn">
            Apply
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">1:1 online running coaching</span>
            <h1 style={{ marginTop: "16px" }}>
              A clear plan and <span className="hl">a coach by your side</span>{" "}
              all the way to your goal
            </h1>
            <p className="hero-sub">
              Not an app with a template. Real work between a coach and a
              runner: I guide you step by step, whether it&apos;s your first
              race, a new personal best or simply running regularly and
              enjoying it.
            </p>
            <ul className="deliver">
              <li><span className="mk">&#10003;</span> A personal plan for your level and goals</li>
              <li><span className="mk">&#10003;</span> Feedback on every single workout</li>
              <li><span className="mk">&#10003;</span> Your coach in touch every day</li>
              <li><span className="mk">&#10003;</span> Strength, mobility, recovery and technique review</li>
              <li><span className="mk">&#10003;</span> Guidance all the way to your race or goal</li>
            </ul>
            <div className="hero-cta">
              <a href="#join" className="btn btn--lg">
                Start coaching &rarr;
              </a>
              <span className="meta">{CLUB.priceMonthlyEur} / month · cancel anytime</span>
            </div>
            <div className="trust">
              <span><b>10+ years</b> of coaching</span>
              <span><b>500+</b> race finishes by my athletes</span>
              <span>from <b>5K</b> to ultramarathons</span>
            </div>
          </div>
          <div className="hero-photo">
            <Image
              src="/landing/01-hero.jpg"
              alt="Igor, running coach, at a race"
              width={600}
              height={750}
              priority
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 30%" }}
            />
            <div className="hero-badge">
              <span className="dot"></span>Igor · running coach
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">How it works</span>
            <h2>Coaching, not a one-off plan</h2>
            <p>
              Every week: your plan, how you felt, and my feedback. Then we
              adjust and go again.
            </p>
          </div>
          <div className="steps">
            <div className="stepc">
              <div className="sc-n">01</div>
              <h3>Your plan</h3>
              <p>Built around your level, goals and schedule. You see the whole week ahead.</p>
            </div>
            <div className="stepc">
              <div className="sc-n">02</div>
              <h3>The workout</h3>
              <p>A clear description: structure, pace and the purpose of each part.</p>
            </div>
            <div className="stepc">
              <div className="sc-n">03</div>
              <h3>Your report</h3>
              <p>Your watch syncs the data. You tell me how it felt.</p>
            </div>
            <div className="stepc">
              <div className="sc-n">04</div>
              <h3>My feedback</h3>
              <p>I review the run and tell you what comes next.</p>
            </div>
          </div>
          <div className="visuals">
            <div className="vbox">
              <div className="window">
                <div className="window-bar">
                  <span className="win-dot r"></span>
                  <span className="win-dot y"></span>
                  <span className="win-dot g"></span>
                  <div className="win-title">Your training week</div>
                  <div className="win-spacer"></div>
                </div>
                <div className="window-body">
                  <img src="/landing/02-calendar.jpg" alt="Training calendar" loading="lazy" />
                </div>
              </div>
              <div className="visual-cap">Your personal training calendar</div>
            </div>
            <div className="vbox">
              <div className="wcard">
                <div className="wc-head">
                  <span className="wc-title">
                    <span className="wc-ic">&#9201;</span> Interval session
                  </span>
                  <span className="wc-meta">10.0 km · 20 × 1 min</span>
                </div>
                <div className="wc-bar">
                  <div className="wc-seg warm">Warm-up</div>
                  <div className="wc-seg main">
                    <span className="chip">20 × 1 min</span>
                  </div>
                  <div className="wc-seg cool">Cool-down</div>
                </div>
                <div className="wc-rows">
                  <div className="wc-row">
                    <span className="pc">06:21–06:50</span>
                    <span className="tx"><b>Warm-up:</b> 10 min easy running</span>
                  </div>
                  <div className="wc-row">
                    <span className="pc">04:55–05:09</span>
                    <span className="tx"><b>Main set:</b> 20 × (1 min on pace + 1 min easy)</span>
                  </div>
                  <div className="wc-row">
                    <span className="pc">06:21–06:50</span>
                    <span className="tx"><b>Cool-down:</b> 5 min easy</span>
                  </div>
                </div>
                <div className="wc-note">
                  Full recovery between reps: calm breathing, heart rate comes down.
                </div>
              </div>
              <div className="visual-cap">Workout card · interval example (pace per km)</div>
            </div>
          </div>
          <div className="flow-close">
            <span className="ic">&#8635;</span>
            <p>This loop repeats every week. Steady progress, no guesswork.</p>
          </div>
        </div>
      </section>

      {/* WHAT I ANALYSE */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Feedback</span>
            <h2>I look at every workout</h2>
            <p>
              Not just a “done” tick. I look at the whole session and adjust
              your plan from there.
            </p>
          </div>
          <div className="analyze">
            <div className="analyze-img">
              <img src="/landing/03-garmin-report.jpg" alt="An athlete's workout" loading="lazy" />
              <div className="visual-cap">A real athlete&apos;s workout · Garmin</div>
            </div>
            <div className="analyze-card">
              <h3>What I check</h3>
              <ul className="checks">
                <li><span className="ch">&#10003;</span>pace</li>
                <li><span className="ch">&#10003;</span>heart rate</li>
                <li><span className="ch">&#10003;</span>how you felt</li>
                <li><span className="ch">&#10003;</span>recovery</li>
                <li><span className="ch">&#10003;</span>fuelling before the run</li>
                <li><span className="ch">&#10003;</span>plan vs. what you actually ran</li>
              </ul>
              <div className="analyze-note">
                Based on this, we adjust the load and pace for the next sessions.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TECHNIQUE */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="tech">
            <div className="tech-visual">
              <Image
                src="/landing/04-technique.jpg"
                alt="Running technique review"
                width={600}
                height={450}
                loading="lazy"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
            <div>
              <span className="eyebrow">Running technique</span>
              <h2 style={{ marginTop: "14px", marginBottom: "16px" }}>
                Frame-by-frame technique review
              </h2>
              <p style={{ color: "var(--ink-2)", fontSize: "16.5px", maxWidth: "48ch", marginBottom: "20px" }}>
                Film yourself running and I&apos;ll show you, frame by frame and
                in plain words, what keeps you from running easier, more
                efficiently and more safely.
              </p>
              <ul className="checks">
                <li><span className="ch">&#10003;</span>body lean</li>
                <li><span className="ch">&#10003;</span>knee drive</li>
                <li><span className="ch">&#10003;</span>arm swing</li>
                <li><span className="ch">&#10003;</span>foot strike</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* RESULTS */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Results</span>
            <h2>What my athletes achieve</h2>
            <p>Real results from athletes I coach. Before &rarr; after.</p>
          </div>
          <Carousel trackClassName="w-case">
            {RESULTS.map((r, i) => (
              <div className="slide" key={r.img}>
                <img src={r.img} alt={`Result ${i + 1}`} loading="lazy" />
                <div className="case-cap">
                  <div className="delta">{r.delta}</div>
                  <div className="sub">{r.sub}</div>
                </div>
              </div>
            ))}
          </Carousel>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Who it&apos;s for</span>
            <h2>This is for you if you want to</h2>
          </div>
          <div className="who-grid">
            <div className="who"><span className="mk">&#10003;</span><p>Run regularly without constantly falling off</p></div>
            <div className="who"><span className="mk">&#10003;</span><p>Train for your first 5K, 10K, half or full marathon</p></div>
            <div className="who"><span className="mk">&#10003;</span><p>Get faster without overtraining or random workouts</p></div>
            <div className="who"><span className="mk">&#10003;</span><p>Have a coach who actually reads your runs</p></div>
            <div className="who"><span className="mk">&#10003;</span><p>Train on a plan made for you, not a template</p></div>
            <div className="who"><span className="mk">&#10003;</span><p>Make running part of your life for the long run</p></div>
          </div>
        </div>
      </section>

      {/* PRICE */}
      <section id="price">
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Price</span>
            <h2>One simple price</h2>
          </div>
          <div className="price-wrap">
            <div className="price-card">
              <div className="price-main">
                <b>{CLUB.priceMonthlyEur}</b>
                <span>per month</span>
              </div>
              <p className="price-note">
                One price for everything. No six-month packages, no extra fees
                for workout reviews.
              </p>
              <ul className="price-list">
                <li><span className="mk">&#10003;</span> Personal plan, feedback on every workout and daily contact</li>
                <li><span className="mk">&#10003;</span> Strength, mobility, recovery and technique review</li>
                <li><span className="mk">&#10003;</span> Monthly payment, cancel anytime</li>
              </ul>
              <a href="#join" className="btn btn--lg">
                Start coaching &rarr;
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">FAQ</span>
            <h2>Common questions</h2>
          </div>
          <div className="faq">
            {FAQ.map((f) => (
              <details className="q" key={f.q}>
                <summary>{f.q}</summary>
                <div className="a">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* AFTER YOU APPLY */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">No pressure</span>
            <h2>What happens after you apply</h2>
          </div>
          <div className="after-grid">
            <div className="after">
              <div className="n">1</div>
              <h3>I get in touch</h3>
              <p>I reply to your application and we pick a way to talk.</p>
            </div>
            <div className="after">
              <div className="n">2</div>
              <h3>We talk goals</h3>
              <p>Your goals, your running history and your current fitness.</p>
            </div>
            <div className="after">
              <div className="n">3</div>
              <h3>We start</h3>
              <p>You get your first training week and we begin.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FORM */}
      <div className="cta-section" id="join">
        <div className="cta-in">
          <div>
            <h2>
              Ready to train <span className="hl">with a plan</span> and see
              results?
            </h2>
            <p className="sub">
              Leave your details and I&apos;ll get back to you. We&apos;ll talk
              about your goals and find the right setup. You can start any
              time. {CLUB.priceMonthlyEur} per month.
            </p>
          </div>
          <LeadFormEn />
        </div>
      </div>

      {/* FOOTER */}
      <footer>
        <div className="wrap">
          <div>© 2026 · Igor · Online Running Coach</div>
          <div>
            <a href="https://instagram.com/runnigor">Instagram</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
