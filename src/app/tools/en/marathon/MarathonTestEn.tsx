"use client";

import { useRef, useState } from "react";

import ConsultNoticeEn from "@/components/ConsultNoticeEn";
import TimeFields, { EMPTY_TIME, joinTime, type TimeParts } from "@/components/TimeFields";

import { formatTime, paceOf, parseTime, resultLooksReal, type Answers, type Plan } from "../../marathon/marathon-logic";
import { buildPlanEn, dayMonthEn, monthYearEn } from "./marathon-logic-en";
import styles from "../../marathon/marathon.module.css";

type Option = { id: string; label: string };
type Question = {
  key: keyof Answers;
  q: string;
  hint?: string;
  options?: Option[];
  input?: true;
};

const QUESTIONS: Question[] = [
  {
    key: "exp",
    q: "How long have you been running regularly?",
    hint: "At least 2-3 times a week, without long breaks.",
    options: [
      { id: "lt6", label: "Less than 6 months" },
      { id: "6to12", label: "6 months to a year" },
      { id: "1to2", label: "1-2 years" },
      { id: "2p", label: "More than 2 years" },
    ],
  },
  {
    key: "km",
    q: "How many km a week do you run now?",
    hint: "On average over the last month.",
    options: [
      { id: "lt20", label: "Under 20 km" },
      { id: "20to30", label: "20-30 km" },
      { id: "30to45", label: "30-45 km" },
      { id: "45p", label: "More than 45 km" },
    ],
  },
  {
    key: "runs",
    q: "How many runs a week?",
    options: [
      { id: "1to2", label: "1-2" },
      { id: "3", label: "3" },
      { id: "4", label: "4" },
      { id: "5p", label: "5 or more" },
    ],
  },
  {
    key: "long",
    q: "Your longest run in the last month?",
    options: [
      { id: "lt10", label: "Under 10 km" },
      { id: "10to15", label: "10-15 km" },
      { id: "15to21", label: "15-21 km" },
      { id: "21p", label: "More than 21 km" },
    ],
  },
  {
    key: "pain",
    q: "Do you get pain or discomfort after running?",
    options: [
      { id: "no", label: "No" },
      { id: "some", label: "Sometimes, after long or fast runs" },
      { id: "often", label: "Yes, regularly" },
    ],
  },
  {
    key: "race",
    q: "When is the marathon you have in mind?",
    options: [
      { id: "none", label: "Not chosen yet" },
      { id: "lt3", label: "In less than 3 months" },
      { id: "3to4", label: "In 3-4 months" },
      { id: "4to6", label: "In 4-6 months" },
      { id: "6p", label: "In more than 6 months" },
    ],
  },
  {
    key: "resTime",
    q: "Your best result in the last year",
    hint: "We use it to estimate your marathon time. You can skip it.",
    input: true,
  },
];

type Screen = "intro" | "quiz" | "result";

