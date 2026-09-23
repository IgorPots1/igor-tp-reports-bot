/**
 * Цифры тренировки — ОДНА СБОРКА НА ВСЮ КАРТОЧКУ.
 *
 * ── ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ ──────────────────────────────────────────────────
 *
 * У ученика без часов ручной ввод — ЕДИНСТВЕННЫЙ источник данных. Он вводит
 * время, дистанцию, темп и пульс, а карточка до 23.09.2026 показывала только
 * время и дистанцию: темп не выбирался из базы вообще, пульс выбирался и
 * нигде не рисовался. Человек отвечал на четыре вопроса, тренер видел два.
 *
 * Строк (time_s/velocity/heartrate) у ручного ввода нет и не будет, поэтому
 * средний темп и средний пульс — ВСЁ, что вообще можно сказать об этой
 * тренировке. Терять их нельзя.
 *
 * ── ПОЧЕМУ ТЕМП НЕ СЧИТАЕТСЯ ЗДЕСЬ ЗАНОВО ───────────────────────────────────
 *
 * average_speed_mps — уже посчитанный факт, и считал его тот, кто знал больше
 * нас. У ручного ввода это дистанция/время, когда дистанция названа, и темп со
 * слов, когда не названа (manual-entry.ts). У привезённой тренировки это
 * среднее самих часов. Пересчитать «дистанция / время» поверх — значит молча
 * выбросить темп у тех, кто дистанцию не вводил: у них её нет, а темп есть.
 *
 * Пересчёт остаётся только ЗАПАСНЫМ путём, на случай старых строк без
 * скорости.
 *
 * ЧИСТЫЕ ФУНКЦИИ, БЕЗ DOM И БЕЗ СЕТИ: их гоняет check:activity-numbers.
 */

export type ActivityNumbersInput = {
  movingTimeS: number | null;
  distanceM: number | null;
  averageHeartrate: number | null;
  averageSpeedMps: number | null;
};

/** Средний темп, с/км. null — сказать нечего, и врать числом не надо. */
export function activityPaceSecPerKm(activity: ActivityNumbersInput): number | null {
  const speed = activity.averageSpeedMps;
  if (speed !== null && Number.isFinite(speed) && speed > 0) return 1000 / speed;

  const { distanceM, movingTimeS } = activity;
  if (
    distanceM !== null &&
    movingTimeS !== null &&
    Number.isFinite(distanceM) &&
    Number.isFinite(movingTimeS) &&
    distanceM > 0 &&
    movingTimeS > 0
  ) {
    return (movingTimeS / distanceM) * 1000;
  }
  return null;
}

/** «7:43» из секунд на километр. */
export function paceLabelRu(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Цифры тренировки одной строкой: «62 мин · 8.03 км · 7:43 /км · пульс 126».
 *
 * ПУСТОГО МЕСТА НЕ ОСТАВЛЯЕМ: чего нет — того нет, прочерки и «—» между
 * реальными числами читаются как поломка, хотя человек просто не ввёл поле.
 */
export function activityNumbersRu(activity: ActivityNumbersInput): string {
  const parts: string[] = [];

  const { movingTimeS } = activity;
  if (movingTimeS !== null && Number.isFinite(movingTimeS) && movingTimeS > 0) {
    parts.push(`${Math.round(movingTimeS / 60)} мин`);
  }

  const { distanceM } = activity;
  if (distanceM !== null && Number.isFinite(distanceM) && distanceM > 0) {
    parts.push(`${(distanceM / 1000).toFixed(2)} км`);
  }

  const pace = activityPaceSecPerKm(activity);
  if (pace !== null) parts.push(`${paceLabelRu(pace)} /км`);

  const { averageHeartrate } = activity;
  if (averageHeartrate !== null && Number.isFinite(averageHeartrate) && averageHeartrate > 0) {
    parts.push(`пульс ${Math.round(averageHeartrate)}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "цифр нет";
}
