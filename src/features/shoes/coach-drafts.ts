/**
 * Черновики тренерского каталога и их проверка Игорем (страница
 * /admin/shoes-review, решение 14.10.2026).
 *
 * Черновик — то, что прочитано в обзорах разрешённых источников: значения по
 * полям с цитатами и ссылками. В подбор черновик не идёт. Игорь проходит
 * модель за моделью: «верно», «поправить», «не знаю». Подтверждённое поле
 * получает status "confirmed" и decided_by "igor"; модель целиком —
 * confirmed, когда ни одного поля в статусе draft не осталось.
 */

export const THESES_BEST_FOR = [
  "держит и тяжёлого бегуна",
  "уверенная на грунте и камнях",
  "стабильная на длинных пробежках",
  "стабильная и предсказуемая",
  "мягкая на длинных пробежках",
  "мягкая амортизация под стопой",
  "оживает на быстром темпе",
  "лёгкая на ноге",
  "универсальная под разные задачи",
  "просторная в носке",
  "плавный перекат с пятки на носок",
  "подойдёт для начала занятий бегом",
  "годится и для ходьбы",
  "верх хорошо дышит в жару",
  "цепкая подошва на асфальте",
  "удобная посадка по стопе",
  "подошва долго не стирается",
] as const;

export const THESES_NOT_FOR = [
  "не для тяжёлых бегунов",
  "узкая колодка, тесно в стопе",
  "может быть неустойчивой",
  "мало амортизации для длинных",
  "не для быстрой работы",
  "мало отдачи от пены",
  "ощутимо жёсткая под стопой",
  "подошва быстро стирается",
  "может натирать или болтаться в пятке",
  "низкий объём верха",
  "нужно время на разноску",
  "маломерит, лучше взять больше",
  "большемерит, лучше взять меньше",
  "скользит на мокром покрытии",
  "тяжеловата для своего класса",
] as const;

export type FieldKind = "one" | "many" | "number";

export type FieldDef = {
  key: DraftFieldKey;
  title: string;
  kind: FieldKind;
  /** Значения и их подписи. Для number — пусто. */
  options: { value: string | number; label: string }[];
};

export type DraftFieldKey =
  | "purpose"
  | "feel"
  | "firmness"
  | "width"
  | "durability"
  | "heel_hold"
  | "winter_grip"
  | "best_for"
  | "not_for"
  | "year";

/** Порядок полей на экране — он же порядок навигации стрелками. */
export const DRAFT_FIELDS: FieldDef[] = [
  {
    key: "purpose",
    title: "Назначение",
    kind: "many",
    options: [
      { value: "daily", label: "ежедневные" },
      { value: "tempo", label: "темп" },
      { value: "race", label: "старт" },
      { value: "max", label: "максимальная амортизация" },
      { value: "stability", label: "поддержка стопы" },
      { value: "trail", label: "трейл" },
      { value: "winter", label: "зима" },
    ],
  },
  {
    key: "feel",
    title: "Ощущение",
    kind: "one",
    options: [
      { value: "firm_responsive", label: "плотная, отзывчивая" },
      { value: "balanced", label: "середина" },
      { value: "soft_stable", label: "мягкая, устойчивая" },
      { value: "bouncy_soft", label: "мягкая, пружинистая" },
      { value: "plush", label: "очень мягкая" },
    ],
  },
  {
    key: "firmness",
    title: "Жёсткость (1 жёстко … 5 очень мягко)",
    kind: "one",
    options: [
      { value: 1, label: "1 жёсткая" },
      { value: 2, label: "2 плотная" },
      { value: 3, label: "3 средняя" },
      { value: 4, label: "4 мягкая" },
      { value: 5, label: "5 очень мягкая" },
    ],
  },
  {
    key: "width",
    title: "Колодка",
    kind: "one",
    options: [
      { value: "narrow", label: "узкая" },
      { value: "standard", label: "обычная" },
      { value: "wide", label: "широкая" },
    ],
  },
  {
    key: "durability",
    title: "Износ",
    kind: "one",
    options: [
      { value: "low", label: "быстро стирается" },
      { value: "average", label: "средний" },
      { value: "high", label: "живучая" },
    ],
  },
  {
    key: "heel_hold",
    title: "Пятка",
    kind: "one",
    options: [
      { value: "loose", label: "болтается" },
      { value: "good", label: "держит" },
      { value: "stiff", label: "жёсткий задник давит" },
    ],
  },
  {
    key: "winter_grip",
    title: "Сцепление зимой",
    kind: "one",
    options: [
      { value: "poor", label: "плохое" },
      { value: "fair", label: "среднее" },
      { value: "good", label: "хорошее" },
    ],
  },
  { key: "best_for", title: "Кому подойдёт", kind: "many", options: THESES_BEST_FOR.map((t) => ({ value: t, label: t })) },
  { key: "not_for", title: "Минусы", kind: "many", options: THESES_NOT_FOR.map((t) => ({ value: t, label: t })) },
  { key: "year", title: "Год модели", kind: "number", options: [] },
];

