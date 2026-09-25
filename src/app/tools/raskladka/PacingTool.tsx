"use client";

import { useEffect, useMemo, useState } from "react";

import {
  COURSES,
  buildPlan,
  effortVerdict,
  formatKm,
  formatPace,
  formatTime,
  parseTime,
  planAsText,
  type Course,
  type CourseId,
  type Finish,
} from "./pacing-logic";
import styles from "./raskladka.module.css";

const STORAGE_KEY = "igorp-pacing-calc-v1";

function Profile({ course }: { course: Course }) {
  const W = 640;
  const H = 150;
  const PT = 18;
  const PB = 26;
  const PAD = 4;
  const lo = Math.min(...course.elev);
  const hi = Math.max(...course.elev);
  const span = Math.max(hi - lo, 20);
  const n = course.elev.length - 1;
  const x = (d: number) => PAD + (d / course.total) * (W - PAD * 2);
  const y = (e: number) => PT + (1 - (e - lo) / span) * (H - PT - PB);
  const at = (i: number) => (i >= n ? course.total : Math.min(i, course.total));

  const line = course.elev.map((e, i) => `${i === 0 ? "M" : "L"}${x(at(i)).toFixed(1)} ${y(e).toFixed(1)}`).join(" ");
  const step = course.total > 20 ? 10 : 2;
  const ticks: number[] = [];
  for (let d = 0; d <= course.total + 0.01; d += step) ticks.push(d);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={styles.profSvg}
      role="img"
      aria-label={`Профиль трассы ${course.name}: старт около ${course.elev[0]} метров, финиш около ${course.elev[n]} метров`}
    >
      {course.elev.slice(0, -1).map((e, i) => {
        const g = (course.elev[i + 1] - e) / ((at(i + 1) - at(i)) * 1000);
        const fill = g < -0.004 ? "var(--green)" : g > 0.004 ? "var(--hill)" : "var(--line)";
        return (
          <path
            key={i}
            d={`M${x(at(i)).toFixed(1)} ${y(e).toFixed(1)} L${x(at(i + 1)).toFixed(1)} ${y(course.elev[i + 1]).toFixed(1)} L${x(at(i + 1)).toFixed(1)} ${H - PB} L${x(at(i)).toFixed(1)} ${H - PB} Z`}
            fill={fill}
            opacity="0.32"
          />
        );
      })}
      <path d={line} fill="none" stroke="var(--ink)" strokeWidth="1.7" strokeLinejoin="round" />
      {course.stations.map((s) => (
        <line
          key={s.km}
          x1={x(s.km).toFixed(1)}
          y1={H - PB}
          x2={x(s.km).toFixed(1)}
          y2={H - PB + 6}
          stroke="var(--accent)"
          strokeWidth="1.6"
        />
      ))}
      {ticks.map((d) => (
        <text
          key={d}
          x={x(d).toFixed(1)}
          y={H - 4}
          fill="var(--muted)"
          fontSize="9"
          textAnchor={d === 0 ? "start" : d >= course.total - 0.01 ? "end" : "middle"}
        >
          {formatKm(d)}
        </text>
      ))}
      <text x={PAD} y="12" fill="var(--muted)" fontSize="9.5">{`${hi} м`}</text>
      <text x={W - PAD} y="12" fill="var(--muted)" fontSize="9.5" textAnchor="end">{`${lo} м`}</text>
    </svg>
  );
}

