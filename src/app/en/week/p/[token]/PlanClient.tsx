"use client";

import { useState } from "react";

import { CHECKIN_VALUES, type CheckinValue } from "@/features/en-week/logic";
import type { PlanView } from "@/features/en-week/model";
import * as T from "@/features/en-week/texts";

import { Brand } from "../../Shell";
import { shrinkToDataUrl } from "./shrink";

const MAX_SHOTS = 3;

function minutesLabel(m: number): string {
  return `${Number.isInteger(m) ? m : m.toFixed(1)} min`;
}

export default function PlanClient({ initial }: { initial: PlanView }) {
  const [view, setView] = useState<PlanView>(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [shotErr, setShotErr] = useState<Record<number, string>>({});

  async function shotRequest(idx: number, body: Record<string, unknown>) {
    setShotErr((e) => ({ ...e, [idx]: "" }));
    try {
      const res = await fetch("/api/en-week/page-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: view.token, ...body }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; view?: PlanView };
      if (res.ok && j.ok && j.view) setView(j.view);
      else setShotErr((e) => ({ ...e, [idx]: T.SCREENSHOT_ERRORS[j.error ?? "type"] ?? T.SCREENSHOT_ERRORS.type }));
    } catch {
      setShotErr((e) => ({ ...e, [idx]: T.SCREENSHOT_ERRORS.network }));
    }
  }

  async function upload(idx: number, files: FileList | null) {
    if (!files || uploading !== null) return;
    setUploading(idx);
    const room = MAX_SHOTS - (view.sessions.find((s) => s.idx === idx)?.screenshots.length ?? 0);
    for (const f of Array.from(files).slice(0, Math.max(0, room))) {
      let dataUrl: string;
      try {
        dataUrl = await shrinkToDataUrl(f);
      } catch {
        setShotErr((e) => ({ ...e, [idx]: T.SCREENSHOT_ERRORS.type }));
        continue;
      }
      await shotRequest(idx, { idx, dataUrl });
    }
    setUploading(null);
  }

  const cta = (place: "offer" | "summary") => `/en/week/go?t=${encodeURIComponent(view.token)}&p=${place}${view.track === "runner" ? "&k=r" : ""}`;

  async function checkin(idx: number, value: CheckinValue) {
    if (busy !== null) return;
    const before = view;
    // Optimistic: the tap shows at once; rolled back if the server says no.
    setView({ ...view, sessions: view.sessions.map((s) => (s.idx === idx ? { ...s, checkin: value } : s)) });
    setBusy(idx);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no haptics */
    }
    try {
      const res = await fetch("/api/en-week/page-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: view.token, idx, value }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; reply?: string; view?: PlanView };
      if (res.ok && j.ok && j.view) {
        setView(j.view);
        setReplies((r) => ({ ...r, [idx]: j.reply ?? "" }));
      } else {
        setView(before);
        setReplies((r) => ({ ...r, [idx]: j.reply || "Couldn't save that. Please try again." }));
      }
    } catch {
      setView(before);
      setReplies((r) => ({ ...r, [idx]: "No connection. Check your internet and tap again." }));
    }
    setBusy(null);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      /* clipboard blocked in some in-app browsers: the address bar still has it */
    }
  }

  const first = view.sessions[0];

  return (
    <>
      <header>
        <div className="wrap">
          <div className="hbar">
            <Brand />
            {view.stage === "week" && view.day >= 1 && <div className="count">Day {Math.min(view.day, 7)} / 7</div>}
          </div>
        </div>
      </header>

      <main>
        <div className="wrap">
          <span className="free">Your free week</span>
          <h1>{view.patternLabel ? `Your week: ${view.patternLabel}` : "Your week"}</h1>
          <p className="lede">{view.goalLine}</p>

          {view.stage === "before_start" && first && (
            <p className="note">
              <b>Your week starts {first.dateLabel}.</b> Nothing to do until then.
            </p>
          )}
          {view.runnerFacts.length > 0 && (
            <ul className="facts" aria-label="Your numbers">
              {view.runnerFacts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          <p className="note rule">{view.track === "runner" ? T.RUNNER_PLAN_RULE : T.PLAN_RULE}</p>

          {view.summary && (
            <>
              <h2>Your week summary</h2>
              <p className="summary">{view.summary}</p>
              <a className="btn wa" style={{ width: "100%", marginTop: 12 }} href={cta("summary")}>
                {T.CTA_LABEL}
              </a>
            </>
          )}

          <h2>Workouts</h2>
          <div className="cards">
            {view.sessions.map((s) => (
              <article key={s.idx} className={`card ${s.isToday ? "today" : ""}`} aria-labelledby={`w${s.idx}`}>
                <div className="when">
                  <span>
                    Workout {s.idx} · {s.dateLabel}
                  </span>
                  {s.isToday && <span className="tag">Today</span>}
                </div>
                {s.isInterval && <span className="tag2">Intervals</span>}
                <h3 id={`w${s.idx}`}>{s.title}</h3>
                <div className="min">{minutesLabel(s.minutes)}</div>
                <details open={s.isToday}>
                  <summary>How to do it</summary>
                  <ol>
                    {s.steps.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                  <p>{s.body}</p>
                  {s.isInterval && <p className="note rule">{T.INTERVAL_RULE}</p>}
                </details>

                {s.canCheckin ? (
                  <div className="ci">
                    <p className="q" id={`q${s.idx}`}>
                      {s.checkin ? "Your check-in (tap to change):" : "How did it go?"}
                    </p>
                    <div className="row" role="group" aria-labelledby={`q${s.idx}`}>
                      {CHECKIN_VALUES.map((v) => (
                        <button type="button" key={v} aria-pressed={s.checkin === v} disabled={busy !== null} onClick={() => checkin(s.idx, v)}>
                          {T.CHECKIN_LABELS[v]}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  s.checkin && <span className="done-tag">Logged: {T.CHECKIN_LABELS[s.checkin]}</span>
                )}
                {s.isDue && (
                  <div className="shots">
                    {s.screenshots.length > 0 && (
                      <div className="thumbs">
                        {s.screenshots.map((sh) => (
                          <div key={sh.id} className="thumb">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <a href={sh.url} target="_blank" rel="noreferrer"><img src={sh.url} alt={`Screenshot for workout ${s.idx}`} /></a>
                            <button type="button" aria-label="Remove screenshot" onClick={() => shotRequest(s.idx, { remove: sh.id })}>
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {s.screenshots.length < MAX_SHOTS && (
                      <label className={`upload ${uploading === s.idx ? "busy" : ""}`}>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          disabled={uploading !== null}
                          onChange={(e) => {
                            void upload(s.idx, e.target.files);
                            e.target.value = "";
                          }}
                        />
                        {uploading === s.idx ? "Uploading..." : T.SCREENSHOT_UPLOAD}
                      </label>
                    )}
                    <p className="shint">{T.SCREENSHOT_HINT}</p>
                    {shotErr[s.idx] && (
                      <p className="emsg" role="alert">
                        {shotErr[s.idx]}
                      </p>
                    )}
                  </div>
                )}
                {replies[s.idx] && (
                  <p className="reply" role="status">
                    {replies[s.idx]}
                  </p>
                )}
              </article>
            ))}
          </div>

          {view.cases.length > 0 && (
            <>
              <h2>Runners I coach</h2>
              {view.cases.map((c) => (
                <figure key={c.name} className="case">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.imageUrl} alt={`${c.name}, a runner Igor coaches`} loading="lazy" />
                  <figcaption>
                    <b>{c.name}</b>
                    {c.text.split("\n\n").map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                  </figcaption>
                </figure>
              ))}
            </>
          )}

          {view.offerVisible && !view.summary && (
            <section className="offer" aria-labelledby="offer">
              <h2 id="offer">{view.track === "runner" ? "Want a plan for your next race?" : "Want to keep going after this week?"}</h2>
              <p>{T.offerText(view.track)}</p>
              <a className="btn wa" href={cta("offer")}>
                {T.CTA_LABEL}
              </a>
            </section>
          )}

          {view.linked && <p className="note">{T.PLAN_DM_NOTE}</p>}
          <p className="note">
            {T.PLAN_LINK_NOTE}
            <br />
            <button type="button" className="copy" onClick={copyLink}>
              {copied ? "Link copied" : "Copy my link"}
            </button>
          </p>
        </div>
      </main>
    </>
  );
}
