"use client";

import { useRef } from "react";

import styles from "./TimeFields.module.css";
import { type TimeParts } from "./time-parts";

export { EMPTY_TIME, joinTime, splitTime, type TimeParts } from "./time-parts";

/* Три поля времени вместо одного текстового.
 *
 * ПОЧЕМУ НЕ ОДНО ПОЛЕ. Было `<input type="text" inputMode="numeric">` с
 * подсказкой «52:30 или 1:55:00». На айфоне inputMode="numeric" открывает
 * цифровую клавиатуру БЕЗ ДВОЕТОЧИЯ, и время было физически не набрать: человек
 * упирался в это на живом сайте. Варианта два — либо просить обычную
 * клавиатуру и заставлять искать двоеточие, либо убрать разделитель из ввода
 * совсем. Второе и сделано.
 *
 * `type="text"` с `inputMode="numeric"`, а не `type="number"`: у числового поля
 * браузер игнорирует maxLength, и ограничение «две цифры» вместе с
 * автопереходом пришлось бы городить вручную. Крутилки у числового поля на
 * десктопе тут тоже лишние.
 *
 * Часы остаются и для десятки: пустое поле ничего не стоит, а своё поведение
 * «на 10 км часов нет» означало бы разную разметку на разных дистанциях и
 * сюрприз для того, кто бежит десятку больше часа.
 */

const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 2);

export default function TimeFields({
  value,
  onChange,
  idPrefix,
  label,
}: {
  value: TimeParts;
  onChange: (next: TimeParts) => void;
  idPrefix: string;
  label: string;
}) {
  const mRef = useRef<HTMLInputElement | null>(null);
  const sRef = useRef<HTMLInputElement | null>(null);

  function set(key: keyof TimeParts, raw: string) {
    const v = onlyDigits(raw);
    onChange({ ...value, [key]: v });
    // Автопереход: две цифры набраны, дальше человеку всё равно в соседнее поле.
    if (v.length === 2) {
      if (key === "h") mRef.current?.focus();
      if (key === "m") sRef.current?.select();
    }
  }

  /* Минуты и секунды приводятся к 0-59 при уходе из поля, а не на каждой
     нажатой цифре: иначе «6» на пути к «65» мгновенно превращалось бы в «59» и
     дальше не набиралось бы вовсе. */
  function clamp(key: "m" | "s") {
    const n = Number(value[key]);
    if (value[key] && n > 59) onChange({ ...value, [key]: "59" });
  }

  const cell = (
    key: keyof TimeParts,
    cap: string,
    aria: string,
    ref?: React.RefObject<HTMLInputElement | null>,
  ) => (
    <span className={styles.cell}>
      <label className={styles.cap} htmlFor={`${idPrefix}-${key}`}>
        {cap}
      </label>
      <input
        id={`${idPrefix}-${key}`}
        ref={ref}
        className={styles.box}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        autoComplete="off"
        placeholder="00"
        aria-label={aria}
        value={value[key]}
        onChange={(e) => set(key, e.target.value)}
        onBlur={key === "h" ? undefined : () => clamp(key as "m" | "s")}
        onFocus={(e) => e.target.select()}
      />
    </span>
  );

  return (
    <div className={styles.row} role="group" aria-label={label}>
      {cell("h", "ч", `${label}: часы`)}
      <span className={styles.colon} aria-hidden="true">
        :
      </span>
      {cell("m", "мин", `${label}: минуты`, mRef)}
      <span className={styles.colon} aria-hidden="true">
        :
      </span>
      {cell("s", "сек", `${label}: секунды`, sRef)}
    </div>
  );
}