export type FieldStatus = "draft" | "confirmed" | "unknown";

export type DraftEvidence = { source_title: string; url: string; quote: string };

export type DraftField = {
  /** Текущее значение (после правки Игоря — его значение). */
  value: unknown;
  /** Что предложил черновик — остаётся для истории правок. */
  draft_value: unknown;
  status: FieldStatus;
  decided_by?: "igor";
  decided_at?: string;
  evidence: DraftEvidence[];
};

export type CoachDraft = {
  id: string;
  brand: string;
  model: string;
  /** reviewed — из обзоров; manual — пустая карточка (китайские бренды), заполняет Игорь. */
  kind: "reviewed" | "manual";
  batch: number;
  position: number;
  confidence: "normal" | "low" | null;
  note: string | null;
  fields: Partial<Record<DraftFieldKey, DraftField>>;
  /**
   * excluded — Игорь убрал модель из каталога целиком (устарела, не беговая,
   * дубль). В подбор не попадает, счётчик пачки её не учитывает.
   */
  status: "draft" | "confirmed" | "excluded";
  excluded_reason: ExcludeReason | null;
};

export type ExcludeReason = "outdated" | "not_running" | "duplicate";

export const EXCLUDE_REASONS: { value: ExcludeReason; label: string }[] = [
  { value: "outdated", label: "устарела, есть новая версия" },
  { value: "not_running", label: "не беговая" },
  { value: "duplicate", label: "дубль" },
];

/** Сколько моделей пачки в работе и сколько подтверждено: убранные не считаются. */
export function batchProgress(drafts: Pick<CoachDraft, "status">[]): { total: number; confirmed: number; excluded: number } {
  const excluded = drafts.filter((d) => d.status === "excluded").length;
  return {
    total: drafts.length - excluded,
    confirmed: drafts.filter((d) => d.status === "confirmed").length,
    excluded,
  };
}

/** Модель подтверждена, когда ни одного поля в статусе draft не осталось. */
export function draftIsConfirmed(fields: CoachDraft["fields"]): boolean {
  return DRAFT_FIELDS.every((f) => (fields[f.key]?.status ?? "draft") !== "draft");
}

/** Применить решение Игоря к полю — одна функция для сервера и для экрана. */
export function applyDecision(
  field: DraftField | undefined,
  action: "confirm" | "correct" | "unknown",
  value: unknown,
  at: string
): DraftField {
  const base: DraftField = field ?? { value: null, draft_value: null, status: "draft", evidence: [] };
  if (action === "confirm") return { ...base, status: "confirmed", decided_by: "igor", decided_at: at };
  if (action === "unknown") return { ...base, value: null, status: "unknown", decided_by: "igor", decided_at: at };
  return { ...base, value, status: "confirmed", decided_by: "igor", decided_at: at };
}
