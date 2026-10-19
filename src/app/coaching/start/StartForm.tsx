"use client";

import { useState } from "react";

// Onboarding form for new 1:1 coaching clients (/coaching/start, 60 EUR/month).
// Same look as /trial/apply (apply.css), 6 steps. Covers run, bike and swim so
// it works for triathletes, but every sport block only shows when that sport is
// chosen, so a pure runner sees a short form. Posts to /api/intensive/apply
// with source=coaching-en: the route files it under flow_number "coaching-en",
// outside the Russian flow and its seat counter, and keeps the answers that
// have no column as a readable block in why_intensive.

const TOTAL_STEPS = 6;
const DONE_STEP = 7;

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

const CONTACTS = [
  { code: "whatsapp", label: "WhatsApp" },
  { code: "telegram", label: "Telegram" },
];

const EXPERIENCE = [
  { code: "never", label: "Never" },
  { code: "some", label: "Some (apps, ready plans)" },
  { code: "yes", label: "Yes, I had a coach" },
];

type SportCode = "run" | "bike" | "swim" | "gym" | "other";

const SPORTS: { code: SportCode; label: string }[] = [
  { code: "run", label: "Run" },
  { code: "bike", label: "Bike" },
  { code: "swim", label: "Swim" },
  { code: "gym", label: "Gym" },
  { code: "other", label: "Other" },
];

const TIME_OF_DAY = ["Early morning", "Morning", "Lunch", "Evening", "It changes"];

const DEVICES = [
  "Garmin",
  "Apple Watch",
  "Coros",
  "Polar",
  "Suunto",
  "Wahoo",
  "Bike computer",
  "Phone only",
];

const PLATFORMS = ["TrainingPeaks", "Strava", "Garmin Connect", "Other", "None"];

const INDOOR = ["Treadmill", "Smart trainer", "Pool access", "Gym access", "None"];

const YES_NO = ["Yes", "No"];

const ENERGY = ["1", "2", "3", "4", "5"];

type Race = { name: string; date: string; distance: string };

type SportWeek = { sessions: string; hours: string };

type Draft = {
  full_name: string;
  instagram: string;
  preferred_contact: string;
  contact_handle: string;
  email: string;
  city: string;
  timezone: string;
  birth_date: string;
  sex: string;
  goal: string;
  races: Race[];
  coach_expectations: string;
  coaching_experience: string;
  sports: SportCode[];
  other_sport_name: string;
  sport_week: Record<SportCode, SportWeek>;
  total_hours: string;
  available_days: string[];
  time_of_day: string[];
  long_session_days: string;
  longest_run: string;
  longest_ride: string;
  longest_swim: string;
  recent_results: string;
  gadgets: string[];
  platforms: string[];
  strava_url: string;
  hr_strap: string;
  power_meter: string;
  indoor: string[];
  health_injuries: string;
  health_chronic: string;
  sleep_hours: string;
  energy_level: string;
  health_discomfort: string;
  health_disclaimer_accepted: boolean;
  why_intensive: string;
};

type ErrorKey =
  | "full_name"
  | "instagram"
  | "preferred_contact"
  | "contact_handle"
  | "city"
  | "goal"
  | "coach_expectations"
  | "sports"
  | "total_hours"
  | "health_injuries"
  | "health_chronic"
  | "health_disclaimer_accepted";

const EMPTY_WEEK: SportWeek = { sessions: "", hours: "" };

