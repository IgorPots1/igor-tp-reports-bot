"use client";

import { useEffect, useState } from "react";

import {
  calcDress,
  formatDegrees,
  type Precip,
  type RunType,
  type WindLevel,
  type ZoneItem,
} from "./dress-logic";
import styles from "./dress.module.css";

const STORAGE_KEY = "igorp-dress-calc-v1";

const WIND_OPTIONS: Array<[WindLevel, string]> = [
  [0, "Без ветра"],
  [-2, "Умеренный"],
  [-5, "Сильный"],
];

const PRECIP_OPTIONS: Array<[Precip, string]> = [
  ["none", "Нет"],
  ["rain", "Дождь"],
  ["snow", "Снег"],
];

const RUN_OPTIONS: Array<[RunType, string]> = [
  [0, "Лёгкая"],
  [-1, "Длительная"],
  [3, "Интервалы"],
];

type ZoneRow = { label: string; item: ZoneItem | null };

function ZoneValue({ item }: { item: ZoneItem | null }) {
  if (!item) {
    return <span className={`${styles.items} ${styles.itemsMuted}`}>ничего не нужно</span>;
  }
  return (
    <span className={item.muted ? `${styles.items} ${styles.itemsMuted}` : styles.items}>
      {item.text}
      {item.note ? <small className={styles.itemsNote}>{item.note}</small> : null}
    </span>
  );
}

export default function DressCalculator() {
  const [t, setT] = useState(3);
  const [wind, setWind] = useState<WindLevel>(0);
  const [precip, setPrecip] = useState<Precip>("none");
  const [run, setRun] = useState<RunType>(0);
  const [feel, setFeel] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved.feel === "number") {
        setFeel(saved.feel);
      }
    } catch {
      // приватный режим / заблокировано — остаёмся на значении по умолчанию
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ feel }));
    } catch {
      // приватный режим / заблокировано — просто не запоминаем
    }
  }, [feel]);

  const { dress, outfit, why } = calcDress({ t, wind, precip, run, feel });

  const zoneRows: ZoneRow[] = [
    { label: "Голова", item: outfit.head },
    { label: "Шея", item: outfit.neck },
    { label: "Тело", item: outfit.body },
    { label: "Руки", item: outfit.hands },
    { label: "Ноги", item: outfit.legs },
    { label: "Стопы", item: { text: outfit.socks, note: outfit.shoeNote } },
  ];

  return (
    <div className={styles.wrap}>
      <p className={styles.brand}>igorp.run</p>
      <h1 className={styles.title}>
        Что надеть
        <br />
        на пробежку
      </h1>
      <p className={styles.lede}>
        Выставь погоду и тренировку. Бег греет примерно на 10 градусов, поэтому комплект
        считается от этой поправки.
      </p>

      <div className={styles.temp} aria-live="polite">
        <span className={styles.tempNow}>{formatDegrees(t)}</span>
        <span className={styles.tempCap}>на улице</span>
      </div>
      <label htmlFor="dress-t" className={styles.visuallyHidden}>
        Температура на улице
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
        <span>−25°</span>
        <span>0°</span>
        <span>+30°</span>
      </div>
      <p className={styles.shift}>
        Одевайся как на <b className={styles.shiftValue}>{formatDegrees(dress)}</b>
      </p>

      <div className={styles.controls}>
        <div>
          <p className={styles.fieldName} id="dress-wind-label">
            Ветер
          </p>
          <div className={styles.seg} role="group" aria-labelledby="dress-wind-label">
            {WIND_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={wind === value}
                onClick={() => setWind(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className={styles.fieldName} id="dress-precip-label">
            Осадки
          </p>
          <div className={styles.seg} role="group" aria-labelledby="dress-precip-label">
            {PRECIP_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={precip === value}
                onClick={() => setPrecip(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className={styles.fieldName} id="dress-run-label">
            Тренировка
          </p>
          <div className={styles.seg} role="group" aria-labelledby="dress-run-label">
            {RUN_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={run === value}
                onClick={() => setRun(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={styles.fieldName} htmlFor="dress-feel" style={{ display: "block" }}>
            Обычно мне на пробежке
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
            <span>Холодно</span>
            <span>Нормально</span>
            <span>Жарко</span>
          </div>
        </div>
      </div>

      <section className={styles.result} aria-live="polite">
        <hr className={styles.resultRule} aria-hidden="true" />
        <h2 className={styles.resultTitle}>Твой комплект</h2>
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
          Это ориентир, а не правило. У всех разный теплообмен: кто-то в плюс пять бежит в
          футболке, кому-то в ней холодно. Подстрой нижний ползунок под себя.
        </p>
      </div>

      <footer className={styles.footer}>igorp.run</footer>
    </div>
  );
}