export default function MarathonTestEn() {
  const [screen, setScreen] = useState<Screen>("intro");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [dist, setDist] = useState("10");
  const [time, setTime] = useState<TimeParts>(EMPTY_TIME);
  const [err, setErr] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [shared, setShared] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  function focusHeading() {
    window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 0);
    window.scrollTo(0, 0);
  }

  function pick(key: keyof Answers, id: string) {
    setAnswers((a) => ({ ...a, [key]: id }));
    window.setTimeout(() => {
      setStep((s) => Math.min(s + 1, QUESTIONS.length - 1));
      focusHeading();
    }, 160);
  }

  function finish() {
    const raw = joinTime(time);
    const next: Answers = { ...answers, resTime: null, resDist: null };
    if (raw) {
      const t = parseTime(raw);
      const d = Number.parseFloat(dist);
      if (t === null || !resultLooksReal(d, t)) {
        setErr(d === 10 ? "Enter a 10K time, for example 52:30" : "Enter a half marathon time, for example 1:55:00");
        return;
      }
      next.resTime = t;
      next.resDist = d;
    }
    setErr("");
    setAnswers(next);
    setPlan(buildPlanEn(next));
    setScreen("result");
    focusHeading();
  }

  function back() {
    if (step === 0) {
      setScreen("intro");
      return;
    }
    setStep((s) => s - 1);
    focusHeading();
  }

  function restart() {
    setAnswers({});
    setPlan(null);
    setStep(0);
    setTime(EMPTY_TIME);
    setDist("10");
    setErr("");
    setShared(false);
    setScreen("intro");
    window.scrollTo(0, 0);
  }

  async function share() {
    if (!plan) return;
    const url = window.location.href.split("#")[0];
    if (navigator.share) {
      try {
        await navigator.share({ title: "Is it time to train for a marathon?", text: plan.shareText, url });
      } catch {
        /* the person closed the share sheet, not an error */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${plan.shareText} ${url}`);
      setShared(true);
    } catch {
      /* no clipboard: the button just does nothing */
    }
  }

  if (screen === "intro") {
    return (
      <div className={styles.wrap} lang="en">
        <h1 className={styles.h1} ref={headingRef} tabIndex={-1}>
          Is it time to train for a marathon?
        </h1>
        <p className={styles.lede}>
          Seven short questions. At the end you&apos;ll know from which month a marathon is realistic for you, what to work
          on before the build, and what time to expect.
        </p>
        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            setStep(0);
            setScreen("quiz");
            focusHeading();
          }}
        >
          Take the test
        </button>
        <p className={styles.facts}>
          <span>
            <b className={styles.mono}>1</b> minute
          </span>
          <span>
            <b className={styles.mono}>7</b> questions
          </span>
          <span>no sign-up</span>
        </p>
      </div>
    );
  }

  if (screen === "quiz") {
    const q = QUESTIONS[step];
    return (
      <div className={styles.wrap} lang="en">
        <div className={styles.progress} aria-hidden="true">
          <i style={{ width: `${(step / QUESTIONS.length) * 100}%` }} />
        </div>
        <p className={styles.step}>
          Question {step + 1} of {QUESTIONS.length}
        </p>
        <h1 className={styles.q} ref={headingRef} tabIndex={-1}>
          {q.q}
        </h1>
        {q.hint ? <p className={styles.hint}>{q.hint}</p> : null}

        {q.options ? (
          <div className={styles.opts} role="group" aria-label={q.q}>
            {q.options.map((o) => (
              <button
                key={o.id}
                type="button"
                className={styles.opt}
                aria-pressed={answers[q.key] === o.id}
                onClick={() => pick(q.key, o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.resinput}>
            <div className={styles.resrow}>
              <div>
                <label className={styles.lbl} htmlFor="marathon-dist">
                  Distance
                </label>
                <select id="marathon-dist" className={styles.select} value={dist} onChange={(e) => setDist(e.target.value)}>
                  <option value="10">10K</option>
                  <option value="21.0975">Half marathon</option>
                </select>
              </div>
              <div>
                <p className={styles.lbl}>Time</p>
                <TimeFields
                  idPrefix="marathon-time"
                  label="Result time"
                  lang="en"
                  value={time}
                  onChange={(next) => {
                    setTime(next);
                    setErr("");
                  }}
                />
              </div>
            </div>
            <p className={styles.err} aria-live="polite">
              {err}
            </p>
          </div>
        )}

        <div className={styles.nav}>
          <button type="button" className={styles.link} onClick={back}>
            {step === 0 ? "Back to start" : "Back"}
          </button>
          {q.input ? (
            <button type="button" className={styles.btn} onClick={finish}>
              Show my result
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!plan) return null;

  const vClass = plan.verdictClass === "ok" ? styles.vOk : plan.verdictClass === "mid" ? styles.vMid : styles.vNo;

  return (
    <div className={styles.wrap} lang="en">
      <h1 className={`${styles.verdict} ${vClass}`} ref={headingRef} tabIndex={-1}>
        {plan.verdict}
      </h1>
      <p className={styles.vsub}>{plan.sub}</p>

      <div className={styles.when}>
        <h2 className={styles.h2}>Your most realistic marathon</h2>
        <p className={`${styles.date} ${styles.mono}`}>{plan.date ? monthYearEn(plan.date) : "after recovery"}</p>
        <div className={styles.bar} role="img" aria-label={`Base ${plan.base} weeks, build ${plan.prep} weeks`}>
          <span className={styles.barBase} style={{ width: `${(plan.base / plan.total) * 100}%` }} />
          <span className={styles.barPrep} style={{ width: `${(plan.prep / plan.total) * 100}%` }} />
        </div>
        <p className={styles.legend}>
          <span>
            <i className={styles.key} style={{ background: "var(--line-2)" }} />
            {plan.base ? `base ${plan.base} wk` : "base already there"}
          </span>
          <span>
            <i className={styles.key} style={{ background: "var(--accent)" }} />
            build {plan.prep} wk
          </span>
        </p>
        {plan.stop ? null : (
          <p className={styles.phases}>
            {plan.baseEnd ? (
              <>
                Base until <b>{dayMonthEn(plan.baseEnd)}</b>, then 4-5 months of marathon training.
              </>
            ) : (
              <>
                You can start your build <b>right now</b>.
              </>
            )}
          </p>
        )}
        {plan.raceNote ? <p className={styles.warnbox}>{plan.raceNote}</p> : null}
        {plan.stop ? null : (
          <p className={styles.calLink}>
            <a href="/tools/en/calendar">Work out your training dates</a>
          </p>
        )}
      </div>

      <div className={styles.sec}>
        <h2 className={styles.h2}>What you have and what to work on</h2>
        <ul className={styles.checks}>
          {plan.checks.map((c) => (
            <li key={c.title}>
              <span
                className={`${styles.mark} ${c.mark === "y" ? styles.mY : c.mark === "w" ? styles.mW : styles.mN}`}
                aria-hidden="true"
              >
                {c.mark === "y" ? "✓" : c.mark === "w" ? "!" : "✕"}
              </span>
              <div>
                <b>{c.title}</b>
                <span>{c.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {plan.forecast ? (
        <div className={styles.sec}>
          <h2 className={styles.h2}>A guide for your first marathon</h2>
          <div className={styles.forecast}>
            <p className={`${styles.forecastT} ${styles.mono}`}>
              {formatTime(plan.forecast.lo)}-{formatTime(plan.forecast.hi)}
            </p>
            <p>
              About {paceOf(plan.forecast.lo)}-{paceOf(plan.forecast.hi)} per km. This is a guide after a full build, not a
              promise. In your first marathon, start at the slower end and speed up in the second half.
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.sec}>
        <h2 className={styles.h2}>What to do this week</h2>
        <div className={styles.next}>
          <p>{plan.nextStep}</p>
        </div>
      </div>

      <button type="button" className={styles.share} onClick={share}>
        {shared ? "Link copied" : "Share my result"}
      </button>

      <ConsultNoticeEn tool="en-marathon" prefill="Hi Igor! I took your marathon readiness test and I'd like a free consultation" />
      <p className={styles.planLink}>
        Your training paces: <a href="/tools/en/plan">igorp.run/tools/en/plan</a>
      </p>

      <p>
        <button type="button" className={styles.link} onClick={restart}>
          Take it again
        </button>
      </p>

      <p className={styles.foot}>This is a guide, not a diagnosis. If something hurts, see a specialist first.</p>
    </div>
  );
}