const EMPTY: Draft = {
  full_name: "",
  instagram: "",
  preferred_contact: "",
  contact_handle: "",
  email: "",
  city: "",
  timezone: "",
  birth_date: "",
  sex: "",
  goal: "",
  races: [{ name: "", date: "", distance: "" }],
  coach_expectations: "",
  coaching_experience: "",
  sports: [],
  other_sport_name: "",
  sport_week: {
    run: EMPTY_WEEK,
    bike: EMPTY_WEEK,
    swim: EMPTY_WEEK,
    gym: EMPTY_WEEK,
    other: EMPTY_WEEK,
  },
  total_hours: "",
  available_days: [],
  time_of_day: [],
  long_session_days: "",
  longest_run: "",
  longest_ride: "",
  longest_swim: "",
  recent_results: "",
  gadgets: [],
  platforms: [],
  strava_url: "",
  hr_strap: "",
  power_meter: "",
  indoor: [],
  health_injuries: "",
  health_chronic: "",
  sleep_hours: "",
  energy_level: "",
  health_discomfort: "",
  health_disclaimer_accepted: false,
  why_intensive: "",
};

type ListKey = "available_days" | "time_of_day" | "gadgets" | "platforms" | "indoor";

/** "@name", "name" or "instagram.com/name/" become "name". */
function cleanHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//iu, "")
    .replace(/^@+/u, "")
    .replace(/[/?#].*$/u, "")
    .trim();
}

/** "@name" or "t.me/name" become "name". */
function cleanTelegram(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?t(elegram)?\.me\//iu, "")
    .replace(/^@+/u, "")
    .replace(/[/?#].*$/u, "")
    .trim();
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

/** One race per line: "Ironman 70.3 Bahrain · 2026-12-06 · 70.3". */
function racesText(races: Race[]): string {
  return races
    .map((race) =>
      [race.name, race.date, race.distance].map((part) => part.trim()).filter(Boolean).join(" · ")
    )
    .filter(Boolean)
    .join("\n");
}

export default function StartForm() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function clearError(key: string) {
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as ErrorKey];
      return next;
    });
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    clearError(key);
  }

  function toggle(key: ListKey, value: string) {
    const current = draft[key];
    set(
      key,
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  function toggleSport(code: SportCode) {
    set(
      "sports",
      draft.sports.includes(code)
        ? draft.sports.filter((item) => item !== code)
        : [...draft.sports, code]
    );
  }

  function setSportWeek(code: SportCode, field: keyof SportWeek, value: string) {
    setDraft((prev) => ({
      ...prev,
      sport_week: { ...prev.sport_week, [code]: { ...prev.sport_week[code], [field]: value } },
    }));
  }

  function setRace(index: number, field: keyof Race, value: string) {
    setDraft((prev) => ({
      ...prev,
      races: prev.races.map((race, i) => (i === index ? { ...race, [field]: value } : race)),
    }));
  }

  function addRace() {
    setDraft((prev) =>
      prev.races.length >= 8
        ? prev
        : { ...prev, races: [...prev.races, { name: "", date: "", distance: "" }] }
    );
  }

  function removeRace(index: number) {
    setDraft((prev) => ({ ...prev, races: prev.races.filter((_, i) => i !== index) }));
  }

  /** Fill the time zone from the browser the first time the field is touched. */
  function suggestTimezone() {
    if (!blank(draft.timezone)) return;
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone) set("timezone", zone);
    } catch {
      // No Intl time zone support: the person types it.
    }
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack(target: number) {
    setStep(target);
    scrollTop();
  }

  function validate(current: number): boolean {
    const found: Partial<Record<ErrorKey, string>> = {};
    if (current === 1) {
      if (blank(draft.full_name)) found.full_name = "What is your name?";
      if (!cleanHandle(draft.instagram)) found.instagram = "Please add your Instagram handle";
      if (!draft.preferred_contact) found.preferred_contact = "Choose WhatsApp or Telegram";
      if (draft.preferred_contact === "whatsapp" && draft.contact_handle.replace(/\D/gu, "").length < 7) {
        found.contact_handle = "Please add the full number with country code";
      }
      if (draft.preferred_contact === "telegram" && !cleanTelegram(draft.contact_handle)) {
        found.contact_handle = "Please add your Telegram username";
      }
      if (blank(draft.city)) found.city = "Please add your city and country";
    }
    if (current === 2) {
      if (blank(draft.goal)) found.goal = "Tell me your main goal";
      if (blank(draft.coach_expectations)) {
        found.coach_expectations = "Tell me what you want from a coach";
      }
    }
    if (current === 3) {
      if (draft.sports.length === 0) found.sports = "Choose at least one sport";
      if (blank(draft.total_hours)) found.total_hours = "How many hours per week can you train?";
    }
    if (current === 5) {
      if (blank(draft.health_injuries)) {
        found.health_injuries = "Please answer. If you have no injuries, write \"no\"";
      }
      if (blank(draft.health_chronic)) {
        found.health_chronic = "Please answer. If there is nothing, write \"no\"";
      }
      if (!draft.health_disclaimer_accepted) {
        found.health_disclaimer_accepted = "I can't accept the form without this";
      }
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
    // Check every step again: a required answer may have been cleared after
    // going back.
    for (let index = 1; index <= TOTAL_STEPS; index += 1) {
      if (!validate(index)) {
        setStep(index);
        scrollTop();
        return;
      }
    }
    setSending(true);
    setSendError(null);

    const payload = new FormData();
    payload.append("source", "coaching-en");
    payload.append("full_name", draft.full_name);
    payload.append("instagram", cleanHandle(draft.instagram));
    payload.append("preferred_contact", draft.preferred_contact);
    payload.append(
      "contact_handle",
      draft.preferred_contact === "telegram"
        ? cleanTelegram(draft.contact_handle)
        : draft.contact_handle
    );
    payload.append("races_this_year", racesText(draft.races));
    for (const code of draft.sports) {
      payload.append("sports", code);
      payload.append(`sessions_${code}`, draft.sport_week[code].sessions);
      payload.append(`hours_${code}`, draft.sport_week[code].hours);
    }

    const plain: (keyof Draft)[] = [
      "email",
      "city",
      "timezone",
      "birth_date",
      "sex",
      "goal",
      "coach_expectations",
      "coaching_experience",
      "other_sport_name",
      "total_hours",
      "long_session_days",
      "longest_run",
      "longest_ride",
      "longest_swim",
      "recent_results",
      "strava_url",
      "hr_strap",
      "power_meter",
      "health_injuries",
      "health_chronic",
      "sleep_hours",
      "energy_level",
      "health_discomfort",
      "why_intensive",
    ];
    for (const key of plain) payload.append(key, String(draft[key]));
    const lists: ListKey[] = ["available_days", "time_of_day", "gadgets", "platforms", "indoor"];
    for (const key of lists) {
      for (const item of draft[key]) payload.append(key, item);
    }
    payload.append(
      "health_disclaimer_accepted",
      draft.health_disclaimer_accepted ? "true" : "false"
    );

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

  function err(key: ErrorKey) {
    return errors[key] ? <div className="emsg">{errors[key]}</div> : null;
  }
  function bad(key: ErrorKey) {
    return errors[key] ? " bad" : "";
  }

  function chipsMulti(key: ListKey, options: string[], name: string) {
    return (
      <div className="chips">
        {options.map((option) => (
          <label className="chip" key={option}>
            <input
              type="checkbox"
              name={name}
              checked={draft[key].includes(option)}
              onChange={() => toggle(key, option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }

  function chipsOne(
    key: "hr_strap" | "power_meter" | "energy_level" | "sex" | "coaching_experience" | "preferred_contact",
    options: { code: string; label: string }[]
  ) {
    return (
      <div className="chips">
        {options.map((option) => (
          <label className="chip" key={option.code}>
            <input
              type="radio"
              name={key}
              checked={draft[key] === option.code}
              onChange={() => set(key, option.code)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  }

  const yesNo = YES_NO.map((value) => ({ code: value.toLowerCase(), label: value }));
  const sportLabel = (code: SportCode) =>
    code === "other" && !blank(draft.other_sport_name)
      ? draft.other_sport_name.trim()
      : (SPORTS.find((sport) => sport.code === code)?.label ?? code);
  const isTelegram = draft.preferred_contact === "telegram";
  const hasEndurance = draft.sports.some((code) => code === "run" || code === "bike" || code === "swim");

  return (
    <>
      <header>
        <div className="wrap hbar">
          <div className="t">
            <span className="dot" />
            1:1 coaching · new client
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
          <span className="eyebrow">Step 1 · You</span>
          <h2>Let&apos;s meet</h2>
          <p className="lede">
            This form takes about 10 minutes. Your answers are the base of your first
            week of training.
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

          <div className={`f${bad("preferred_contact")}`}>
            <label>
              Where should I message you? <span className="req">*</span>
            </label>
            <div className="hint">We talk there every day: your plan, your questions, my feedback</div>
            {chipsOne("preferred_contact", CONTACTS)}
            {err("preferred_contact")}
          </div>

          {draft.preferred_contact ? (
            <div className={`f${bad("contact_handle")}`}>
              <label htmlFor="contact_handle">
                {isTelegram ? "Telegram username" : "WhatsApp number"}{" "}
                <span className="req">*</span>
              </label>
              <div className="hint">
                {isTelegram
                  ? "For example: @yourname"
                  : "With country code, for example +971 50 123 4567"}
              </div>
              <input
                id="contact_handle"
                type="text"
                inputMode={isTelegram ? "text" : "tel"}
                autoComplete={isTelegram ? "off" : "tel"}
                autoCapitalize="none"
                spellCheck={false}
                placeholder={isTelegram ? "@yourname" : "+971 50 123 4567"}
                value={draft.contact_handle}
                onChange={(event) => set("contact_handle", event.target.value)}
              />
              {err("contact_handle")}
            </div>
          ) : null}

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
            <div className="hint">So I can plan around your weather and heat</div>
            <input
              id="city"
              type="text"
              placeholder="For example: Dubai, UAE"
              value={draft.city}
              onChange={(event) => set("city", event.target.value)}
            />
            {err("city")}
          </div>

          <div className="f">
            <label htmlFor="timezone">Time zone</label>
            <div className="hint">Optional. Tap the field and I fill it from your phone</div>
            <input
              id="timezone"
              type="text"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="For example: Asia/Dubai or GMT+4"
              value={draft.timezone}
              onFocus={suggestTimezone}
              onChange={(event) => set("timezone", event.target.value)}
            />
          </div>

          <div className="row">
            <div className="f">
              <label htmlFor="birth_date">Date of birth</label>
              <div className="hint">Optional</div>
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
              {chipsOne("sex", SEX)}
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
          <span className="eyebrow">Step 2 · Goals and races</span>
          <h2>Where do you want to go?</h2>
          <p className="lede">Your goal and your races set the shape of the whole plan.</p>

          <div className={`f${bad("goal")}`}>
            <label htmlFor="goal">
              What is your main goal? <span className="req">*</span>
            </label>
            <div className="hint">A race, a time, a distance, or just training well and staying healthy</div>
            <textarea
              id="goal"
              placeholder="For example: finish my first 70.3 strong. Or: half marathon under 1:45"
              value={draft.goal}
              onChange={(event) => set("goal", event.target.value)}
            />
            {err("goal")}
          </div>

          <div className="f">
            <label>Races you have planned</label>
            <div className="hint">Optional. Name, date and distance. Add a line for each race</div>
            <div className="pr">
              {draft.races.map((race, index) => (
                <div className="f" key={index} style={{ marginBottom: 6 }}>
                  <input
                    type="text"
                    aria-label={`Race ${index + 1} name`}
                    placeholder="Race name, for example: Ironman 70.3 Bahrain"
                    value={race.name}
                    onChange={(event) => setRace(index, "name", event.target.value)}
                  />
                  <div className="row" style={{ marginTop: 8 }}>
                    <input
                      type="date"
                      aria-label={`Race ${index + 1} date`}
                      value={race.date}
                      onChange={(event) => setRace(index, "date", event.target.value)}
                    />
                    <input
                      type="text"
                      aria-label={`Race ${index + 1} distance`}
                      placeholder="Distance: 70.3, 10K..."
                      value={race.distance}
                      onChange={(event) => setRace(index, "distance", event.target.value)}
                    />
                  </div>
                  {draft.races.length > 1 ? (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ marginTop: 8, padding: "8px 14px", fontSize: 14 }}
                      onClick={() => removeRace(index)}
                    >
                      Remove this race
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {draft.races.length < 8 ? (
              <button
                type="button"
                className="btn ghost"
                style={{ marginTop: 6, padding: "10px 16px", fontSize: 14.5 }}
                onClick={addRace}
              >
                + Add another race
              </button>
            ) : null}
          </div>

          <div className={`f${bad("coach_expectations")}`}>
            <label htmlFor="coach_expectations">
              What do you want from a coach? <span className="req">*</span>
            </label>
            <div className="hint">A clear plan, feedback, someone to keep you on track, fewer injuries...</div>
            <textarea
              id="coach_expectations"
              placeholder="For example: a plan that fits my work, and honest feedback on my sessions"
              value={draft.coach_expectations}
              onChange={(event) => set("coach_expectations", event.target.value)}
            />
            {err("coach_expectations")}
          </div>

          <div className="f">
            <label>Have you worked with a coach before?</label>
            {chipsOne("coaching_experience", EXPERIENCE)}
          </div>

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
          <span className="eyebrow">Step 3 · Your week now</span>
          <h2>How you train today</h2>
          <p className="lede">Your week now is the starting point. I build from here, not from zero.</p>

          <div className={`f${bad("sports")}`}>
            <label>
              Which sports do you do? <span className="req">*</span>
            </label>
            <div className="chips">
              {SPORTS.map((sport) => (
                <label className="chip" key={sport.code}>
                  <input
                    type="checkbox"
                    checked={draft.sports.includes(sport.code)}
                    onChange={() => toggleSport(sport.code)}
                  />
                  <span>{sport.label}</span>
                </label>
              ))}
            </div>
            {err("sports")}
          </div>

          {draft.sports.includes("other") ? (
            <div className="f">
              <label htmlFor="other_sport_name">Which other sport?</label>
              <input
                id="other_sport_name"
                type="text"
                placeholder="For example: yoga, padel"
                value={draft.other_sport_name}
                onChange={(event) => set("other_sport_name", event.target.value)}
              />
            </div>
          ) : null}

          {draft.sports.length > 0 ? (
            <div className="f">
              <label>For each sport: sessions per week and hours per week</label>
              <div className="hint">A typical week, roughly is fine</div>
              <div className="pr">
                {SPORTS.filter((sport) => draft.sports.includes(sport.code)).map((sport) => (
                  <div className="pr-row" key={sport.code}>
                    <span className="d">{sportLabel(sport.code)}</span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div className="suffix">
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`${sportLabel(sport.code)} sessions per week`}
                          placeholder="0"
                          value={draft.sport_week[sport.code].sessions}
                          onChange={(event) =>
                            setSportWeek(sport.code, "sessions", event.target.value)
                          }
                        />
                        <span>/wk</span>
                      </div>
                      <div className="suffix">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`${sportLabel(sport.code)} hours per week`}
                          placeholder="0"
                          value={draft.sport_week[sport.code].hours}
                          onChange={(event) =>
                            setSportWeek(sport.code, "hours", event.target.value)
                          }
                        />
                        <span>h</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className={`f${bad("total_hours")}`}>
            <label htmlFor="total_hours">
              How many hours per week can you train in total? <span className="req">*</span>
            </label>
            <div className="hint">Be realistic: what fits with work, family and sleep</div>
            <div className="suffix">
              <input
                id="total_hours"
                type="text"
                inputMode="decimal"
                placeholder="For example: 8"
                value={draft.total_hours}
                onChange={(event) => set("total_hours", event.target.value)}
              />
              <span>h / week</span>
            </div>
            {err("total_hours")}
          </div>

          <div className="f">
            <label>Which days can you train?</label>
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
          </div>

          <div className="f">
            <label>What time of day can you train?</label>
            {chipsMulti("time_of_day", TIME_OF_DAY, "time_of_day")}
          </div>

          <div className="f">
            <label htmlFor="long_session_days">Which days fit your long sessions?</label>
            <div className="hint">Long run, long ride, or anything over 1.5 hours</div>
            <input
              id="long_session_days"
              type="text"
              placeholder="For example: long ride Saturday morning, long run Sunday"
              value={draft.long_session_days}
              onChange={(event) => set("long_session_days", event.target.value)}
            />
          </div>

          {hasEndurance ? (
            <div className="f">
              <label>Your longest session in the last 2 months</label>
              <div className="hint">Distance or time</div>
              <div className="pr">
                {draft.sports.includes("run") ? (
                  <div className="pr-row">
                    <span className="d">Run</span>
                    <input
                      type="text"
                      aria-label="Longest recent run"
                      placeholder="For example: 18 km"
                      value={draft.longest_run}
                      onChange={(event) => set("longest_run", event.target.value)}
                    />
                  </div>
                ) : null}
                {draft.sports.includes("bike") ? (
                  <div className="pr-row">
                    <span className="d">Ride</span>
                    <input
                      type="text"
                      aria-label="Longest recent ride"
                      placeholder="For example: 90 km or 3 h"
                      value={draft.longest_ride}
                      onChange={(event) => set("longest_ride", event.target.value)}
                    />
                  </div>
                ) : null}
                {draft.sports.includes("swim") ? (
                  <div className="pr-row">
                    <span className="d">Swim</span>
                    <input
                      type="text"
                      aria-label="Longest recent swim"
                      placeholder="For example: 2000 m"
                      value={draft.longest_swim}
                      onChange={(event) => set("longest_swim", event.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="f">
            <label htmlFor="recent_results">Recent results and personal bests</label>
            <div className="hint">Optional. Race times, FTP, swim pace per 100 m, with the year</div>
            <textarea
              id="recent_results"
              placeholder="For example: 10K 48:30 (2026), 70.3 in 5:58 (2025), FTP 230 W"
              value={draft.recent_results}
              onChange={(event) => set("recent_results", event.target.value)}
            />
          </div>

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(2)}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={() => goNext(4)}>
              Next &rarr;
            </button>
          </div>
        </section>

        {/* STEP 4 */}
        <section className={`step${step === 4 ? " on" : ""}`}>
          <span className="eyebrow">Step 4 · Tools</span>
          <h2>What you train with</h2>
          <p className="lede">So I know what data I can see and what workouts you can do.</p>

          <div className="f">
            <label>Watch and devices</label>
            {chipsMulti("gadgets", DEVICES, "gadgets")}
          </div>

          <div className="f">
            <label>Which platforms do you use?</label>
            {chipsMulti("platforms", PLATFORMS, "platforms")}
          </div>

          <div className="f">
            <label htmlFor="strava_url">Strava profile link</label>
            <div className="hint">Optional. It helps me see your training history faster</div>
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

          <div className="row">
            <div className="f">
              <label>Heart rate strap?</label>
              {chipsOne("hr_strap", yesNo)}
            </div>
            <div className="f">
              <label>Power meter?</label>
              {chipsOne("power_meter", yesNo)}
            </div>
          </div>

          <div className="f">
            <label>What can you use indoors?</label>
            {chipsMulti("indoor", INDOOR, "indoor")}
          </div>

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(3)}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={() => goNext(5)}>
              Next &rarr;
            </button>
          </div>
        </section>

        {/* STEP 5 */}
        <section className={`step${step === 5 ? " on" : ""}`}>
          <span className="eyebrow">Step 5 · Health</span>
          <h2>Safety first</h2>
          <p className="lede">This shapes how fast I build your load.</p>

          <div className="med">
            <div className="note">
              <span className="i">!</span>
              <span>
                Only I see this. I use it to choose a safe load. I don&apos;t share it
                with anyone.
              </span>
            </div>

            <div className={`f${bad("health_injuries")}`}>
              <label htmlFor="health_injuries">
                Any injuries now or in the last 12 months? <span className="req">*</span>
              </label>
              <div className="hint">What, when, and how it is now. If none, write &quot;no&quot;</div>
              <textarea
                id="health_injuries"
                placeholder="For example: Achilles pain in March, fine now"
                value={draft.health_injuries}
                onChange={(event) => set("health_injuries", event.target.value)}
              />
              {err("health_injuries")}
            </div>

            <div className={`f${bad("health_chronic")}`}>
              <label htmlFor="health_chronic">
                Any health conditions or medications that affect training?{" "}
                <span className="req">*</span>
              </label>
              <div className="hint">Heart, blood pressure, asthma, anything else. If none, write &quot;no&quot;</div>
              <textarea
                id="health_chronic"
                placeholder="For example: no. Or: mild asthma, I use an inhaler"
                value={draft.health_chronic}
                onChange={(event) => set("health_chronic", event.target.value)}
              />
              {err("health_chronic")}
            </div>

            <div className="row">
              <div className="f">
                <label htmlFor="sleep_hours">Sleep per night</label>
                <div className="suffix">
                  <input
                    id="sleep_hours"
                    type="text"
                    inputMode="decimal"
                    placeholder="7"
                    value={draft.sleep_hours}
                    onChange={(event) => set("sleep_hours", event.target.value)}
                  />
                  <span>h</span>
                </div>
              </div>
              <div className="f">
                <label>Energy level</label>
                <div className="hint">1 is very low, 5 is great</div>
                {chipsOne(
                  "energy_level",
                  ENERGY.map((value) => ({ code: value, label: value }))
                )}
              </div>
            </div>

            <div className="f">
              <label htmlFor="health_discomfort">
                Anything about health, energy or your cycle you&apos;d like me to know (optional)
              </label>
              <textarea
                id="health_discomfort"
                placeholder="Anything that helps me plan your load"
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
              I have no medical reasons not to exercise. If unsure, I&apos;ll talk to a
              doctor. <span className="req">*</span>
            </span>
          </label>
          {err("health_disclaimer_accepted")}

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(4)}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={() => goNext(6)}>
              Next &rarr;
            </button>
          </div>
        </section>

        {/* STEP 6 */}
        <section className={`step${step === 6 ? " on" : ""}`}>
          <span className="eyebrow">Step 6 · Anything else</span>
          <h2>Last one</h2>
          <p className="lede">Work, travel, family, what worked or didn&apos;t work before.</p>

          <div className="f">
            <label htmlFor="why_intensive">Anything else I should know?</label>
            <div className="hint">Optional</div>
            <textarea
              id="why_intensive"
              placeholder="For example: I travel for work twice a month and can only use hotel gyms then"
              value={draft.why_intensive}
              onChange={(event) => set("why_intensive", event.target.value)}
            />
          </div>

          {sendError ? <div className="sendfail">{sendError}</div> : null}

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(5)} disabled={sending}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={submit} disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </section>

        {/* DONE */}
        <section className={`step${step === DONE_STEP ? " on" : ""}`}>
          <div className="done">
            <div className="tick">&#10003;</div>
            <h2>Form sent</h2>
            <p>
              Thanks! I&apos;ll read your answers and build your first week. I&apos;ll
              message you on WhatsApp or Telegram within 24 hours.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
