"use client";

import { useEffect, useMemo, useState } from "react";

import ConsultNoticeEn from "@/components/ConsultNoticeEn";

import {
  defaultRaceDate,
  startOfDay,
  toIsoDate,
  type CountId,
  type KmId,
  type LastId,
  type PhaseId,
} from "../../calendar/calendar-logic";
import { buildCalendarEn } from "./calendar-logic-en";
import styles from "../../calendar/calendar.module.css";

type Option<T extends string> = { id: T; label: string };

const KM: Option<KmId>[] = [
  { id: "lt20", label: "Under 20 km a week" },
  { id: "20to30", label: "20-30 km" },
  { id: "30p", label: "30 km or more" },
];
const LAST: Option<LastId>[] = [
  { id: "none", label: "None" },
  { id: "10", label: "5-10 km" },
  { id: "21", label: "Half marathon" },
  { id: "42", label: "Marathon" },
];
const COUNT: Option<CountId>[] = [
  { id: "1to2", label: "1-2" },
  { id: "3to5", label: "3-5" },
  { id: "6p", label: "More than 5" },
];

const PHASE_CLASS: Record<PhaseId, string> = {
  rec: styles.cRec,
  off: styles.cOff,
  dev: styles.cDev,
  mp: styles.cMp,
  taper: styles.cTaper,
};
const KIND_CLASS: Record<string, string> = {
  ...PHASE_CLASS,
  long25: styles.cDev,
  long30: styles.cMp,
  key: styles.cMp,
  race: styles.cRace,
};

const PREFILL = "Hi Igor! I used your marathon calendar and I'd like a free consultation about my marathon build";

function Pills<T extends string>({
  labelId,
  options,
  value,
  onPick,
}: {
  labelId: string;
  options: Option<T>[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className={styles.seg} role="group" aria-labelledby={labelId}>
      {options.map((o) => (
        <button key={o.id} type="button" className={styles.pill} aria-pressed={value === o.id} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function MarathonCalendarEn() {
  // "Today" is taken only in the browser: the build server has another day and time zone.
  const [today, setToday] = useState<Date | null>(null);
  const [race, setRace] = useState("");
  const [km, setKm] = useState<KmId>("30p");
  const [last, setLast] = useState<LastId>("none");
  const [lastDate, setLastDate] = useState("");
  const [count, setCount] = useState<CountId>("1to2");

  useEffect(() => {
    const t = startOfDay(new Date());
    setToday(t);
    setRace(toIsoDate(defaultRaceDate(t)));
  }, []);

  const res = useMemo(
    () => (today ? buildCalendarEn({ race, km, last, lastDate, count }, today) : null),
    [today, race, km, last, lastDate, count],
  );

  return (
    <div className={styles.wrap} lang="en">
      <h1 className={styles.h1}>Marathon calendar</h1>
      <p className={styles.lede}>
        Enter your marathon date and get every date of your build: off-season, plan start, key sessions and the taper.
      </p>

      <div className={styles.field}>
        <label className={styles.lab} htmlFor="cal-race">
          Marathon date
        </label>
        <input id="cal-race" type="date" className={styles.date} value={race} onChange={(e) => setRace(e.target.value)} />
        <p className={styles.err} aria-live="polite">
          {res && !res.ok ? res.error : ""}
        </p>
      </div>

      <div className={styles.field}>
        <span className={styles.lab} id="cal-km">
          How much you run now
        </span>
        <Pills labelId="cal-km" options={KM} value={km} onPick={setKm} />
      </div>

      <div className={styles.field}>
        <span className={styles.lab} id="cal-last">
          Your last race
        </span>
        <Pills labelId="cal-last" options={LAST} value={last} onPick={setLast} />
      </div>

      {last !== "none" ? (
        <>
          <div className={styles.field}>
            <label className={styles.lab} htmlFor="cal-lastdate">
              When was it
            </label>
            <input
              id="cal-lastdate"
              type="date"
              className={styles.date}
              value={lastDate}
              max={today ? toIsoDate(today) : undefined}
              onChange={(e) => setLastDate(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.lab} id="cal-count">
              Races this season
            </span>
            <Pills labelId="cal-count" options={COUNT} value={count} onPick={setCount} />
          </div>
        </>
      ) : null}

      <section className={styles.out} hidden={!res?.ok} aria-labelledby="cal-now">
        {res?.ok ? (
          <>
            <div aria-live="polite" aria-atomic="true">
              <p className={styles.now} id="cal-now">
                Where you are now
              </p>
              <p className={styles.big}>{res.phaseNow}</p>
              <p className={styles.weeks}>{res.weeksText}</p>
              <p className={`${styles.warn} ${res.fits ? styles.warnOk : ""}`}>{res.note}</p>
            </div>

            <div className={styles.bar} role="img" aria-label={res.barLabel}>
              {res.bar.map((b) => (
                <span key={b.id} className={PHASE_CLASS[b.id]} style={{ width: `${b.pct}%` }} />
              ))}
            </div>
            <p className={styles.legend} aria-hidden="true">
              {res.bar.map((b) => (
                <span key={b.id}>
                  <i className={PHASE_CLASS[b.id]} />
                  {b.name}
                </span>
              ))}
            </p>

            <ol className={styles.tl}>
              {res.timeline.map((it) => (
                <li key={`${it.kind}-${it.when}`} className={`${KIND_CLASS[it.kind]} ${it.current ? styles.cur : ""}`}>
                  <span className={`${styles.when} ${styles.mono}`}>{it.when}</span>
                  <b>
                    {it.name}
                    {it.current ? <span className={styles.tag}>now</span> : null}
                  </b>
                  <p>{it.text}</p>
                </li>
              ))}
            </ol>

            <ConsultNoticeEn prefill={PREFILL} />
          </>
        ) : null}
      </section>

      <p className={styles.foot}>This is a timeline guide, not a ready-made training plan.</p>
    </div>
  );
}
