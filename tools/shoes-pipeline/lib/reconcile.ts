/**
 * Сверка значений из разных источников — раздел 4 наряда.
 *
 * Три правила, и все три про одно: не дать одному источнику молча стать
 * истиной.
 *
 *   1. Поле без источника в базу не попадает. Совсем.
 *   2. Числовое поле требует ДВУХ независимых источников.
 *   3. Расхождение больше 10 % не усредняется, а уходит в отчёт для человека.
 *
 * Про третье отдельно: усреднение выглядит разумно и потому опасно. Среднее
 * между 39 мм и 45 мм даёт 42 мм — число, которого нет ни в одном источнике,
 * зато выглядит достоверно. Расхождение почти всегда означает, что источники
 * говорят о РАЗНЫХ вещах: заявленное против измеренного, мужская версия против
 * женской, обновлённая модель против прошлогодней. Это разбирает человек.
 */

export type Observation = {
  /** Из какого источника значение. */
  source: string;
  value: number;
  /** measured — замер, declared — со слов производителя. */
  kind: "measured" | "declared";
  /** Кусок страницы, по которому значение можно проверить глазами. */
  evidence: string;
};

export type Reconciled =
  | { status: "ok"; value: number; kind: "measured" | "declared"; sources: string[] }
  | { status: "single_source"; value: number; sources: string[]; note: string }
  | { status: "no_source"; note: string }
  | { status: "divergent"; observations: Observation[]; spreadPct: number; note: string };

export const DIVERGENCE_LIMIT_PCT = 10;

export function reconcileNumber(field: string, obs: Observation[]): Reconciled {
  if (obs.length === 0) {
    return { status: "no_source", note: `${field}: нет ни одного источника` };
  }
  if (obs.length === 1) {
    // Одного источника мало по правилу наряда. Значение придержим, но в базу
    // оно не пойдёт — и в отчёте будет видно, чего именно не хватило.
    return {
      status: "single_source",
      value: obs[0].value,
      sources: [obs[0].source],
      note: `${field}: только один источник (${obs[0].source}), нужен второй`,
    };
  }

  const values = obs.map((o) => o.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // База сравнения — минимум: так спред не занижается на больших числах.
  const spreadPct = min === 0 ? Infinity : ((max - min) / min) * 100;

  if (spreadPct > DIVERGENCE_LIMIT_PCT) {
    return {
      status: "divergent",
      observations: obs,
      spreadPct,
      note:
        `${field}: расхождение ${spreadPct.toFixed(1)} % между ` +
        obs.map((o) => `${o.source}=${o.value} (${o.kind})`).join(", ") +
        " — решает человек, не усредняем",
    };
  }

  // Сошлись. Замер важнее заявленного: заявленный производителем перепад часто
  // расходится с реальным, и там, где есть оба, берём измеренный.
  const measured = obs.find((o) => o.kind === "measured");
  const chosen = measured ?? obs[0];
  return {
    status: "ok",
    value: chosen.value,
    kind: chosen.kind,
    sources: obs.map((o) => o.source),
  };
}
