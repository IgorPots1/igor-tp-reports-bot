"use client";

import { useRef, useState } from "react";

import ConsultNotice from "@/components/ConsultNotice";
import TimeFields, { EMPTY_TIME, joinTime, type TimeParts } from "@/components/TimeFields";

import {
  buildPlan,
  dayMonth,
  formatTime,
  monthYear,
  paceOf,
  parseTime,
  resultLooksReal,
  type Answers,
  type Plan,
} from "./marathon-logic";
import styles from "./marathon.module.css";

type Option = { id: string; label: string };
type Question = {
  key: keyof Answers;
  q: string;
  hint?: string;
  options?: Option[];
  input?: true;
};

const QUESTIONS: Question[] = [
  {
    key: "exp",
    q: "Сколько ты уже бегаешь регулярно?",
    hint: "Хотя бы 2-3 раза в неделю, без долгих перерывов.",
    options: [
      { id: "lt6", label: "Меньше полугода" },
      { id: "6to12", label: "От полугода до года" },
      { id: "1to2", label: "1-2 года" },
      { id: "2p", label: "Больше 2 лет" },
    ],
  },
  {
    key: "km",
    q: "Сколько километров в неделю сейчас?",
    hint: "В среднем за последний месяц.",
    options: [
      { id: "lt20", label: "До 20 км" },
      { id: "20to30", label: "20-30 км" },
      { id: "30to45", label: "30-45 км" },
      { id: "45p", label: "Больше 45 км" },
    ],
  },
  {
    key: "runs",
    q: "Сколько тренировок в неделю?",
    options: [
      { id: "1to2", label: "1-2" },
      { id: "3", label: "3" },
      { id: "4", label: "4" },
      { id: "5p", label: "5 и больше" },
    ],
  },
  {
    key: "long",
    q: "Самая длинная пробежка за последний месяц?",
    options: [
      { id: "lt10", label: "До 10 км" },
      { id: "10to15", label: "10-15 км" },
      { id: "15to21", label: "15-21 км" },
      { id: "21p", label: "Больше 21 км" },
    ],
  },
  {
    key: "pain",
    q: "Бывает боль или дискомфорт после бега?",
    options: [
      { id: "no", label: "Нет" },
      { id: "some", label: "Иногда, после длинных или быстрых" },
      { id: "often", label: "Да, регулярно" },
    ],
  },
  {
    key: "race",
    q: "Когда марафон, на который смотришь?",
    options: [
      { id: "none", label: "Ещё не выбран" },
      { id: "lt3", label: "Меньше чем через 3 месяца" },
      { id: "3to4", label: "Через 3-4 месяца" },
      { id: "4to6", label: "Через 4-6 месяцев" },
      { id: "6p", label: "Больше чем через полгода" },
    ],
  },
  {
    key: "resTime",
    q: "Твой лучший результат за последний год",
    hint: "Нужен, чтобы прикинуть время на марафон. Можно пропустить.",
    input: true,
  },
];

type Screen = "intro" | "quiz" | "result";

