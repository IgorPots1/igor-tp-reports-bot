"use client";

import { useMemo, useState } from "react";

import styles from "../../plan/plan.module.css";
import type { RaceDistance } from "../../plan/vdot";
import { buildWorkoutCardsEn } from "./workoutCardsEn";
import ConsultNoticeEn from "@/components/ConsultNoticeEn";

type WeekDay = { day: string; type: string; duration: string };

const WEEK_3: WeekDay[] = [
  { day: "Tue", type: "Easy", duration: "40-60 min" },
  { day: "Thu", type: "Quality session", duration: "50-60 min" },
  { day: "Sun", type: "Long run", duration: "60-90 min" },
];

const WEEK_4: WeekDay[] = [
  { day: "Mon", type: "Easy", duration: "40-60 min" },
  { day: "Wed", type: "Quality session", duration: "50-60 min" },
  { day: "Fri", type: "Easy", duration: "40-60 min" },
  { day: "Sun", type: "Long run", duration: "60-90 min" },
];

// Realistic result bounds by distance (seconds), the same as the Russian tool.
const RACE_BOUNDS: Record<RaceDistance, [number, number]> = {
  5000: [13 * 60, 42 * 60],
  10000: [27 * 60, 90 * 60],
};

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

export default function ThreeRunsToolEn() {
  const [weekVariant, setWeekVariant] = useState<3 | 4>(3);
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
    return buildWorkoutCardsEn(distance, totalSeconds);
  }, [distance, totalSeconds, isRealistic]);

  return (
    <div className={styles.inner} lang="en">
      <h1 className={styles.title}>
        A running week template and <span className={styles.accent}>your paces for every session</span>
      </h1>

      <section className={styles.section}>
        <div className={styles.sectionHead}>Week template</div>
        <div className={styles.toggleRow}>
          <button
            type="button"
            onClick={() => setWeekVariant(3)}
            className={`${styles.toggleBtn} ${weekVariant === 3 ? styles.toggleBtnActive : ""}`}
          >
            3 runs
          </button>
          <button
            type="button"
            onClick={() => setWeekVariant(4)}
            className={`${styles.toggleBtn} ${weekVariant === 4 ? styles.toggleBtnActive : ""}`}
          >
            4 runs
          </button>
        </div>

        <WeekTemplate days={weekVariant === 3 ? WEEK_3 : WEEK_4} />

        <p className={styles.note}>
          <span className={styles.noteAccent}>Rule: </span>
          never put the quality session and the long run on back-to-back days. Put an easy day or a rest day between them.
        </p>
        <p className={styles.note}>
          In the calculator below, the quality session means tempo runs, long intervals and short intervals. Run the long run
          at an easy, chatty pace.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>Pace calculator</div>

        <div className={styles.fieldLabel}>A recent result for</div>
        <div className={styles.toggleRow}>
          <button
            type="button"
            onClick={() => setDistance(5000)}
            className={`${styles.toggleBtn} ${distance === 5000 ? styles.toggleBtnActive : ""}`}
          >
            5K
          </button>
          <button
            type="button"
            onClick={() => setDistance(10000)}
            className={`${styles.toggleBtn} ${distance === 10000 ? styles.toggleBtnActive : ""}`}
          >
            10K
          </button>
        </div>

        <div className={styles.fieldLabel}>Time</div>
        <div className={styles.timeRow}>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={300}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className={styles.timeInput}
            aria-label="Minutes"
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
            aria-label="Seconds"
          />
          <span className={styles.timeUnit}>min : sec</span>
        </div>

        <p className={styles.disclaimer}>
          Use a result from the last 1-2 months. If you&apos;ve lost some fitness since, run 10-15 sec per km slower.
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
                    <span className={styles.cardMetaLabel}>Format: </span>
                    {c.format}
                  </div>
                  {c.workVolume ? (
                    <div className={styles.cardMetaRow}>
                      <span className={styles.cardMetaLabel}>Work volume: </span>
                      {c.workVolume}
                    </div>
                  ) : null}
                </div>
                <p className={styles.cardDesc}>{c.description}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.disclaimer}>Check your result, this time doesn&apos;t look realistic.</p>
        )}

        {cards ? (
          <p className={styles.disclaimer}>
            This is a guide. Adjust by feel: in the heat, after bad sleep or on tired legs your pace will be slower.
          </p>
        ) : null}

        <div className={styles.important}>
          <div className={styles.importantLabel}>IMPORTANT</div>
          <p className={styles.importantText}>
            The work volume is for trained runners. If you&apos;re just starting, take the low end and build up slowly: 30-40
            min at threshold is the upper limit, not where a beginner starts.
          </p>
        </div>
      </section>

      {cards ? (
        <ConsultNoticeEn tool="en-plan" prefill="Hi Igor! I used your pace calculator and I'd like a free consultation" />
      ) : null}

      <div className={styles.footer}>igorp.run</div>
    </div>
  );
}
