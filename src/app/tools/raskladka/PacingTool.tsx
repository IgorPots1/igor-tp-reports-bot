"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  COURSES,
  buildPlan,
  effortVerdict,
  formatDec,
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

/* Профиль рисуется в РЕАЛЬНЫХ пикселях, а не в растянутом viewBox.
 * Раньше viewBox был 640x150 при любой ширине: на телефоне блок сжимался до
 * ~315 px, и вместе с картинкой сжимался шрифт — подписи 9 px превращались в
 * 4,4 px, то есть в серую кашу. Теперь ширину мерим у контейнера и кладём её в
 * viewBox один к одному, поэтому fontSize="11" это одиннадцать настоящих
 * пикселей и на телефоне, и на мониторе. */
function useBoxWidth(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => setW(Math.max(260, Math.round(el.clientWidth)));
    apply();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, w };
}

function Profile({ course }: { course: Course }) {
  const { ref, w } = useBoxWidth(620);
  const W = w;
  const H = w < 520 ? 250 : 230;
  const PT = 24;
  const PB = 38;
  const PL = 38;
  const PR = 12;

  const lo = Math.min(...course.elev);
  const hi = Math.max(...course.elev);
  const span = Math.max(hi - lo, 20);
  const n = course.elev.length - 1;
  const y0 = H - PB;
  const x = (d: number) => PL + (d / course.total) * (W - PL - PR);
  const y = (e: number) => PT + (1 - (e - lo) / span) * (y0 - PT);
  const at = (i: number) => (i >= n ? course.total : Math.min(i, course.total));

  const line = course.elev
    .map((e, i) => `${i === 0 ? "M" : "L"}${x(at(i)).toFixed(1)} ${y(e).toFixed(1)}`)
    .join(" ");

  // Шаг сетки по километрам: на узком экране реже, чтобы числа не сливались.
  const step = course.total > 20 ? (W < 520 ? 10 : 5) : W < 360 ? 2 : 1;
  const ticks: number[] = [];
  for (let d = 0; d <= course.total + 0.01; d += step) ticks.push(Math.round(d * 10) / 10);

  const rows = [hi, Math.round((hi + lo) / 2), lo];

  return (
    <div ref={ref} className={styles.profBox}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className={styles.profSvg}
        role="img"
        aria-label={`Профиль трассы ${course.name}: старт около ${course.elev[0]} метров, самая высокая точка ${hi} метров, самая низкая ${lo} метров, финиш около ${course.elev[n]} метров`}
      >
        {rows.map((e) => (
          <g key={e}>
            <line
              x1={PL}
              y1={y(e).toFixed(1)}
              x2={W - PR}
              y2={y(e).toFixed(1)}
              stroke="var(--line)"
              strokeWidth="1"
              strokeDasharray={e === lo ? undefined : "3 4"}
            />
            <text
              x={PL - 7}
              y={(y(e) + 4).toFixed(1)}
              fill="var(--muted)"
              fontSize="11"
              textAnchor="end"
            >
              {e}
            </text>
          </g>
        ))}
        <text x={PL - 7} y={PT - 10} fill="var(--muted)" fontSize="10.5" textAnchor="end">
          м
        </text>

        {course.elev.slice(0, -1).map((e, i) => {
          const g = (course.elev[i + 1] - e) / ((at(i + 1) - at(i)) * 1000);
          const fill = g < -0.004 ? "var(--green)" : g > 0.004 ? "var(--hill)" : "var(--line-2)";
          return (
            <path
              key={i}
              d={`M${x(at(i)).toFixed(1)} ${y(e).toFixed(1)} L${x(at(i + 1)).toFixed(1)} ${y(course.elev[i + 1]).toFixed(1)} L${x(at(i + 1)).toFixed(1)} ${y0} L${x(at(i)).toFixed(1)} ${y0} Z`}
              fill={fill}
              opacity="0.42"
            />
          );
        })}
        <path d={line} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />

        {course.marks.map((m) => (
          <g key={`mark-${m.km}`}>
            <line
              x1={x(m.km).toFixed(1)}
              y1={PT}
              x2={x(m.km).toFixed(1)}
              y2={y0}
              stroke="var(--ink-2)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <text
              x={(x(m.km) + 5).toFixed(1)}
              y={PT + 10}
              fill="var(--ink-2)"
              fontSize="10.5"
            >
              {m.label}
            </text>
          </g>
        ))}

        <line x1={PL} y1={y0} x2={W - PR} y2={y0} stroke="var(--line-2)" strokeWidth="1" />

        {course.stations.map((s) => (
          <g key={`st-${s.km}`}>
            <line
              x1={x(s.km).toFixed(1)}
              y1={y0}
              x2={x(s.km).toFixed(1)}
              y2={y0 + 7}
              stroke={s.kind === "food" ? "var(--accent)" : "var(--water)"}
              strokeWidth="1.6"
            />
            {s.kind === "food" ? (
              <circle
                cx={x(s.km).toFixed(1)}
                cy={y0 + 11}
                r="4"
                fill="var(--accent)"
              />
            ) : (
              <rect
                x={(x(s.km) - 3).toFixed(1)}
                y={y0 + 8}
                width="6"
                height="6"
                rx="1"
                fill="var(--water)"
              />
            )}
          </g>
        ))}

        {ticks.map((d) => (
          <text
            key={d}
            x={x(d).toFixed(1)}
            y={H - 6}
            fill="var(--muted)"
            fontSize="11"
            textAnchor={d === 0 ? "start" : d >= course.total - 0.01 ? "end" : "middle"}
          >
            {formatKm(d)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function StationList({ course }: { course: Course }) {
  const food = course.stations.filter((s) => s.kind === "food");
  const water = course.stations.filter((s) => s.kind !== "food");
  return (
    <div className={styles.stList}>
      {food.length ? (
        <p>
          <b>Питание</b> {food.map((s) => formatKm(s.km)).join(" · ")} км
        </p>
      ) : null}
      {water.length ? (
        <p>
          <b>Вода</b> {water.map((s) => formatKm(s.km)).join(" · ")} км
        </p>
      ) : null}
    </div>
  );
}

export default function PacingTool() {
  const [courseId, setCourseId] = useState<CourseId>("10");
  const [finish, setFinish] = useState<Finish>("kick");
  const [target, setTarget] = useState(COURSES["10"].defaultTarget);
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
    setTarget(COURSES[id].defaultTarget);
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
        <div className={styles.colInput}>
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
                  <button
                    key={p}
                    type="button"
                    aria-pressed={p === target}
                    onClick={() => setTarget(p)}
                  >
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
                  ? "Последняя часть быстрее рабочего темпа. Вариант для тех, у кого к концу остаются силы."
                  : "Один темп от старта до финиша, без ускорения в конце. Самый простой план: держишь одну цифру и не думаешь о раскладке."}
              </p>
            </div>

            <p className={styles.hint}>{course.hint}</p>

            <div className={styles.starts}>
              <p className={styles.startsH}>Старт {course.start.date}</p>
              <p>
                <b>{course.start.first}</b> первая массовая волна, кластер А, улица Косыгина. Дальше
                кластеры уходят с интервалами до <b>{course.start.last}</b>. Раскладка считается от
                своей волны: часы включаются на стартовой арке, а не в {course.start.elite}.
              </p>
              <p>
                <b>{course.start.elite}</b> уходит элитный кластер, и уходит с другого места, с{" "}
                {course.start.eliteWhere}. К массовому старту это время не относится.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.prof}>
          <p className={styles.profH}>Профиль трассы · {course.name}</p>
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
              <i className={styles.dotFood} style={{ background: "var(--accent)" }} />
              пункт питания
            </span>
            <span>
              <i style={{ background: "var(--water)" }} />
              вода
            </span>
          </p>
          <StationList course={course} />
        </div>

        <div className={styles.colRes}>
          <div className={styles.goal}>
            <div>
              <p className={styles.goalLab}>Финиш по плану</p>
              <p className={styles.goalT}>{plan ? formatTime(plan.total) : "··:··"}</p>
            </div>
            <p className={styles.goalR}>
              {plan ? (
                <>
                  Средний темп <b>{formatPace(plan.total / course.total)}</b> на километр.{" "}
                  {Math.abs(plan.diff) < 0.5
                    ? "Ровно в цель."
                    : plan.diff > 0
                      ? `Запас к цели ${Math.round(plan.diff)} с.`
                      : `Быстрее цели на ${Math.round(-plan.diff)} с.`}
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
                      {formatDec(Math.abs(plan.shift))} % {plan.shift < 0 ? "тяжелее" : "легче"}
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
                      const raw = s.grade * 100;
                      // -0,0 % бессмысленно на экране: это ноль, а не спуск
                      const g = Math.abs(raw) < 0.05 ? 0 : raw;
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
                            {formatDec(g)} %
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
            Трасса: {course.where}. Старт {course.start.date}, первая массовая волна{" "}
            {course.start.first}. Профиль приблизительный: снят с трека по спутниковой модели высот,
            мосты в такой модели не видны.
          </p>
        </div>
      </div>
    </div>
  );
}
