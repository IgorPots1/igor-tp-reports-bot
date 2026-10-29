"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  GOALS,
  HEALTH_ITEMS,
  HEALTH_NONE_LABEL,
  LONGEST_RUN,
  QUALITY,
  RACE_DISTANCES,
  RETURN_LAST,
  RETURN_LEVEL,
  START_LONGEST,
  START_NOW,
  WEEKLY_KM,
  daysPerWeekOptions,
  patternLabelEn,
  patternsForRuns,
  stepsFor,
  type Answers,
  type Goal,
  type RaceDist,
  type Runs,
  type StepId,
} from "@/features/en-week/logic";
import { checkResult } from "@/features/en-week/paces";
import * as T from "@/features/en-week/texts";

import { Brand } from "./Shell";

// The goal drives the questions (the same branching as Igor's "AI running coach" onboarding,
// see stepsFor in logic.ts). One question per screen; a tap moves on by itself. Health: the
// tapped item stays in this component, only `health: true/false` goes to the server.

type Draft = Partial<Answers> & { result_time?: string; no_result?: boolean };
type Opt = { code: string; label: string; sub?: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** This month and the next 11, as "YYYY-MM". */
function nextMonths(): Array<{ code: string; label: string }> {
  const d = new Date();
  const out: Array<{ code: string; label: string }> = [];
  for (let i = 0; i < 12; i++) {
    const y = d.getFullYear() + Math.floor((d.getMonth() + i) / 12);
    const m = (d.getMonth() + i) % 12;
    out.push({ code: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${y}` });
  }
  return out;
}

export default function WeekForm() {
  const params = useSearchParams();
  const router = useRouter();
  const clientId = (params.get("c") ?? "").replace(/[^\w-]/gu, "").slice(0, 64);
  const username = (params.get("u") ?? "").slice(0, 64); // checked by the API
  const [pos, setPos] = useState(0); // 0 intro, then 1..steps.length
  const [a, setA] = useState<Draft>({});
  const [healthStop, setHealthStop] = useState(false);
  const [sending, setSending] = useState(false);
  const [fail, setFail] = useState("");
  const [resultError, setResultError] = useState("");
  const [website, setWebsite] = useState("");
  const headRef = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);
  const months = useMemo(nextMonths, []);

  const steps = stepsFor((a.goal as Goal | undefined) ?? null);
  const step: StepId | null = pos >= 1 && pos <= steps.length ? steps[pos - 1] : null;
  const runner = a.goal === "train_for_race";

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    fetch("/api/en-week/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "open", c: clientId }),
      keepalive: true,
    }).catch(() => undefined);
  }, [clientId]);

  // Move focus to the new question for screen readers and keyboards.
  useEffect(() => {
    if (pos > 0) headRef.current?.focus();
  }, [pos, healthStop]);

  const go = (n: number) => {
    setFail("");
    setResultError("");
    setPos(n);
    window.scrollTo(0, 0);
  };
  const next = () => go(pos + 1);
  const set = (patch: Draft) => setA((p) => ({ ...p, ...patch }));
  const tap = (patch: Draft) => {
    set(patch);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no haptics */
    }
    setTimeout(() => go(pos + 1), 200);
  };

  function chooseGoal(goal: Goal) {
    // A new goal starts its branch clean: no answers from another branch travel.
    setA({ goal });
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no haptics */
    }
    setTimeout(() => go(2), 200);
  }

  function confirmResult() {
    if (a.no_result) return next();
    if (!a.result_distance) return setResultError(T.RESULT_ERROR_FORMAT);
    const r = checkResult(a.result_distance, a.result_time ?? "");
    if (!r.ok) {
      const lbl = RACE_DISTANCES.find((d) => d.code === a.result_distance)!.label;
      return setResultError(r.error === "format" ? T.RESULT_ERROR_FORMAT : T.resultErrorRange(lbl));
    }
    set({ result_seconds: r.seconds });
    next();
  }

  async function submit(health: boolean) {
    if (sending) return;
    setSending(true);
    setFail("");
    let tz = "UTC";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      /* keep UTC */
    }
    const body = {
      c: clientId,
      u: username,
      goal: a.goal,
      start_now: a.start_now,
      start_longest: a.start_longest,
      return_last: a.return_last,
      return_level: a.return_level,
      race_distance: a.race_distance,
      race_month: a.race_month,
      result_distance: a.no_result ? null : a.result_distance,
      result_seconds: a.no_result ? null : a.result_seconds,
      weekly_km: a.weekly_km,
      longest_run: a.longest_run,
      quality: a.quality,
      runs: a.runs,
      pattern: a.pattern,
      tz,
      health,
      website,
    };
    try {
      const res = await fetch("/api/en-week/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; healthStop?: boolean };
      if (res.ok && j.ok && j.healthStop) {
        setHealthStop(true);
      } else if (res.ok && j.ok && j.token) {
        router.replace(`/en/week/p/${j.token}`);
        return;
      } else {
        setFail("Something went wrong on my side. Please try again in a minute.");
      }
    } catch {
      setFail("No connection. Check your internet and tap again.");
    }
    setSending(false);
  }

  const Options = ({ opts, value, onPick, grid }: { opts: Opt[]; value: unknown; onPick: (code: string) => void; grid?: boolean }) => (
    <div className={`opts ${grid ? "grid2" : ""}`} role="group" aria-labelledby="q">
      {opts.map((o) => (
        <button type="button" key={o.code} className={`opt ${value === o.code ? "sel" : ""}`} aria-pressed={value === o.code} onClick={() => onPick(o.code)}>
          <span className="tx">
            <b>{o.label}</b>
            {o.sub && <span>{o.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );

  const Question = ({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) => (
    <>
      <div className="eyebrow">{eyebrow}</div>
      <h1 id="q" ref={headRef} tabIndex={-1}>
        {title}
      </h1>
      {lede && <p className="lede">{lede}</p>}
    </>
  );

  const showCount = step !== null && !healthStop;

  return (
    <>
      <header>
        <div className="wrap">
          <div className="hbar">
            <Brand />
            {showCount && (
              <div className="count" aria-label={`Question ${pos} of ${steps.length}`}>
                {pos} / {steps.length}
              </div>
            )}
          </div>
          {showCount && (
            <div className="prog" aria-hidden="true">
              {steps.map((_, i) => (
                <i key={i} className={i < pos ? "on" : ""} />
              ))}
            </div>
          )}
        </div>
      </header>

      <main>
        <div className="wrap">
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />

          {pos === 0 && (
            <section className="step">
              <span className="free">Free · 7 days</span>
              <h1 ref={headRef} tabIndex={-1}>
                {T.INTRO_TITLE}
              </h1>
              <p className="lede">{T.INTRO_LEDE}</p>
              <div className="intro">
                {T.INTRO_POINTS.map((p) => (
                  <div key={p}>
                    <i aria-hidden="true">✓</i>
                    {p}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!healthStop && step === "goal" && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Your goal" title={T.Q_GOAL} />
              <Options opts={GOALS} value={a.goal} onPick={(c) => chooseGoal(c as Goal)} />
            </section>
          )}

          {!healthStop && step === "start_now" && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Where you are now" title={T.Q_START_NOW} />
              <Options opts={START_NOW} value={a.start_now} onPick={(c) => tap({ start_now: c as Answers["start_now"] })} />
            </section>
          )}

          {!healthStop && step === "start_longest" && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Where you are now" title={T.Q_START_LONGEST} />
              <Options opts={START_LONGEST} value={a.start_longest} onPick={(c) => tap({ start_longest: c as Answers["start_longest"] })} />
            </section>
          )}

          {!healthStop && step === "return_last" && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Your break" title={T.Q_RETURN_LAST} />
              <Options opts={RETURN_LAST} value={a.return_last} onPick={(c) => tap({ return_last: c as Answers["return_last"] })} />
            </section>
          )}

          {!healthStop && step === "return_level" && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Your break" title={T.Q_RETURN_LEVEL} />
              <Options opts={RETURN_LEVEL} value={a.return_level} onPick={(c) => tap({ return_level: c as Answers["return_level"] })} />
            </section>
          )}

          {!healthStop && step === "race" && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Your race" title={T.Q_RACE} />
              <Options opts={RACE_DISTANCES} value={a.race_distance} onPick={(c) => set({ race_distance: c as RaceDist })} grid />
              <div className="f">
                <label htmlFor="race-month">{T.Q_RACE_MONTH}</label>
                <select id="race-month" value={a.race_month ?? ""} onChange={(e) => set({ race_month: e.target.value || null })}>
                  <option value="">Pick a month</option>
                  {months.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          )}

          {!healthStop && step === "result" && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Your race" title={T.Q_RESULT} lede={T.Q_RESULT_LEDE} />
              <Options
                opts={[...RACE_DISTANCES, { code: "none", label: T.NO_RESULT }]}
                value={a.no_result ? "none" : a.result_distance}
                onPick={(c) => {
                  setResultError("");
                  if (c === "none") set({ no_result: true, result_distance: null, result_seconds: null });
                  else set({ no_result: false, result_distance: c as RaceDist });
                }}
              />
              {!a.no_result && a.result_distance && (
                <div className={`f ${resultError ? "bad" : ""}`}>
                  <label htmlFor="result-time">{T.Q_RESULT_TIME}</label>
                  <input
                    id="result-time"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={a.result_distance === "5k" || a.result_distance === "10k" ? "52:00" : "1:52:30"}
                    value={a.result_time ?? ""}
                    aria-invalid={!!resultError}
                    aria-describedby={resultError ? "result-err" : undefined}
                    onChange={(e) => {
                      setResultError("");
                      set({ result_time: e.target.value });
                    }}
                  />
                  {resultError && (
                    <p className="emsg" id="result-err" role="alert">
                      {resultError}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {!healthStop && step === "days" && a.goal && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Your week" title={T.Q_DAYS} />
              <div className="opts grid2" role="group" aria-labelledby="q">
                {daysPerWeekOptions(a.goal).map((r) => (
                  <button
                    type="button"
                    key={r}
                    className={`opt ${a.runs === r ? "sel" : ""}`}
                    aria-pressed={a.runs === r}
                    aria-label={`${r} days a week`}
                    onClick={() => tap({ runs: r as Runs, pattern: a.pattern && patternsForRuns(r).includes(a.pattern) ? a.pattern : undefined })}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="hint">{runner || a.goal === "run_consistently" ? T.Q_DAYS_HINT_RUNNER : T.Q_DAYS_HINT_BEGINNER}</p>
            </section>
          )}

          {!healthStop && step === "pattern" && a.runs && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Your days" title={T.Q_PATTERN} />
              <Options opts={patternsForRuns(a.runs).map((p) => ({ code: p, label: patternLabelEn(p) }))} value={a.pattern} onPick={(c) => tap({ pattern: c })} />
            </section>
          )}

          {!healthStop && step === "baseline" && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Your running" title={T.Q_BASELINE} lede={T.Q_BASELINE_LEDE} />
              <h2 id="q-km">{T.Q_WEEKLY_KM}</h2>
              <div className="opts grid2" role="group" aria-labelledby="q-km">
                {WEEKLY_KM.map((o) => (
                  <button type="button" key={o.code} className={`opt ${a.weekly_km === o.code ? "sel" : ""}`} aria-pressed={a.weekly_km === o.code} onClick={() => set({ weekly_km: o.code })}>
                    <span className="tx">
                      <b>{o.label}</b>
                      {o.sub && <span>{o.sub}</span>}
                    </span>
                  </button>
                ))}
              </div>
              <h2 id="q-long">{T.Q_LONGEST_RUN}</h2>
              <div className="opts grid2" role="group" aria-labelledby="q-long">
                {LONGEST_RUN.map((o) => (
                  <button type="button" key={o.code} className={`opt ${a.longest_run === o.code ? "sel" : ""}`} aria-pressed={a.longest_run === o.code} onClick={() => set({ longest_run: o.code })}>
                    <span className="tx">
                      <b>{o.label}</b>
                      {o.sub && <span>{o.sub}</span>}
                    </span>
                  </button>
                ))}
              </div>
              <h2 id="q-quality">{T.Q_QUALITY}</h2>
              <div className="opts" role="group" aria-labelledby="q-quality">
                {QUALITY.map((o) => (
                  <button type="button" key={o.code} className={`opt ${a.quality === o.code ? "sel" : ""}`} aria-pressed={a.quality === o.code} onClick={() => set({ quality: o.code })}>
                    <span className="tx">
                      <b>{o.label}</b>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {!healthStop && step === "health" && (
            <section className="step" aria-labelledby="q">
              <Question eyebrow="Health" title={T.Q_HEALTH} />
              <div className="opts" role="group" aria-labelledby="q">
                {HEALTH_ITEMS.map((h) => (
                  <button type="button" key={h} className="opt" disabled={sending} onClick={() => submit(true)}>
                    {h}
                  </button>
                ))}
                <button type="button" className="opt none" disabled={sending} onClick={() => submit(false)}>
                  {sending ? "Building your week..." : HEALTH_NONE_LABEL}
                </button>
              </div>
              <p className="hint">{T.Q_HEALTH_HINT}</p>
              {fail && (
                <p className="err" role="alert">
                  {fail}
                </p>
              )}
            </section>
          )}

          {healthStop && (
            <section className="step">
              <h1 ref={headRef} tabIndex={-1}>
                {T.HEALTH_STOP_TITLE}
              </h1>
              <p className="lede">{T.HEALTH_STOP}</p>
              <a className="btn wa" href={T.consultUrl(T.PREFILL_HEALTH)}>
                {T.CTA_LABEL}
              </a>
            </section>
          )}
        </div>
      </main>

      {!healthStop && step !== "health" && (
        <div className="bar">
          <div className="wrap">
            {pos >= 1 && (
              <button type="button" className="btn ghost" disabled={sending} onClick={() => go(pos - 1)} aria-label="Back">
                ←
              </button>
            )}
            {pos === 0 && (
              <button type="button" className="btn" onClick={() => go(1)}>
                Get my free week
              </button>
            )}
            {step === "race" && (
              <button type="button" className="btn" disabled={!a.race_distance || !a.race_month} onClick={next}>
                Next
              </button>
            )}
            {step === "result" && (
              <button type="button" className="btn" disabled={!a.no_result && !a.result_distance} onClick={confirmResult}>
                Next
              </button>
            )}
            {step === "baseline" && (
              <button type="button" className="btn" disabled={!a.weekly_km || !a.longest_run || !a.quality} onClick={next}>
                Next
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
