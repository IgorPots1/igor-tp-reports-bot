"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { PRIVACY_EN_PATH } from "@/lib/privacy-en";

// Onboarding form for new 1:1 coaching clients (/coaching/start, 60 EUR/month).
// Same look as /trial/apply (apply.css), 6 steps. Covers run, bike and swim so
// it works for triathletes, but every sport block only shows when that sport is
// chosen, so a pure runner sees a short form. Posts to /api/intensive/apply
// with source=coaching-en: the route files it under flow_number "coaching-en",
// outside the Russian flow and its seat counter, and keeps the answers that
// have no column as a readable block in why_intensive.
//
// No contact fields: clients get this link from Igor in DMs, so he already
// knows who they are. The link may carry ?c=<chat id> (same as /breakdown);
// it is sent as "c" and lands in the header block, so the form can be matched
// to the chat. Without c the name is enough.

const TOTAL_STEPS = 6;
const DONE_STEP = 7;

/** Day codes match available_days text[] in the DB: ['mon','tue',...]. */
const DAYS: { code: string; label: string; full: string }[] = [
  { code: "mon", label: "Mon", full: "Monday" },
  { code: "tue", label: "Tue", full: "Tuesday" },
  { code: "wed", label: "Wed", full: "Wednesday" },
  { code: "thu", label: "Thu", full: "Thursday" },
  { code: "fri", label: "Fri", full: "Friday" },
  { code: "sat", label: "Sat", full: "Saturday" },
  { code: "sun", label: "Sun", full: "Sunday" },
];

const SEX = [
  { code: "female", label: "Female" },
  { code: "male", label: "Male" },
];

