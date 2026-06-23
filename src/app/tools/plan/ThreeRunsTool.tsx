"use client";

import { useMemo, useState } from "react";

import styles from "./plan.module.css";
import { buildWorkoutCards, type RaceDistance } from "./vdot";

type WeekDay = { day: string; type: string; duration: string };

const WEEK_3: WeekDay[] = [
  { day: "Вт", type: "Лёгкий", duration: "40–60 мин" },
  { day: "Чт", type: "Развивающая", duration: "50–60 мин" },
  { day: "Вс", type: "Длительный", duration: "60–90 мин" },
];

// Реалистичные рамки результата по дистанции (в секундах).
const RACE_BOUNDS: Record<RaceDistance, [number, number]> = {
  5000: [13 * 60, 42 * 60], // 13:00–42:00
  10000: [27 * 60, 90 * 60], // 27:00–90:00
};

const WEEK_4: WeekDay[] = [
  { day: "Пн", type: "Лёгкий", duration: "40–60 мин" },
  { day: "Ср", type: "Развивающая", duration: "50–60 мин" },
  { day: "Пт", type: "Лёгкий", duration: "40–60 мин" },
  { day: "Вс", type: "Длительный", duration: "60–90 мин" },
];

function WeekTemplate({ days }: { days: WeekDay[] }) {
  return (
    <div className={styles.weekList}>
      {days.map((d) => (
        <div key={d.day} className={styles.weekRow}>
          <span className={styles.weekDay}>{d.day}</span>
          <span className={styles.weekType}>{d.type}</span>
          <span className={styles.weekDuration}>{d.duration}</span>
        </div>
      ))}
    </div>
  );
}

export default function ThreeRunsTool() {
  // Часть A — шаблон недели
  const [weekVariant, setWeekVariant] = useState<3 | 4>(3);

  // Часть B — калькулятор темпов
  const [distance, setDistance] = useState<RaceDistance>(5000);
  const [minutes, setMinutes] = useState("25");
  const [seconds, setSeconds] = useState("00");

  const totalSeconds = useMemo(() => {
    const m = Number(minutes);
    const s = Number(seconds);
    if (
      minutes.trim() === "" ||
      seconds.trim() === "" ||
      !Number.isInteger(m) ||
      !Number.isInteger(s) ||
      m < 0 ||
      s < 0 ||
      s >= 60
    ) {
      return NaN;
    }
    const total = m * 60 + s;
    return total > 0 ? total : NaN;
  }, [minutes, seconds]);

  const isRealistic = useMemo(() => {
    if (!Number.isFinite(totalSeconds)) return false;
    const [min, max] = RACE_BOUNDS[distance];
    return totalSeconds >= min && totalSeconds <= max;
  }, [distance, totalSeconds]);

  const cards = useMemo(() => {
    if (!isRealistic) return null;
    return buildWorkoutCards(distance, totalSeconds);
  }, [distance, totalSeconds, isRealistic]);

  return (
    <div className={styles.inner}>
      <div className={styles.brand}>igorp.run</div>
      <h1 className={styles.title}>
        ТРИ ТИПА <span className={styles.accent}>ТРЕНИРОВОК</span>
      </h1>
      <p className={styles.subtitle}>
        Шаблон беговой недели и твой темп под разные тренировки
      </p>

      {/* ===== Часть A. Шаблон недели ===== */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>Шаблон недели</div>
        <div className={styles.toggleRow}>
          <button
            type="button"
            onClick={() => setWeekVariant(3)}
            className={`${styles.toggleBtn} ${
              weekVariant === 3 ? styles.toggleBtnActive : ""
            }`}
          >
            3 тренировки
          </button>
          <button
            type="button"
            onClick={() => setWeekVariant(4)}
            className={`${styles.toggleBtn} ${
              weekVariant === 4 ? styles.toggleBtnActive : ""
            }`}
          >
            4 тренировки
          </button>
        </div>

        <WeekTemplate days={weekVariant === 3 ? WEEK_3 : WEEK_4} />

        <p className={styles.note}>
          <span className={styles.noteAccent}>Правило: </span>
          развивающую и длительный не ставь в соседние дни — между ними лёгкий
          или отдых.
        </p>
        <p className={styles.note}>
          В калькуляторе ниже «Развивающая» раскрыта на темповый, длинные и
          короткие интервалы. Длительный беги в лёгком, разговорном темпе.
        </p>
      </section>

      {/* ===== Часть B. Калькулятор темпа ===== */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>Калькулятор темпа</div>

        <div className={styles.fieldLabel}>Недавний результат на</div>
        <div className={styles.toggleRow}>
          <button
            type="button"
            onClick={() => setDistance(5000)}
            className={`${styles.toggleBtn} ${
              distance === 5000 ? styles.toggleBtnActive : ""
            }`}
          >
            5 км
          </button>
          <button
            type="button"
            onClick={() => setDistance(10000)}
            className={`${styles.toggleBtn} ${
              distance === 10000 ? styles.toggleBtnActive : ""
            }`}
          >
            10 км
          </button>
        </div>

        <div className={styles.fieldLabel}>Время</div>
        <div className={styles.timeRow}>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={300}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className={styles.timeInput}
            aria-label="Минуты"
          />
          <span className={styles.timeColon}>:</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            className={styles.timeInput}
            aria-label="Секунды"
          />
          <span className={styles.timeUnit}>мин : сек</span>
        </div>

        <p className={styles.disclaimer}>
          Бери результат за последние 1–2 месяца. Если форма ушла, держи темп
          на 10–15 сек медленнее.
        </p>

        {cards ? (
          <div className={styles.cards}>
            {cards.map((c) => (
              <article key={c.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>{c.title}</span>
                  <span className={styles.cardPace}>{c.paceRange}</span>
                </div>
                <div className={styles.cardMeta}>
                  <div className={styles.cardMetaRow}>
                    <span className={styles.cardMetaLabel}>Формат: </span>
                    {c.format}
                  </div>
                  {c.workVolume ? (
                    <div className={styles.cardMetaRow}>
                      <span className={styles.cardMetaLabel}>
                        Объём работы:{" "}
                      </span>
                      {c.workVolume}
                    </div>
                  ) : null}
                </div>
                <p className={styles.cardDesc}>{c.description}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.disclaimer}>
            Проверь результат, кажется, время нереалистичное.
          </p>
        )}

        {cards ? (
          <p className={styles.disclaimer}>
            Это ориентир. Подстраивай по ощущению: в жару, после плохого сна и на
            усталых ногах темп будет медленнее.
          </p>
        ) : null}

        <div className={styles.important}>
          <div className={styles.importantLabel}>ВАЖНО</div>
          <p className={styles.importantText}>
            Объём работы — ориентир для подготовленных. Если только начинаешь,
            бери нижнюю границу и наращивай постепенно: 30–40 мин на пороге это
            верхний предел, а не старт для новичка.
          </p>
        </div>
      </section>

      {/* CTA */}
      <div className={styles.cta}>
        <div className={styles.ctaTitle}>
          Хочешь знать, какие тренировки нужны именно тебе?
        </div>
        <p className={styles.ctaText}>
          Это базовый каркас. Реальный прогресс дают правильный объём,
          прогрессия нагрузки и восстановление, подобранные под твой уровень и
          цель. Разберём твою подготовку на бесплатной консультации.
        </p>
        <a
          href="https://t.me/IgorPotseluev"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.ctaButton}
        >
          Записаться на консультацию →
        </a>
      </div>

      <div className={styles.footer}>igorp.run</div>
    </div>
  );
}
