"use client";

import { useMemo, useState } from "react";

import styles from "../../nutrition/nutrition.module.css";
import ConsultNoticeEn from "@/components/ConsultNoticeEn";
import type { NutritionBlock, TimeBefore, WorkoutType } from "../../nutrition/foodPools";
import { calcNutritionEn } from "./foodPoolsEn";

const WORKOUT_TYPES: Array<[WorkoutType, string]> = [
  ["easy_short", "Easy, up to 60 min"],
  ["long", "Long run, 80+ min"],
  ["tempo", "Tempo or intervals"],
];

const TIME_OPTIONS: Array<[TimeBefore, string]> = [
  ["<1", "Less than 1 hour"],
  ["1-2", "1-2 hours"],
  ["2-3", "2-3 hours"],
  ["3+", "More than 3 hours"],
];

function Block({ title, data }: { title: string; data: NutritionBlock }) {
  return (
    <div className={styles.block}>
      <div className={styles.blockTitle}>{title}</div>
      {data.carbs > 0 && (
        <div className={styles.macros}>
          {data.carbs} g of carbs
          {data.protein ? <span className={styles.macrosProtein}> + {data.protein} g of protein</span> : null}
        </div>
      )}
      <p className={styles.rule}>{data.rule}</p>
      <div className={styles.examples}>
        {data.examples.map((ex, i) => (
          <div key={i} className={styles.exampleRow}>
            <span className={styles.bullet}>•</span>
            <span className={styles.exampleText}>{ex}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function NutritionCalculatorEn() {
  const [weight, setWeight] = useState(70);
  const [type, setType] = useState<WorkoutType>("long");
  const [timeBefore, setTimeBefore] = useState<TimeBefore>("2-3");
  const [seed, setSeed] = useState(1);

  const result = useMemo(() => calcNutritionEn(weight, type, timeBefore, seed), [weight, type, timeBefore, seed]);

  return (
    <div className={styles.inner} lang="en">
      <h1 className={styles.title}>
        FUEL FOR <span className={styles.accent}>YOUR RUN</span>
      </h1>
      <p className={styles.subtitle}>Before and after, real grams for your body weight</p>

      <div className={styles.field}>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Weight</span>
          <span className={styles.fieldValue}>{weight} kg</span>
        </div>
        <input
          type="range"
          min={40}
          max={120}
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          className={styles.range}
          aria-label="Weight in kilograms"
        />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Today&apos;s run</div>
        <div className={styles.btnGrid1}>
          {WORKOUT_TYPES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setType(k)}
              className={`${styles.optionBtn} ${styles.optionBtnTypeLeft} ${type === k ? styles.optionBtnActive : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Time until the run</div>
        <div className={styles.btnGrid2}>
          {TIME_OPTIONS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTimeBefore(k)}
              className={`${styles.optionBtn} ${timeBefore === k ? styles.optionBtnActive : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.result}>
        <Block title="BEFORE THE RUN" data={result.before} />
        <Block title="AFTER" data={result.after} />
      </div>

      <button type="button" onClick={() => setSeed((s) => s + 1)} className={styles.reshuffleBtn}>
        Show other food ideas
      </button>

      <div className={styles.disclaimer}>
        <div className={styles.disclaimerLabel}>IMPORTANT</div>
        <p className={styles.disclaimerText}>
          This is a starting point. Everyone&apos;s stomach is different, so test what works for you in training. Never
          try new food on race day. If you have health issues, talk to your doctor.
        </p>
      </div>

      <ConsultNoticeEn prefill="Hi Igor! I used your fuel calculator and I'd like a free consultation" />

      <div className={styles.footer}>igorp.run · fuel for your run</div>
    </div>
  );
}
