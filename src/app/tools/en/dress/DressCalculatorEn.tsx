"use client";

import { useEffect, useState } from "react";

import type { Precip, RunType, WindLevel, ZoneItem } from "../../dress/dress-logic";
import { calcDressEn, formatDegrees, toF } from "./dress-logic-en";
import styles from "../../dress/dress.module.css";
import ConsultNoticeEn from "@/components/ConsultNoticeEn";

const STORAGE_KEY = "igorp-dress-calc-v1";

const WIND_OPTIONS: Array<[WindLevel, string]> = [
  [0, "No wind"],
  [-2, "Moderate"],
  [-5, "Strong"],
];

const PRECIP_OPTIONS: Array<[Precip, string]> = [
  ["none", "None"],
  ["rain", "Rain"],
  ["snow", "Snow"],
];

const RUN_OPTIONS: Array<[RunType, string]> = [
  [0, "Easy"],
  [-1, "Long"],
  [3, "Intervals"],
];

type ZoneRow = { label: string; item: ZoneItem | null };

function ZoneValue({ item }: { item: ZoneItem | null }) {
  if (!item) {
    return <span className={`${styles.items} ${styles.itemsMuted}`}>nothing needed</span>;
  }
  return (
    <span className={item.muted ? `${styles.items} ${styles.itemsMuted}` : styles.items}>
      {item.text}
      {item.note ? <small className={styles.itemsNote}>{item.note}</small> : null}
    </span>
  );
}

export default function DressCalculatorEn() {
  const [t, setT] = useState(3);
  const [wind, setWind] = useState<WindLevel>(0);
  const [precip, setPrecip] = useState<Precip>("none");
  const [run, setRun] = useState<RunType>(0);
  const [feel, setFeel] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved.feel === "number") setFeel(saved.feel);
    } catch {
      // private mode or blocked: keep the default
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ feel }));
    } catch {
      // private mode or blocked: just don't remember
    }
  }, [feel]);

  const { dress, outfit, why } = calcDressEn({ t, wind, precip, run, feel });

  const zoneRows: ZoneRow[] = [
    { label: "Head", item: outfit.head },
    { label: "Neck", item: outfit.neck },
    { label: "Body", item: outfit.body },
    { label: "Hands", item: outfit.hands },
    { label: "Legs", item: outfit.legs },
    { label: "Feet", item: { text: outfit.socks, note: outfit.shoeNote } },
  ];

  return (
    <div className={styles.wrap} lang="en">
      <h1 className={styles.title}>
        What to wear
        <br />
        for your run
      </h1>
      <p className={styles.lede}>
        Set the weather and your session. Running warms you up by about 10 degrees (°C), so the outfit is picked with that
        in mind.
      </p>

      <div className={styles.temp} aria-live="polite">
        <span className={styles.tempNow}>{formatDegrees(t)}C</span>
        <span className={styles.tempCap}>outside · {toF(t)}°F</span>
      </div>
      <label htmlFor="dress-t" className={styles.visuallyHidden}>
        Temperature outside
      </label>
      <input
        id="dress-t"
        className={styles.range}
        type="range"
        min={-25}
        max={30}
        step={1}
        value={t}
        onChange={(e) => setT(Number(e.target.value))}
      />
      <div className={styles.scale}>
        <span>−25°C</span>
        <span>0°C</span>
        <span>+30°C</span>
      </div>
      <p className={styles.shift}>
        Dress as if it were <b className={styles.shiftValue}>{formatDegrees(dress)}C</b> ({toF(dress)}°F)
      </p>

      <div className={styles.controls}>
        <div>
          <p className={styles.fieldName} id="dress-wind-label">
            Wind
          </p>
          <div className={styles.seg} role="group" aria-labelledby="dress-wind-label">
            {WIND_OPTIONS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={wind === value} onClick={() => setWind(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className={styles.fieldName} id="dress-precip-label">
            Rain or snow
          </p>
          <div className={styles.seg} role="group" aria-labelledby="dress-precip-label">
            {PRECIP_OPTIONS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={precip === value} onClick={() => setPrecip(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className={styles.fieldName} id="dress-run-label">
            Session
          </p>
          <div className={styles.seg} role="group" aria-labelledby="dress-run-label">
            {RUN_OPTIONS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={run === value} onClick={() => setRun(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={styles.fieldName} htmlFor="dress-feel" style={{ display: "block" }}>
            On a run I usually feel
          </label>
          <input
            id="dress-feel"
            className={styles.range}
            type="range"
            min={-3}
            max={3}
            step={1}
            value={feel}
            onChange={(e) => setFeel(Number(e.target.value))}
          />
          <div className={styles.feelRow}>
            <span>Cold</span>
            <span>Fine</span>
            <span>Hot</span>
          </div>
        </div>
      </div>

      <section className={styles.result} aria-live="polite">
        <hr className={styles.resultRule} aria-hidden="true" />
        <h2 className={styles.resultTitle}>Your outfit</h2>
        <ul className={styles.bodyMap}>
          {zoneRows.map((row) => (
            <li key={row.label}>
              <span className={styles.zone}>{row.label}</span>
              <ZoneValue item={row.item} />
            </li>
          ))}
        </ul>
        <p className={styles.why}>{why}</p>
      </section>

      <div className={styles.note}>
        <p>
          This is a guide, not a rule. Everyone handles heat differently: some people run in a T-shirt at +5°C, others feel
          cold in it. Adjust the bottom slider to suit you.
        </p>
      </div>

      <ConsultNoticeEn prefill="Hi Igor! I used your what-to-wear calculator and I'd like a free consultation" />

      <footer className={styles.footer}>igorp.run</footer>
    </div>
  );
}
