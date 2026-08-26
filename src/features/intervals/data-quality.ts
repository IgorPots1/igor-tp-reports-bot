/**
 * Что в тренировке РЕАЛЬНО есть. Считается по рядам, а не по полям-средним.
 *
 * Зачем не по средним: у активности может стоять average_heartrate, посчитанный
 * по первым двум минутам, пока ремень ещё держал контакт. Поле заполнено —
 * значит «пульс есть», и генератор разбора начинает рассуждать об интенсивности
 * тренировки, от которой пульс известен на одну сотую. Ряд такого не позволяет:
 * в нём видно, сколько точек живых.
 */

import type { ActivityDataQuality, ActivityStreams } from "./types";

/**
 * Ниже этой доли живых точек пульс считается ОТСУТСТВУЮЩИМ.
 *
 * Половина выбрана как граница, за которой любое утверждение про интенсивность
 * описывает меньшую часть тренировки, чем не описывает. Порог намеренно
 * назначенный, а не выведенный, поэтому рядом всегда сохраняется точная доля
 * (hr_coverage_pct): если правило захотят сдвинуть, пересчитать можно по базе,
 * не перекачивая историю у провайдера.
 */
const MIN_HR_COVERAGE_PCT = 50;

/**
 * Считает ЖИВЫЕ точки пульса.
 *
 * Ноль — это НЕ показание. Проверено на живых данных (i38500, 2 ряда из 200
 * проверенных содержали 2223 нулевые точки, а null внутри рядов не встретился
 * ни разу): Intervals.icu затыкает провалы пульса нулями, а не пропусками. Пока
 * ноль считался живым значением, такая тренировка показывала покрытие 100% —
 * то есть ровно та ложь, ради предотвращения которой уровень качества и
 * считается по рядам, а не по average_heartrate.
 *
 * Пульс 0 уд/мин физиологически невозможен, поэтому граница не назначенная, а
 *однозначная: ноль отбрасывается всегда. Более широкий порог («меньше 30 —
 * тоже провал») сознательно НЕ вводится: без данных о том, как выглядят такие
 * ряды, он был бы догадкой, а нижние значения бывают настоящими у выносливых
 * людей на разминке.
 */
function countLiveHeartrate(series: (number | null)[] | null | undefined): number {
  if (!series) return 0;
  let live = 0;
  for (const value of series) {
    if (value !== null && Number.isFinite(value) && value > 0) live += 1;
  }
  return live;
}

export function assessDataQuality(streams: ActivityStreams | null): ActivityDataQuality {
  if (!streams || streams.time.length === 0) {
    // Рядов нет вовсе: силовая без записи, ручной ввод, чужой импорт. Это
    // нормальный исход, и он обязан отличаться от «ряды есть, но пустые».
    return {
      dataLevel: "none",
      hasHeartrate: false,
      hasPace: false,
      hrCoveragePct: null,
      pointCount: 0,
    };
  }

  const pointCount = streams.time.length;

  const hrLive = countLiveHeartrate(streams.heartrate);
  // null — ряда не было; 0 — ряд пришёл, но пустой. Разница важна при разборе
  // жалоб «почему у меня нет пульса»: в первом случае его не записали, во
  // втором записали пустым.
  const hrCoveragePct = streams.heartrate ? (hrLive / pointCount) * 100 : null;
  const hasHeartrate = hrCoveragePct !== null && hrCoveragePct >= MIN_HR_COVERAGE_PCT;

  // Для темпа хватает того, что в ряду есть хоть одно ненулевое движение:
  // нули — это стояние на светофоре, а не отсутствие данных.
  const hasPace = (streams.velocitySmooth ?? []).some(
    (value) => value !== null && Number.isFinite(value) && value > 0
  );

  return {
    dataLevel: hasHeartrate ? "heartrate" : hasPace ? "pace_only" : "none",
    hasHeartrate,
    hasPace,
    hrCoveragePct: hrCoveragePct === null ? null : Number(hrCoveragePct.toFixed(1)),
    pointCount,
  };
}
