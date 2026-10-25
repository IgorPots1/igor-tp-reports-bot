import Image from "next/image";

import HtmlLang from "../coaching/HtmlLang";
import { jetbrains, onest } from "@/lib/fonts";
import { REVIEW_PRICES, reviewWhatsappHref, type ReviewVariant } from "@/features/review-offer/variants";
import "./review.css";

// Paid Strava breakdown landing (@runnigor, US price test). Same page for both prices:
// /review/a = $5, /review/b = $10. Only real results of Igor's 1:1 athletes are shown,
// and the sample breakdown is labelled as a made-up runner. No invented reviews.

const RESULTS: { img: string; big: string; sub: string }[] = [
  { img: "/landing/05-result-nadya.jpg", big: "1:52 → 1:44", sub: "Half marathon, 8 minutes faster" },
  { img: "/landing/06-result-2-10-to-1-52-en.jpg", big: "2:10 → 1:52", sub: "Half marathon, 18 minutes faster" },
  { img: "/landing/07-result-2-16-to-1-50-en.jpg", big: "2:16 → 1:50", sub: "Half marathon, 26 minutes faster" },
  { img: "/landing/11-result-capcity-1-51-47-en.jpg", big: "1:51:47", sub: "Half marathon in the USA, 15 minutes faster" },
  { img: "/landing/09-result-sochi-marathon-en.jpg", big: "4:21", sub: "First marathon" },
  { img: "/landing/10-result-10k-47-43-en.jpg", big: "47:43", sub: "New 10K PR" },
];

const LOOK: { t: string; d: string }[] = [
  { t: "A year of your training", d: "How often you really run, your weekly miles, and where the breaks and jumps were." },
  { t: "Easy vs hard", d: "Are your easy days easy? Many runners do almost every run at the same medium effort." },
  { t: "Your long runs", d: "How long, how often, and how they changed before your races." },
  { t: "Your recent runs and your goal", d: "What your last weeks say about the race or time you want." },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is this a training plan?",
    a: "No. It's a look at what you've already done and the one change that will help most. You'll know what to do with your easy days, your hard days and your long run.",
  },
  {
    q: "Do I need Strava premium?",
    a: "No. A free account is enough. Your runs need to be visible to me, and I'll tell you how in one step.",
  },
  {
    q: "I only started running. Is it worth it?",
    a: "Yes. A few months of runs is enough to see your habits. It's easier to fix them now than after a year.",
  },
  {
    q: "How do I pay?",
    a: "Tap the button. It opens WhatsApp with a message ready to send. I'll reply with a payment link and a few quick questions about your goal.",
  },
];

export default function ReviewLanding({ variant }: { variant: ReviewVariant }) {
  const price = REVIEW_PRICES[variant];
  const wa = reviewWhatsappHref(variant);
  const cta = `Get my breakdown for $${price}`;

  return (
    <div className={`rv-root ${onest.variable} ${jetbrains.variable}`}>
      <HtmlLang lang="en" />

      <header>
        <div className="wrap hbar">
          <div className="who">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="ava" src="/landing/01-hero.jpg" alt="" />
            Igor · running coach
          </div>
          <a className="mini-btn" href={wa}>${price}</a>
        </div>
      </header>

      <main>
        <section className="hero wrap">
          <div className="eyebrow">Personal Strava breakdown</div>
          <h1>
            Your Strava already knows <span className="hl">why you&apos;re not getting faster</span>
          </h1>
          <p className="lede">
            I go through a year of your runs and tell you the one thing to change. You get it in writing within 24 hours.
          </p>
          <div className="price-card">
            <div className="price-row">
              <div className="price">${price}</div>
              <div className="price-note">one time<br />no subscription</div>
            </div>
            <a className="btn" href={wa}>{cta}</a>
            <div className="btn-note">Opens WhatsApp with a ready message</div>
          </div>
          <div className="trust">
            <span>10 years coaching</span>
            <span>500+ races finished by my runners</span>
          </div>
        </section>

        <section className="wrap block">
          <h2>What I look at</h2>
          <div className="look">
            {LOOK.map((l, i) => (
              <div className="look-i" key={l.t}>
                <div className="n">{String(i + 1).padStart(2, "0")}</div>
                <div>
                  <b>{l.t}</b>
                  <p>{l.d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="wrap block">
          <h2>What you get</h2>
          <ul className="get">
            <li><i>✓</i>The one main thing holding you back, shown on your own runs</li>
            <li><i>✓</i>What to keep, because it already works</li>
            <li><i>✓</i>How to run your easy days, hard days and long run from now on</li>
            <li><i>✓</i>A short written breakdown you can come back to</li>
          </ul>
        </section>

        <section className="wrap block">
          <h2>This is what it looks like</h2>
          <div className="sample">
            <div className="sample-tag">Sample for a made-up runner</div>
            <div className="sample-head">
              <div>
                <div className="s-name">Alex, 34</div>
                <div className="s-goal">Goal: half marathon under 2:00</div>
              </div>
              <div className="s-runs">212 runs<br />in a year</div>
            </div>
            <div className="s-bars" aria-hidden="true">
              {[62, 64, 63, 65, 61, 64, 63, 66, 62, 64, 65, 63].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="s-cap">Pace of every run: almost all at 9:40 to 10:00 per mile</div>
            <div className="s-main">
              <div className="s-lab">Main thing to change</div>
              <p>
                Almost every run is at the same medium effort. Your easy days are too hard to recover from, so your hard days are never really hard.
              </p>
            </div>
            <div className="s-do">
              <div className="s-lab">What to do</div>
              <p>
                Slow your easy runs down to a pace where you can talk in full sentences. Keep one harder run a week. Your long run stays easy.
              </p>
            </div>
          </div>
        </section>

        <section className="block">
          <div className="wrap">
            <h2>Results of runners I coach</h2>
            <p className="sub">Real athletes who train with me 1:1. The breakdown is where that work starts.</p>
          </div>
          <div className="cases">
            {RESULTS.map((r) => (
              <div className="case" key={r.img}>
                <Image src={r.img} alt={r.sub} width={300} height={375} loading="lazy" />
                <div className="case-cap">
                  <b>{r.big}</b>
                  <span>{r.sub}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="wrap swipe">swipe →</div>
        </section>

        <section className="wrap block">
          <h2>How it works</h2>
          <ol className="steps">
            <li><span><b>Tap the button.</b> WhatsApp opens with a message ready to send.</span></li>
            <li><span><b>Pay ${price}.</b> I send you a payment link.</span></li>
            <li><span><b>Send your Strava link</b> and answer a few quick questions about your goal.</span></li>
            <li><span><b>Get your breakdown</b> within 24 hours.</span></li>
          </ol>
        </section>

        <section className="wrap block about">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing/01-hero.jpg" alt="Igor, running coach" />
          <div>
            <h2>Who&apos;s looking at your runs</h2>
            <p>
              I&apos;m Igor, a running coach. I&apos;ve coached runners for 10 years, from first 5Ks to marathons, and my runners have finished more than 500 races. I check every breakdown myself before it goes to you.
            </p>
          </div>
        </section>

        <section className="wrap block">
          <h2>Questions</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="wrap final">
          <h2>Find out what your runs are telling you</h2>
          <a className="btn" href={wa}>{cta}</a>
          <div className="btn-note">One time. Written breakdown within 24 hours.</div>
        </section>
      </main>

      <div className="sticky">
        <a className="btn" href={wa}>{cta}</a>
      </div>
    </div>
  );
}
