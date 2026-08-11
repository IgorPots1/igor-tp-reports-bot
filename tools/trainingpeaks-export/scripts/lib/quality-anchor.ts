/**
 * quality-anchor — якорь КАЧЕСТВА из описаний, по образцу якоря лёгкого.
 *
 * ЗАЧЕМ. Полоса отрезка считалась процентами от порога и выходила 4:42–5:23 (41 с/км) —
 * вдвое шире лёгкого и перешагивала сам порог (89–103%). Так тренер не пишет. Игорь задаёт
 * темп отрезков в описании ровно так же, как лёгкий: «8 минут 4:55–5:05». Значит и якорь
 * качества надо восстанавливать из описаний, а не выводить процентами.
 *
 * Парсер — канонический parseSegments() из tp-recompute.ts. Агрегация (свежесть, отсев
 * выбросов, эффективный размер выборки) — buildAnchor() из easy-anchor.ts. Второго парсера
 * и второго агрегатора здесь нет.
 */
import { parseSegments } from "./tp-recompute.ts";
import { buildAnchor, type Anchor, type DateWindow, type EasySample } from "./easy-anchor.ts";

/** Заголовок интервальной: «6 х 5 мин», «12 x 2 мин». Даёт число повторов и длину отрезка. */
export const INTERVAL_TITLE_SHAPE = /([0-9]{1,2})\s*[xх×]\s*([0-9]{1,2}(?:[.,][0-9])?)\s*мин/i;

export const MIN_WORK_PACE_S = 150;  // 2:30 — быстрее не бывает
export const MAX_WORK_PACE_S = 540;  // 9:00 — медленнее это уже не работа
/** Отрезок опознаём по длительности: |длительность сегмента − M| ≤ допуск. */
const DURATION_TOL_MIN = 0.75;
/** Полоса рабочего отрезка шире этого — описание слепило разные куски, не берём. */
const MAX_WORK_BAND_S = 45;

export type QualitySample = EasySample & { workMinutes: number; reps: number };

/**
 * Достать полосу РАБОЧИХ отрезков из описания интервальной тренировки.
 *
 * Отделение работы от трусцы и разминки/заминки — по ДЛИТЕЛЬНОСТИ сегмента: в заголовке
 * стоит «N x M мин», значит рабочие сегменты те, чья длительность ≈ M. Трусца между ними
 * короче, разминка и заминка длиннее и стоят с краёв. Полагаться на «самый быстрый диапазон»
 * нельзя: у ускорений в конце лёгкой он тоже быстрый.
 */
export function extractQualitySample(title: string, desc: string): { fast: number; slow: number; workMinutes: number; reps: number } | null {
  if (!title || !desc) return null;
  const shape = INTERVAL_TITLE_SHAPE.exec(title);
  if (!shape) return null;
  const reps = Number(shape[1]);
  const workMin = Number(shape[2].replace(",", "."));
  if (!Number.isFinite(reps) || !Number.isFinite(workMin) || reps < 2 || workMin <= 0 || workMin > 30) return null;

  const segs = parseSegments(desc);
  // Разминка и заминка стоят С КРАЁВ описания и часто ТОЙ ЖЕ длительности, что и отрезок
  // («4 x 10 мин»: разминка 10 мин, работа 10 мин, заминка 10 мин). Одной длительности мало —
  // края надо снимать ПО ПОЗИЦИИ, иначе медиана берёт лёгкий темп заминки за рабочий.
  // Замер до правки: у 5953351 «работой» вышла заминка 6:15–6:47 — МЕДЛЕННЕЕ его же лёгкого.
  if (segs.length < 3) return null; // без краёв работу от разминки не отделить — сэмпл не берём
  const inner = segs.slice(1, -1);

  // рабочие сегменты: длительность совпадает с M из заголовка И есть прописанный темп
  const work = inner.filter((s) => Math.abs(s.durSec / 60 - workMin) <= DURATION_TOL_MIN && s.range != null);
  if (work.length === 0) return null;

  const fasts = work.map((s) => s.range!.fast).sort((a, b) => a - b);
  const slows = work.map((s) => s.range!.slow).sort((a, b) => a - b);
  const med = (xs: number[]): number => (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);
  const fast = Math.round(med(fasts)), slow = Math.round(med(slows));

  if (fast < MIN_WORK_PACE_S || slow > MAX_WORK_PACE_S) return null;
  if (slow - fast > MAX_WORK_BAND_S) return null;

  // Санити: работа не может быть МЕДЛЕННЕЕ разминки или заминки — там лёгкий бег.
  // Если оказалась — значит за работу принят не тот сегмент, сэмпл выбрасываем.
  const edges = [segs[0], segs[segs.length - 1]]
    .filter((s) => s.range != null).map((s) => (s.range!.fast + s.range!.slow) / 2);
  if (edges.length > 0 && (fast + slow) / 2 >= Math.min(...edges)) return null;

  return { fast, slow, workMinutes: workMin, reps };
}

