"use client";

import { useRef, useState } from "react";

const TOTAL_STEPS = 5;
const DONE_STEP = 6;

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Дни недели кодами: в базе available_days text[] = ['mon','tue',...]. */
const DAYS: { code: string; label: string }[] = [
  { code: "mon", label: "Пн" },
  { code: "tue", label: "Вт" },
  { code: "wed", label: "Ср" },
  { code: "thu", label: "Чт" },
  { code: "fri", label: "Пт" },
  { code: "sat", label: "Сб" },
  { code: "sun", label: "Вс" },
];

const STRENGTH: { code: string; label: string }[] = [
  { code: "yes", label: "Да" },
  { code: "no", label: "Нет" },
  { code: "already", label: "Уже делаю" },
];

const SEX = [
  { code: "female", label: "Женский" },
  { code: "male", label: "Мужской" },
];

const WEEKLY_KM = ["Не бегаю", "до 10", "10–20", "20–40", "40–60", "60+"];
const MAX_DISTANCE = ["до 5 км", "5–10 км", "10–21 км", "21 км", "42 км", "больше"];
const DURATION = ["до 30 мин", "30–45 мин", "45–60 мин", "60–90 мин", "90+ мин"];
const SURFACES = ["Улица / парк", "Дорожка", "Стадион", "Манеж"];
const GADGETS = [
  "Garmin",
  "Apple Watch",
  "Polar",
  "Coros",
  "Suunto",
  "Приложение на телефоне",
  "Нагрудный пульсометр",
  "Ничего нет",
];

type Draft = {
  full_name: string;
  birth_date: string;
  sex: string;
  height_cm: string;
  weight_kg: string;
  city: string;
  health_chronic: string;
  health_injuries: string;
  health_discomfort: string;
  health_disclaimer_accepted: boolean;
  weekly_km: string;
  max_distance: string;
  pr_5k: string;
  pr_10k: string;
  pr_21k: string;
  pr_42k: string;
  current_training: string;
  other_sports: string;
  goal: string;
  races_this_year: string;
  why_intensive: string;
  available_days: string[];
  session_duration: string;
  surfaces: string[];
  gadgets: string[];
  shoes: string;
  strength: string;
};

const EMPTY: Draft = {
  full_name: "",
  birth_date: "",
  sex: "",
  height_cm: "",
  weight_kg: "",
  city: "",
  health_chronic: "",
  health_injuries: "",
  health_discomfort: "",
  health_disclaimer_accepted: false,
  weekly_km: "",
  max_distance: "",
  pr_5k: "",
  pr_10k: "",
  pr_21k: "",
  pr_42k: "",
  current_training: "",
  other_sports: "",
  goal: "",
  races_this_year: "",
  why_intensive: "",
  available_days: [],
  session_duration: "",
  surfaces: [],
  gadgets: [],
  shoes: "",
  strength: "",
};

/** Обязательные поля по шагам — ровно те, что помечены звёздочкой в эталоне. */
const REQUIRED: Record<number, { key: keyof Draft; message: string }[]> = {
  1: [
    { key: "full_name", message: "Как тебя зовут?" },
    { key: "birth_date", message: "Без даты рождения не посчитать пульсовые зоны" },
    { key: "sex", message: "Выбери пол" },
    { key: "height_cm", message: "Укажи рост в сантиметрах" },
    { key: "weight_kg", message: "Укажи вес в килограммах" },
    { key: "city", message: "Укажи город" },
  ],
  2: [
    { key: "health_chronic", message: "Напиши про здоровье. Если проблем нет — так и напиши" },
    { key: "health_injuries", message: "Напиши про травмы. Если их не было — так и напиши" },
    { key: "health_discomfort", message: "Напиши про дискомфорт. Если его нет — так и напиши" },
    { key: "health_disclaimer_accepted", message: "Без этого подтверждения записать не могу" },
  ],
  3: [
    { key: "weekly_km", message: "Выбери, сколько бегаешь сейчас" },
    { key: "max_distance", message: "Выбери самую длинную дистанцию" },
    { key: "current_training", message: "Расскажи, как тренируешься сейчас" },
    { key: "other_sports", message: "Напиши про другие занятия. Если их нет — так и напиши" },
  ],
  4: [
    { key: "goal", message: "Напиши про цель — с ней план получится осмысленным" },
    { key: "races_this_year", message: "Напиши про забеги. Если их не планируешь — так и напиши" },
    { key: "why_intensive", message: "Напиши, почему решил(а) пойти" },
  ],
  5: [
    { key: "available_days", message: "Отметь хотя бы один день" },
    { key: "session_duration", message: "Выбери, сколько времени готов(а) тратить" },
    { key: "surfaces", message: "Отметь, где обычно бегаешь" },
    { key: "gadgets", message: "Отметь гаджеты. Если ничего нет — так и отметь" },
    { key: "strength", message: "Выбери вариант по силовым" },
  ],
};

