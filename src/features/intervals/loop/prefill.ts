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
  // Из развёрнутой анкеты (интенсив или форма тренера). В приложении этих
  // вопросов НЕТ ВООБЩЕ — ни одного из них.
  "goalKind",
  "raceDate",
  "raceDistanceKm",
  "daysPerWeek",
  "selfReportedWeeklyMinutes",
  "canRunContinuously",
  "healthLimits",
  "experienceNote",
  // Про график. Эти вопросы приложение задаёт, но тренер вправе закрыть любой
  // из них: про выпускника интенсива он может знать и расписание.
  "weekStability",
  "availableWeekdays",
  "unavailableWeekdays",
  "preferredLongWeekday",
  "preferredQualityWeekday",
  "timeOfDay",
  "runSurfaces",
  "weekBreakers",
  "maxSessionMinutes",
  "timezone",
] as const;

/**
 * Поля, которых в форме приложения нет НИКОГДА, даже когда тренер их не задал.
 *
 * Вход в приложение — настройка графика. Опыт, травмы, история и «может ли
 * бежать непрерывно» живут в развёрнутой анкете ДО него: спрашивать это в
 * приложении значит просить пересказать то, что тренер уже прочитал.
 */
export const NEVER_IN_APP_FORM: readonly PrefillableField[] = [
  // Часовой пояс определяется САМ из браузера. В форму он попадает только
  // отдельной веткой, когда определить не удалось: вопрос, на который машина
  // знает ответ, — плохой вопрос.
  "timezone",
  // Форма спрашивает КОНКРЕТНЫЕ ДНИ, а не количество: «сколько раз в неделю
  // готовы бегать» — вопрос к тренеру, а не к человеку, который ещё не начал.
  // Число либо задаёт тренер, либо оно выводится из свободных дней.
  "daysPerWeek",
  "selfReportedWeeklyMinutes",
  "canRunContinuously",
  "healthLimits",
  "experienceNote",
];

export type PrefillableField = (typeof PREFILLABLE_FIELDS)[number];

/**
 * Заметка о том, что срывает неделю, тренером задаётся редко и по делу: он
 * может знать про сменный график. Но если он молчит, поле остаётся у человека —
 * подставлять туда свои слова его голосом нельзя.
 */
export const STUDENT_ONLY_FIELDS = ["weekBreakers"] as const;

export type PrefillValues = {
  goalKind: "race" | "regular" | "improve" | "start_running" | null;
  raceDate: string | null;
  raceDistanceKm: number | null;
  daysPerWeek: number | null;
  selfReportedWeeklyMinutes: number | null;
  canRunContinuously: boolean | null;
  healthLimits: string | null;
  experienceNote: string | null;
  weekStability: "stable" | "varies" | null;
  availableWeekdays: number[] | null;
  unavailableWeekdays: number[] | null;
  preferredLongWeekday: number | null;
  preferredQualityWeekday: number | null;
  timeOfDay: "morning" | "evening" | "varies" | null;
  runSurfaces: string[] | null;
  weekBreakers: string | null;
  maxSessionMinutes: number | null;
  timezone: string | null;
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
    canRunContinuously: null,
    healthLimits: null,
    experienceNote: null,
    weekStability: null,
    availableWeekdays: null,
    unavailableWeekdays: null,
    preferredLongWeekday: null,
    preferredQualityWeekday: null,
    timeOfDay: null,
    runSurfaces: null,
    weekBreakers: null,
    maxSessionMinutes: null,
    timezone: null,
  },
  note: null,
  setBy: "coach",
};

/**
 * Ответ человека. Все поля необязательны: что задал тренер, форма не рисует и
 * не присылает.
 */
export type StudentAnswerInput = Partial<PrefillValues>;

export type MergedAnswers = {
  values: PrefillValues;
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
  const hidden = new Set<PrefillableField>(prefill?.setFields ?? []);
  for (const field of NEVER_IN_APP_FORM) hidden.add(field);

  // Дата и дистанция старта имеют смысл ТОЛЬКО при цели «готовлюсь к старту».
  // Когда тренер задал другую цель, вопроса быть не может, и список обязан это
  // отражать: иначе он обещает форму, которой человек не увидит.
  const goalFixed = prefill?.setFields.includes("goalKind") === true;
  if (goalFixed && prefill?.values.goalKind !== "race") {
    hidden.add("raceDate");
    hidden.add("raceDistanceKm");
  }

  return PREFILLABLE_FIELDS.filter((field) => !hidden.has(field));
}

const FIELD_LABELS_RU: Record<PrefillableField | "coachNote", string> = {
  goalKind: "цель",
  raceDate: "дата старта",
  raceDistanceKm: "дистанция",
  daysPerWeek: "дней в неделю",
  selfReportedWeeklyMinutes: "текущий объём со слов",
  canRunContinuously: "может бежать непрерывно",
  healthLimits: "ограничения по здоровью",
  experienceNote: "беговой опыт",
  weekStability: "стабильность недели",
  availableWeekdays: "свободные дни",
  unavailableWeekdays: "занятые дни",
  preferredLongWeekday: "день длинной тренировки",
  preferredQualityWeekday: "день тяжёлой тренировки",
  timeOfDay: "время суток",
  runSurfaces: "где бегает",
  weekBreakers: "что срывает неделю",
  maxSessionMinutes: "сколько времени на тренировку",
  timezone: "часовой пояс",
  coachNote: "что важно знать тренеру (старое поле)",
};

export function fieldLabelRu(field: string): string {
  return FIELD_LABELS_RU[field as PrefillableField] ?? field;
}