export default function MarathonTest() {
  const [screen, setScreen] = useState<Screen>("intro");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [dist, setDist] = useState("10");
  const [time, setTime] = useState<TimeParts>(EMPTY_TIME);
  const [err, setErr] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [shared, setShared] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  /* Фокус уводится на заголовок шага руками: экран меняется без навигации, и
     читалка иначе осталась бы на кнопке, которой уже нет. */
  function focusHeading() {
    window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 0);
    window.scrollTo(0, 0);
  }

  function pick(key: keyof Answers, id: string) {
    setAnswers((a) => ({ ...a, [key]: id }));
    window.setTimeout(() => {
      setStep((s) => Math.min(s + 1, QUESTIONS.length - 1));
      focusHeading();
    }, 160);
  }

  function finish() {
    const raw = joinTime(time);
    const next: Answers = { ...answers, resTime: null, resDist: null };
    if (raw) {
      const t = parseTime(raw);
      const d = Number.parseFloat(dist);
      if (t === null || !resultLooksReal(d, t)) {
        setErr(
          d === 10
            ? "Введи время на 10 км, например 52:30"
            : "Введи время на полумарафоне, например 1:55:00",
        );
        return;
      }
      next.resTime = t;
      next.resDist = d;
    }
    setErr("");
    setAnswers(next);
    setPlan(buildPlan(next));
    setScreen("result");
    focusHeading();
  }

  function back() {
    if (step === 0) {
      setScreen("intro");
      return;
    }
    setStep((s) => s - 1);
    focusHeading();
  }

  function restart() {
    setAnswers({});
    setPlan(null);
    setStep(0);
    setTime(EMPTY_TIME);
    setDist("10");
    setErr("");
    setShared(false);
    setScreen("intro");
    window.scrollTo(0, 0);
  }

  async function share() {
    if (!plan) return;
    const url = window.location.href.split("#")[0];
    if (navigator.share) {
      try {
        await navigator.share({ title: "Пора готовиться к марафону?", text: plan.shareText, url });
      } catch {
        /* человек закрыл системное окно — это не ошибка */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${plan.shareText} ${url}`);
      setShared(true);
    } catch {
      /* буфер недоступен: кнопка просто ничего не делает, ломать экран нечем */
    }
  }

  if (screen === "intro") {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.h1} ref={headingRef} tabIndex={-1}>
          Пора готовиться к марафону?
        </h1>
        <p className={styles.lede}>
          Семь коротких вопросов. В конце узнаешь, с какого месяца тебе реально стартовать
          марафон, что подтянуть до начала подготовки и на какое время рассчитывать.
        </p>
        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            setStep(0);
            setScreen("quiz");
            focusHeading();
          }}
        >
          Пройти тест
        </button>
        <p className={styles.facts}>
          <span>
            <b className={styles.mono}>1</b> минута
          </span>
          <span>
            <b className={styles.mono}>7</b> вопросов
          </span>
          <span>без регистрации</span>
        </p>
      </div>
    );
  }

  if (screen === "quiz") {
    const q = QUESTIONS[step];
    return (
      <div className={styles.wrap}>
        <div className={styles.progress} aria-hidden="true">
          <i style={{ width: `${(step / QUESTIONS.length) * 100}%` }} />
        </div>
        <p className={styles.step}>
          Вопрос {step + 1} из {QUESTIONS.length}
        </p>
        <h1 className={styles.q} ref={headingRef} tabIndex={-1}>
          {q.q}
        </h1>
        {q.hint ? <p className={styles.hint}>{q.hint}</p> : null}

        {q.options ? (
          <div className={styles.opts} role="group" aria-label={q.q}>
            {q.options.map((o) => (
              <button
                key={o.id}
                type="button"
                className={styles.opt}
                aria-pressed={answers[q.key] === o.id}
                onClick={() => pick(q.key, o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.resinput}>
            <div className={styles.resrow}>
              <div>
                <label className={styles.lbl} htmlFor="marathon-dist">
                  Дистанция
                </label>
                <select
                  id="marathon-dist"
                  className={styles.select}
                  value={dist}
                  onChange={(e) => setDist(e.target.value)}
                >
                  <option value="10">10 км</option>
                  <option value="21.0975">Полумарафон</option>
                </select>
              </div>
              <div>
                <p className={styles.lbl}>Время</p>
                <TimeFields
                  idPrefix="marathon-time"
                  label="Время результата"
                  value={time}
                  onChange={(next) => {
                    setTime(next);
                    setErr("");
                  }}
                />
              </div>
            </div>
            <p className={styles.err} aria-live="polite">
              {err}
            </p>
          </div>
        )}

        <div className={styles.nav}>
          <button type="button" className={styles.link} onClick={back}>
            {step === 0 ? "На старт" : "Назад"}
          </button>
          {q.input ? (
            <button type="button" className={styles.btn} onClick={finish}>
              Показать результат
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!plan) return null;

  const vClass =
    plan.verdictClass === "ok" ? styles.vOk : plan.verdictClass === "mid" ? styles.vMid : styles.vNo;

  return (
    <div className={styles.wrap}>
      <h1 className={`${styles.verdict} ${vClass}`} ref={headingRef} tabIndex={-1}>
        {plan.verdict}
      </h1>
      <p className={styles.vsub}>{plan.sub}</p>

      <div className={styles.when}>
        <h2 className={styles.h2}>Самый реальный марафон</h2>
        <p className={`${styles.date} ${styles.mono}`}>
          {plan.date ? monthYear(plan.date) : "после восстановления"}
        </p>
        <div
          className={styles.bar}
          role="img"
          aria-label={`База ${plan.base} недель, подготовка ${plan.prep} недель`}
        >
          <span className={styles.barBase} style={{ width: `${(plan.base / plan.total) * 100}%` }} />
          <span className={styles.barPrep} style={{ width: `${(plan.prep / plan.total) * 100}%` }} />
        </div>
        <p className={styles.legend}>
          <span>
            <i className={styles.key} style={{ background: "var(--line-2)" }} />
            {plan.base ? `база ${plan.base} нед.` : "база уже есть"}
          </span>
          <span>
            <i className={styles.key} style={{ background: "var(--accent)" }} />
            подготовка {plan.prep} нед.
          </span>
        </p>
        {plan.stop ? null : (
          <p className={styles.phases}>
            {plan.baseEnd ? (
              <>
                База до <b>{dayMonth(plan.baseEnd)}</b>, потом 4-5 месяцев подготовки.
              </>
            ) : (
              <>
                Подготовку можно начинать <b>уже сейчас</b>.
              </>
            )}
          </p>
        )}
        {plan.raceNote ? <p className={styles.warnbox}>{plan.raceNote}</p> : null}
      </div>

      <div className={styles.sec}>
        <h2 className={styles.h2}>Что уже есть, а что подтянуть</h2>
        <ul className={styles.checks}>
          {plan.checks.map((c) => (
            <li key={c.title}>
              <span
                className={`${styles.mark} ${
                  c.mark === "y" ? styles.mY : c.mark === "w" ? styles.mW : styles.mN
                }`}
                aria-hidden="true"
              >
                {c.mark === "y" ? "✓" : c.mark === "w" ? "!" : "✕"}
              </span>
              <div>
                <b>{c.title}</b>
                <span>{c.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {plan.forecast ? (
        <div className={styles.sec}>
          <h2 className={styles.h2}>Ориентир на первый марафон</h2>
          <div className={styles.forecast}>
            <p className={`${styles.forecastT} ${styles.mono}`}>
              {formatTime(plan.forecast.lo)}-{formatTime(plan.forecast.hi)}
            </p>
            <p>
              Темп примерно {paceOf(plan.forecast.lo)}-{paceOf(plan.forecast.hi)} на км. Это
              ориентир после полноценной подготовки, а не обещание. На первом марафоне лучше
              начать с нижней границы скорости и ускориться во второй половине.
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.sec}>
        <h2 className={styles.h2}>Что сделать на этой неделе</h2>
        <div className={styles.next}>
          <p>{plan.nextStep}</p>
        </div>
      </div>

      <button type="button" className={styles.share} onClick={share}>
        {shared ? "Ссылка скопирована" : "Поделиться результатом"}
      </button>

      <ConsultNotice prefill="Здравствуйте! Хочу на бесплатную консультацию по подготовке к марафону" />
      <p className={styles.planLink}>
        Темпы для тренировок: <a href="/tools/plan">igorp.run/tools/plan</a>
      </p>

      <p>
        <button type="button" className={styles.link} onClick={restart}>
          Пройти заново
        </button>
      </p>

      <p className={styles.foot}>
        Это ориентир, а не диагноз. Если что-то болит, сначала покажись специалисту.
      </p>
    </div>
  );
}
