"use client";

import { useState } from "react";

// English application for the 7-day trial (/trial). Same look as the Russian
// /camp/apply (apply.css), but shorter: 3 steps, no screenshots (a Strava link
// instead), Instagram handle required because Igor sends the payment link in
// Instagram DM. WhatsApp number required too: the week itself runs 1:1 on
// WhatsApp. Posts to the same /api/intensive/apply with source=trial-en:
// the route then files it under flow_number "trial-en", outside the Russian
// flow and its seat counter.

const TOTAL_STEPS = 3;
const DONE_STEP = 4;

/** Day codes match available_days text[] in the DB: ['mon','tue',...]. */
const DAYS: { code: string; label: string }[] = [
  { code: "mon", label: "Mon" },
  { code: "tue", label: "Tue" },
  { code: "wed", label: "Wed" },
  { code: "thu", label: "Thu" },
  { code: "fri", label: "Fri" },
  { code: "sat", label: "Sat" },
  { code: "sun", label: "Sun" },
];

const SEX = [
  { code: "female", label: "Female" },
  { code: "male", label: "Male" },
];

const WEEKLY_KM = ["I don't run yet", "under 10 km", "10-20 km", "20-40 km", "40-60 km", "60+ km"];
const GADGETS = [
  "Garmin",
  "Apple Watch",
  "Polar",
  "Coros",
  "Suunto",
  "Phone app",
  "Chest heart rate strap",
  "Nothing yet",
];

type Draft = {
  full_name: string;
  instagram: string;
  whatsapp: string;
  email: string;
  city: string;
  birth_date: string;
  sex: string;
  health_chronic: string;
  health_injuries: string;
  health_discomfort: string;
  health_disclaimer_accepted: boolean;
  weekly_km: string;
  current_training: string;
  strava_url: string;
  goal: string;
  races_this_year: string;
  available_days: string[];
  gadgets: string[];
  why_intensive: string;
};

const EMPTY: Draft = {
  full_name: "",
  instagram: "",
  whatsapp: "",
  email: "",
  city: "",
  birth_date: "",
  sex: "",
  health_chronic: "",
  health_injuries: "",
  health_discomfort: "",
  health_disclaimer_accepted: false,
  weekly_km: "",
  current_training: "",
  strava_url: "",
  goal: "",
  races_this_year: "",
  available_days: [],
  gadgets: [],
  why_intensive: "",
};

const REQUIRED: Record<number, { key: keyof Draft; message: string }[]> = {
  1: [
    { key: "full_name", message: "What is your name?" },
    { key: "instagram", message: "I need your Instagram to send you the payment link" },
    { key: "whatsapp", message: "I need your WhatsApp number: the week runs there" },
    { key: "city", message: "Please add your city and country" },
  ],
  2: [
    { key: "health_chronic", message: "Please answer. If you have no health problems, write \"no\"" },
    { key: "health_injuries", message: "Please answer. If you have no injuries, write \"no\"" },
    { key: "health_disclaimer_accepted", message: "I can't accept the form without this" },
  ],
  3: [
    { key: "weekly_km", message: "Choose how much you run now" },
    { key: "current_training", message: "Tell me how you train now" },
    { key: "goal", message: "Tell me your goal, so the plan makes sense" },
    { key: "available_days", message: "Choose at least one day" },
  ],
};

function isFilled(value: Draft[keyof Draft]): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return value.trim().length > 0;
}

