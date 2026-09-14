/**
 * Предзаполнение анкеты тренером.
 *
 * ПРАВИЛО ОДНО: что задал тренер — ученик не видит и переопределить не может.
 * Не «поле с подсказкой» и не «значение по умолчанию»: и то и другое снова
 * просит человека отвечать на решённый вопрос, а при расхождении оставляет
 * непонятным, чей ответ в базе.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ. Ближайшие ученики — выпускники интенсива, их тренировки
 * тренер видел. Спрашивать «можешь ли бежать непрерывно» у того, про кого ты
 * это знаешь, — плохой онбординг: вопрос читается как проверка, а ответ выходит
 * хуже твоего знания и при этом попадает в план.
 */

/** Поля анкеты, которые тренер вправе задать за ученика. */
export const PREFILLABLE_FIELDS = [
  "goalKind",
  "raceDate",
  "raceDistanceKm",
  "daysPerWeek",
  "selfReportedWeeklyMinutes",
  "unavailableWeekdays",
  "preferredLongWeekday",
  "canRunContinuously",
] as const;

export type PrefillableField = (typeof PREFILLABLE_FIELDS)[number];

/**
 * coachNote в этот список НЕ входит и не войдёт. Поле называется «что важно
 * знать тренеру» — оно по определению принадлежит ученику. Заполнить его за
 * него значит записать свои слова его голосом, а потом читать их как его.
 */
export const STUDENT_ONLY_FIELDS = ["coachNote"] as const;

export type PrefillValues = {
  goalKind: "race" | "regular" | "start_running" | null;
  raceDate: string | null;
  raceDistanceKm: number | null;
  daysPerWeek: number | null;
  selfReportedWeeklyMinutes: number | null;
  unavailableWeekdays: number[] | null;
  preferredLongWeekday: number | null;
  canRunContinuously: boolean | null;
};

export type Prefill = {
  sourceId: string;
  /** Что тренер зафиксировал. Пустой массив — не задано ничего. */
  setFields: PrefillableField[];
  values: PrefillValues;
  note: string | null;
  setBy: string;
};

export function isPrefillableField(value: string): value is PrefillableField {
  return (PREFILLABLE_FIELDS as readonly string[]).includes(value);
}

export function isFieldSet(prefill: Prefill | null, field: PrefillableField): boolean {
  return prefill !== null && prefill.setFields.includes(field);
}

/** Пустое предзаполнение — то же, что его отсутствие. Чтобы не ветвиться на null. */
export const EMPTY_PREFILL: Prefill = {
  sourceId: "",
  setFields: [],
  values: {
    goalKind: null,
    raceDate: null,
    raceDistanceKm: null,
    daysPerWeek: null,
    selfReportedWeeklyMinutes: null,
    unavailableWeekdays: null,
    preferredLongWeekday: null,
    canRunContinuously: null,
  },
  note: null,
  setBy: "coach",
};

export type StudentAnswerInput = Partial<PrefillValues> & { coachNote: string | null };

export type MergedAnswers = {
  values: PrefillValues;
  coachNote: string | null;
  /** Снимок: какие поля пришли от тренера. Ложится в анкету вместе с ответами. */
  coachSetFields: PrefillableField[];
  /**
   * Поля, которые ученик прислал, хотя они заданы тренером. В норме пусто:
   * форма их не показывает. Непусто — значит запрос пришёл не из формы, и
   * молчать об этом нельзя.
   */
  ignoredFromStudent: PrefillableField[];
};

/**
 * Свести ответ ученика с тем, что задал тренер.
 *
 * Тренер ПОБЕЖДАЕТ ВСЕГДА. Не потому, что он главный, а потому, что поле, за
 * которое отвечает тренер, ученик в форме вообще не видел: значение, пришедшее
 * от клиента по такому полю, не может быть его осознанным ответом — это либо
 * старая версия формы, либо подделанный запрос.
 */
export function mergeAnswers(prefill: Prefill | null, student: StudentAnswerInput): MergedAnswers {
  const source = prefill ?? EMPTY_PREFILL;
  const values: PrefillValues = { ...EMPTY_PREFILL.values };
  const ignored: PrefillableField[] = [];

  for (const field of PREFILLABLE_FIELDS) {
    if (source.setFields.includes(field)) {
      // @ts-expect-error — ключи совпадают по построению, значения разнотипны.
      values[field] = source.values[field];
      const fromStudent = student[field];
      if (fromStudent !== undefined && fromStudent !== null) ignored.push(field);
      continue;
    }
    const fromStudent = student[field];
    if (fromStudent !== undefined) {
      // @ts-expect-error — то же самое: соответствие ключей гарантировано типом.
      values[field] = fromStudent;
    }
  }

  return {
    values,
    coachNote: student.coachNote,
    coachSetFields: [...source.setFields],
    ignoredFromStudent: ignored,
  };
}

/**
 * Что показывать ученику в форме.
 *
 * Отдельная функция, а не «спрятать в разметке»: список полей, которых человек
 * не увидит, — это решение, а не оформление, и оно должно проверяться.
 */
export function visibleFormFields(prefill: Prefill | null): PrefillableField[] {
  const hidden = new Set(prefill?.setFields ?? []);
  return PREFILLABLE_FIELDS.filter((field) => !hidden.has(field));
}

const FIELD_LABELS_RU: Record<PrefillableField | "coachNote", string> = {
  goalKind: "цель",
  raceDate: "дата старта",
  raceDistanceKm: "дистанция",
  daysPerWeek: "дней в неделю",
  selfReportedWeeklyMinutes: "текущий объём со слов",
  unavailableWeekdays: "недоступные дни",
  preferredLongWeekday: "день длительной",
  canRunContinuously: "может бежать непрерывно",
  coachNote: "что важно знать тренеру",
};

export function fieldLabelRu(field: string): string {
  return FIELD_LABELS_RU[field as PrefillableField] ?? field;
}
