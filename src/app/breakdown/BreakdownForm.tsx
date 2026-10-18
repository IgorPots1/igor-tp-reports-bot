"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { stravaLinkOk } from "@/features/breakdown/strava-link";

// 6 questions, one per screen. Tap answers move on by themselves; text answers
// have a Next button. ChatPlace opens this page with ?c=<client id>, which is how
// the answers get matched to the Instagram chat. Without it we ask for the @handle.

type Answers = {
  goal_type: string;
  goal_details: string;
  runs_week: string;
  age: string;
  best_recent: string;
  injury: string;
  injury_details: string;
  hr_strap: string;
  strava_link: string;
  instagram: string;
  website: string; // honeypot
};

const EMPTY: Answers = {
  goal_type: "", goal_details: "", runs_week: "", age: "", best_recent: "",
  injury: "", injury_details: "", hr_strap: "", strava_link: "", instagram: "", website: "",
};

const QUESTIONS = 6;
const DM_URL = "https://ig.me/m/runnigor";

type Opt = { v: string; em: string; title: string; sub?: string };

const GOALS: Opt[] = [
  { v: "5K or 10K", em: "⚡", title: "5K or 10K", sub: "Faster or first time" },
  { v: "Half or marathon", em: "🏁", title: "Half or marathon", sub: "21.1 or 42.2 km" },
  { v: "No race yet", em: "🌱", title: "No race yet", sub: "Just want to get better" },
];
const RUNS: Opt[] = [
  { v: "0-1", em: "", title: "0-1" },
  { v: "2-3", em: "", title: "2-3" },
  { v: "4-5", em: "", title: "4-5" },
  { v: "6+", em: "", title: "6+" },
];
const INJURY: Opt[] = [
  { v: "none", em: "💪", title: "No, all good" },
  { v: "right now", em: "🩹", title: "Yes, right now" },
  { v: "healed", em: "✅", title: "Yes, but it's healed" },
];
const STRAP: Opt[] = [
  { v: "always", em: "❤️", title: "Yes, always" },
  { v: "sometimes", em: "🔁", title: "Sometimes" },
  { v: "wrist only", em: "⌚", title: "No, watch on the wrist" },
];