const EXPERIENCE = [
  { code: "never", label: "Never" },
  { code: "some", label: "Some (apps or ready-made plans)" },
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

/** Devices; "bike" ones only show when Bike is chosen. */
const DEVICES: { value: string; bike?: boolean }[] = [
  { value: "Garmin" },
  { value: "Apple Watch" },
  { value: "Coros" },
  { value: "Polar" },
  { value: "Suunto" },
  { value: "Wahoo" },
  { value: "Bike computer", bike: true },
  { value: "Phone only" },
];

const PLATFORMS = ["TrainingPeaks", "Strava", "Garmin Connect", "Other", "None"];

/** Indoor options; each one only shows for the sport it belongs to. */
const INDOOR: { value: string; sport?: SportCode }[] = [
  { value: "Treadmill", sport: "run" },
  { value: "Smart trainer", sport: "bike" },
  { value: "Pool access", sport: "swim" },
  { value: "Gym access" },
  { value: "None" },
];

const YES_NO = [
  { code: "yes", label: "Yes" },
  { code: "no", label: "No" },
];

const ENERGY = ["1", "2", "3", "4", "5"].map((value) => ({ code: value, label: value }));

type Race = { name: string; date: string; distance: string };

type SportWeek = { sessions: string; hours: string };

type Draft = {
  full_name: string;
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
  privacy_consent: boolean;
  why_intensive: string;
};

type ErrorKey =
  | "full_name"
  | "goal"
  | "sports"
  | "total_hours"
  | "health_injuries"
  | "health_chronic"
  | "health_disclaimer_accepted"
  | "privacy_consent";

const EMPTY_WEEK: SportWeek = { sessions: "", hours: "" };

const EMPTY: Draft = {
  full_name: "",
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
  privacy_consent: false,
  why_intensive: "",
};

type ListKey = "available_days" | "time_of_day" | "gadgets" | "platforms" | "indoor";

type OneKey = "hr_strap" | "power_meter" | "energy_level" | "sex" | "coaching_experience";

function blank(value: string): boolean {
  return value.trim().length === 0;
}

/** Chat id from ?c=, same cleaning as /breakdown: letters, digits, _ and -. */
function cleanChatId(raw: string | null): string {
  return (raw ?? "").replace(/[^\w-]/gu, "").slice(0, 64);
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
  const params = useSearchParams();
  const chatId = cleanChatId(params.get("c"));

  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const hasRun = draft.sports.includes("run");
  const hasBike = draft.sports.includes("bike");
  const hasSwim = draft.sports.includes("swim");
  const hasEndurance = hasRun || hasBike || hasSwim;
  const isTri = [hasRun, hasBike, hasSwim].filter(Boolean).length >= 2;

  const deviceOptions = DEVICES.filter((item) => !item.bike || hasBike).map((item) => item.value);
  const indoorOptions = INDOOR.filter((item) => !item.sport || draft.sports.includes(item.sport)).map(
    (item) => item.value
  );

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

  /** Required answers of one step. Only what the first week really needs. */
  function check(current: number): Partial<Record<ErrorKey, string>> {
    const found: Partial<Record<ErrorKey, string>> = {};
    if (current === 1) {
      if (blank(draft.full_name)) found.full_name = "Please write your name";
    }
    if (current === 2) {
      if (blank(draft.goal)) found.goal = "Please write your main goal";
    }
    if (current === 3) {
      if (draft.sports.length === 0) found.sports = "Please choose at least one sport";
      if (blank(draft.total_hours)) {
        found.total_hours = "Please write how many hours per week you can train";
      }
    }
    if (current === 5) {
      if (blank(draft.health_injuries)) {
        found.health_injuries = "Please answer. If you have no injuries, write \"no\"";
      }
      if (blank(draft.health_chronic)) {
        found.health_chronic = "Please answer. If there is nothing, write \"no\"";
      }
      if (!draft.health_disclaimer_accepted) {
        found.health_disclaimer_accepted = "Please tick this box to continue";
      }
      if (!draft.privacy_consent) {
        found.privacy_consent = "Please tick this box. I can't plan your training without it";
      }
    }
    return found;
  }

  function validate(current: number): boolean {
    const found = check(current);
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
    if (chatId) payload.append("c", chatId);
    payload.append("full_name", draft.full_name);
    payload.append("races_this_year", racesText(draft.races));
    for (const code of draft.sports) {
      payload.append("sports", code);
      payload.append(`sessions_${code}`, draft.sport_week[code].sessions);
      payload.append(`hours_${code}`, draft.sport_week[code].hours);
    }
    if (draft.sports.includes("other")) payload.append("other_sport_name", draft.other_sport_name);
    // Sport answers only for the sports that are still chosen: a value typed
    // before unticking a sport must not reach the coach.
    if (hasRun) payload.append("longest_run", draft.longest_run);
    if (hasBike) payload.append("longest_ride", draft.longest_ride);
    if (hasSwim) payload.append("longest_swim", draft.longest_swim);
    if (hasBike) payload.append("power_meter", draft.power_meter);

    const plain: (keyof Draft)[] = [
      "city",
      "timezone",
      "birth_date",
      "sex",
      "goal",
      "coach_expectations",
      "coaching_experience",
      "total_hours",
      "long_session_days",
      "recent_results",
      "strava_url",
      "hr_strap",
      "health_injuries",
      "health_chronic",
      "sleep_hours",
      "energy_level",
      "health_discomfort",
      "why_intensive",
    ];
    for (const key of plain) payload.append(key, String(draft[key]));
    for (const item of draft.available_days) payload.append("available_days", item);
    for (const item of draft.time_of_day) payload.append("time_of_day", item);
    for (const item of draft.platforms) payload.append("platforms", item);
    for (const item of draft.gadgets.filter((value) => deviceOptions.includes(value))) {
      payload.append("gadgets", item);
    }
    for (const item of draft.indoor.filter((value) => indoorOptions.includes(value))) {
      payload.append("indoor", item);
    }
    payload.append(
      "health_disclaimer_accepted",
      draft.health_disclaimer_accepted ? "true" : "false"
    );
    payload.append("privacy_consent", draft.privacy_consent ? "true" : "false");

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
      setSendError("Could not send the form. Check your internet connection and try again.");
    }
    setSending(false);
  }

  const progress = (Math.min(step, TOTAL_STEPS) / TOTAL_STEPS) * 100;
  const counter = step > TOTAL_STEPS ? "Done" : `Step ${step} of ${TOTAL_STEPS}`;

  function err(key: ErrorKey) {
    return errors[key] ? (
      <div className="emsg" id={`${key}-error`} role="alert">
        {errors[key]}
      </div>
    ) : null;
  }
  function bad(key: ErrorKey) {
    return errors[key] ? " bad" : "";
  }
  /** aria props for a field that can show an error. */
  function invalid(key: ErrorKey) {
    return errors[key]
      ? { "aria-invalid": true as const, "aria-describedby": `${key}-error` }
      : {};
  }

  function chipsMulti(key: ListKey, options: string[], labelId: string) {
    return (
      <div className="chips" role="group" aria-labelledby={labelId}>
        {options.map((option) => (
          <label className="chip" key={option}>
            <input
              type="checkbox"
              name={key}
              checked={draft[key].includes(option)}
              onChange={() => toggle(key, option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }

  function chipsOne(key: OneKey, options: { code: string; label: string }[], labelId: string) {
    return (
      <div className="chips" role="radiogroup" aria-labelledby={labelId}>
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

  const sportLabel = (code: SportCode) =>
    code === "other" && !blank(draft.other_sport_name)
      ? draft.other_sport_name.trim()
      : (SPORTS.find((sport) => sport.code === code)?.label ?? code);

  const resultsHint = isTri || hasBike || hasSwim
    ? "Optional. Race times with the year, FTP, swim pace per 100 m"
    : "Optional. Race times with the year";
  const resultsPlaceholder = isTri || hasBike || hasSwim
    ? "For example: 70.3 in 5:58 (2025), FTP 230 W, swim 2:05 per 100 m"
    : "For example: 5K 23:10 (2026), half marathon 1:52 (2025)";
  const linkStyle = { color: "var(--accent)", fontWeight: 600, textDecoration: "underline" };

  return (
    <>
      <header>
        <div className="wrap hbar">
          <div className="t">
            <span className="dot" />
            1:1 coaching · new client
          </div>
          <div className="c" aria-live="polite">
            {counter}
          </div>
        </div>
        <div className="prog" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="wrap">
        {/* STEP 1 */}
        <section className={`step${step === 1 ? " on" : ""}`}>
          <span className="eyebrow">Step 1 · You</span>
          <h2>Let&apos;s meet</h2>
          <p className="lede">
            This form takes about 10 minutes. I use your answers to build your
            first week of training. Only your name is required here.
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
              required
              {...invalid("full_name")}
            />
            {err("full_name")}
          </div>

          <div className="f">
            <label htmlFor="city">City and country</label>
            <div className="hint" id="city-hint">
              Optional. It helps me plan for your weather and heat
            </div>
            <input
              id="city"
              type="text"
              autoComplete="address-level2"
              aria-describedby="city-hint"
              placeholder="For example: Dubai, UAE"
              value={draft.city}
              onChange={(event) => set("city", event.target.value)}
            />
          </div>

          <div className="f">
            <label htmlFor="timezone">Time zone</label>
            <div className="hint" id="timezone-hint">
              Optional. Tap the field to fill it in from your phone
            </div>
            <input
              id="timezone"
              type="text"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="timezone-hint"
              placeholder="For example: Asia/Dubai or GMT+4"
              value={draft.timezone}
              onFocus={suggestTimezone}
              onChange={(event) => set("timezone", event.target.value)}
            />
          </div>

          <div className="row">
            <div className="f">
              <label htmlFor="birth_date">Date of birth</label>
              <div className="hint">Optional. I use your age to set heart rate zones</div>
              <input
                id="birth_date"
                type="date"
                autoComplete="bday"
                min="1930-01-01"
                max="2015-12-31"
                value={draft.birth_date}
                onChange={(event) => set("birth_date", event.target.value)}
              />
            </div>
            <div className="f">
              <label id="sex-label">Sex</label>
              <div className="hint">Optional</div>
              {chipsOne("sex", SEX, "sex-label")}
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
          <h2>Your goals</h2>
          <p className="lede">Your goal and your races shape the whole plan.</p>

          <div className={`f${bad("goal")}`}>
            <label htmlFor="goal">
              What is your main goal? <span className="req">*</span>
            </label>
            <div className="hint">
              A race, a finish time, a distance, or simply to train well and stay healthy
            </div>
            <textarea
              id="goal"
              placeholder="For example: finish my first 70.3 feeling strong. Or: half marathon under 1:45"
              value={draft.goal}
              onChange={(event) => set("goal", event.target.value)}
              required
              {...invalid("goal")}
            />
            {err("goal")}
          </div>

          <div className="f">
            <label id="races-label">Races you have planned</label>
            <div className="hint">Optional. Name, date and distance. One block for each race</div>
            <div className="pr" role="group" aria-labelledby="races-label">
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
                      Remove race {index + 1}
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

          <div className="f">
            <label htmlFor="coach_expectations">What do you want from a coach?</label>
            <div className="hint">
              Optional. For example: a clear plan, feedback on your sessions, help to
              stay consistent, fewer injuries
            </div>
            <textarea
              id="coach_expectations"
              placeholder="For example: a plan that fits my work, and honest feedback on my sessions"
              value={draft.coach_expectations}
              onChange={(event) => set("coach_expectations", event.target.value)}
            />
          </div>

          <div className="f">
            <label id="coaching_experience-label">Have you worked with a coach before?</label>
            {chipsOne("coaching_experience", EXPERIENCE, "coaching_experience-label")}
          </div>

          <div className="nav">
            <button className="btn ghost" type="button" aria-label="Back" onClick={() => goBack(1)}>
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
          <p className="lede">I start from your current week, not from zero.</p>

          <div className={`f${bad("sports")}`}>
            <label id="sports-label">
              Which sports do you do? <span className="req">*</span>
            </label>
            <div className="hint">Choose all that apply. Triathletes: choose Run, Bike and Swim</div>
            <div
              className="chips"
              role="group"
              aria-labelledby="sports-label"
              {...(errors.sports ? { "aria-describedby": "sports-error" } : {})}
            >
              {SPORTS.map((sport) => (
                <label className="chip" key={sport.code}>
                  <input
                    type="checkbox"
                    name="sports"
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
              <label id="sport-week-label">How much do you do in a normal week?</label>
              <div className="hint">Sessions per week and hours per week for each sport. Rough numbers are fine</div>
              <div className="pr" role="group" aria-labelledby="sport-week-label">
                {SPORTS.filter((sport) => draft.sports.includes(sport.code)).map((sport) => (
                  <div className="pr-row" key={sport.code}>
                    <span className="d">{sportLabel(sport.code)}</span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div className="suffix">
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`${sportLabel(sport.code)}: sessions per week`}
                          placeholder="0"
                          value={draft.sport_week[sport.code].sessions}
                          onChange={(event) =>
                            setSportWeek(sport.code, "sessions", event.target.value)
                          }
                        />
                        <span aria-hidden="true">times</span>
                      </div>
                      <div className="suffix">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`${sportLabel(sport.code)}: hours per week`}
                          placeholder="0"
                          value={draft.sport_week[sport.code].hours}
                          onChange={(event) =>
                            setSportWeek(sport.code, "hours", event.target.value)
                          }
                        />
                        <span aria-hidden="true">h</span>
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
            <div className="hint">Be realistic: what fits around work, family and sleep</div>
            <div className="suffix">
              <input
                id="total_hours"
                type="text"
                inputMode="decimal"
                placeholder="For example: 8"
                value={draft.total_hours}
                onChange={(event) => set("total_hours", event.target.value)}
                required
                {...invalid("total_hours")}
              />
              <span aria-hidden="true">h / week</span>
            </div>
            {err("total_hours")}
          </div>

          <div className="f">
            <label id="days-label">Which days can you train?</label>
            <div className="chips" role="group" aria-labelledby="days-label">
              {DAYS.map((option) => (
                <label className="chip day" key={option.code}>
                  <input
                    type="checkbox"
                    name="available_days"
                    aria-label={option.full}
                    checked={draft.available_days.includes(option.code)}
                    onChange={() => toggle("available_days", option.code)}
                  />
                  <span aria-hidden="true">{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="f">
            <label id="time_of_day-label">What time of day can you train?</label>
            {chipsMulti("time_of_day", TIME_OF_DAY, "time_of_day-label")}
          </div>

          <div className="f">
            <label htmlFor="long_session_days">Which days are best for your long sessions?</label>
            <div className="hint">
              {hasBike ? "Long run, long ride, or anything over 1.5 hours" : "For example your long run"}
            </div>
            <input
              id="long_session_days"
              type="text"
              placeholder={
                hasBike
                  ? "For example: long ride Saturday morning, long run Sunday"
                  : "For example: Sunday morning"
              }
              value={draft.long_session_days}
              onChange={(event) => set("long_session_days", event.target.value)}
            />
          </div>

          {hasEndurance ? (
            <div className="f">
              <label id="longest-label">Your longest session in the last 2 months</label>
              <div className="hint">Distance or time</div>
              <div className="pr" role="group" aria-labelledby="longest-label">
                {hasRun ? (
                  <div className="pr-row">
                    <span className="d">Run</span>
                    <input
                      type="text"
                      aria-label="Longest run in the last 2 months"
                      placeholder="For example: 18 km"
                      value={draft.longest_run}
                      onChange={(event) => set("longest_run", event.target.value)}
                    />
                  </div>
                ) : null}
                {hasBike ? (
                  <div className="pr-row">
                    <span className="d">Ride</span>
                    <input
                      type="text"
                      aria-label="Longest ride in the last 2 months"
                      placeholder="For example: 90 km or 3 h"
                      value={draft.longest_ride}
                      onChange={(event) => set("longest_ride", event.target.value)}
                    />
                  </div>
                ) : null}
                {hasSwim ? (
                  <div className="pr-row">
                    <span className="d">Swim</span>
                    <input
                      type="text"
                      aria-label="Longest swim in the last 2 months"
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
            <div className="hint">{resultsHint}</div>
            <textarea
              id="recent_results"
              placeholder={resultsPlaceholder}
              value={draft.recent_results}
              onChange={(event) => set("recent_results", event.target.value)}
            />
          </div>

          <div className="nav">
            <button className="btn ghost" type="button" aria-label="Back" onClick={() => goBack(2)}>
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
          <p className="lede">So I know what data I can see and which workouts you can do.</p>

          <div className="f">
            <label id="gadgets-label">Which watch or devices do you use?</label>
            {chipsMulti("gadgets", deviceOptions, "gadgets-label")}
          </div>

          <div className="f">
            <label id="platforms-label">Which apps do you use for training?</label>
            {chipsMulti("platforms", PLATFORMS, "platforms-label")}
          </div>

          <div className="f">
            <label htmlFor="strava_url">Strava profile link</label>
            <div className="hint" id="strava-hint">
              Optional. It helps me see your training history faster
            </div>
            <input
              id="strava_url"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="strava-hint"
              placeholder="https://www.strava.com/athletes/..."
              value={draft.strava_url}
              onChange={(event) => set("strava_url", event.target.value)}
            />
          </div>

          <div className="row">
            <div className="f">
              <label id="hr_strap-label">Do you have a chest heart rate strap?</label>
              {chipsOne("hr_strap", YES_NO, "hr_strap-label")}
            </div>
            {hasBike ? (
              <div className="f">
                <label id="power_meter-label">Do you have a power meter on your bike?</label>
                {chipsOne("power_meter", YES_NO, "power_meter-label")}
              </div>
            ) : null}
          </div>

          <div className="f">
            <label id="indoor-label">What can you use for indoor training?</label>
            {chipsMulti("indoor", indoorOptions, "indoor-label")}
          </div>

          <div className="nav">
            <button className="btn ghost" type="button" aria-label="Back" onClick={() => goBack(3)}>
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
          <p className="lede">Your answers help me decide how fast to increase your training.</p>

          <div className="med">
            <div className="note">
              <span className="i" aria-hidden="true">!</span>
              <span>
                Only I read these answers. I use them to choose a safe training load
                and I never sell or share them. Read more in the{" "}
                <a href={PRIVACY_EN_PATH} target="_blank" rel="noopener" style={linkStyle}>
                  Privacy notice
                </a>
                .
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
                required
                {...invalid("health_injuries")}
              />
              {err("health_injuries")}
            </div>

            <div className={`f${bad("health_chronic")}`}>
              <label htmlFor="health_chronic">
                Any health conditions or medicines that affect training?{" "}
                <span className="req">*</span>
              </label>
              <div className="hint">
                For example heart, blood pressure, asthma, diabetes. If none, write &quot;no&quot;
              </div>
              <textarea
                id="health_chronic"
                placeholder="For example: no. Or: mild asthma, I use an inhaler"
                value={draft.health_chronic}
                onChange={(event) => set("health_chronic", event.target.value)}
                required
                {...invalid("health_chronic")}
              />
              {err("health_chronic")}
            </div>

            <div className="row">
              <div className="f">
                <label htmlFor="sleep_hours">How many hours do you sleep per night?</label>
                <div className="suffix">
                  <input
                    id="sleep_hours"
                    type="text"
                    inputMode="decimal"
                    placeholder="7"
                    value={draft.sleep_hours}
                    onChange={(event) => set("sleep_hours", event.target.value)}
                  />
                  <span aria-hidden="true">h</span>
                </div>
              </div>
              <div className="f">
                <label id="energy_level-label">Your energy level lately</label>
                <div className="hint">1 is very low, 5 is great</div>
                {chipsOne("energy_level", ENERGY, "energy_level-label")}
              </div>
            </div>

            <div className="f">
              <label htmlFor="health_discomfort">
                {draft.sex === "male"
                  ? "Anything else about your health or energy I should know?"
                  : "Anything else about your health, energy or menstrual cycle I should know?"}
              </label>
              <div className="hint">Optional</div>
              <textarea
                id="health_discomfort"
                placeholder="Anything that helps me plan your training load"
                value={draft.health_discomfort}
                onChange={(event) => set("health_discomfort", event.target.value)}
              />
            </div>
          </div>

          <label className={`check${errors.privacy_consent ? " bad" : ""}`}>
            <input
              type="checkbox"
              checked={draft.privacy_consent}
              onChange={(event) => set("privacy_consent", event.target.checked)}
              {...invalid("privacy_consent")}
            />
            <span>
              I agree to the processing of my data, including health information, to
              plan my training, as described in the{" "}
              <a href={PRIVACY_EN_PATH} target="_blank" rel="noopener" style={linkStyle}>
                Privacy notice
              </a>
              . <span className="req">*</span>
            </span>
          </label>
          {err("privacy_consent")}

          <label
            className={`check${errors.health_disclaimer_accepted ? " bad" : ""}`}
            style={{ marginTop: 10 }}
          >
            <input
              type="checkbox"
              checked={draft.health_disclaimer_accepted}
              onChange={(event) =>
                set("health_disclaimer_accepted", event.target.checked)
              }
              {...invalid("health_disclaimer_accepted")}
            />
            <span>
              I have no medical reasons not to exercise. If I am not sure, I will talk
              to a doctor first. <span className="req">*</span>
            </span>
          </label>
          {err("health_disclaimer_accepted")}

          <div className="nav">
            <button className="btn ghost" type="button" aria-label="Back" onClick={() => goBack(4)}>
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
          <h2>Almost done</h2>
          <p className="lede">
            Work, travel, family, what worked or did not work for you before.
          </p>

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

          {sendError ? (
            <div className="sendfail" role="alert">
              {sendError}
            </div>
          ) : null}

          <div className="nav">
            <button
              className="btn ghost"
              type="button"
              aria-label="Back"
              onClick={() => goBack(5)}
              disabled={sending}
            >
              &larr;
            </button>
            <button className="btn" type="button" onClick={submit} disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </section>

        {/* DONE */}
        <section className={`step${step === DONE_STEP ? " on" : ""}`}>
          <div className="done" role="status">
            <div className="tick" aria-hidden="true">&#10003;</div>
            <h2>Form sent</h2>
            <p>
              Thanks! I&apos;ll read your answers and build your first week. I&apos;ll
              message you within 24 hours.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
