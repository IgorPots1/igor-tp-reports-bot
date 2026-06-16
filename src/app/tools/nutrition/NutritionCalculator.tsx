"use client";

import { useMemo, useState } from "react";

import styles from "./nutrition.module.css";
import {
  calcNutrition,
  type NutritionBlock,
  type TimeBefore,
  type WorkoutType,
} from "./foodPools";

const WORKOUT_TYPES: Array<[WorkoutType, string]> = [
  ["easy_short", "Лёгкая до 60 мин"],
  ["long", "Длительная 80+ мин"],
  ["tempo", "Темповая / интервалы"],
];

const TIME_OPTIONS: Array<[TimeBefore, string]> = [
  ["<1", "Меньше часа"],
  ["1-2", "1-2 часа"],
  ["2-3", "2-3 часа"],
  ["3+", "Больше 3 часов"],
];

function Block({ title, data }: { title: string; data: NutritionBlock }) {
  return (
    <div className={styles.block}>
      <div className={styles.blockTitle}>{title}</div>
      {data.carbs > 0 && (
        <div className={styles.macros}>
          {data.carbs} г углеводов
          {data.protein ? (
            <span className={styles.macrosProtein}> + {data.protein} г белка</span>
          ) : null}
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

export default function NutritionCalculator() {
  const [weight, setWeight] = useState(70);
  const [type, setType] = useState<WorkoutType>("long");
  const [timeBefore, setTimeBefore] = useState<TimeBefore>("2-3");
  const [seed, setSeed] = useState(1);

  const result = useMemo(
    () => calcNutrition(weight, type, timeBefore, seed),
    [weight, type, timeBefore, seed],
  );

  return (
    <div className={styles.inner}>
      <div className={styles.brand}>igorp.run</div>
      <h1 className={styles.title}>
        ПИТАНИЕ <span className={styles.accent}>ПОД ТРЕНИРОВКУ</span>
      </h1>
      <p className={styles.subtitle}>До и после, конкретные граммы под твой вес</p>

      <div className={styles.field}>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Вес</span>
          <span className={styles.fieldValue}>{weight} кг</span>
        </div>
        <input
          type="range"
          min={40}
          max={120}
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          className={styles.range}
          aria-label="Вес в килограммах"
        />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Тренировка сегодня</div>
        <div className={styles.btnGrid1}>
          {WORKOUT_TYPES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setType(k)}
              className={`${styles.optionBtn} ${styles.optionBtnTypeLeft} ${
                type === k ? styles.optionBtnActive : ""
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Времени до тренировки</div>
        <div className={styles.btnGrid2}>
          {TIME_OPTIONS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTimeBefore(k)}
              className={`${styles.optionBtn} ${
                timeBefore === k ? styles.optionBtnActive : ""
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.result}>
        <Block title="ДО ТРЕНИРОВКИ" data={result.before} />
        <Block title="ПОСЛЕ" data={result.after} />
      </div>

      <button
        type="button"
        onClick={() => setSeed((s) => s + 1)}
        className={styles.reshuffleBtn}
      >
        Показать другие примеры еды
      </button>

      <div className={styles.disclaimer}>
        <div className={styles.disclaimerLabel}>ВАЖНО</div>
        <p className={styles.disclaimerText}>
          Это база. У всех своё пищеварение, подбирай под себя опытным путём на
          тренировках. Новую еду на старте не пробуй. При проблемах со здоровьем
          советуйся с врачом.
        </p>
      </div>

      <div className={styles.cta}>
        <div className={styles.ctaTitle}>Хочешь бежать быстрее и без травм?</div>
        <p className={styles.ctaText}>
          Питание это только часть. Результат даёт система: тренировки,
          восстановление, темп, прогрессия. Давай разберём твою подготовку под
          конкретную цель.
        </p>
        <a
          href="https://t.me/IgorPotseluev"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.ctaButton}
        >
          Написать мне в Telegram →
        </a>
      </div>

      <div className={styles.footer}>igorp.run · питание под тренировку</div>
    </div>
  );
}
