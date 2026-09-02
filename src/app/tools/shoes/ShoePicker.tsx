"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { shoeLabels, TIER_WORDS } from "@/features/shoes/labels";
import { recommend } from "@/features/shoes/recommend";
import { entryById, labelOf, searchShoes, type IndexEntry } from "@/features/shoes/search";
import { TOTAL_WEIGHT } from "@/features/shoes/weights";
import type {
  Answers,
  ClientCatalog,
  Dislike,
  Issue,
  Recommendation,
} from "@/features/shoes/types";

import styles from "./shoes.module.css";

/**
 * Опросник и выдача подборщика.
 *
 * Считается всё здесь, на клиенте: языковая модель в рантайме не участвует.
 * На аудитории в 15 тысяч каждый прогон через модель стоил бы денег, а главное
 * — модель начала бы выдумывать модели и характеристики, которых нет в базе.
 *
 * Каталог приходит пропсом с сервера и УЖЕ без цен: цену нельзя показать в
 * интерфейсе, и надёжнее всего это гарантируется тем, что её здесь физически нет.
 */

const STORAGE_KEY = "igorp-shoes-picker-v1";

const STEP_TITLES = ["Про бег", "Про тебя", "Опыт", "Предпочтения"];

/** Что должно быть отвечено, чтобы уйти со шага дальше. */
const REQUIRED: (keyof Answers)[][] = [
  ["weeklyVolume", "surface", "winter", "goal", "speedwork"],
  ["gender", "bodyWeightKg", "footWidth", "pronation", "issues"],
  ["dislikes"],
  ["feel", "tier", "market", "pairs"],
];

type Draft = Partial<Answers>;

const DEFAULT_DRAFT: Draft = { bodyWeightKg: 70, ownedShoeIds: [] };

type Option<T> = { value: T; label: string };