function isFilled(value: Draft[keyof Draft]): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return value.trim().length > 0;
}

type PickedFile = { file: File; key: string };

export default function ApplyForm() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function toggle(key: "available_days" | "surfaces" | "gadgets", value: string) {
    const current = draft[key];
    set(
      key,
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  /** Черновик живёт в состоянии страницы, поэтому «назад» ничего не теряет. */
  function goBack(target: number) {
    setStep(target);
    scrollTop();
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validate(current: number): boolean {
    const found: Partial<Record<keyof Draft, string>> = {};
    for (const rule of REQUIRED[current] ?? []) {
      if (!isFilled(draft[rule.key])) found[rule.key] = rule.message;
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  function goNext(target: number) {
    if (!validate(step)) return;
    setStep(target);
    scrollTop();
  }

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const incoming = [...picked];
    let rejected: string | null = null;
    const accepted: PickedFile[] = [];

    for (const file of incoming) {
      if (!file.type.startsWith("image/")) {
        rejected = "Можно загружать только изображения";
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected = `«${file.name}» больше 10 МБ`;
        continue;
      }
      accepted.push({ file, key: `${file.name}-${file.size}-${file.lastModified}` });
    }

    setFiles((prev) => {
      const merged = [...prev];
      for (const item of accepted) {
        if (merged.some((existing) => existing.key === item.key)) continue;
        if (merged.length >= MAX_FILES) {
          rejected = `Не больше ${MAX_FILES} скриншотов`;
          break;
        }
        merged.push(item);
      }
      return merged;
    });
    setFileError(rejected);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit() {
    if (!validate(5)) return;
    setSending(true);
    setSendError(null);

    const payload = new FormData();
    for (const [key, value] of Object.entries(draft)) {
      if (Array.isArray(value)) {
        for (const item of value) payload.append(key, item);
      } else if (typeof value === "boolean") {
        payload.append(key, value ? "true" : "false");
      } else {
        payload.append(key, value);
      }
    }
    for (const item of files) payload.append("screenshots", item.file);

    try {
      const response = await fetch("/api/intensive/apply", {
        method: "POST",
        body: payload,
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || result.ok !== true) {
        setSendError(result.error ?? "Не получилось отправить анкету. Попробуй ещё раз.");
        setSending(false);
        return;
      }
      setStep(DONE_STEP);
      scrollTop();
    } catch {
      setSendError("Не получилось отправить анкету. Проверь связь и попробуй ещё раз.");
    }
    setSending(false);
  }

  const progress = (Math.min(step, TOTAL_STEPS) / TOTAL_STEPS) * 100;
  const counter = step > TOTAL_STEPS ? "Готово" : `Шаг ${step} из ${TOTAL_STEPS}`;

  function err(key: keyof Draft) {
    return errors[key] ? <div className="emsg">{errors[key]}</div> : null;
  }
  function bad(key: keyof Draft) {
    return errors[key] ? " bad" : "";
  }

  return (
    <>
      <header>
        <div className="wrap hbar">
          <div className="t">
            <span className="dot" />
            Анкета участника
          </div>
          <div className="c">{counter}</div>
        </div>
        <div className="prog">
          <i style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="wrap">
        {/* ШАГ 1 */}
        <section className={`step${step === 1 ? " on" : ""}`}>
          <span className="eyebrow">Шаг 1 · О тебе</span>
          <h2>Познакомимся</h2>
          <p className="lede">Базовые данные, чтобы правильно рассчитать нагрузку и зоны.</p>

          <div className={`f${bad("full_name")}`}>
            <label htmlFor="full_name">
              Имя и фамилия <span className="req">*</span>
            </label>
            <input
              id="full_name"
              type="text"
              placeholder="Например: Анна Петрова"
              value={draft.full_name}
              onChange={(event) => set("full_name", event.target.value)}
            />
            {err("full_name")}
          </div>

          <div className={`f${bad("birth_date")}`}>
            <label htmlFor="birth_date">
              Дата рождения <span className="req">*</span>
            </label>
            <div className="hint">Нужна для расчёта пульсовых зон</div>
            <input
              id="birth_date"
              type="date"
              value={draft.birth_date}
              onChange={(event) => set("birth_date", event.target.value)}
            />
            {err("birth_date")}
          </div>

          <div className={`f${bad("sex")}`}>
            <label>
              Пол <span className="req">*</span>
            </label>
            <div className="chips">
              {SEX.map((option) => (
                <label className="chip" key={option.code}>
                  <input
                    type="radio"
                    name="sex"
                    checked={draft.sex === option.code}
                    onChange={() => set("sex", option.code)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {err("sex")}
          </div>

          <div className="f row">
            <div className={bad("height_cm") ? "f bad" : "f"} style={{ marginBottom: 0 }}>
              <label htmlFor="height_cm">
                Рост <span className="req">*</span>
              </label>
              <div className="suffix">
                <input
                  id="height_cm"
                  type="number"
                  placeholder="170"
                  value={draft.height_cm}
                  onChange={(event) => set("height_cm", event.target.value)}
                />
                <span>см</span>
              </div>
              {err("height_cm")}
            </div>
            <div className={bad("weight_kg") ? "f bad" : "f"} style={{ marginBottom: 0 }}>
              <label htmlFor="weight_kg">
                Вес <span className="req">*</span>
              </label>
              <div className="suffix">
                <input
                  id="weight_kg"
                  type="number"
                  placeholder="65"
                  value={draft.weight_kg}
                  onChange={(event) => set("weight_kg", event.target.value)}
                />
                <span>кг</span>
              </div>
              {err("weight_kg")}
            </div>
          </div>

          <div className={`f${bad("city")}`}>
            <label htmlFor="city">
              Город <span className="req">*</span>
            </label>
            <div className="hint">Чтобы учесть часовой пояс и погоду</div>
            <input
              id="city"
              type="text"
              placeholder="Например: Москва"
              value={draft.city}
              onChange={(event) => set("city", event.target.value)}
            />
            {err("city")}
          </div>

          <div className="nav">
            <button className="btn" type="button" onClick={() => goNext(2)}>
              Далее &rarr;
            </button>
          </div>
        </section>

        {/* ШАГ 2 */}
        <section className={`step${step === 2 ? " on" : ""}`}>
          <span className="eyebrow">Шаг 2 · Здоровье</span>
          <h2>Чтобы не навредить</h2>
          <p className="lede">Самый важный блок. От него зависит, как я построю нагрузку.</p>

          <div className="med">
            <div className="note">
              <span className="i">!</span>
              <span>
                Эти данные видит только тренер. Они нужны, чтобы подобрать безопасную
                нагрузку, и не передаются третьим лицам.
              </span>
            </div>

            <div className={`f${bad("health_chronic")}`}>
              <label htmlFor="health_chronic">
                Есть ли хронические проблемы со здоровьем? <span className="req">*</span>
              </label>
              <div className="hint">
                Сердце, давление, суставы, спина, дыхание, что-то ещё. Если нет — так и напиши
              </div>
              <textarea
                id="health_chronic"
                placeholder="Например: нет. Или: гипертония, принимаю препараты"
                value={draft.health_chronic}
                onChange={(event) => set("health_chronic", event.target.value)}
              />
              {err("health_chronic")}
            </div>

            <div className={`f${bad("health_injuries")}`}>
              <label htmlFor="health_injuries">
                Травмы и операции <span className="req">*</span>
              </label>
              <div className="hint">Что и как давно. Даже старые — важно</div>
              <textarea
                id="health_injuries"
                placeholder="Например: разрыв мениска, операция 3 года назад"
                value={draft.health_injuries}
                onChange={(event) => set("health_injuries", event.target.value)}
              />
              {err("health_injuries")}
            </div>

            <div className={`f${bad("health_discomfort")}`}>
              <label htmlFor="health_discomfort">
                Есть ли дискомфорт во время бега или после? <span className="req">*</span>
              </label>
              <div className="hint">Колени, стопы, голень, спина, дыхание</div>
              <textarea
                id="health_discomfort"
                placeholder="Например: тянет правое колено после 5 км"
                value={draft.health_discomfort}
                onChange={(event) => set("health_discomfort", event.target.value)}
              />
              {err("health_discomfort")}
            </div>
          </div>

          <label className={`check${errors.health_disclaimer_accepted ? " bad" : ""}`}>
            <input
              type="checkbox"
              checked={draft.health_disclaimer_accepted}
              onChange={(event) =>
                set("health_disclaimer_accepted", event.target.checked)
              }
            />
            <span>
              Подтверждаю, что не имею противопоказаний к физическим нагрузкам. При
              сомнениях проконсультируюсь с врачом. <span className="req">*</span>
            </span>
          </label>
          {err("health_disclaimer_accepted")}

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(1)}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={() => goNext(3)}>
              Далее &rarr;
            </button>
          </div>
        </section>

        {/* ШАГ 3 */}
        <section className={`step${step === 3 ? " on" : ""}`}>
          <span className="eyebrow">Шаг 3 · Опыт</span>
          <h2>Где ты сейчас</h2>
          <p className="lede">Твой текущий уровень — точка старта для плана.</p>

          <div className={`f${bad("weekly_km")}`}>
            <label>
              Сколько км в неделю пробегаешь сейчас? <span className="req">*</span>
            </label>
            <div className="chips">
              {WEEKLY_KM.map((option) => (
                <label className="chip" key={option}>
                  <input
                    type="radio"
                    name="km"
                    checked={draft.weekly_km === option}
                    onChange={() => set("weekly_km", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {err("weekly_km")}
          </div>

          <div className={`f${bad("max_distance")}`}>
            <label>
              Самая длинная дистанция, которую пробегал(а) <span className="req">*</span>
            </label>
            <div className="chips">
              {MAX_DISTANCE.map((option) => (
                <label className="chip" key={option}>
                  <input
                    type="radio"
                    name="max"
                    checked={draft.max_distance === option}
                    onChange={() => set("max_distance", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {err("max_distance")}
          </div>

          <div className="f">
            <label>Личные рекорды</label>
            <div className="hint">Заполни те, что знаешь. Можно примерно</div>
            <div className="pr">
              <div className="pr-row">
                <span className="d">5 км</span>
                <input
                  type="text"
                  placeholder="напр. 28:40"
                  value={draft.pr_5k}
                  onChange={(event) => set("pr_5k", event.target.value)}
                />
              </div>
              <div className="pr-row">
                <span className="d">10 км</span>
                <input
                  type="text"
                  placeholder="напр. 58:10"
                  value={draft.pr_10k}
                  onChange={(event) => set("pr_10k", event.target.value)}
                />
              </div>
              <div className="pr-row">
                <span className="d">21,1 км</span>
                <input
                  type="text"
                  placeholder="напр. 2:05:00"
                  value={draft.pr_21k}
                  onChange={(event) => set("pr_21k", event.target.value)}
                />
              </div>
              <div className="pr-row">
                <span className="d">42,2 км</span>
                <input
                  type="text"
                  placeholder="напр. 4:30:00"
                  value={draft.pr_42k}
                  onChange={(event) => set("pr_42k", event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className={`f${bad("current_training")}`}>
            <label htmlFor="current_training">
              Как тренируешься сейчас? <span className="req">*</span>
            </label>
            <div className="hint">
              Есть ли план, какие тренировки делаешь, сколько раз в неделю
            </div>
            <textarea
              id="current_training"
              placeholder="Например: бегаю 3 раза в неделю по 40 минут, без плана, всё в одном темпе"
              value={draft.current_training}
              onChange={(event) => set("current_training", event.target.value)}
            />
            {err("current_training")}
          </div>

          <div className={`f${bad("other_sports")}`}>
            <label htmlFor="other_sports">
              Занимаешься чем-то ещё кроме бега? <span className="req">*</span>
            </label>
            <div className="hint">Зал, плавание, велосипед, йога — что и как часто</div>
            <textarea
              id="other_sports"
              placeholder="Например: зал 2 раза в неделю"
              value={draft.other_sports}
              onChange={(event) => set("other_sports", event.target.value)}
            />
            {err("other_sports")}
          </div>

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(2)}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={() => goNext(4)}>
              Далее &rarr;
            </button>
          </div>
        </section>

        {/* ШАГ 4 */}
        <section className={`step${step === 4 ? " on" : ""}`}>
          <span className="eyebrow">Шаг 4 · Цель</span>
          <h2>Куда идём</h2>
          <p className="lede">Чтобы план вёл к твоей цели, а не в никуда.</p>

          <div className={`f${bad("goal")}`}>
            <label htmlFor="goal">
              Какая у тебя беговая цель? <span className="req">*</span>
            </label>
            <div className="hint">
              Даже если это «просто бегать регулярно и не бросить» — так и напиши
            </div>
            <textarea
              id="goal"
              placeholder="Например: пробежать первую десятку без остановок"
              value={draft.goal}
              onChange={(event) => set("goal", event.target.value)}
            />
            {err("goal")}
          </div>

          <div className={`f${bad("races_this_year")}`}>
            <label htmlFor="races_this_year">
              Готовишься к забегам в этом году? <span className="req">*</span>
            </label>
            <div className="hint">Если да — какие и какой результат хочешь показать</div>
            <textarea
              id="races_this_year"
              placeholder="Например: полумарафон в октябре, хочу из 2 часов"
              value={draft.races_this_year}
              onChange={(event) => set("races_this_year", event.target.value)}
            />
            {err("races_this_year")}
          </div>

          <div className={`f${bad("why_intensive")}`}>
            <label htmlFor="why_intensive">
              Почему решил(а) пойти на интенсив? <span className="req">*</span>
            </label>
            <textarea
              id="why_intensive"
              placeholder="Например: бегаю сама, но не понимаю, правильно ли"
              value={draft.why_intensive}
              onChange={(event) => set("why_intensive", event.target.value)}
            />
            {err("why_intensive")}
          </div>

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(3)}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={() => goNext(5)}>
              Далее &rarr;
            </button>
          </div>
        </section>

        {/* ШАГ 5 */}
        <section className={`step${step === 5 ? " on" : ""}`}>
          <span className="eyebrow">Шаг 5 · Практика</span>
          <h2>Как будем тренироваться</h2>
          <p className="lede">Последний шаг — расписание и техника.</p>

          <div className={`f${bad("available_days")}`}>
            <label>
              В какие дни удобно тренироваться? <span className="req">*</span>
            </label>
            <div className="hint">Отметь все подходящие</div>
            <div className="chips">
              {DAYS.map((day) => (
                <label className="chip day" key={day.code}>
                  <input
                    type="checkbox"
                    checked={draft.available_days.includes(day.code)}
                    onChange={() => toggle("available_days", day.code)}
                  />
                  <span>{day.label}</span>
                </label>
              ))}
            </div>
            {err("available_days")}
          </div>

          <div className={`f${bad("session_duration")}`}>
            <label>
              Сколько времени готов(а) тратить на тренировку? <span className="req">*</span>
            </label>
            <div className="chips">
              {DURATION.map((option) => (
                <label className="chip" key={option}>
                  <input
                    type="radio"
                    name="tm"
                    checked={draft.session_duration === option}
                    onChange={() => set("session_duration", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {err("session_duration")}
          </div>

          <div className={`f${bad("surfaces")}`}>
            <label>
              Где обычно бегаешь? <span className="req">*</span>
            </label>
            <div className="chips">
              {SURFACES.map((option) => (
                <label className="chip" key={option}>
                  <input
                    type="checkbox"
                    checked={draft.surfaces.includes(option)}
                    onChange={() => toggle("surfaces", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {err("surfaces")}
          </div>

          <div className={`f${bad("gadgets")}`}>
            <label>
              Какие гаджеты используешь? <span className="req">*</span>
            </label>
            <div className="chips">
              {GADGETS.map((option) => (
                <label className="chip" key={option}>
                  <input
                    type="checkbox"
                    checked={draft.gadgets.includes(option)}
                    onChange={() => toggle("gadgets", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {err("gadgets")}
          </div>

          <div className="f">
            <label htmlFor="shoes">В каких кроссовках бегаешь?</label>
            <input
              id="shoes"
              type="text"
              placeholder="Например: Nike Pegasus 40. Или: пока не знаю"
              value={draft.shoes}
              onChange={(event) => set("shoes", event.target.value)}
            />
          </div>

          <div className={`f${bad("strength")}`}>
            <label>
              Хочешь добавить силовые тренировки? <span className="req">*</span>
            </label>
            <div className="chips">
              {STRENGTH.map((option) => (
                <label className="chip" key={option.code}>
                  <input
                    type="radio"
                    name="str"
                    checked={draft.strength === option.code}
                    onChange={() => set("strength", option.code)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {err("strength")}
          </div>

          <div className="f">
            <label>Скриншоты последних тренировок</label>
            <div className="hint">
              Помогают точнее оценить твой уровень. Нужны экраны с темпом, пульсом и
              дистанцией
            </div>
            <label className="up">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => addFiles(event.target.files)}
              />
              <div className="ic">&#8679;</div>
              <div className="t">Загрузить скриншоты</div>
              <div className="s">
                1) последняя длительная пробежка
                <br />
                2) интервальная или быстрая, если делаешь
                <br />
                3) сводка за неделю или месяц
              </div>
            </label>
            {fileError ? <div className="emsg">{fileError}</div> : null}
            {files.length > 0 ? (
              <div className="up-list">
                {files.map((item, index) => (
                  <div className="up-item" key={item.key}>
                    <span className="n">{index + 1}</span>
                    <span className="fn">{item.file.name}</span>
                    <button
                      className="x"
                      type="button"
                      aria-label={`Убрать ${item.file.name}`}
                      onClick={() =>
                        setFiles((prev) => prev.filter((file) => file.key !== item.key))
                      }
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {sendError ? <div className="sendfail">{sendError}</div> : null}

          <div className="nav">
            <button className="btn ghost" type="button" onClick={() => goBack(4)} disabled={sending}>
              &larr;
            </button>
            <button className="btn" type="button" onClick={submit} disabled={sending}>
              {sending ? "Отправляю…" : "Отправить анкету"}
            </button>
          </div>
        </section>

        {/* ГОТОВО. Экран ОДИН на любой исход — и для попавших в набор, и для
            тех, кто пришёл сверх лимита. Снаружи разницы быть не должно: кто
            в наборе, а кто в очереди, видит только тренер в админке.
            Обещания «место закреплено» здесь нет намеренно — сверх лимита оно
            было бы неправдой. */}
        <section className={`step${step === DONE_STEP ? " on" : ""}`}>
          <div className="done">
            <div className="tick">&#10003;</div>
            <h2>Анкета отправлена</h2>
            <p>Я изучу твои ответы и напишу в Telegram перед стартом потока.</p>
            <p>Если что-то захочешь добавить — просто напиши мне.</p>
          </div>
        </section>
      </main>
    </>
  );
}
