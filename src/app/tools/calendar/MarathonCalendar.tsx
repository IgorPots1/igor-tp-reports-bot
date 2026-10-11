"use client";

import { useEffect, useMemo, useState } from "react";

import ConsultNotice from "@/components/ConsultNotice";

import {
  buildCalendar,
  defaultRaceDate,
  startOfDay,
  toIsoDate,
  type CountId,
  type KmId,
  type LastId,
  type PhaseId,
} from "./calendar-logic";
import styles from "./calendar.module.css";

type Option<T extends string> = { id: T; label: string };

const KM: Option<KmId>[] = [
  { id: "lt20", label: "До 20 км в неделю" },
  { id: "20to30", label: "20-30 км" },
  { id: "30p", label: "От 30 км" },
];
const LAST: Option<LastId>[] = [
  { id: "none", label: "Не было" },
  { id: "10", label: "5-10 км" },
  { id: "21", label: "Полумарафон" },
  { id: "42", label: "Марафон" },
];
const COUNT: Option<CountId>[] = [
  { id: "1to2", label: "1-2" },
  { id: "3to5", label: "3-5" },
  { id: "6p", label: "Больше 5" },
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

const PREFILL = "Здравствуйте! Хочу на бесплатную консультацию по подготовке к марафону";

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
        <button
          key={o.id}
          type="button"
          className={styles.pill}
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function MarathonCalendar() {
  /* «Сегодня» берётся только в браузере: на сервере сборки другой день и
     другой часовой пояс, и дата по умолчанию разошлась бы с гидрацией. */
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
    () => (today ? buildCalendar({ race, km, last, lastDate, count }, today) : null),
    [today, race, km, last, lastDate, count],
  );

  return (
    <div className={styles.wrap}>
      <h1 className={styles.h1}>Календарь до марафона</h1>
      <p className={styles.lede}>
        Укажи дату своего марафона, и получишь все даты подготовки: межсезонье, старт плана,
        ключевые тренировки и подводку.
      </p>

      <div className={styles.field}>
        <label className={styles.lab} htmlFor="cal-race">
          Дата марафона
        </label>
        {/* React onChange слушает и input, и change: нативный выбор даты в iOS
            Safari отдаёт значение событием change, и оно доходит до расчёта. */}
        <input
          id="cal-race"
          type="date"
          className={styles.date}
          value={race}
          onChange={(e) => setRace(e.target.value)}
        />
        <p className={styles.err} aria-live="polite">
          {res && !res.ok ? res.error : ""}
        </p>
      </div>

      <div className={styles.field}>
        <span className={styles.lab} id="cal-km">
          Сколько бегаешь сейчас
        </span>
        <Pills labelId="cal-km" options={KM} value={km} onPick={setKm} />
      </div>

      <div className={styles.field}>
        <span className={styles.lab} id="cal-last">
          Какой был последний старт?
        </span>
        <Pills labelId="cal-last" options={LAST} value={last} onPick={setLast} />
      </div>

      {last !== "none" ? (
        <>
          <div className={styles.field}>
            <label className={styles.lab} htmlFor="cal-lastdate">
              Когда он был
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
              Сколько стартов было за сезон
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
                Сейчас у тебя
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
                <li
                  key={`${it.kind}-${it.when}`}
                  className={`${KIND_CLASS[it.kind]} ${it.current ? styles.cur : ""}`}
                >
                  <span className={`${styles.when} ${styles.mono}`}>{it.when}</span>
                  <b>
                    {it.name}
                    {it.current ? <span className={styles.tag}>сейчас</span> : null}
                  </b>
                  <p>{it.text}</p>
                </li>
              ))}
            </ol>

            <ConsultNotice prefill={PREFILL} />
          </>
        ) : null}
      </section>

      <p className={styles.foot}>Это ориентир по срокам, а не готовый план тренировок.</p>
    </div>
  );
}