function Choice<T extends string | number | boolean>({
  label,
  hint,
  options,
  value,
  onChange,
  two,
}: {
  label: string;
  hint?: string;
  options: Option<T>[];
  value: T | undefined;
  onChange: (v: T) => void;
  two?: boolean;
}) {
  return (
    <div className={styles.question}>
      <p className={styles.questionLabel}>{label}</p>
      {hint ? <p className={styles.questionHint}>{hint}</p> : null}
      <div className={`${styles.options} ${two ? styles.optionsTwo : ""}`}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            className={`${styles.option} ${value === o.value ? styles.optionActive : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Множественный выбор с исключающим вариантом: «ничего не беспокоило» гасит
 * остальные отметки, а любая другая отметка гасит его.
 */
function MultiChoice<T extends string>({
  label,
  hint,
  options,
  value,
  exclusive,
  onChange,
}: {
  label: string;
  hint?: string;
  options: Option<T>[];
  value: T[] | undefined;
  exclusive: T;
  onChange: (v: T[]) => void;
}) {
  const selected = value ?? [];
  const toggle = (v: T) => {
    if (v === exclusive) return onChange([exclusive]);
    const next = selected.includes(v)
      ? selected.filter((x) => x !== v)
      : [...selected.filter((x) => x !== exclusive), v];
    onChange(next);
  };
  return (
    <div className={styles.question}>
      <p className={styles.questionLabel}>{label}</p>
      {hint ? <p className={styles.questionHint}>{hint}</p> : null}
      <div className={styles.options}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`${styles.option} ${selected.includes(o.value) ? styles.optionActive : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function OwnedShoes({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => (query.trim().length >= 2 ? searchShoes(query) : []), [query]);
  const chosen = value
    .map((id) => entryById(id))
    .filter((e): e is IndexEntry => Boolean(e));

  const add = (e: IndexEntry) => {
    if (!value.includes(e.id)) onChange([...value, e.id]);
    setQuery("");
  };

  return (
    <div className={styles.question}>
      <p className={styles.questionLabel}>Твои прошлые и нынешние кроссовки</p>
      <p className={styles.questionHint}>
        Начни печатать — можно по-русски: «пегас», «клифтон», «новабласт».
        Если сейчас ни в чём не бегаешь, пропусти.
      </p>
      <div className={styles.searchWrap}>
        <input
          className={styles.searchInput}
          type="text"
          value={query}
          placeholder="Например, Nike Pegasus"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск модели кроссовок"
        />
        {hits.length > 0 ? (
          <ul className={styles.suggestions}>
            {hits.map((h) => (
              <li key={h.id}>
                <button type="button" className={styles.suggestion} onClick={() => add(h)}>
                  {labelOf(h)}{" "}
                  <span className={styles.suggestionYear}>{h.year}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {chosen.length > 0 ? (
        <div className={styles.chips}>
          {chosen.map((e) => (
            <button
              key={e.id}
              type="button"
              className={styles.chip}
              onClick={() => onChange(value.filter((id) => id !== e.id))}
            >
              {labelOf(e)}
              <span className={styles.chipRemove}>×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Card({ rec, best }: { rec: Recommendation; best: boolean }) {
  const s = rec.shoe;
  const market = s.available.includes("ru") ? "ru" : "eu";
  return (
    <article className={`${styles.card} ${best ? styles.cardBest : ""}`}>
      {best ? <div className={styles.bestBadge}>Лучшее совпадение</div> : null}
      {/* Фотографии в версии 1.0 нет — карточка обязана быть цельной и без неё. */}
      {s.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.cardImage} src={s.image} alt={`${s.brand} ${s.model}`} />
      ) : null}
      <div className={styles.cardHead}>
        <div className={styles.cardName}>
          {s.brand} {s.model}
        </div>
        <div className={styles.cardScore}>
          {rec.score}
          <span className={styles.cardScoreUnit}>совпадение</span>
        </div>
      </div>
      <div className={styles.cardMeta}>
        уровень: {TIER_WORDS[s.tier[market]]} · {s.year}
      </div>

      <div className={styles.tags}>
        {shoeLabels(rec).map((t) => (
          <span key={t} className={styles.tag}>
            {t}
          </span>
        ))}
      </div>

      {rec.pros.length > 0 ? (
        <ul className={styles.pros}>
          {rec.pros.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {rec.cons.length > 0 ? (
        <ul className={styles.cons}>
          {rec.cons.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      {rec.variant.borrowedFromMen ? (
        <p className={styles.borrowed}>
          Женская версия в лаборатории не измерялась — плотность и мягкость здесь
          с мужской.
        </p>
      ) : null}

      <details className={styles.details}>
        <summary className={styles.summary}>Цифры и разбор баллов</summary>
        <div className={styles.numbers}>
          <div className={styles.numberRow}>
            <span className={styles.numberLabel}>Под пяткой</span>
            <span>{s.stack_heel_mm} мм</span>
          </div>
          <div className={styles.numberRow}>
            <span className={styles.numberLabel}>Под носком</span>
            <span>{s.stack_fore_mm} мм</span>
          </div>
          <div className={styles.numberRow}>
            <span className={styles.numberLabel}>Перепад</span>
            <span>{s.drop_mm} мм</span>
          </div>
          <div className={styles.numberRow}>
            <span className={styles.numberLabel}>Вес пары</span>
            <span>{rec.variant.weight_g} г</span>
          </div>
        </div>
        <div className={styles.breakdown}>
          {rec.criteria
            .slice()
            .sort((a, b) => b.contribution - a.contribution)
            .map((c) => (
              <div key={c.id} className={styles.breakdownRow}>
                <span>{c.title}</span>
                <span className={styles.breakdownValue}>
                  {c.contribution.toFixed(1)} /{" "}
                  {((c.weight * 100) / TOTAL_WEIGHT).toFixed(1)}
                </span>
                <span className={styles.breakdownBarTrack}>
                  <span
                    className={styles.breakdownBar}
                    style={{ width: `${Math.round(c.score * 100)}%` }}
                  />
                </span>
              </div>
            ))}
        </div>
      </details>
    </article>
  );
}

export default function ShoePicker({ catalog }: { catalog: ClientCatalog }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [done, setDone] = useState(false);
  // Сохранять ли ответы. По умолчанию НЕТ: среди ответов вес и история травм,
  // то есть данные о здоровье, и брать их можно только с явного согласия, а не
  // с молчаливого. Калибровка весов держится на этих ответах, но она не повод
  // забирать их у того, кто не отметил галочку.
  const [saveAnswers, setSaveAnswers] = useState(false);
  const [restored, setRestored] = useState(false);
  const sent = useRef(false);

  // Ответы переживают перезагрузку и переход между шагами: опросник длинный,
  // и терять его на случайном обновлении страницы нельзя.
  //
  // Восстановление идёт эффектом ПОСЛЕ первого рендера, а не в инициализаторе
  // состояния: сервер про sessionStorage ничего не знает, и чтение из него до
  // рендера разошлось бы с серверной разметкой. Ценой этому — один кадр первого
  // шага у вернувшегося человека; альтернатива хуже: пока не отработает
  // гидратация, страница отдавала бы пустоту всем, включая поисковики.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { draft?: Draft; step?: number; save?: boolean };
        if (saved.draft) setDraft({ ...DEFAULT_DRAFT, ...saved.draft });
        if (typeof saved.step === "number") setStep(Math.min(saved.step, STEP_TITLES.length - 1));
        if (typeof saved.save === "boolean") setSaveAnswers(saved.save);
      }
    } catch {
      // Сломанное хранилище не должно ронять опросник — начинаем с чистого.
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ draft, step, save: saveAnswers }));
    } catch {
      // Приватный режим — просто не сохраняем.
    }
  }, [draft, step, saveAnswers, restored]);

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const stepReady = REQUIRED[step].every((k) => {
    const v = draft[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined;
  });

  const answers = draft as Answers;
  const results = useMemo(
    () => (done ? recommend(catalog, answers) : []),
    [done, catalog, answers]
  );

  // Ответы опросника — это данные о том, чем реально бегает аудитория, и вход
  // в калибровку весов. Уходят один раз, уже после того как человек увидел
  // выдачу, и только если он не снял галочку: в ответах есть вес и история
  // травм, то есть данные о здоровье, и молча забирать их нельзя.
  useEffect(() => {
    if (!done || sent.current || !saveAnswers) return;
    sent.current = true;
    void fetch("/api/shoes/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers,
        picks: results.map((r) => ({
          slot: r.slot.id,
          shoeIds: r.picks.map((p) => p.shoe.id),
        })),
      }),
    }).catch(() => {
      // Молча: сбор статистики не должен мешать человеку получить выдачу.
    });
  }, [done, answers, results, saveAnswers]);

  // Жалоба на пятку учтена, если у показанных моделей есть замер задника.
  // Строка про неучтённый ответ гаснет сама, как только замеры появятся в базе.
  const heelUnmeasured =
    done &&
    (answers.dislikes ?? []).includes("heel_rub") &&
    results
      .flatMap((r) => r.picks)
      .every((p) => p.shoe.heel_counter_stiffness === null);

  if (done) {
    return (
      <>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.headerTop}>
              <span className={styles.brand}>igorp.run</span>
              <span className={styles.progressStep}>подбор кроссовок</span>
            </div>
          </div>
        </header>
        <main className={styles.main}>
          <div className={styles.inner}>
        <h1 className={styles.title}>
          Твоя <span className={styles.accent}>ротация</span>
        </h1>

        {catalog.catalog_kind === "demo" ? (
          <div className={styles.demoNotice}>
            База в демонстрационном режиме: характеристики моделей ещё не сверены
            по лабораторным источникам. Логика подбора работает, конкретным
            цифрам верить рано.
          </div>
        ) : null}

        <div className={styles.rotationNote}>
          Это не «одни кроссовки на всё». Несколько пар под разные тренировки
          снижают риск травмы примерно на 39% против одной пары — нагрузка
          каждый раз ложится немного иначе. Меняй пары по типу тренировки, а не
          по настроению.
        </div>

        {heelUnmeasured ? (
          <div className={styles.rotationNote}>
            Про «натирало пятку» подбор промолчал намеренно: посадки пятки нет в
            замерах, а гадать по остальным цифрам — значит выдать догадку за
            факт. Это вопрос примерки, и его стоит проверить ногой.
          </div>
        ) : null}

        {results.map((r) => (
          <section key={r.slot.id} className={styles.slot}>
            <h2 className={styles.slotHead}>{r.slot.title}</h2>
            <p className={styles.slotSubtitle}>{r.slot.subtitle}</p>
            {r.picks.length === 0 ? (
              <div className={styles.empty}>{r.emptyReason}</div>
            ) : (
              <div className={styles.cards}>
                {r.picks.map((p, i) => (
                  <Card key={p.shoe.id} rec={p} best={i === 0} />
                ))}
              </div>
            )}
          </section>
        ))}

        <div className={styles.cta}>
          <div className={styles.ctaTitle}>Разбор ротации в боте</div>
          <p className={styles.ctaText}>
            В боте — почему именно эта ротация, как распределить по ней
            тренировки и когда пары пора менять.
          </p>
          <a
            href="https://t.me/IgorPotseluev"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaButton}
          >
            Получить разбор →
          </a>
        </div>

        <button
          type="button"
          className={styles.restart}
          onClick={() => {
            setDone(false);
            setStep(0);
            setDraft(DEFAULT_DRAFT);
            sent.current = false;
          }}
        >
          Пройти заново
        </button>

            <div className={styles.footer}>igorp.run</div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      {/* Шапка липкая и непрозрачная: без этого заголовок вопроса при прокрутке
          наезжал на часы и индикатор сети. */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerTop}>
            <span className={styles.brand}>{STEP_TITLES[step]}</span>
            <span className={styles.progressStep}>
              шаг {step + 1} из {STEP_TITLES.length}
            </span>
          </div>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${((step + 1) / STEP_TITLES.length) * 100}%` }}
            />
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.inner}>
      {step === 0 ? (
        <>
          <h1 className={styles.title}>
            Подбор <span className={styles.accent}>беговых кроссовок</span>
          </h1>
          <p className={styles.subtitle}>
            16 вопросов — и набор пар под твои тренировки, а не одна модель на
            всё. Видно, какие свойства кроссовка привели к решению.
          </p>
        </>
      ) : null}

      {step === 0 ? (
        <>
          <Choice
            label="Сколько бегаешь в неделю"
            options={[
              { value: "lt20" as const, label: "До 20 км" },
              { value: "20-40" as const, label: "20–40 км" },
              { value: "40-60" as const, label: "40–60 км" },
              { value: "60-80" as const, label: "60–80 км" },
              { value: "80plus" as const, label: "80 км и больше" },
            ]}
            value={draft.weeklyVolume}
            onChange={(v) => set("weeklyVolume", v)}
          />
          <Choice
            label="Где бегаешь"
            options={[
              { value: "road" as const, label: "Асфальт" },
              { value: "mixed" as const, label: "Асфальт и грунт" },
              { value: "trail" as const, label: "В основном трейл" },
            ]}
            value={draft.surface}
            onChange={(v) => set("surface", v)}
          />
          <Choice
            label="Бегаешь ли зимой на улице"
            hint="Дождь, слякоть и лёд требуют другой обуви, чем сухой асфальт"
            options={[
              { value: "none" as const, label: "Зимой не бегаю или только в зале" },
              { value: "slush" as const, label: "Дождь и слякоть, снега почти нет" },
              { value: "snow" as const, label: "Снег и лёд" },
            ]}
            value={draft.winter}
            onChange={(v) => set("winter", v)}
          />
          <Choice
            label="К чему готовишься"
            options={[
              { value: "just_run" as const, label: "Просто бегаю" },
              { value: "5_10" as const, label: "5–10 км" },
              { value: "half" as const, label: "Полумарафон" },
              { value: "marathon" as const, label: "Марафон" },
              { value: "trail_ultra" as const, label: "Трейл и ультра" },
            ]}
            value={draft.goal}
            onChange={(v) => set("goal", v)}
          />
          <Choice
            label="Есть ли скоростные тренировки"
            two
            options={[
              { value: true, label: "Да" },
              { value: false, label: "Нет" },
            ]}
            value={draft.speedwork}
            onChange={(v) => set("speedwork", v)}
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Choice
            label="Какие модели смотрим"
            hint="У женских версий своя колодка, ростовка и вес"
            options={[
              { value: "m" as const, label: "Мужские" },
              { value: "w" as const, label: "Женские" },
              { value: "any" as const, label: "Любые" },
            ]}
            value={draft.gender}
            onChange={(v) => set("gender", v)}
          />
          <div className={styles.question}>
            <p className={styles.questionLabel}>Вес</p>
            <div>
              <span className={styles.sliderValue}>{draft.bodyWeightKg ?? 70}</span>
              <span className={styles.sliderUnit}>кг</span>
            </div>
            <input
              className={styles.slider}
              type="range"
              min={45}
              max={120}
              step={1}
              value={draft.bodyWeightKg ?? 70}
              onChange={(e) => set("bodyWeightKg", Number(e.target.value))}
              aria-label="Вес, кг"
            />
          </div>
          <Choice
            label="Ширина стопы"
            options={[
              { value: "narrow" as const, label: "Узкая" },
              { value: "std" as const, label: "Обычная" },
              { value: "wide" as const, label: "Широкая" },
              { value: "unknown" as const, label: "Не знаю" },
            ]}
            value={draft.footWidth}
            onChange={(v) => set("footWidth", v)}
          />
          <Choice
            label="Пронация"
            options={[
              { value: "neutral" as const, label: "Нейтральная" },
              { value: "over" as const, label: "Заваливаю внутрь" },
              { value: "unknown" as const, label: "Не знаю" },
            ]}
            value={draft.pronation}
            onChange={(v) => set("pronation", v)}
          />
          <MultiChoice<Issue>
            label="Что беспокоило за последний год"
            hint="Можно отметить несколько"
            exclusive="none"
            options={[
              { value: "shin", label: "Голени и надкостница" },
              { value: "achilles", label: "Ахилл и икра" },
              { value: "knee", label: "Колено" },
              { value: "foot", label: "Стопа, пальцы, пятка" },
              { value: "none", label: "Ничего не беспокоило" },
            ]}
            value={draft.issues}
            onChange={(v) => set("issues", v)}
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <OwnedShoes
            value={draft.ownedShoeIds ?? []}
            onChange={(ids) => set("ownedShoeIds", ids)}
          />
          <MultiChoice<Dislike>
            label="Что не устраивало"
            hint="Можно отметить несколько"
            exclusive="none"
            options={[
              { value: "harsh", label: "Жёстко, забивались ноги" },
              { value: "unstable", label: "Нога проваливалась и гуляла" },
              { value: "narrow", label: "Узко, давило пальцы" },
              { value: "heavy", label: "Тяжёлые" },
              { value: "wear", label: "Быстро изнашивались" },
              { value: "heel_rub", label: "Натирало пятку" },
              { value: "none", label: "Всё устраивало" },
            ]}
            value={draft.dislikes}
            onChange={(v) => set("dislikes", v)}
          />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Choice
            label="Как любишь по ощущению"
            hint="От жёсткого и отзывчивого до максимума мягкости"
            options={[
              { value: 1 as const, label: "Жёстко и отзывчиво" },
              { value: 2 as const, label: "Скорее плотно" },
              { value: 3 as const, label: "Посередине" },
              { value: 4 as const, label: "Скорее мягко" },
              { value: 5 as const, label: "Максимум мягкости" },
            ]}
            value={draft.feel}
            onChange={(v) => set("feel", v)}
          />
          <Choice
            label="Какой уровень рассматриваешь"
            options={[
              { value: "low" as const, label: "Доступные" },
              { value: "mid" as const, label: "Средние" },
              { value: "top" as const, label: "Топовые" },
              { value: "any" as const, label: "Не важно" },
            ]}
            value={draft.tier}
            onChange={(v) => set("tier", v)}
          />
          <Choice
            label="Где покупаешь"
            options={[
              { value: "ru" as const, label: "Россия" },
              { value: "eu" as const, label: "Европа" },
              { value: "any" as const, label: "Заказываю откуда угодно" },
            ]}
            value={draft.market}
            onChange={(v) => set("market", v)}
          />
          <Choice
            label="Сколько пар хочешь держать"
            hint="Зимняя пара, если бегаешь зимой, добавляется сверх этого числа"
            options={[
              { value: 1 as const, label: "Одну на всё" },
              { value: 2 as const, label: "Две" },
              { value: 3 as const, label: "Три и больше" },
            ]}
            value={draft.pairs}
            onChange={(v) => set("pairs", v)}
          />

          {/* Уведомление стоит на последнем шаге, до кнопки: среди ответов есть
              вес и история травм — данные о здоровье, и забирать их молча
              нельзя. Отказ ничего не ломает: выдачу человек получает так же. */}
          <div className={styles.privacyNote}>
            Если разрешишь, ответы сохранятся обезличенно — чтобы понимать, чем
            реально бегает аудитория, и чинить подбор там, где он
            промахивается. Ни имени, ни
            почты, ни телефона на этом шаге не спрашиваем и не сохраняем; ни
            IP, ни данные браузера не пишем. Связка с тобой появится, только
            если ты сам перейдёшь в бот.{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              Политика конфиденциальности
            </a>
            .
            <label className={styles.privacyToggle}>
              <input
                type="checkbox"
                checked={saveAnswers}
                onChange={(e) => setSaveAnswers(e.target.checked)}
              />
              <span>
                Можно сохранить мои ответы. Не отметишь — выдачу всё равно
                увидишь, просто ничего не сохранится.
              </span>
            </label>
          </div>
        </>
      ) : null}

        </div>
      </main>

      <div className={styles.bottomBar}>
        <div className={styles.bottomBarInner}>
          {step > 0 ? (
            <button type="button" className={styles.navBack} onClick={() => setStep(step - 1)}>
              Назад
            </button>
          ) : null}
          <button
            type="button"
            className={styles.navNext}
            disabled={!stepReady}
            onClick={() => (step === STEP_TITLES.length - 1 ? setDone(true) : setStep(step + 1))}
          >
            {step === STEP_TITLES.length - 1 ? "Показать ротацию" : "Далее"}
          </button>
        </div>
      </div>
    </>
  );
}