export default function PacingTool() {
  const [courseId, setCourseId] = useState<CourseId>("10");
  const [finish, setFinish] = useState<Finish>("kick");
  const [target, setTarget] = useState("50:00");
  const [showText, setShowText] = useState(false);
  const [said, setSaid] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { courseId?: CourseId; finish?: Finish; target?: string };
      if (saved.courseId && COURSES[saved.courseId]) setCourseId(saved.courseId);
      if (saved.finish === "even" || saved.finish === "kick") setFinish(saved.finish);
      if (typeof saved.target === "string") setTarget(saved.target);
    } catch {
      /* приватное окно или заблокированные данные сайта — просто стартуем с умолчаний */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ courseId, finish, target }));
    } catch {
      /* не критично */
    }
  }, [courseId, finish, target]);

  useEffect(() => {
    if (!said) return undefined;
    const id = window.setTimeout(() => setSaid(""), 2600);
    return () => window.clearTimeout(id);
  }, [said]);

  const course = COURSES[courseId];
  const seconds = parseTime(target);
  const valid = seconds !== null && seconds >= 15 * 60 && seconds <= 7 * 3600;
  const plan = useMemo(
    () => (valid ? buildPlan(course, seconds as number, finish) : null),
    [course, seconds, finish, valid],
  );

  const stationAt = useMemo(() => {
    const map = new Map<number, string[]>();
    course.stations.forEach((s) => {
      const k = Math.ceil(s.km);
      map.set(k, [...(map.get(k) ?? []), s.label]);
    });
    course.marks.forEach((m) => {
      const k = Math.ceil(m.km);
      map.set(k, [...(map.get(k) ?? []), m.label]);
    });
    return map;
  }, [course]);

  const text = plan ? planAsText(course, plan) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setSaid("Скопировано");
    } catch {
      setShowText(true);
      setSaid("Не вышло скопировать, выдели текст ниже");
    }
  }

  function pickCourse(id: CourseId) {
    setCourseId(id);
    setTarget(COURSES[id].presets[3]);
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.eb}>Калькулятор</p>
      <h1 className={styles.h1}>Раскладка Московского марафона</h1>
      <p className={styles.lede}>
        Вводишь целевое время, получаешь раскладку по полосам с поправкой на рельеф. Темпы всегда
        кратны пяти секундам, спуск считается с запасом, а не в полную силу.
      </p>

      <div className={styles.grid}>
        <div>
          <div className={styles.panel}>
            <div className={styles.field}>
              <p className={styles.lbl}>Дистанция</p>
              <div className={styles.seg} role="group" aria-label="Дистанция">
                {(["10", "42"] as CourseId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={courseId === id}
                    onClick={() => pickCourse(id)}
                  >
                    {COURSES[id].name}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.lbl} htmlFor="pacing-target">
                Целевое время
              </label>
              <input
                id="pacing-target"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className={styles.input}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
              <div className={styles.chips}>
                {course.presets.map((p) => (
                  <button key={p} type="button" onClick={() => setTarget(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <p className={styles.lbl}>Финиш</p>
              <div className={styles.seg} role="group" aria-label="Форма финиша">
                <button type="button" aria-pressed={finish === "even"} onClick={() => setFinish("even")}>
                  Ровный
                </button>
                <button type="button" aria-pressed={finish === "kick"} onClick={() => setFinish("kick")}>
                  С разгоном
                </button>
              </div>
              <p className={styles.noteS}>
                {finish === "kick"
                  ? "Последняя часть быстрее рабочего темпа. Так бегут, когда готов."
                  : "Один темп до конца, без ускорения. Так бегут после болезни, на первом старте или когда форма под вопросом."}
              </p>
            </div>

            <p className={styles.hint}>{course.hint}</p>
          </div>

          <div className={styles.prof}>
            <Profile course={course} />
            <p className={styles.legend}>
              <span>
                <i style={{ background: "var(--green)" }} />
                спуск
              </span>
              <span>
                <i style={{ background: "var(--hill)" }} />
                подъём
              </span>
              <span>
                <i style={{ background: "var(--accent)" }} />
                пункт питания
              </span>
            </p>
          </div>
        </div>

        <div>
          <div className={styles.goal}>
            <div>
              <p className={styles.goalLab}>Финиш по плану</p>
              <p className={styles.goalT}>{plan ? formatTime(plan.total) : "··:··"}</p>
            </div>
            <p className={styles.goalR}>
              {plan ? (
                <>
                  Средний темп <b>{formatPace(plan.total / course.total)}</b> на километр.{" "}
                  {plan.diff > 0
                    ? `Запас к цели ${Math.round(plan.diff)} с.`
                    : plan.diff < 0
                      ? `Быстрее цели на ${Math.round(-plan.diff)} с.`
                      : "Ровно в цель."}
                </>
              ) : (
                <>
                  Введи время в формате <b>44:00</b> или <b>3:45:00</b>.
                </>
              )}
            </p>
          </div>

          {plan ? (
            <>
              <div className={styles.bands}>
                {course.bands.map((b, i) => {
                  const last = i === course.bands.length - 1;
                  return (
                    <div key={b.title} className={last ? `${styles.band} ${styles.bandFin}` : styles.band}>
                      <span className={styles.pv}>
                        {formatPace(plan.bandPaces[i])}
                        {last && plan.kick ? "↑" : ""}
                      </span>
                      <span className={styles.rng}>
                        км {formatKm(b.from === 0 ? 1 : b.from)}-{formatKm(b.to)}
                        <br />
                        {formatKm(plan.bandKm[i])} км
                      </span>
                      <span className={styles.tx}>
                        <b>{b.title}.</b> {b.text}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className={styles.subh}>Сверка по часам</p>
              <div className={styles.chk}>
                {plan.checks.map((ch) => (
                  <div key={ch.km} className={styles.sp}>
                    <span className={styles.spD}>{formatKm(ch.km)} км</span>
                    <span className={styles.spV}>{formatTime(ch.time)}</span>
                  </div>
                ))}
                <div className={`${styles.sp} ${styles.spFin}`}>
                  <span className={styles.spD}>финиш</span>
                  <span className={styles.spV}>{formatTime(plan.total)}</span>
                </div>
              </div>

              {(() => {
                const v = effortVerdict(course, plan.shift);
                return (
                  <p className={v.ok ? `${styles.verdict} ${styles.verdictOk}` : `${styles.verdict} ${styles.verdictWarn}`}>
                    <b>Эквивалент ровного бега:</b> вторая половина идёт на{" "}
                    <b>
                      {Math.abs(plan.shift).toFixed(1)} % {plan.shift < 0 ? "тяжелее" : "легче"}
                    </b>{" "}
                    первой. {v.text}
                  </p>
                );
              })()}

              <p className={styles.subh}>По километрам</p>
              <div className={styles.tblwrap}>
                <table className={styles.tbl}>
                  <thead>
                    <tr>
                      <th>км</th>
                      <th>высота</th>
                      <th>уклон</th>
                      <th>темп</th>
                      <th>ровный</th>
                      <th>время</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.segs.map((s) => {
                      const g = s.grade * 100;
                      const cls = g < -0.4 ? styles.rowDown : g > 0.4 ? styles.rowUp : undefined;
                      const extra = stationAt.get(Math.ceil(s.to - 0.0001));
                      return (
                        <tr key={s.to} className={cls}>
                          <td>
                            {formatKm(s.to)}
                            {extra ? <span className={styles.st}> · {extra.join(" · ")}</span> : null}
                          </td>
                          <td>{Math.round(s.elevTo)} м</td>
                          <td>
                            {g > 0 ? "+" : ""}
                            {g.toFixed(1)} %
                          </td>
                          <td>{formatPace(s.pace)}</td>
                          <td>{formatPace(s.flatPace)}</td>
                          <td>{formatTime(s.cum)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className={styles.copyrow}>
                <button type="button" className={styles.btn} onClick={copy}>
                  Скопировать для карточки
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={() => setShowText((v) => !v)}
                >
                  {showText ? "Скрыть текст" : "Показать текст"}
                </button>
                {said ? <span className={styles.said}>{said}</span> : null}
              </div>
              {showText ? <pre className={styles.out}>{text}</pre> : null}
            </>
          ) : null}

          <p className={styles.foot}>
            Трасса {course.where}, старт {course.startTime}. Профиль приблизительный: снят с трека по
            спутниковой модели высот, мосты в такой модели не видны. Это план, а не обещание.
          </p>
        </div>
      </div>
    </div>
  );
}
