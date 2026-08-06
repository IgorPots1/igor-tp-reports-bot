/**
 * band-collision — проверка, что лёгкий не слипся с качеством.
 *
 * ЗАЧЕМ. У 5673496 сгенерировано: лёгкий 4:53–5:18, отрезки 4:47–5:02 — быстрый край лёгкого
 * быстрее медленного края работы. Отношение середин 1.04. В практике Игоря отношение
 * лёгкий/порог НИКОГДА не опускается ниже 1.09 (замер n=63, разброс 1.09–1.53). Значит такой
 * лёгкий недостоверен: почти наверняка это зона 2 TP, которая гонит лёгкий слишком быстро.
 *
 * ЧТО ДЕЛАЕМ ПРИ СРАБАТЫВАНИИ: не выдаём неделю и помечаем атлета «лёгкий не подтверждён».
 * Полосу молча не подкручиваем — подкрутка спрятала бы негодный источник вместо того,
 * чтобы его показать.
 *
 * Чистый модуль.
 */

/** Минимальное допустимое отношение середины лёгкого к середине качества (параметр). */
export const MIN_EASY_TO_QUALITY_RATIO = 1.09;

export type CollisionVerdict =
  | { status: "ok"; ratio: number }
  | { status: "collision"; ratio: number; message: string }
  | { status: "unverifiable"; message: string };

/**
 * Лёгкий достоверен, если он достаточно медленнее работы.
 * Проверяем ТОЛЬКО когда якорь качества свой (из описаний): фолбэк качества сам выведен
 * из порога, и сравнивать с ним лёгкий, тоже выведенный из порога, бессмысленно —
 * это сравнение формулы с формулой, а не с фактом.
 */
export function checkEasyAgainstQuality(
  easyFastSec: number, easySlowSec: number,
  quality: { fastSec: number; slowSec: number; isOwnAnchor: boolean } | null,
  minRatio: number = MIN_EASY_TO_QUALITY_RATIO,
): CollisionVerdict {
  if (!quality || !quality.isOwnAnchor) {
    return { status: "unverifiable", message: "своего якоря качества нет — проверить лёгкий нечем" };
  }
  const easyMid = (easyFastSec + easySlowSec) / 2;
  const qualMid = (quality.fastSec + quality.slowSec) / 2;
  if (qualMid <= 0) return { status: "unverifiable", message: "якорь качества пуст" };
  const ratio = easyMid / qualMid;
  if (ratio < minRatio) {
    return {
      status: "collision", ratio,
      message: `лёгкий не подтверждён: отношение лёгкий/качество ${ratio.toFixed(3)} < ${minRatio} `
        + `(в практике ниже 1.09 не опускается) — лёгкий слишком близко к рабочему темпу`,
    };
  }
  return { status: "ok", ratio };
}