export type QualityAnchor = Anchor & { source: "quality_description" };

/**
 * Пол ЭФФЕКТИВНОГО размера выборки, ниже которого якоря НЕТ (а не «есть, но ненадёжный»).
 *
 * ЗАЧЕМ. buildAnchor отсекает по СЫРОМУ числу сэмплов и возраст не смотрит, поэтому якорь,
 * собранный из полугодовых назначений, всё равно выдавал числа: у 5751651 effN = 0.02, и
 * проверка на слипание считала такой якорь фактом, сравнивая с ним лёгкий.
 *
 * ПОЧЕМУ 0.25, А НЕ MIN_EFFECTIVE_SAMPLES (=3). Тройка — порог ГРАДАЦИИ ДОВЕРИЯ внутри
 * источника, а не порог существования: по ней якорь потеряли бы 70 атлетов из 81, полоса
 * качества почти у всех уехала бы на формулу от порога, и восстановление якоря из описаний
 * обнулилось бы. 0.25 — арифметика полураспада: при half-life 21 день это ровно одно
 * назначение ШЕСТИНЕДЕЛЬНОЙ давности. Кто дольше не получал отрезков — археология.
 * Цена замерена (tp-collision-calibrate, раздел З): 0.25 снимает якорь у 7 из 81,
 * 0.50 — у 18, 1.00 — у 26, 3.00 — у 70.
 */
export const MIN_QUALITY_ANCHOR_EFF_N = 0.25;

/** Якорь качества = тот же агрегатор, что у лёгкого (свежесть + отсев выбросов + effN). */
export function buildQualityAnchor(
  samples: QualitySample[],
  asOf: string,
  opts: { halfLifeDays: number; illness?: DateWindow[]; minSamples?: number },
): QualityAnchor | null {
  const a = buildAnchor(samples, asOf, { halfLifeDays: opts.halfLifeDays, illness: opts.illness, minSamples: opts.minSamples ?? 4 });
  if (!a) return null;
  // Данных нет — чисел не даём: полоса качества уходит на фолбэк от порога, а проверка на
  // слипание получает unverifiable вместо ложного «проверено».
  if (a.effectiveN < MIN_QUALITY_ANCHOR_EFF_N) return null;
  return { ...a, source: "quality_description" };
}

/** Фолбэк-полоса качества от порога: ПОД порогом, узкая, без расширения по доверию. */
export const QUALITY_FALLBACK = {
  /** верхний край не быстрее порога — работа контролируемая, не гонка */
  fastAtThreshold: 1.0,
  /** нижний край — чуть медленнее порога */
  slowMult: 1.04,
  /** ширина полосы сверху ограничена, сек/км (параметр) */
  maxBandS: 12,
};

/** Полоса качества от порога, когда своего якоря нет. Никакого §2.5-расширения. */
export function qualityBandFromThreshold(thresholdSec: number): { fast: number; slow: number } {
  const fast = Math.round(thresholdSec * QUALITY_FALLBACK.fastAtThreshold);
  let slow = Math.round(thresholdSec * QUALITY_FALLBACK.slowMult);
  if (slow - fast > QUALITY_FALLBACK.maxBandS) slow = fast + QUALITY_FALLBACK.maxBandS;
  return { fast, slow };
}