export default function BreakdownForm() {
  const params = useSearchParams();
  const clientId = (params.get("c") ?? "").replace(/[^\w-]/gu, "").slice(0, 64);
  const [step, setStep] = useState(0); // 0 intro, 1..6 questions, 7 done
  const [a, setA] = useState<Answers>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [fail, setFail] = useState("");

  const set = (k: keyof Answers, v: string) => setA((p) => ({ ...p, [k]: v }));
  const next = () => { setTouched(false); setStep((s) => s + 1); window.scrollTo(0, 0); };
  const back = () => { setTouched(false); setStep((s) => Math.max(0, s - 1)); };
  const tap = (k: keyof Answers, v: string, advance = true) => {
    set(k, v);
    try { navigator.vibrate?.(8); } catch { /* no haptics */ }
    if (advance) setTimeout(next, 220);
  };

  const linkOk = stravaLinkOk(a.strava_link);
  const handleOk = clientId !== "" || a.instagram.trim().replace(/^@/u, "").length >= 2;

  const canNext: Record<number, boolean> = {
    1: a.goal_type !== "",
    2: a.runs_week !== "",
    3: true,
    4: a.injury !== "" && (a.injury === "none" || a.injury_details.trim() !== ""),
    5: a.hr_strap !== "",
    6: linkOk && handleOk,
  };

  async function send() {
    setTouched(true);
    if (!canNext[6]) return;
    setSending(true);
    setFail("");
    try {
      const res = await fetch("/api/breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...a, c: clientId }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) { setStep(7); window.scrollTo(0, 0); }
      else if (j.error === "strava_link") setFail("That doesn't look like a Strava link. Copy it from the Strava app: You → Share → Copy link.");
      else setFail("Something went wrong on my side. Please try again in a minute, or send me the link in the DM.");
    } catch {
      setFail("No connection. Check your internet and tap Send again.");
    } finally {
      setSending(false);
    }
  }

  const Options = ({ k, opts, cls, advance = true }: { k: keyof Answers; opts: Opt[]; cls?: string; advance?: boolean }) => (
    <div className={`opts ${cls ?? ""}`}>
      {opts.map((o) => (
        <button type="button" key={o.v} className={`opt ${a[k] === o.v ? "sel" : ""}`} onClick={() => tap(k, o.v, advance)}>
          {o.em && <span className="em">{o.em}</span>}
          <span className="tx"><b>{o.title}</b>{o.sub && <span>{o.sub}</span>}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <header>
        <div className="wrap">
          <div className="hbar">
            <div className="who">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="ava" src="/landing/01-hero.jpg" alt="" />
              Igor · running coach
            </div>
            {step >= 1 && step <= QUESTIONS && <div className="count">{step} / {QUESTIONS}</div>}
          </div>
          {step >= 1 && step <= QUESTIONS && (
            <div className="prog">{Array.from({ length: QUESTIONS }, (_, i) => <i key={i} className={i < step ? "on" : ""} />)}</div>
          )}
        </div>
      </header>

      <main>
        <div className="wrap">
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={a.website} onChange={(e) => set("website", e.target.value)} />

          {step === 0 && (
            <section className="step">
              <div className="eyebrow">Free Strava breakdown</div>
              <h1>I&apos;ll go through your Strava myself</h1>
              <div className="intro">
                <div><i>1</i>What&apos;s holding you back</div>
                <div><i>2</i>Your heart rate and pace zones</div>
                <div><i>3</i>Your training week and 3 fixes, in order</div>
                <div><i>4</i>An honest answer: is your goal realistic</div>
              </div>
              <span className="free">FREE · 6 QUESTIONS · 1 MINUTE</span>
              <p className="cred">10 years coaching, 500+ races finished by my athletes.</p>
            </section>
          )}

          {step === 1 && (
            <section className="step" key="s1">
              <div className="eyebrow">Your goal</div>
              <h1>What are you training for?</h1>
              <p className="lede">Pick one.</p>
              <Options k="goal_type" opts={GOALS} advance={false} />
              {a.goal_type && (
                <div className="f">
                  <label htmlFor="gd">Race, date and target time</label>
                  <input id="gd" type="text" value={a.goal_details} onChange={(e) => set("goal_details", e.target.value)}
                    placeholder={a.goal_type === "No race yet" ? "e.g. run 10K without stopping" : "e.g. 10K, January, under 55:00"} />
                  <div className="hint">Optional, but it helps me answer if your goal is realistic.</div>
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section className="step" key="s2">
              <div className="eyebrow">Right now</div>
              <h1>How many runs a week?</h1>
              <p className="lede">A normal week, not your best one.</p>
              <Options k="runs_week" opts={RUNS} cls="grid4" />
            </section>
          )}

          {step === 3 && (
            <section className="step" key="s3">
              <div className="eyebrow">About you</div>
              <h1>Your age and best recent race</h1>
              <div className="f">
                <label htmlFor="age">Age</label>
                <input id="age" type="number" inputMode="numeric" value={a.age} onChange={(e) => set("age", e.target.value.slice(0, 2))} placeholder="34" />
              </div>
              <div className="f">
                <label htmlFor="best">Best race in the last year</label>
                <input id="best" type="text" value={a.best_recent} onChange={(e) => set("best_recent", e.target.value)} placeholder="e.g. 10K in 52:10" />
                <div className="hint">No race yet? Leave it empty.</div>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="step" key="s4">
              <div className="eyebrow">Health</div>
              <h1>Any pain or injuries in the last year?</h1>
              <p className="lede">So I don&apos;t give you a plan that makes it worse.</p>
              <Options k="injury" opts={INJURY} advance={false} />
              {a.injury && a.injury !== "none" && (
                <div className={`f ${touched && !a.injury_details.trim() ? "bad" : ""}`}>
                  <label htmlFor="inj">What and where?</label>
                  <input id="inj" type="text" value={a.injury_details} onChange={(e) => set("injury_details", e.target.value)} placeholder="e.g. shin splints, left leg, since August" />
                </div>
              )}
            </section>
          )}

          {step === 5 && (
            <section className="step" key="s5">
              <div className="eyebrow">Heart rate</div>
              <h1>Do you run with a chest strap?</h1>
              <p className="lede">It tells me how much to trust your heart rate data.</p>
              <Options k="hr_strap" opts={STRAP} />
            </section>
          )}

          {step === 6 && (
            <section className="step" key="s6">
              <div className="eyebrow">Last step</div>
              <h1>Your Strava link</h1>
              <div className="how">
                <ol>
                  <li>Open the <b>Strava app</b></li>
                  <li>Tap <b>You</b>, then <b>Share</b> (top right)</li>
                  <li>Tap <b>Copy link</b> and paste it below</li>
                </ol>
              </div>
              <div className={`f ${touched && !linkOk ? "bad" : ""}`}>
                <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={a.strava_link}
                  onChange={(e) => set("strava_link", e.target.value)} placeholder="https://strava.app.link/..." />
                {a.strava_link && !linkOk && <div className="emsg">This should start with strava.com or strava.app.link</div>}
                {linkOk && <div className="ok-link">✓ Got it</div>}
              </div>
              <div className="warn"><i>!</i><span>In Strava settings, set your <b>profile and activities to Everyone</b>. Otherwise I can&apos;t see your runs.</span></div>
              {!clientId && (
                <div className={`f ${touched && !handleOk ? "bad" : ""}`}>
                  <label htmlFor="ig">Your Instagram</label>
                  <input id="ig" type="text" autoCapitalize="off" value={a.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="@yourname" />
                  <div className="hint">So I know where to send your breakdown.</div>
                </div>
              )}
              {fail && <div className="sendfail">{fail}</div>}
            </section>
          )}

          {step === 7 && (
            <section className="step done" key="s7">
              <div className="tick">✓</div>
              <h1>Got it, thank you!</h1>
              <p>I&apos;ll open your Strava and go through it myself.</p>
              <p>Your breakdown lands in your Instagram DMs within 12 hours. No call, no sales pitch.</p>
            </section>
          )}
        </div>
      </main>

      <div className="bar">
        <div className="wrap">
          {step === 0 && <button className="btn" onClick={next}>Let&apos;s go →</button>}
          {step >= 1 && step <= QUESTIONS && (
            <>
              <button className="btn ghost" onClick={back} aria-label="Back">←</button>
              {step < QUESTIONS ? (
                <button className="btn" disabled={!canNext[step]} onClick={() => { setTouched(true); if (canNext[step]) next(); }}>Next →</button>
              ) : (
                <button className="btn" disabled={sending} onClick={send}>{sending ? "Sending…" : "Send →"}</button>
              )}
            </>
          )}
          {step === 7 && <a className="btn" href={DM_URL}>Back to Instagram</a>}
        </div>
      </div>
    </>
  );
}
