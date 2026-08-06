/**
 * band-collision — проверка, что лёгкий не слипся с качеством.
 *
 * ЗАЧЕМ. У 5673496 сгенерировано: лёгкий 4:53–5:18, отрезки 4:47–5:02 — быстрый край лёгкого
 * быстрее медленного края работы. Так тренер не пишет: ученику показаны две полосы, которые
 * пересекаются, и «лёгкий» неотличим от рабочего темпа.
 *
 * ГРАНИЦА — В ТОЙ ЖЕ ВАЛЮТЕ, ЧТО И ПРОВЕРКА. Прежние 1.09 были минимумом отношения
 * лёгкий/ПОРОГ, а сравниваем мы лёгкий/ТЕМП ОТРЕЗКОВ. Величины разные: контролируемый порог
 * бежится примерно НА пороге и медленнее (замер: медиана отрезки/порог 1.003, p75 1.035),
 * поэтому отношение лёгкий/отрезки систематически ниже, и старое число резало здоровых.
 *
 * ЗАМЕР В ПРАВИЛЬНОЙ ВАЛЮТЕ (только coach_authored: проверено SQL, что все описания
 * с диапазонами темпа лежат на is_planned=true — 0 из 1345 неплановых):
 *   по атлетам      n=51:  min 1.071 · p05 1.130 · медиана 1.235 · max 1.446
 *   потренировочно  n=700: min 1.060 · p01 1.073 · p05 1.124 · медиана 1.233 · max 1.563
 * Ниже 1.060 тренер не пишет НИ РАЗУ за 200 дней. Границу берём по этому полу, а не по p05:
 * p05 (≈1.12) зарезал бы 5% РЕАЛЬНОЙ практики, а это гейт, а не предупреждение.
 * Исходный дефект 5673496 (отношение 1.036) новая граница ловит с запасом.
 *
 * ЧТО ПРОВЕРЯЕМ — ТОЛЬКО ПОКАЗАННЫЕ ЧИСЛА. Если лёгкий идёт «по ощущениям» (тир T1) или
 * качества на неделе нет, цифр темпа ученик не видит и слипаться нечему: not_applicable.
 * Проверять надо ПОЛОСЫ ИЗ ГОТОВОГО ОПИСАНИЯ, а не якоря: полоса лёгкого перед показом
 * сужается до потолка ширины, и широкая зона 2 после сужения перестаёт задевать работу.
 *
 * ЧТО ДЕЛАЕМ ПРИ СРАБАТЫВАНИИ: не выдаём неделю и помечаем атлета «лёгкий не подтверждён».
 * Полосу молча не подкручиваем — подкрутка спрятала бы негодный источник вместо того,
 * чтобы его показать.
 *
 * Чистый модуль.
 */

/**
 * Минимальное допустимое отношение середины лёгкого к середине темпа ОТРЕЗКОВ (параметр).
 * Пол наблюдаемой практики: 1.060 потренировочно (n=700), 1.071 по атлетам (n=51).
 */
export const MIN_EASY_TO_QUALITY_RATIO = 1.06;

export type Band = { fastSec: number; slowSec: number };

export type CollisionVerdict =
  | { status: "ok"; ratio: number }
  | { status: "collision"; ratio: number; message: string }
  | { status: "unverifiable"; message: string }
  /** темп ученику не показывается — слипаться нечему */
  | { status: "not_applicable"; message: string };

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
        + `(пол наблюдаемой практики 1.060) — лёгкий слишком близко к рабочему темпу`,
    };
  }
  return { status: "ok", ratio };
}

/**
 * Проверка ПОКАЗАННЫХ полос — то, что реально уйдёт ученику в описании.
 *
 * easyShown / qualityShown = null означает «числа не показываются» (по ощущениям либо такой
 * сессии на неделе нет). Тогда проверять нечего — not_applicable, неделя выдаётся.
 * Это не поблажка: 5847207 отклонялся старой проверкой, хотя вся его неделя идёт
 * по ощущениям и ни одной цифры темпа в тексте нет.
 */
export function checkShownBands(
  easyShown: Band | null,
  qualityShown: Band | null,
  isOwnQualityAnchor: boolean,
  minRatio: number = MIN_EASY_TO_QUALITY_RATIO,
): CollisionVerdict {
  if (!easyShown) return { status: "not_applicable", message: "лёгкий показан по ощущениям — цифр темпа нет" };
  if (!qualityShown) return { status: "not_applicable", message: "качественной сессии с темпом на неделе нет" };
  return checkEasyAgainstQuality(easyShown.fastSec, easyShown.slowSec,
    { fastSec: qualityShown.fastSec, slowSec: qualityShown.slowSec, isOwnAnchor: isOwnQualityAnchor }, minRatio);
}
