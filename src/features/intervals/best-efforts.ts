/**
 * Лучшие непрерывные отрезки внутри тренировки: «самые быстрые 20 минут».
 *
 * ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
 *
 * Чтобы поставить человеку пороговый темп, надо смотреть не на среднюю по
 * пробежке (в ней разминка, заминка и светофоры), а на то, что он реально
 * ДЕРЖАЛ подряд. Сводка по тренировке на этот вопрос не отвечает, ряды
 * отвечают.
 *
 * ── ЧТО СЧИТАЕМ ─────────────────────────────────────────────────────────────
 *
 * Для каждой длительности D — окно длиной не меньше D с максимальной средней
 * скоростью. Берём НАИМЕНЬШЕЕ окно, покрывающее D: иначе длинный кусок с
 * быстрым началом разбавляется медленным хвостом и выглядит ровнее, чем был.
 *
 * ── ЧЕГО НЕ ДЕЛАЕМ ──────────────────────────────────────────────────────────
 *
 * Не сглаживаем, не выбрасываем «подозрительные» точки и не чиним паузы. Если
 * человек стоял на светофоре, в ряду будет провал скорости, и окно с этим
 * провалом честно проиграет окну без него. Любая попытка «почистить» данные
 * здесь означает придумать за человека, что он бежал быстрее, чем бежал.
 */

export type BestEffort = {
  /** Запрошенная длительность, секунд. */
  durationS: number;
  /** Фактическая длительность окна: обычно чуть больше запрошенной. */
  actualS: number;
  paceSecPerKm: number;
  distanceM: number;
  /** Смещение начала окна от старта тренировки, секунд. */
  startOffsetS: number;
};

/**
 * Накопленная дистанция по ряду скорости.
 *
 * Скорость в ряду — мгновенная на момент отсчёта, поэтому на отрезке между
 * отсчётами берём среднюю из двух концов (трапеция). На секундном ряду разница
 * с прямоугольником микроскопическая, но на редких рядах (раз в 5–10 секунд)
 * прямоугольник систематически врёт в сторону предыдущего значения.
 */
function cumulativeDistance(timeS: number[], velocity: Array<number | null>): number[] {
  const out = new Array<number>(timeS.length).fill(0);
  for (let i = 1; i < timeS.length; i += 1) {
    const dt = timeS[i] - timeS[i - 1];
    if (!Number.isFinite(dt) || dt <= 0) {
      out[i] = out[i - 1];
      continue;
    }
    const a = velocity[i - 1];
    const b = velocity[i];
    const va = typeof a === "number" && Number.isFinite(a) && a > 0 ? a : 0;
    const vb = typeof b === "number" && Number.isFinite(b) && b > 0 ? b : 0;
    out[i] = out[i - 1] + ((va + vb) / 2) * dt;
  }
  return out;
}

/**
 * Лучшее окно каждой длительности. Длительности, не помещающиеся в тренировку,
 * получают null: «нет данных» и «ноль» — разные ответы.
 */
export function bestEfforts(
  timeS: number[],
  velocity: Array<number | null>,
  durationsS: number[]
): Map<number, BestEffort | null> {
  const result = new Map<number, BestEffort | null>();
  const n = Math.min(timeS.length, velocity.length);
  if (n < 2) {
    for (const d of durationsS) result.set(d, null);
    return result;
  }

  const dist = cumulativeDistance(timeS.slice(0, n), velocity.slice(0, n));
  const total = timeS[n - 1] - timeS[0];

  for (const duration of durationsS) {
    if (!(duration > 0) || total < duration) {
      result.set(duration, null);
      continue;
    }

    let best: BestEffort | null = null;
    let left = 0;
    for (let right = 1; right < n; right += 1) {
      // Двигаем левый край, пока окно ОСТАЁТСЯ не короче нужного: так у нас
      // всегда наименьшее окно, покрывающее длительность.
      while (left + 1 < right && timeS[right] - timeS[left + 1] >= duration) left += 1;
      const span = timeS[right] - timeS[left];
      if (span < duration) continue;
      const metres = dist[right] - dist[left];
      if (!(metres > 0)) continue;
      const pace = (span / metres) * 1000;
      if (!Number.isFinite(pace)) continue;
      if (best === null || pace < best.paceSecPerKm) {
        best = {
          durationS: duration,
          actualS: Math.round(span),
          paceSecPerKm: pace,
          distanceM: metres,
          startOffsetS: Math.round(timeS[left] - timeS[0]),
        };
      }
    }
    result.set(duration, best);
  }

  return result;
}

/** «275» → «4:35». */
export function paceText(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Длительности по умолчанию: от коротких усилий до почти часа. */
export const DEFAULT_DURATIONS_S = [5 * 60, 10 * 60, 20 * 60, 30 * 60, 60 * 60];
