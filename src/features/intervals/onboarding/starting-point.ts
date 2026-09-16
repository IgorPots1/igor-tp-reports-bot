/**
 * Стартовая точка ученика: что видно из его истории в Intervals.
 *
 * ПРАВИЛО НАРЯДА: не спрашивать то, что можно посчитать. Частота, объём и
 * наличие пульса берутся ОТСЮДА, а анкета их не дублирует.
 *
 * Чистые функции отделены от загрузки намеренно: числа, на которых стоит план,
 * должны проверяться тестом на выдуманных данных, а не только живым прогоном.
 */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { fetchAllRows } from "@/features/supabase/paginate";

import type { OnboardingAnswers, StartingPoint, WeeklyVolumePoint } from "./types";

/**
 * Что считается бегом. Плавание и велосипед в беговой объём не входят: цикл
 * растит беговые минуты, и подмешивание чужого спорта завысит базу — у Игоря в
 * истории 1688 активностей, из них заметная часть Swim и Ride.
 */
export const RUN_TYPES = new Set(["Run", "VirtualRun", "TrailRun"]);

/** Окно наблюдения. Наряд задаёт 4–8 недель; берём верхнюю границу — она устойчивее. */
export const WINDOW_WEEKS = 8;

/**
 * Короче этой дистанции пробежка не участвует в расчёте темпа: разминочные
 * километры и обрывки записи дают темп, которого человек не бежал.
 */
const MIN_DISTANCE_FOR_PACE_M = 3000;

/** Меньше этого числа пробежек — темп лёгкого не считаем, выборка не выборка. */
const MIN_RUNS_FOR_EASY_PACE = 5;

/**
 * Сколько нужно, чтобы называть стартовую точку ИСТОРИЕЙ.
 *
 * База цикла — это утверждение про ТИПИЧНУЮ неделю человека. Одна неделя
 * данных типичной недели не описывает, сколько бы пробежек в ней ни было,
 * поэтому гейт двойной: и пробежек достаточно, и они разложены хотя бы по двум
 * неделям. Не пройдено — план строится по анкете, и это подписано в
 * start_point_source, а не спрятано за правдоподобными нулями.
 */
export const MIN_RUNS_FOR_HISTORY = 4;
export const MIN_WEEKS_WITH_RUNS_FOR_HISTORY = 2;

/** Годится ли измеренная стартовая точка как база цикла. */
export function hasUsableHistory(start: StartingPoint): boolean {
  return (
    start.source === "history" &&
    start.runsTotal >= MIN_RUNS_FOR_HISTORY &&
    start.weeksWithRuns >= MIN_WEEKS_WITH_RUNS_FOR_HISTORY
  );
}

export type ActivityForStartingPoint = {
  activityType: string | null;
  startDateLocal: string | null;
  movingTimeS: number | null;
  distanceM: number | null;
  dataLevel: string;
};

