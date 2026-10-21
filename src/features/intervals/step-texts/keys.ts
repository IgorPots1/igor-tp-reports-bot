/**
 * Ключи шагов и эталонные тексты [решение Игоря, 21.10.2026].
 *
 * Чистый модуль: им пользуются генератор (tools/.../autoplanner-week.ts — ставит
 * ключ каждому шагу и подставляет эталон) и админка (редактор тренировки,
 * список эталонов). Без базы и без сети.
 *
 * ЭТАЛОН — ТОЛЬКО ТЕКСТ. Минуты, повторы и «усилие N из 10» считает генератор:
 * у отрезка эталон заменяет описание ПОСЛЕ «усилие N из 10». Диапазоны вида
 * «5:30–6:00» в эталоне запрещены: текст уходит в описание тренировки, а
 * генератор разбирает описание обратно (verifyRoundTrip), и чужой диапазон
 * сломал бы этот разбор.
 *
 * Новичок (beginner-week) и диагностический тест пока вне эталонов.
 */

export const STEP_KEYS = [
  "warmup_walk",
  "warmup_easy",
  "warmup_strides",
  "warmup_settle",
  "easy_main_treadmill",
  "easy_main_street",
  "long_main_treadmill",
  "long_main_street",
  "interval_work",
  "interval_rest",
  "cooldown",
] as const;

export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_KEY_LABEL_RU: Record<StepKey, string> = {
  warmup_walk: "Разминка: ходьба",
  warmup_easy: "Разминка: лёгкий бег",
  warmup_strides: "Разминка: ускорения",
  warmup_settle: "Разминка: войти в ритм",
  easy_main_treadmill: "Лёгкая основная · дорожка",
  easy_main_street: "Лёгкая основная · улица",
  long_main_treadmill: "Длительная основная · дорожка",
  long_main_street: "Длительная основная · улица",
  interval_work: "Отрезок (после «усилие N из 10»)",
  interval_rest: "Шаг между отрезками",
  cooldown: "Заминка",
};

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === "string" && (STEP_KEYS as readonly string[]).includes(value);
}

export type StepTextEtalons = Partial<Record<StepKey, string>>;

/** «Усилие N из 10» в начале текста отрезка — это число, его ставит генератор. */
const EFFORT_PREFIX_RE = /^(усилие\s+\d+(?:[.,]\d+)?\s+из\s+10)\s*[,.:;—-]?\s*/iu;

export function effortPrefixOf(text: string | null | undefined): string | null {
  const m = (text ?? "").match(EFFORT_PREFIX_RE);
  return m ? m[1] : null;
}

/** Текст отрезка без «усилие N из 10» — то, что может стать эталоном. */
export function stripEffortPrefix(text: string): string {
  return text.replace(EFFORT_PREFIX_RE, "").trim();
}

/** Диапазон темпа или времени: «5:30–6:00», «5:30 - 6:00», «6–7 км/ч» и т.п. */
const RANGE_RE = /\d+(?::\d{2})?\s*[–—-]\s*\d+(?::\d{2})?/u;

/**
 * Можно ли сделать текст эталоном. null — можно, строка — причина отказа.
 * Исключение для «5-6 км/ч» у ходьбы НЕ делаем: правило одно для всех ключей,
 * и словами («пять-шесть км/ч») генератор уже пишет именно так.
 */
export function etalonTextProblem(key: StepKey, text: string): string | null {
  const t = (key === "interval_work" ? stripEffortPrefix(text) : text).trim();
  if (!t) return "Пустой текст эталоном не становится.";
  if (t.length > 600) return "Слишком длинно для шага (до 600 знаков).";
  if (RANGE_RE.test(t)) return "В эталоне не должно быть диапазонов чисел: их ставит генератор (и разбирает описание обратно).";
  return null;
}

/** Текст шага, который ляжет в эталон: у отрезка — без «усилие N из 10». */
export function etalonTextFor(key: StepKey, text: string): string {
  return (key === "interval_work" ? stripEffortPrefix(text) : text).trim();
}

/**
 * Подставить эталон в сегмент генератора. У отрезка «усилие N из 10» остаётся
 * генераторным: эталон встаёт ПОСЛЕ него.
 */
export function applyStepText<T extends { key?: StepKey; noPaceText?: string }>(seg: T, etalons: StepTextEtalons): T {
  if (!seg.key) return seg;
  const etalon = etalons[seg.key];
  if (!etalon) return seg;
  if (seg.key === "interval_work") {
    const prefix = effortPrefixOf(seg.noPaceText);
    return { ...seg, noPaceText: prefix ? `${prefix}, ${etalon}` : etalon };
  }
  return { ...seg, noPaceText: etalon };
}

/**
 * Догадка ключа для шага БЕЗ ключа (рукописные недели тренера, старые сборки).
 * Только подсказка в выпадающем списке редактора: эталоном правка становится,
 * когда ключ выбран тренером.
 */
export function guessStepKey(input: {
  name: string;
  role: string;
  onTreadmill: boolean;
  index: number;
  count: number;
}): StepKey | null {
  const n = input.name.toLowerCase();
  if (/^отрезок|^бег$/.test(n)) return "interval_work";
  if (/шагом|восстановлени/.test(n) && input.role === "quality") return "interval_rest";
  if (/заминк/.test(n)) return "cooldown";
  if (/перед работой|ускорени/.test(n)) return "warmup_strides";
  if (/спокойный бег/.test(n) && input.role === "quality") return "warmup_settle";
  if (/ходьб|разминк/.test(n) && input.index === 0) return "warmup_walk";
  if (/лёгкий бег|легкий бег/.test(n) && input.role === "quality") return "warmup_easy";
  if (input.role === "long") return input.onTreadmill ? "long_main_treadmill" : "long_main_street";
  if (/бег/.test(n)) return input.onTreadmill ? "easy_main_treadmill" : "easy_main_street";
  return null;
}
