import type { Metadata } from "next";
import Image from "next/image";
import fs from "fs";
import path from "path";
import { publicPageMetadata } from "@/lib/site";
import { jetbrains, onest } from "@/lib/fonts";
import Carousel from "../club/Carousel";
import HtmlLang from "../coaching/HtmlLang";
import { TRIAL_REVIEWS } from "./reviews";
import "../camp/camp.css";
import "./trial.css";

// English trial week for the international Instagram (@runnigor).
// Same design and structure as the Russian /camp, but its own offer:
// 7 days, 10 EUR, apply first, payment link in Instagram DM, then the week
// runs 1:1 on WhatsApp (plan and reports there).
// Not tied to the Russian flow config: no flow number, no seat counter,
// no prices from intensive_flow_config. Price lives here as a constant.
// Decisions by Igor, 19.10.2026.

const PRICE = "10 EUR";
const COACHING_PRICE = "60 EUR";
const APPLY = "/trial/apply";

export const metadata: Metadata = publicPageMetadata({
  path: "/trial",
  title: "7-day running trial with coach Igor | 10 EUR",
  description:
    "A personal running plan, technique and strength work, and feedback on every run. Try one week of coaching for 10 EUR.",
  siteName: "Igor | Online Running Coach",
  lang: "en",
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "How do I pay?",
    a: `Not on this page. First you fill in a short form. Then I send you a payment link in Instagram DM within 24 hours. The price is ${PRICE} for the week.`,
  },
  {
    q: "Where does the week happen?",
    a: "On WhatsApp, 1:1. After you pay, we talk 1:1 on WhatsApp. You get your plan there and send your reports there.",
  },
  {
    q: "I don't have a running watch or a heart rate monitor. What do I do?",
    a: "You can use an app on your phone. I will tell you which one to download and how to set it up.",
  },
  {
    q: "I don't have running gear. Can I join?",
    a: "Yes. Any comfortable shoes and clothes for the weather are fine. We start with what you have. I can help you choose gear later.",
  },
  {
    q: "How often will I run?",
    a: "Usually 3 to 4 runs a week, 30 to 60 minutes each. I adjust the plan to your level and your schedule.",
  },
  {
    q: "Can I run on a treadmill?",
    a: "Yes. The plan works outside and on a treadmill.",
  },
  {
    q: "What if I miss a workout?",
    a: "That's OK. The plan adapts. The main thing is to stay in touch and tell me.",
  },
  {
    q: "I'm a total beginner. Can I do it?",
    a: "Yes, the plan adapts to you. Even if you only walk right now, that is already a starting point.",
  },
  {
    q: "What happens after the 7 days?",
    a: `I tell you what to do next for your goal. If you want to keep working with me, the next step is 1:1 coaching for ${COACHING_PRICE} a month. You can cancel any time. It is your choice, no pressure.`,
  },
];

