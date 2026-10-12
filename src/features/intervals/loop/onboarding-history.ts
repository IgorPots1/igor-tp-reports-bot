/**
 * Провенанс анкетных полей: что изменилось, кем и откуда.
 *
 * ── ПОВОД ────────────────────────────────────────────────────────────────────
 *
 * 12.10.2026 не удалось ответить на простой вопрос о собственных данных:
 * «потолок одной тренировки 80 — кто его поставил?» В анкете стояло 80 и
 * пометка coach_set_fields, то есть «задал тренер», а кто, когда и из чего —
 * нигде. Ответ пришлось выводить косвенно, через потолок аэробного,
 * сохранённый в цикле от 17.09, и он дал вероятность, а не факт.
 *
 * ── ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ ────────────────────────────────────────────────
 *
 * Здесь только СРАВНЕНИЕ двух снимков анкеты: чистая функция, никакой базы.
 * Запись истории — в repository (saveOnboardingAnswers), а требование «у
 * коачской правки обязателен источник» держит КОНСТРЕЙНТ в базе, а не этот
 * модуль: правило, живущее только в коде, обходится первым же скриптом.
 */

/** Откуда взято значение. Для коачских правок обязательно (констрейнт в базе). */
export type FieldOrigin =
  /** Ученик сам ответил в анкете. */
  | "student_answer"
  /** Со слов ученика, тренер записал. */
  | "coach_words"
  /** Из переписки. */
  | "coach_dm"
  /** Из данных: истории тренировок, отчётов, расчёта. */
  | "coach_data"
  /** Восстановлено задним числом по косвенным следам. */
  | "reconstructed";

export type FieldChange = {
  field: string;
  valueBefore: string | null;
  valueAfter: string | null;
};

/**
 * ЗНАЧЕНИЯ ПРИВОДЯТСЯ К ТЕКСТУ ОДНИМ СПОСОБОМ — и это важнее, чем кажется.
 *
 * Поля анкеты разного вида: числа, строки, даты, массив поверхностей. Если
 * сравнивать их «как придётся», массив ["Улица","Дорожка"] и ["Дорожка","Улица"]
 * прочитаются как разные значения, и история наполнится правками, которых никто
 * не делал. Поэтому массивы сортируются: порядок галочек в анкете ничего не
 * значит.
 */
export function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return [...value].map((x) => String(x)).sort().join(", ");
  return String(value);
}

/**
 * Что изменилось между двумя снимками анкеты.
 *
 * СРАВНИВАЮТСЯ ТОЛЬКО ПОЛЯ, ПРИШЕДШИЕ В НОВОМ СНИМКЕ. Отсутствие ключа — это
 * «не трогали», а не «стёрли в null»: upsert анкеты пишет не все колонки сразу,
 * и трактовать пропуск как обнуление значило бы записать в историю потерю,
 * которой не было.
 */
export function onboardingFieldChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [field, raw] of Object.entries(after)) {
    if (raw === undefined) continue;
    const valueAfter = asText(raw);
    const valueBefore = before ? asText(before[field]) : null;
    if (valueBefore === valueAfter) continue;
    out.push({ field, valueBefore, valueAfter });
  }
  return out;
}

/**
 * Нужен ли источник для этой правки.
 *
 * Правка ученицей источника не требует: она и есть источник. Всё остальное —
 * требует, и это проверяет база. Функция существует, чтобы вызывающий мог
 * отказаться ДО записи и сказать человеку понятное, а не ловить отказ
 * констрейнта.
 */
export function originRequired(changedBy: string): boolean {
  return changedBy.startsWith("coach");
}

/** Человеческая подпись источника — для карточки тренера. */
export function originLabelRu(origin: FieldOrigin | null): string {
  switch (origin) {
    case "student_answer": return "ответ ученицы в анкете";
    case "coach_words": return "со слов ученицы";
    case "coach_dm": return "из переписки";
    case "coach_data": return "из данных";
    case "reconstructed": return "восстановлено задним числом";
    default: return "источник не указан";
  }
}