/** "@name", "name" or "instagram.com/name/" become "name". */
function cleanHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//iu, "")
    .replace(/^@+/u, "")
    .replace(/[/?#].*$/u, "")
    .trim();
}

export default function TrialApplyForm() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function toggle(key: "available_days" | "gadgets", value: string) {
    const current = draft[key];
    set(
      key,
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack(target: number) {
    setStep(target);
    scrollTop();
  }

  function validate(current: number): boolean {
    const found: Partial<Record<keyof Draft, string>> = {};
    for (const rule of REQUIRED[current] ?? []) {
      if (!isFilled(draft[rule.key])) found[rule.key] = rule.message;
    }
    if (current === 1 && !found.instagram && !cleanHandle(draft.instagram)) {
      found.instagram = "Please check your Instagram handle";
    }
    if (current === 1 && !found.whatsapp && draft.whatsapp.replace(/\D/gu, "").length < 7) {
      found.whatsapp = "Please add the full number with country code";
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  function goNext(target: number) {
    if (!validate(step)) return;
    setStep(target);
    scrollTop();
  }

  async function submit() {
    if (!validate(3)) return;
    setSending(true);
    setSendError(null);

    const payload = new FormData();
    payload.append("source", "trial-en");
    for (const [key, value] of Object.entries(draft)) {
      if (Array.isArray(value)) {
        for (const item of value) payload.append(key, item);
      } else if (typeof value === "boolean") {
        payload.append(key, value ? "true" : "false");
      } else if (key === "instagram") {
        payload.append(key, cleanHandle(value));
      } else {
        payload.append(key, value);
      }
    }

    try {
      const response = await fetch("/api/intensive/apply", {
        method: "POST",
        body: payload,
      });
      let result: { ok?: boolean; error?: string } = {};
      try {
        result = (await response.json()) as { ok?: boolean; error?: string };
      } catch {
        result = {};
      }
      if (!response.ok || result.ok !== true) {
        setSendError(result.error ?? "Something went wrong. Please try again.");
        setSending(false);
        return;
      }
      setStep(DONE_STEP);
      scrollTop();
    } catch {
      setSendError("Could not send the form. Check your connection and try again.");
    }
    setSending(false);
  }

  const progress = (Math.min(step, TOTAL_STEPS) / TOTAL_STEPS) * 100;
  const counter = step > TOTAL_STEPS ? "Done" : `Step ${step} of ${TOTAL_STEPS}`;

  function err(key: keyof Draft) {
    return errors[key] ? <div className="emsg">{errors[key]}</div> : null;
  }
  function bad(key: keyof Draft) {
    return errors[key] ? " bad" : "";
  }

  return (
    <>
      <header>
        <div className="wrap hbar">
          <div className="t">
            <span className="dot" />
            Trial week application
          </div>
          <div className="c">{counter}</div>
        </div>
        <div className="prog">
          <i style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="wrap">
        {/* STEP 1 */}
        <section className={`step${step === 1 ? " on" : ""}`}>
          <span className="eyebrow">Step 1 · About you</span>
          <h2>Let&apos;s meet</h2>
          <p className="lede">
            A few basics. After you send the form, I reply in Instagram DM within
            24 hours with a payment link. After you pay, we talk 1:1 on WhatsApp.
          </p>

          <div className={`f${bad("full_name")}`}>
            <label htmlFor="full_name">
              Your name <span className="req">*</span>
            </label>
            <input
              id="full_name"
              type="text"
              autoComplete="name"
              placeholder="For example: Anna Smith"
              value={draft.full_name}
              onChange={(event) => set("full_name", event.target.value)}
            />
            {err("full_name")}
          </div>

          <div className={`f${bad("instagram")}`}>
            <label htmlFor="instagram">
              Instagram handle <span className="req">*</span>
            </label>
            <div className="hint">I send the payment link here, in DM</div>
            <input
              id="instagram"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="@yourname"
              value={draft.instagram}
              onChange={(event) => set("instagram", event.target.value)}
            />
            {err("instagram")}
          </div>

          <div className={`f${bad("whatsapp")}`}>
            <label htmlFor="whatsapp">
              WhatsApp number <span className="req">*</span>
            </label>
            <div className="hint">
              With country code, for example +44 7700 900123. The week runs 1:1 on
              WhatsApp: you get your plan there and send your reports there
            </div>
            <input
              id="whatsapp"
              type="text"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+44 7700 900123"
              value={draft.whatsapp}
              onChange={(event) => set("whatsapp", event.target.value)}
            />
            {err("whatsapp")}
          </div>

          <div className="f">
            <label htmlFor="email">Email</label>
            <div className="hint">Optional</div>
            <input
              id="email"
              type="text"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={draft.email}
              onChange={(event) => set("email", event.target.value)}
            />
          </div>

          <div className={`f${bad("city")}`}>
            <label htmlFor="city">
              City and country <span className="req">*</span>
            </label>
            <div className="hint">So I know your time zone and weather</div>
            <input
              id="city"
              type="text"
              placeholder="For example: Lisbon, Portugal"
              value={draft.city}
              onChange={(event) => set("city", event.target.value)}
            />
            {err("city")}
          </div>

          <div className="f">
            <label htmlFor="birth_date">Date of birth</label>
            <div className="hint">Optional. It helps me set your heart rate zones</div>
            <input
              id="birth_date"
              type="date"
              value={draft.birth_date}
              onChange={(event) => set("birth_date", event.target.value)}
            />
          </div>

          <div className="f">
            <label>Sex</label>
            <div className="hint">Optional</div>
            <div className="chips">
              {SEX.map((option) => (
                <label className="chip" key={option.code}>
                  <input
                    type="radio"
                    name="sex"
                    checked={draft.sex === option.code}
                    onChange={() => set("sex", option.code)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="nav">
            <button className="btn" type="button" onClick={() => goNext(2)}>
              Next &rarr;
            </button>
          </div>
        </section>

        {/* STEP 2 */}
        <section className={`step${step === 2 ? " on" : ""}`}>
          <span className="eyebrow">Step 2 · Health</span>
          <h2>Safety first</h2>
          <p className="lede">The most important part. It shapes how I build your load.</p>

          <div className="med">
            <div className="note">
              <span className="i">!</span>
              <span>
                Only I see this. I use it to choose a safe load. I don&apos;t share it
                with anyone.
              </span>
            </div>

            <div className={`f${bad("health_chronic")}`}>
              <label htmlFor="health_chronic">
                Do you have any health problems? <span className="req">*</span>
              </label>
              <div className="hint">
                Heart, blood pressure, joints, back, breathing or anything else. If
                not, write &quot;no&quot;
              </div>
              <textarea
                id="health_chronic"
                placeholder="For example: no. Or: high blood pressure, I take medication"
                value={draft.health_chronic}
                onChange={(event) => set("health_chronic", event.target.value)}
              />
              {err("health_chronic")}
            </div>

            <div className={`f${bad("health_injuries")}`}>
              <label htmlFor="health_injuries">
                Any injuries, now or in the past? <span className="req">*</span>
              </label>
              <div className="hint">What, when, and is it OK now? If none, write &quot;no&quot;</div>
              <textarea
                id="health_injuries"
                placeholder="For example: knee pain last year, fine now"
                value={draft.health_injuries}
                onChange={(event) => set("health_injuries", event.target.value)}
              />
              {err("health_injuries")}
            </div>

            <div className="f">
              <label htmlFor="health_discomfort">
                Any pain or discomfort when you run?
              </label>
              <div className="hint">Optional</div>
              <textarea
                id="health_discomfort"
                placeholder="For example: my shins get tight after 5 km"
                value={draft.health_discomfort}
                onChange={(event) => set("health_discomfort", event.target.value)}
              />
            </div>
          </div>

          <label className={`check${errors.health_disclaimer_accepted ? " bad" : ""}`}>
            <input
              type="checkbox"
              checked={draft.health_disclaimer_accepted}
              onChange={(event) =>
                set("health_disclaimer_accepted", event.target.checked)
              }
            />
            <span>
              I confirm that I have no medical reasons not to exercise. If I am not
              sure, I will talk to a doctor. <span className="req">*</span>
            </span>
          </label>
          {err("health_disclaimer_accepted")}

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(1)}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={() => goNext(3)}>
              Next &rarr;
            </button>
          </div>
        </section>

        {/* STEP 3 */}
        <section className={`step${step === 3 ? " on" : ""}`}>
          <span className="eyebrow">Step 3 · Running and goal</span>
          <h2>Where you are and where you want to go</h2>
          <p className="lede">Your level now is the starting point of your plan.</p>

          <div className={`f${bad("weekly_km")}`}>
            <label>
              How much do you run per week now? <span className="req">*</span>
            </label>
            <div className="chips">
              {WEEKLY_KM.map((option) => (
                <label className="chip" key={option}>
                  <input
                    type="radio"
                    name="km"
                    checked={draft.weekly_km === option}
                    onChange={() => set("weekly_km", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {err("weekly_km")}
          </div>

          <div className={`f${bad("current_training")}`}>
            <label htmlFor="current_training">
              How do you train now? <span className="req">*</span>
            </label>
            <div className="hint">Do you have a plan? What runs do you do? How many times a week?</div>
            <textarea
              id="current_training"
              placeholder="For example: I run 3 times a week for 40 minutes, no plan, always the same pace"
              value={draft.current_training}
              onChange={(event) => set("current_training", event.target.value)}
            />
            {err("current_training")}
          </div>

          <div className="f">
            <label htmlFor="strava_url">Strava profile link</label>
            <div className="hint">Optional. It helps me see your level faster</div>
            <input
              id="strava_url"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://www.strava.com/athletes/..."
              value={draft.strava_url}
              onChange={(event) => set("strava_url", event.target.value)}
            />
          </div>

          <div className={`f${bad("goal")}`}>
            <label htmlFor="goal">
              What is your running goal? <span className="req">*</span>
            </label>
            <div className="hint">
              Even if it is &quot;just run regularly and not quit&quot;, write that
            </div>
            <textarea
              id="goal"
              placeholder="For example: run my first 10K without stopping"
              value={draft.goal}
              onChange={(event) => set("goal", event.target.value)}
            />
            {err("goal")}
          </div>

          <div className="f">
            <label htmlFor="races_this_year">Any races planned?</label>
            <div className="hint">Optional. Which ones, when, and what result you want</div>
            <textarea
              id="races_this_year"
              placeholder="For example: half marathon in April, I want to finish under 2 hours"
              value={draft.races_this_year}
              onChange={(event) => set("races_this_year", event.target.value)}
            />
          </div>

          <div className={`f${bad("available_days")}`}>
            <label>
              Which days can you train? <span className="req">*</span>
            </label>
            <div className="chips">
              {DAYS.map((option) => (
                <label className="chip day" key={option.code}>
                  <input
                    type="checkbox"
                    checked={draft.available_days.includes(option.code)}
                    onChange={() => toggle("available_days", option.code)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {err("available_days")}
          </div>

          <div className="f">
            <label>What do you track your runs with?</label>
            <div className="hint">Optional</div>
            <div className="chips">
              {GADGETS.map((option) => (
                <label className="chip" key={option}>
                  <input
                    type="checkbox"
                    checked={draft.gadgets.includes(option)}
                    onChange={() => toggle("gadgets", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="f">
            <label htmlFor="why_intensive">Anything else I should know?</label>
            <div className="hint">Optional</div>
            <textarea
              id="why_intensive"
              placeholder="For example: I work shifts, so my days change every week"
              value={draft.why_intensive}
              onChange={(event) => set("why_intensive", event.target.value)}
            />
          </div>

          {sendError ? <div className="sendfail">{sendError}</div> : null}

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(2)} disabled={sending}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={submit} disabled={sending}>
              {sending ? "Sending..." : "Send application"}
            </button>
          </div>
        </section>

        {/* DONE */}
        <section className={`step${step === DONE_STEP ? " on" : ""}`}>
          <div className="done">
            <div className="tick">&#10003;</div>
            <h2>Application sent</h2>
            <p>
              Thank you! I will read your answers and send you a payment link in
              Instagram DM within 24 hours.
            </p>
            <p>
              If you don&apos;t see my message, check your message requests in
              Instagram.
            </p>
            <p>After you pay, we talk 1:1 on WhatsApp.</p>
          </div>
        </section>
      </main>
    </>
  );
}