export default function TrialPage() {
  const hasHeroPhoto = fs.existsSync(
    path.join(process.cwd(), "public/intensive/hero.jpg")
  );

  return (
    <div
      lang="en"
      className={`intensive-root trial-root ${onest.variable} ${jetbrains.variable}`}
    >
      <HtmlLang lang="en" />

      {/* NAV */}
      <nav className="top">
        <div className="wrap">
          <div className="brand">
            <span className="dot"></span>Igor · 7-day running trial
          </div>
          <a href={APPLY} className="btn">
            Apply
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">Running trial week · online</span>
            <h1 style={{ marginTop: "15px" }}>
              7 days that will{" "}
              <span className="hl">change how you train</span>
            </h1>
            <p className="hero-sub">
              A personal plan, technique and strength work, and feedback on
              every run. Try one week of coaching for {PRICE}.
            </p>

            <div className="hero-cta">
              <a href={APPLY} className="btn btn--lg">
                Apply for the trial week
              </a>
              <span className="hero-note">I reply myself. No bots.</span>
            </div>
            <div className="hero-trust">
              <span>
                <b>10 years</b> of coaching
              </span>
              <span>
                <b>500+</b> race finishes by my athletes
              </span>
              <span>
                <b>300+</b> runners in my intensive
              </span>
            </div>
            <div className="after-cta">
              <span className="d">&#8594;</span>
              <span>
                Fill in a short form. I read it and send you a payment link in
                Instagram DM within 24 hours.
              </span>
            </div>
          </div>

          <div className={`hero-photo${hasHeroPhoto ? " has-photo" : ""}`}>
            {hasHeroPhoto ? (
              <Image
                src="/intensive/hero.jpg"
                alt="Igor, running coach"
                width={600}
                height={750}
                priority
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "50% 30%",
                }}
              />
            ) : (
              <span>[ photo ]</span>
            )}
          </div>
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">What it is</span>
            <h2>What you get in the trial week</h2>
          </div>
          <div className="grid g2">
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                A running plan for <b>your level and your goal</b>
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                Technique and strength exercises, <b>with video</b>
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                Support and <b>feedback on every run</b>
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>Answers to all your questions</p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                You learn to train{" "}
                <b>with a clear purpose and get results</b>
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#128204;</span>
              <p>
                It works even if you have only run{" "}
                <b>a couple of times</b>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* NUMBERS */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Numbers</span>
            <h2>Results so far</h2>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="v">
                <span className="u">300+</span>
              </div>
              <div className="k">runners have done my running intensive</div>
            </div>
            <div className="stat">
              <div className="v">
                <span className="u">50+</span>
              </div>
              <div className="k">ran 10 km for the first time</div>
            </div>
            <div className="stat">
              <div className="v">
                <span className="u">10</span>
              </div>
              <div className="k">years of coaching</div>
            </div>
            <div className="stat">
              <div className="v">
                <span className="u">500+</span>
              </div>
              <div className="k">race finishes by my athletes</div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Format</span>
            <h2>How it works</h2>
          </div>
          <div className="steps">
            <div className="stp">
              <span className="n">01</span>
              <p>
                <b>7 days with a clear structure.</b> Every day is planned.
              </p>
            </div>
            <div className="stp">
              <span className="n">02</span>
              <p>
                <b>You get the plan on WhatsApp, in advance.</b> You always
                know what to do.
              </p>
            </div>
            <div className="stp">
              <span className="n">03</span>
              <p>
                <b>You send your report on WhatsApp,</b> I send feedback on the
                workout.
              </p>
            </div>
            <div className="stp">
              <span className="n">04</span>
              <p>
                <b>We talk 1:1 on WhatsApp:</b> support, motivation, answers
                and useful tips.
              </p>
            </div>
            <div className="stp">
              <span className="n">05</span>
              <p>
                <b>At the end of the week</b> I tell you what to do next for
                your goal.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WORKOUT EXAMPLES */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">What the plan looks like</span>
            <h2>Workout examples</h2>
            <p>
              Every workout is written out: structure, pace and goal. You
              don&apos;t have to guess anything.
            </p>
          </div>
          <Carousel trackClassName="w-workouts" hint="&larr; swipe &rarr;">
            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#128694;</span> Test run
                </span>
                <span className="m">45 min</span>
              </div>
              <div className="wc-bar">
                <div className="wc-seg easy" style={{ flex: 1 }}>
                  easy zone 1-2
                </div>
              </div>
              <div className="wc-rows">
                <div className="wc-row">
                  <span className="pc">by feel</span>
                  <span className="tx">
                    <b>45 minutes</b> at a steady, comfortable pace
                  </span>
                </div>
                <div className="wc-row">
                  <span className="pc">breathing</span>
                  <span className="tx">
                    even, you can speak in full sentences
                  </span>
                </div>
              </div>
              <div className="wc-note">
                Goal: find your easy running zone. It is the base for zone 1-2
                workouts.
              </div>
            </div>

            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#9201;</span> Intervals
                </span>
                <span className="m">5 × 5 min</span>
              </div>
              <div className="wc-bar">
                <div className="wc-seg warm">warm-up</div>
                <div className="wc-seg main">
                  <span>5 × 5 min</span>
                </div>
                <div className="wc-seg cool">cool-down</div>
              </div>
              <div className="wc-rows">
                <div className="wc-row">
                  <span className="pc">4:55-5:15/km</span>
                  <span className="tx">
                    <b>5 × 5 minutes</b> at a steady pace (effort 7 out of 10)
                  </span>
                </div>
                <div className="wc-row">
                  <span className="pc">7:00/km or slower</span>
                  <span className="tx">
                    1:30 of very easy running between reps
                  </span>
                </div>
              </div>
              <div className="wc-note">
                All 5 reps are equal in quality and effort. This is not your
                max. You keep something in reserve.
              </div>
            </div>

            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#127939;</span> Steady run
                </span>
                <span className="m">40 min · Wednesday</span>
              </div>
              <div className="wc-bar">
                <div className="wc-seg easy" style={{ flex: 1 }}>
                  steady pace
                </div>
              </div>
              <div className="wc-rows">
                <div className="wc-row">
                  <span className="pc">6:45-7:00/km</span>
                  <span className="tx">
                    <b>40 minutes</b> of steady running
                  </span>
                </div>
              </div>
              <div className="wc-note">
                We build your base and keep your overall volume.
              </div>
            </div>

            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#9889;</span> Activation
                </span>
                <span className="m">Friday</span>
              </div>
              <div className="wc-bar">
                <div className="wc-seg easy">easy</div>
                <div className="wc-seg tempo">5K pace</div>
                <div className="wc-seg easy">easy</div>
              </div>
              <div className="wc-rows">
                <div className="wc-row">
                  <span className="pc">warm-up</span>
                  <span className="tx">10 minutes of easy running</span>
                </div>
                <div className="wc-row">
                  <span className="pc">5K pace</span>
                  <span className="tx">
                    <b>3 minutes</b> at your 5K race pace: hard, but in control
                  </span>
                </div>
                <div className="wc-row">
                  <span className="pc">cool-down</span>
                  <span className="tx">10 minutes of easy running</span>
                </div>
              </div>
              <div className="wc-note">
                Goal: wake up your body and switch on speed and technique.
              </div>
            </div>

            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#128170;</span> Strength after a run
                </span>
                <span className="m">Wed · Sun</span>
              </div>
              <div className="wc-rows" style={{ marginTop: "2px" }}>
                <div className="wc-row">
                  <span className="pc">3 × 12-15</span>
                  <span className="tx">
                    <b>Bulgarian split squat</b> on each leg
                  </span>
                </div>
                <div className="wc-row">
                  <span className="pc">3 × 12-15</span>
                  <span className="tx">
                    <b>Standing calf raise</b> on each leg
                  </span>
                </div>
              </div>
              <div className="wc-note">
                We make your legs, glutes and core stronger for stable running.
                Every exercise has a video.
              </div>
            </div>
          </Carousel>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Who it&apos;s for</span>
            <h2>It&apos;s for you if</h2>
          </div>
          <div className="grid g2">
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>You want to start running but don&apos;t know how</p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>You run at random, without a system</p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>You already train but don&apos;t see progress</p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>You want to try working with me</p>
            </div>
          </div>
        </div>
      </section>

      {/* REVIEWS */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Reviews</span>
            <h2>What runners say</h2>
            <p>Real messages from runners of my Russian program.</p>
            <span className="tr-note">Translated from Russian</span>
          </div>
          <Carousel trackClassName="w-rev-en" hint="&larr; swipe &rarr;">
            {TRIAL_REVIEWS.map((review) => (
              <div className="slide rev-en" key={review.img}>
                <div className="rev-name">{review.name}</div>
                <div className="rev-text">
                  {review.text.map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                </div>
                <div className="rev-foot">Translated from Russian</div>
                <details className="rev-orig">
                  <summary>Show original screenshot</summary>
                  <img
                    src={review.img}
                    width={review.width}
                    height={review.height}
                    alt={`Original review by ${review.name}, in Russian`}
                    loading="lazy"
                  />
                </details>
              </div>
            ))}
          </Carousel>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">FAQ</span>
            <h2>Common questions</h2>
          </div>
          <div className="faq">
            {FAQ.map((item) => (
              <details className="q" key={item.q}>
                <summary>{item.q}</summary>
                <div className="a">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* WHAT STAYS WITH YOU */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">After the week</span>
            <h2>What stays with you</h2>
            <p>
              The trial lasts 7 days. What you learn keeps working after it.
            </p>
          </div>
          <div className="grid g2">
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                <b>You know how to keep training</b> on your own, without
                guessing
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                <b>How training works:</b> how a week is built and why each
                workout matters
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                <b>How heart rate zones work</b> and how to run at your own
                pace
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                <b>All guides and materials</b> stay with you
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHEN AND HOW + PRICE */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">When and how</span>
            <h2>How to join</h2>
          </div>
          <div className="band" style={{ marginBottom: "30px" }}>
            <div className="bandi">
              <div className="v">Start any day</div>
              <div className="k">no waiting, we start when you are ready</div>
            </div>
            <div className="bandi">
              <div className="v">Personal</div>
              <div className="k">the plan is made only for you</div>
            </div>
            <div className="bandi">
              <div className="v">1:1 on WhatsApp</div>
              <div className="k">I coach you myself</div>
            </div>
          </div>
          <div className="steps" style={{ marginBottom: "30px" }}>
            <div className="stp">
              <span className="n">01</span>
              <p>
                <b>Fill in the form.</b> Your goal, your running now, your
                health.
              </p>
            </div>
            <div className="stp">
              <span className="n">02</span>
              <p>
                <b>I send you a payment link</b> in Instagram DM within 24
                hours.
              </p>
            </div>
            <div className="stp">
              <span className="n">03</span>
              <p>
                <b>You pay {PRICE}.</b> Then we talk 1:1 on WhatsApp: you get
                your plan there and send your reports there.
              </p>
            </div>
          </div>
          <div className="price">
            <div>
              <div
                className="eyebrow"
                style={{ color: "rgba(255,255,255,.55)", marginBottom: "10px" }}
              >
                Price
              </div>
              <div className="big">
                {PRICE} <span>· 7 days</span>
              </div>
            </div>
            <ul className="price-stack">
              <li>
                <span className="c">&#10003;</span>A personal running plan for 7
                days
              </li>
              <li>
                <span className="c">&#10003;</span>Technique and strength, with
                video
              </li>
              <li>
                <span className="c">&#10003;</span>Feedback on every run
              </li>
              <li>
                <span className="c">&#10003;</span>Support and answers to your
                questions
              </li>
              <li>
                <span className="c">&#10003;</span>A system you keep after the
                week
              </li>
            </ul>
          </div>
          <div className="next-step">
            <div className="ns-t">After the week</div>
            <p>
              I tell you what to do next for your goal. If you want to keep
              going with me, there is 1:1 coaching for {COACHING_PRICE} a month.
              You can cancel any time.
            </p>
            <a href="/coaching" className="ns-link">
              About 1:1 coaching <span aria-hidden="true">&rarr;</span>
            </a>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section>
        <div className="wrap">
          <div className="final">
            <span className="urg">1:1. I coach you myself.</span>
            <h2>Want to run the right way and get better results?</h2>
            <p>
              Apply now. I read every form myself and reply in Instagram DM
              within 24 hours.
            </p>
            <a href={APPLY} className="btn btn--lg">
              Apply for the trial week
            </a>
          </div>
        </div>
      </section>

      {/* LINKS */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div
            className="head"
            style={{ textAlign: "center", margin: "0 auto 28px" }}
          >
            <span className="eyebrow">Also from me</span>
          </div>
          <div className="links">
            <a className="linkbtn" href="/coaching">
              <span className="ic">&#127939;</span>1:1 online coaching
              <span className="ar">&rarr;</span>
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="wrap">
          <div>© 2026 · Igor · 7-day running trial</div>
          <div>
            <a href="https://instagram.com/runnigor">Instagram</a> ·{" "}
            <a href="/coaching">Coaching</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