/** Понедельник недели, в которую попадает дата. */
export function mondayOf(dateIso: string): string {
  const date = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // 0 = понедельник
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  return new Date(Date.parse(`${dateIso}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return Number.isInteger(middle)
    ? sorted[middle]
    : (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
}

function round(value: number): number {
  return Math.round(value);
}

/** Перцентиль по возрастающему массиву, линейной интерполяцией. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = ((sorted.length - 1) * p) / 100;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Стартовая точка по истории.
 *
 * `asOf` — конец окна (обычно сегодня). Окно закрытое: [asOf − 8 недель, asOf].
 */
export function computeStartingPointFromHistory(
  activities: ActivityForStartingPoint[],
  asOf: string
): StartingPoint {
  const notes: string[] = [];
  // Окно — 8 ПОЛНЫХ недель, заканчивающихся воскресеньем перед текущей.
  // Текущая неделя не входит НАМЕРЕННО: она неполная, и её обрубок тянул бы
  // медиану вниз тем сильнее, чем раньше в неделе считаем. Граница совпадает с
  // границей корзин — иначе пробежка проходит фильтр, но не попадает ни в одну
  // неделю, и её минуты исчезают (ровно это и случилось на первом прогоне).
  const windowEnd = mondayOf(asOf);                       // исключающая граница
  const windowFrom = addDays(windowEnd, -7 * WINDOW_WEEKS);

  const inWindow = (day: string): boolean => day >= windowFrom && day < windowEnd;

  const runsAll = activities.filter(
    (activity) => activity.startDateLocal && RUN_TYPES.has(String(activity.activityType))
  );
  const runs = runsAll.filter((activity) => inWindow(activity.startDateLocal!.slice(0, 10)));

  // Недельные корзины заводятся ЗАРАНЕЕ и пустыми. Иначе неделя без единой
  // пробежки просто не появится в ряду, и медиана посчитается по одним лишь
  // неделям, когда человек бегал, — то есть завысит базу ровно у того, кто
  // тренируется через раз.
  const buckets = new Map<string, WeeklyVolumePoint>();
  for (let index = 0; index < WINDOW_WEEKS; index += 1) {
    const weekStart = addDays(windowFrom, index * 7);
    buckets.set(weekStart, { weekStart, minutes: 0, runs: 0 });
  }

  const dayHistogram = [0, 0, 0, 0, 0, 0, 0];
  const dayHistogramLong = [0, 0, 0, 0, 0, 0, 0];
  const runMinutes: number[] = [];
  // Самая длинная пробежка каждой недели: из неё берётся и «обычная длительная»,
  // и день, в который человек её ставит.
  const longestOfWeek = new Map<string, { minutes: number; weekday: number }>();
  const paceSamples: number[] = [];
  let paceSamplesManualCount = 0;
  let runsWithHeartrate = 0;

  for (const activity of runs) {
    const day = activity.startDateLocal!.slice(0, 10);
    const bucket = buckets.get(mondayOf(day));
    const minutes = (activity.movingTimeS ?? 0) / 60;
    if (bucket) {
      bucket.minutes += minutes;
      bucket.runs += 1;
    }
    if (minutes > 0) runMinutes.push(minutes);

    const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
    dayHistogram[weekday] += 1;

    if (activity.dataLevel === "heartrate") runsWithHeartrate += 1;

    const weekKey = mondayOf(day);
    const currentLongest = longestOfWeek.get(weekKey);
    if (!currentLongest || minutes > currentLongest.minutes) {
      longestOfWeek.set(weekKey, { minutes, weekday });
    }

    const distance = activity.distanceM ?? 0;
    const seconds = activity.movingTimeS ?? 0;
    if (distance >= MIN_DISTANCE_FOR_PACE_M && seconds > 0) {
      paceSamples.push(seconds / (distance / 1000));
      // ДИСТАНЦИЯ И ВРЕМЯ У РУЧНОЙ ЗАПИСИ ТОЖЕ ЧИСЛА, И ТЕМП ИЗ НИХ СЧИТАЕТСЯ
      // ТАК ЖЕ. Не выбрасываем её из выборки — объём и здесь достоверен как
      // среднее. Но откуда взялся ЭТОТ темп (со слов или с GPS), нужно
      // помнить отдельно: доверие к якорю лёгкого зависит от происхождения, а
      // не только от того, сколько чисел набралось.
      if (activity.dataLevel === "manual") paceSamplesManualCount += 1;
    }
  }

  const longRuns: number[] = [];
  for (const longest of longestOfWeek.values()) {
    if (longest.minutes <= 0) continue;
    longRuns.push(longest.minutes);
    dayHistogramLong[longest.weekday] += 1;
  }

  const weekly = [...buckets.values()].map((point) => ({
    ...point,
    minutes: round(point.minutes),
  }));

  const weeklyMinutes = weekly.map((point) => point.minutes);
  const last4 = weeklyMinutes.slice(-4);
  const medianWeekly = round(median(weeklyMinutes));

  // ТЕМП ЛЁГКОГО — медиана МЕДЛЕННОЙ ПОЛОВИНЫ пробежек, а не всех.
  //
  // Своих названий у активностей Intervals нет (в отличие от TP, где тренер
  // пишет «лёгкий» в заголовке), поэтому отделить лёгкое от качественного по
  // тексту нельзя. Медиана всех пробежек утянута вниз соревнованиями и
  // отрезками; медиана медленной половины устойчива к ним по построению —
  // быстрые попадают в отброшенную половину.
  let easyPaceSec: number | null = null;
  const sortedPaces = [...paceSamples].sort((a, b) => a - b);
  const slowerHalf = sortedPaces.slice(Math.floor(sortedPaces.length / 2));
  if (sortedPaces.length >= MIN_RUNS_FOR_EASY_PACE) {
    easyPaceSec = round(median(slowerHalf));
  } else if (sortedPaces.length > 0) {
    notes.push(
      `темп лёгкого не считали: пробежек с дистанцией ≥3 км всего ${sortedPaces.length}, нужно ${MIN_RUNS_FOR_EASY_PACE}`
    );
  }

  const runsTotal = runs.length;
  const dataLevel: StartingPoint["dataLevel"] =
    runsTotal === 0
      ? "none"
      : runsWithHeartrate / runsTotal >= 0.5
        ? "heartrate"
        : "pace_only";

  if (runsTotal > 0 && dataLevel === "pace_only") {
    notes.push(
      `пульс есть у ${runsWithHeartrate} из ${runsTotal} пробежек окна — цели будут по темпу`
    );
  }

  const otherSportsInWindow = activities.filter((activity) => {
    if (!activity.startDateLocal) return false;
    if (RUN_TYPES.has(String(activity.activityType))) return false;
    return inWindow(activity.startDateLocal.slice(0, 10));
  }).length;
  if (otherSportsInWindow > 0) {
    notes.push(`в беговой объём не вошли ${otherSportsInWindow} активностей других видов спорта в окне`);
  }

  // АРХИВ ЗА ОКНОМ. Без этой строки «пробежек 0» читается как «человек не
  // бегает», хотя в базе может лежать несколько лет истории, просто старой.
  const outside = runsAll.filter((activity) => !inWindow(activity.startDateLocal!.slice(0, 10)));
  if (outside.length > 0) {
    const lastDay = outside
      .map((activity) => activity.startDateLocal!.slice(0, 10))
      .sort()
      .at(-1);
    notes.push(`за пределами окна в архиве ещё ${outside.length} пробежек, последняя ${lastDay}`);
  }

  return {
    source: "history",
    windowFrom,
    windowTo: addDays(windowEnd, -1),
    weeksObserved: WINDOW_WEEKS,
    weekly,
    medianWeeklyMinutes: medianWeekly,
    rolling4wWeeklyMinutes: round(last4.reduce((sum, value) => sum + value, 0) / Math.max(last4.length, 1)),
    rolling8wWeeklyMinutes: round(weeklyMinutes.reduce((sum, value) => sum + value, 0) / Math.max(weeklyMinutes.length, 1)),
    runsPerWeek: Number((runsTotal / WINDOW_WEEKS).toFixed(2)),
    dayHistogram,
    weeksWithRuns: weekly.filter((point) => point.runs > 0).length,
    typicalRunMinutes: round(median(runMinutes)),
    longestRunMinutes: round(runMinutes.length ? Math.max(...runMinutes) : 0),
    longRunMedianMinutes: round(median(longRuns)),
    runMinutesP10: round(percentile(runMinutes, 10)),
    runMinutesP90: round(percentile(runMinutes, 90)),
    dayHistogramLong,
    easyPaceSec,
    easyPaceSampleSize: sortedPaces.length,
    easyPaceManualCount: paceSamplesManualCount,
    dataLevel,
    runsWithHeartrate,
    runsTotal,
    notes,
  };
}

/**
 * Стартовая точка по анкете — ОТДЕЛЬНАЯ ВЕТКА, а не история с подстановками.
 *
 * Здесь нечего измерять: нет ни ряда недель, ни распределения дней, ни темпа.
 * Всё, что есть, — объём со слов и число дней, которое человек готов бегать.
 * Разница с историей должна быть видна снаружи, поэтому поля, которых нет,
 * остаются пустыми, а не заполняются правдоподобными числами.
 */
export function startingPointFromAnswers(answers: OnboardingAnswers): StartingPoint {
  const weekly = answers.selfReportedWeeklyMinutes ?? 0;
  const notes = ["истории в Intervals нет — стартовая точка целиком со слов ученика"];
  if (!answers.selfReportedWeeklyMinutes) {
    notes.push("объём со слов не указан — база нулевая, цикл начнётся с минимальной недели");
  }

  return {
    source: "questionnaire",
    windowFrom: null,
    windowTo: null,
    weeksObserved: 0,
    weekly: [],
    medianWeeklyMinutes: weekly,
    rolling4wWeeklyMinutes: weekly,
    rolling8wWeeklyMinutes: weekly,
    runsPerWeek: answers.daysPerWeek,
    dayHistogram: [0, 0, 0, 0, 0, 0, 0],
    weeksWithRuns: 0,
    typicalRunMinutes: 0,
    longestRunMinutes: 0,
    longRunMedianMinutes: 0,
    runMinutesP10: 0,
    runMinutesP90: 0,
    dayHistogramLong: [0, 0, 0, 0, 0, 0, 0],
    easyPaceSec: null,
    easyPaceSampleSize: 0,
    easyPaceManualCount: 0,
    dataLevel: "none",
    runsWithHeartrate: 0,
    runsTotal: 0,
    notes,
  };
}

/** Загрузка активностей источника. Через пагинацию: порог 1000 строк не поднимается. */
export async function loadActivitiesForSource(
  sourceId: string
): Promise<ActivityForStartingPoint[]> {
  const supabase = createSupabaseServerClient();
  const rows = await fetchAllRows<{
    activity_type: string | null;
    start_date_local: string | null;
    moving_time_s: number | null;
    distance_m: number | null;
    data_level: string;
  }>(
    async (from, to) => {
      const { data, error } = await supabase
        .from("intervals_activities")
        .select("activity_type, start_date_local, moving_time_s, distance_m, data_level")
        .eq("source_id", sourceId)
        .order("activity_id")
        .range(from, to);
      // Ошибку отдаём наверх в форме, которую ждёт fetchAllRows, — он сам её
      // обернёт с номером страницы, на которой чтение сломалось.
      return { data, error: error ? { message: describeSupabaseError(error) } : null };
    },
    { label: "activities-for-starting-point" }
  );

  return rows.map((row) => ({
    activityType: row.activity_type,
    startDateLocal: row.start_date_local,
    movingTimeS: row.moving_time_s,
    distanceM: row.distance_m,
    dataLevel: row.data_level,
  }));
}
