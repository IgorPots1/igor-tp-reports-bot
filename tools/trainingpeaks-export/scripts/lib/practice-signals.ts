/**
 * practice-signals — ЧИСТЫЕ величины, выведенные из практики тренера. Без I/O.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Эти правила (отсев разминок, личный пол лёгкой, запасной детектор
 * длительных, порог достаточности данных) — то, что правилось последние три наряда, и до
 * 13.08 они не были покрыты НИЧЕМ: жили внутри цикла с обращениями к базе, а все проверки
 * идут на заглушке конверта и это место не исполняют вовсе. Мутационный прогон это и показал:
 * порча отсева разминок и порога достаточности не роняла ни одной из 49 проверок.
 *
 * Здесь только вычисления. Кто и откуда взял строки — дело autoplanner-context.
 */

/** Заголовок качественной. Дубль константы контекста НАМЕРЕННО не делаем — она приходит извне. */
export type PlannedRun = { title: string; minutes: number };

/**
 * РАЗМИНКА/АКТИВАЦИЯ — НЕ ЛЁГКИЙ БЕГ.
 *
 * Замер 13.08: всё, что короче 40 мин у группы, — «Разминка» перед стартом (23 и 25 мин у
 * 5476215, 20/25/25 у 6009851). Без их отсева минимум атлета падает до 20-25, то есть ровно
 * в когортный пол, и личный пол теряет смысл.
 */
export const WARMUP_TITLE_RE = /разминк|активац|раскатк/i;

/**
 * БЛОК В СОРЕВНОВАТЕЛЬНОМ ТЕМПЕ — работа, а не обычная длительная.
 *
 * У 5475652 в верхнюю дециль попадали «25 км в темпе марафона» (180 мин) и «15 км в темпе
 * марафона» (132), и медиана длительных выходила 134 вместо 115.
 */
export const RACE_PACE_BLOCK_RE = /в темпе\s+(марафон|пм|полумарафон|мар\b)|марафонском темпе|соревновательн\w*\s+темп/i;

/**
 * «ТЕМП ВЫШЕ» — АЭРОБНЫЙ БЕГ ПО ЗАМЕРУ, а не качественный по регулярке.
 *
 * Измерено отдельным нарядом: 76% от порога против 83% у обычной лёгкой. QUALITY_TITLE_RE
 * держит его качественным, и трогать её нельзя — она кормит счётчики качества по всему
 * автопланировщику. Поэтому поправка живёт здесь, локально.
 */
export const AEROBIC_DESPITE_QUALITY_RE = /темп выше/i;

/** Меньше этого числа пробежек за окно — личный пол не считаем, берём когортный. */
export const MIN_RUNS_FOR_PERSONAL_FLOOR = 20;

/** Верхняя доля не-качественных, из которой берётся запасная оценка длительной. */
export const LONG_FALLBACK_DECILE = 0.10;

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
}

/** Качественная ДЛЯ ЭТИХ РАСЧЁТОВ: как решает регулярка, но «темп выше» — аэробный. */
export function isQualityForPractice(title: string, qualityRe: RegExp): boolean {
  return qualityRe.test(title) && !AEROBIC_DESPITE_QUALITY_RE.test(title);
}

/** Годится ли пробежка в выборку ЛИЧНОГО ПОЛА лёгкой. */
export function countsForEasyFloor(title: string, minutes: number, qualityRe: RegExp): boolean {
  if (!title || minutes <= 0 || minutes > 300) return false;
  if (isQualityForPractice(title, qualityRe)) return false;
  if (WARMUP_TITLE_RE.test(title)) return false;
  return true;
}

/** Годится ли пробежка в выборку ЗАПАСНОГО детектора длительных. */
export function countsForLongFallback(title: string, minutes: number, qualityRe: RegExp): boolean {
  if (!title || minutes <= 0 || minutes > 400) return false;
  if (isQualityForPractice(title, qualityRe)) return false;
  if (RACE_PACE_BLOCK_RE.test(title)) return false;
  return true;
}

/**
 * ЛИЧНЫЙ ПОЛ ЛЁГКОЙ — p10, а не min.
 *
 * Обосновано замером 13.08: min после отсева разминок выходит 40 у ДЕСЯТИ из двенадцати, то
 * есть схлопывается в когортную константу под личным именем; p10 даёт 40-55 и различает людей.
 * p10 симметричен правилу потолков «машине можно то, что тренер делает в девяти из десяти».
 */
export function easyFloorPersonal(samples: number[]): number {
  if (samples.length < MIN_RUNS_FOR_PERSONAL_FLOOR) return 0;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor(LONG_FALLBACK_DECILE * (s.length - 1))];
}

/**
 * ЗАПАСНАЯ ОЦЕНКА ДЛИТЕЛЬНОЙ — медиана верхней децили не-качественных.
 *
 * Нужна там, где тренер вообще не пишет в заголовке «длительная»: у 5748681 из 100 плановых
 * пробежек заголовку не отвечает НИ ОДНА, при этом пять её сессий по 100 мин названы
 * «Лёгкий бег (темп выше)». Проверено против эталона там, где заголовки есть (n=11): точное
 * совпадение у 5, средняя |ошибка| 9.5 мин, НИ РАЗУ не ниже эталона — для пола это правильная
 * сторона ошибки.
 */
export function longRunFallback(nonQualSamples: number[]): number {
  if (!nonQualSamples.length) return 0;
  const desc = [...nonQualSamples].sort((a, b) => b - a);
  return median(desc.slice(0, Math.max(1, Math.ceil(desc.length * LONG_FALLBACK_DECILE))));
}

export type LongPractice = { maxMin: number; medianMin: number; fromFallback: boolean };

/**
 * ПРАКТИКА ДЛИТЕЛЬНЫХ: по заголовкам, а при их полном отсутствии — запасным детектором.
 *
 * Запасной включается ТОЛЬКО при полном отсутствии заголовков. Порог «мало заголовков»
 * (например меньше трёх) сознательно НЕ введён: у 5475652 он поднял бы медиану 90 -> 126,
 * и это решение тренера, а не моё.
 */
export function longRunPractice(titledSamples: number[], nonQualSamples: number[]): LongPractice {
  if (titledSamples.length > 0) {
    const s = [...titledSamples].sort((a, b) => a - b);
    return { maxMin: s[s.length - 1], medianMin: median(s), fromFallback: false };
  }
  const fb = longRunFallback(nonQualSamples);
  return { maxMin: fb, medianMin: fb, fromFallback: true };
}
