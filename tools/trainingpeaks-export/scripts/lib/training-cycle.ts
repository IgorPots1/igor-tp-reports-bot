/**
 * training-cycle — черновик цикла из данных и разворачивание его в недели.
 *
 * ЧИСТЫЕ ФУНКЦИИ, БЕЗ I/O И БЕЗ ВЛИЯНИЯ НА ГЕНЕРАЦИЮ. Сборщик недель этот модуль не
 * импортирует и не должен: цикл пока только хранится и показывается (наряд 11.08, п.5).
 *
 * Спецификация: ops-log/2026-08-11-training-cycle-model.md, части C1 и C2.
 *
 * ПОМЕТКИ ИСТОЧНИКА: [практика] — замерено по данным Игоря; [решение Игоря] — принято
 * тренером и практикой НЕ подтверждается; [выведено] — ни то ни другое.
 */

import { DEFAULT_HALF_LIFE_DAYS, inAnyWindow, weightForAge, weightedMedian, type DateWindow } from "./easy-anchor.ts";

/**
 * БАЗА ЦИКЛА СЧИТАЕТСЯ ОТ НОРМЫ, А НЕ ОТ ФАЗЫ.
 *
 * Медиана за 8 недель наследовала то состояние, в котором человек оказался в момент
 * заведения цикла: у Кудрявцевой она дала долю качества 15.6% против её же медианы
 * за 26 недель 12.6% (p25 5.5%, p75 14.2%) — то есть закрепила хвост тяжёлого блока.
 * Заведи цикл после болезни — так же закрепился бы провал.
 *
 * Берём окно 26 недель со взвешиванием по свежести — тем же, что у якоря лёгкого
 * (период полураспада 42 дня): недавнее весит больше, но одна фаза уже не решает.
 * Недели с активным health-сигналом исключаются, как и для якоря.
 */
export const CYCLE_BASE_WINDOW_WEEKS = 26;
export const CYCLE_BASE_HALF_LIFE_DAYS = DEFAULT_HALF_LIFE_DAYS;

/**
 * ОКНО БАЗЫ КОРОЧЕ У РАСТУЩЕГО. Фиксированные 42 дня не поспевали за теми, кто реально
 * набирает: у Семешиной тренд +4.9 мин/нед, а база опустилась на 18 мин против
 * восьминедельной — окно тянуло вниз старыми, более лёгкими неделями.
 *
 * МЕХАНИКА. Считаем, на сколько процентов от базы объём изменился ЗА ВСЁ окно
 * (наклон × число недель ÷ база). Растёт заметно — окно укорачиваем, стоит на месте —
 * оставляем 42 дня. Падение окно НЕ укорачивает: там короткое окно закрепило бы провал
 * как норму, а это ровно та ошибка, из-за которой базу и переводили на 26 недель
 * (случай Лобуса: 8 недель дали бы 180 вместо верных 223).
 *
 * ПОРОГ 25% взят как «рост, заметный на глаз за полгода»; ниже него в практике живёт
 * подавляющее большинство — медиана роста за 26 недель ×1.01 [практика, n=93], то есть
 * укорочение сработает только у настоящих исключений, а не у всех подряд.
 * НИЖНЯЯ ГРАНИЦА 21 день [выведено] — половина дефолта и всё ещё три недели, то есть
 * больше одной тренировочной недели; короче делать нельзя, окно выродится в фазу.
 */
export const TREND_SHORTENING_AT_PCT = 25;
export const CYCLE_BASE_HALF_LIFE_MIN_DAYS = 21;

/** Наклон недельного ряда, единиц в неделю. Обычный МНК. */
export function weeklySlope(values: number[]): number {
  const n = values.length;
  if (n < 4) return 0;
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (values[i] - my); den += (i - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

/** Период полураспада для базы: короче у растущего, обычный у стабильного и падающего. */
export function halfLifeForTrend(values: number[], base: number): number {
  if (!(base > 0) || values.length < 4) return CYCLE_BASE_HALF_LIFE_DAYS;
  const growthPct = 100 * weeklySlope(values) * values.length / base;
  if (growthPct <= 0) return CYCLE_BASE_HALF_LIFE_DAYS;
  const k = Math.min(1, growthPct / TREND_SHORTENING_AT_PCT);
  return Math.round(CYCLE_BASE_HALF_LIFE_DAYS - k * (CYCLE_BASE_HALF_LIFE_DAYS - CYCLE_BASE_HALF_LIFE_MIN_DAYS));
}

/** Взвешенная по свежести медиана недельных величин, с выбросом больных недель. */
export function weightedWeeklyBase(
  weeks: Array<{ weekStart: string; value: number; hasTraining: boolean }>,
  asOf: string,
  illness: DateWindow[] = [],
  halfLifeDays: number = CYCLE_BASE_HALF_LIFE_DAYS,
): number {
  // ОТБИРАЕМ ПО «БЫЛА ЛИ НЕДЕЛЯ», А НЕ ПО «БЫЛА ЛИ ЭТА ВЕЛИЧИНА».
  // Первая версия отбрасывала недели с нулевым качеством, и база качества считалась
  // только по тем неделям, где отрезки были: у Пономаревой это подняло её с 20 до 40 мин,
  // а долю с 9.1% до 14.8%. Неделя без отрезков — это настоящая неделя, в которой
  // качества просто не было, и в норму она входит нулём.
  const pool = weeks.filter((w) => w.hasTraining && !inAnyWindow(w.weekStart, illness));
  if (pool.length === 0) return 0;
  const items = pool.map((w) => ({
    v: w.value,
    w: weightForAge(Math.round((Date.parse(asOf) - Date.parse(w.weekStart)) / 86400000), halfLifeDays),
  }));
  return Math.round(weightedMedian(items));
}

export type CycleIntent = "5k" | "10k" | "half" | "marathon" | "maintenance";
export type WeekRole = "рост" | "плановая разгрузка" | "подводка" | "старт" | "поддержание";

/**
 * ЧТО ЦИКЛ НА САМОМ ДЕЛЕ ДЕЛАЕТ. У пяти из двенадцати недель роста в горизонте нет
 * вовсе — старт близко, расти некогда. Такой цикл не «подготовка», а «подвести к старту
 * в текущей форме», и называть его надо честно, чтобы тренер видел разницу.
 */
export type CycleMode = "подготовка" | "подвод к старту в текущей форме" | "поддержание";

/** Длина цикла по типу, недель. [литература] — см. часть B спеки; 5k и marathon по аналогии. */
export const LENGTH_WEEKS: Record<CycleIntent, number> = {
  "5k": 11, "10k": 14, half: 16, marathon: 18, maintenance: 8,
};

/**
 * ШАГ РОСТА НЕДЕЛИ — ПЛАВНЫЙ, НЕ ПРЕДЕЛЬНЫЙ.
 *
 * 1.22 — это p90 ОДНОГО перехода [практика, n=1715], то есть «максимум, который бывает»,
 * а не темп, который держат неделя за неделей: медиана перехода 0.99. Когда 1.22 работало
 * темпом, аэробный упирался в потолок (база ×1.25) на ПЕРВОЙ же неделе, и рычага «рост
 * объёмом» не оказалось ни у кого из двенадцати — вместо двух рычагов получилось полтора.
 *
 * Теперь шаг +6% [решение Игоря, середина названного диапазона 5-7%], и цикл доходит
 * до своего потолка за несколько недель, а не прыжком.
 */
export const STEP_AEROBIC = 1.06;
export const STEP_QUALITY = 1.06;

/**
 * ПРЕДЕЛ ОДНОГО ПЕРЕХОДА. Ни один шаг цикла — включая возврат после разгрузки и добор
 * до потолка — не может превысить эту величину [практика, p90 от нормальной базы, n=1715].
 * Это страховка, а не темп: рабочий темп задаётся STEP_* выше.
 */
export const MAX_SINGLE_STEP = 1.22;

/** Период плановой разгрузки. [практика] — медианный период между спадами 4.0 нед, n=16. */
export const DELOAD_EVERY_N = 4;

/**
 * ПЛАНОВАЯ разгрузка [решение Игоря]. НОВОЕ ПОВЕДЕНИЕ: в практике такой недели нет.
 * Аэробный −20%, минуты работы −30%, день НЕ убирается, качество НЕ снимается.
 * Не путать с РЕАКТИВНОЙ (health-сигнал / провал): та снимает качество в ноль,
 * режет аэробный на 36% и убирает день [практика, n=16 атлетов / 90 недель].
 */
export const DELOAD_AEROBIC_FACTOR = 0.80;
/**
 * РАЗГРУЗКА СИММЕТРИЧНА: работа режется на столько же, на сколько объём [решение Игоря].
 *
 * Было −30% при аэробном −20%, и разгрузка била по качеству сильнее, чем по объёму:
 * у Богачева доля качества падала до 7.0% при его обычных 9.4%. Это противоречило
 * и самому решению Игоря («качество не снимаем, просто мягче»), и литературе
 * (в разгрузку интенсивность не трогают, режут объём — мета-анализ Bosquet, см. часть B
 * спеки ops-log/2026-08-11-training-cycle-model.md).
 *
 * «Потише» обеспечивают ДРУГИЕ два рычага, они остаются: формат на шаг короче
 * и темп отрезков на ступень мягче. Доля качества при этом стоит на месте.
 */
export const DELOAD_QUALITY_FACTOR = 0.80;

/**
 * ПОДВОДКА — профиль по неделям от предстартового ПИКА. Все числа [решение Игоря],
 * практикой НЕ подтверждаются и глубже неё.
 *
 * Форма ЭКСПОНЕНЦИАЛЬНАЯ: срез нарастает к старту. Неизменно на всех дистанциях —
 * интенсивность сохраняется (темпы те же, режется число минут работы), число беговых
 * дней не уменьшается, объём режется за счёт лёгких и длительной.
 *
 * ФАКТ ПРАКТИКИ ДЛЯ СВЕРКИ [практика], главные старты, неделя −1 от пика:
 *   42.2 −32% (n=12) · 21.1 −15% (n=36) · 10 км +3%, подводки нет (n=13) · 5 км n=2, нечем.
 */
export type TaperWeek = { weeksOut: number; aerobicFactor: number; qualityMinutesFactor: number };
export const TAPER_PROFILE: Record<CycleIntent, TaperWeek[]> = {
  // 5–7 дней: одна неделя, почти весь срез в последние 3 дня
  "5k": [{ weeksOut: 1, aerobicFactor: 0.80, qualityMinutesFactor: 0.75 }],
  // 7–10 дней: одна неделя с более глубоким срезом, основное в последние 4 дня
  "10k": [{ weeksOut: 1, aerobicFactor: 0.75, qualityMinutesFactor: 0.70 }],
  // 10–14 дней: две недели, −20% затем −35%
  half: [
    { weeksOut: 2, aerobicFactor: 0.80, qualityMinutesFactor: 0.85 },
    { weeksOut: 1, aerobicFactor: 0.65, qualityMinutesFactor: 0.65 },
  ],
  // 14–17 дней: три недели, −15% / −35% / −50%
  marathon: [
    { weeksOut: 3, aerobicFactor: 0.85, qualityMinutesFactor: 0.90 },
    { weeksOut: 2, aerobicFactor: 0.65, qualityMinutesFactor: 0.75 },
    { weeksOut: 1, aerobicFactor: 0.50, qualityMinutesFactor: 0.55 },
  ],
  maintenance: [],
};

/**
 * ПОСЛЕДНЯЯ ЗАЩИТА, НЕ РАБОЧИЙ ПРЕДЕЛ. Доля работы в неделе не выше 0.20
 * [практика, p90 по ростеру, n=1132]. Это КОГОРТНОЕ число: оно годится, чтобы
 * поймать выброс, но не годится как личный потолок. Рабочий предел качества —
 * личный (peakCapQualityMin).
 */
export const WORK_SHARE_MAX = 0.20;

/**
 * НАСКОЛЬКО ЦИКЛУ ПОЗВОЛЕНО ВЫЙТИ ЗА СОБСТВЕННЫЙ ИСТОРИЧЕСКИЙ МАКСИМУМ.
 * Оба числа [решение Игоря]; берётся МЕНЬШЕЕ из двух.
 *
 * ЗАЧЕМ ДВА. Жёсткий исторический максимум запрещал прогрессию структурно: у Богачева
 * максимум 376 при базе 349, то есть цикл мог дать ему +8% и упирался. Но и один
 * множитель к максимуму опасен: у того, кто когда-то сделал одну огромную неделю,
 * максимум сильно оторван от базы, и ×1.10 к нему увёл бы далеко от его нынешней формы.
 * Поэтому второй ограничитель — от БАЗЫ, то есть от того, чем человек живёт сейчас.
 */
export const PEAK_OVER_HISTORIC_MAX = 1.10;
export const PEAK_OVER_BASE_MAX = 1.25;

/**
 * ПОТОЛОК ОТ НОРМЫ ДО МАКСИМУМА: норма + половина расстояния до максимума
 * [решение Игоря].
 *
 * ЗАЧЕМ. Исторический максимум оказался слишком щедрым пределом: у Пономаревой максимум
 * работы 60 мин при норме 20, и цикл уводил её долю качества с 9.1% до 15.3% — прежний
 * когортный перекос вернулся в личной обёртке. Максимум — это ОДНА, возможно случайная
 * неделя; норма — то, что человек несёт постоянно. Половина расстояния между ними —
 * компромисс: у Пономаревой 20 -> 40, а не 20 -> 60.
 */
export const CAP_BETWEEN_BASE_AND_MAX = 0.5;
export const capBetween = (base: number, max: number): number =>
  Math.round((base + (Math.max(max, base) - base) * CAP_BETWEEN_BASE_AND_MAX) / 5) * 5;

/**
 * ПОДВОДКА БЕЗ ПИКА. Если в цикле не было ни одной недели роста, пика нет: усталость
 * не копилась, и сбрасывать нечего. Полный профиль (-25% и глубже) в таком случае просто
 * отнимает форму. Символический срез [решение Игоря].
 */
export const TAPER_NO_PEAK_FACTOR = 0.90;

/**
 * ПОТОЛОК ПО ДОЛЕ, А НЕ ПО МИНУТАМ. Доля качества не уходит от личной обычной больше
 * чем на столько процентных пунктов НИ НА ОДНОЙ неделе цикла [решение Игоря].
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ПОТОЛКА МИНУТ. Личный потолок минут работы стоял, но не спасал:
 * у Пономаревой марафонская подводка режет аэробный ×0.50 против работы ×0.55, минуты
 * при этом ПАДАЮТ и потолка не касаются, а доля уезжает с 13.5% до 15.5%. Минуты и доля —
 * разные величины, и ограничивать надо ту, которая уезжает.
 *
 * При упоре режутся МИНУТЫ РАБОТЫ, а не добавляется аэробный объём: объём недели задан
 * ролью недели (рост/разгрузка/подводка), и подтягивать его ради доли значило бы ломать
 * смысл этой роли.
 */
export const MAX_SHARE_DEVIATION_PP = 2.0;

/**
 * Прижать минуты работы так, чтобы доля не ушла от обычной больше допустимого.
 * Возвращает исправленные минуты и пометку, если пришлось вмешаться.
 */
export function clampShare(
  aerobicMin: number,
  qualityMin: number,
  ownSharePct: number,
  capQualityMin: number,
): { q: number; note: string | null } {
  const total = aerobicMin + qualityMin;
  if (total <= 0) return { q: qualityMin, note: null };
  const share = 100 * qualityMin / total;
  const hi = ownSharePct + MAX_SHARE_DEVIATION_PP;
  const lo = Math.max(0, ownSharePct - MAX_SHARE_DEVIATION_PP);
  // q такое, что q/(a+q) = s  =>  q = s·a/(1−s)
  // ВНИЗ, а не к ближайшему: округление к пяти само выводило за допуск
  // (у Пономаревой оставалось 2.1 п.п. при пороге 2.0).
  const qFor = (sPct: number, dir: "down" | "up"): number => {
    const s = sPct / 100;
    if (s >= 1) return qualityMin;
    const raw = (s * aerobicMin) / (1 - s);
    return (dir === "down" ? Math.floor(raw / 5) : Math.ceil(raw / 5)) * 5;
  };
  if (share > hi) {
    const q = Math.min(qualityMin, qFor(hi, "down"));
    return { q, note: `работа срезана до ${q} мин: доля упиралась в +${MAX_SHARE_DEVIATION_PP} п.п. к обычной` };
  }
  if (share < lo) {
    // мирроринг вверх, но не выше личного потолка минут
    const q = Math.min(capQualityMin, Math.max(qualityMin, qFor(lo, "up")));
    return q > qualityMin
      ? { q, note: `работа поднята до ${q} мин: доля проваливалась ниже −${MAX_SHARE_DEVIATION_PP} п.п.` }
      : { q: qualityMin, note: null };
  }
  return { q: qualityMin, note: null };
}

/** Каким рычагом идёт рост на неделе — для прогноза. */
export type GrowthLever = "аэробный" | "качество" | "оба" | "упёрлись";

export type CycleDraft = {
  athleteId: number;
  intent: CycleIntent;
  targetRaceId: string | null;
  targetDate: string | null;
  lengthWeeks: number;
  baseAerobicMin: number;
  baseQualityMin: number;
  stepAerobic: number;
  stepQuality: number;
  deloadEveryN: number;
  deloadDepthAerobic: number;
  deloadQualityFactor: number;
  taperProfile: TaperWeek[];
  days: number;
  /**
   * ПОТОЛОК АЭРОБНОГО ОБЪЁМА, мин/нед. Собственный исторический максимум атлета
   * за окно наблюдения [практика].
   *
   * ЗАЧЕМ. Шаг ×1.22 — это ПОТОЛОК ОДНОГО перехода [практика, p90, n=1715], а не темп,
   * который держат неделя за неделей: медиана перехода 0.99, а рост за 26 недель
   * вообще ×1.01 [практика, n=93]. Если применять 1.22 каждую неделю, за пять недель
   * выходит ×2.2 — первый прогон черновика дал атлету 775 мин/нед вместо 350, то есть
   * 13 часов бега. Выход за собственный исторический максимум — это решение тренера,
   * а не следствие арифметики, поэтому цикл сам туда не идёт.
   */
  peakCapAerobicMin: number;
  /**
   * Сырой собственный максимум аэробной недели за окно [практика].
   * Отдельно от peakCapAerobicMin: потолок цикла считается ОТ него, но им не равен —
   * циклу разрешён ограниченный выход выше (PEAK_OVER_HISTORIC_MAX / PEAK_OVER_BASE_MAX).
   * Нужен ещё и для пометки в прогнозе «неделя выше исторического максимума».
   */
  historicMaxAerobicMin: number;
  /**
   * ПОТОЛОК КАЧЕСТВЕННЫХ МИНУТ, мин работы/нед. Собственный исторический максимум
   * атлета за окно наблюдения [практика].
   *
   * ЗАЧЕМ. До 11.08 качество ограничивалось только долей работы ≤20% недели — это p90
   * ПО РОСТЕРУ [практика, n=1132], то есть чужое число в роли личного предела. У Богачева
   * собственная доля 9.4%, а прогноз вёл его к 16% (60 мин работы против базовых 35).
   * Та же ошибка уже была с полосой лёгкого и с длиной сессий: когортное вместо личного.
   * Теперь рабочий предел — личный, а когортные 20% остались ПОСЛЕДНЕЙ защитой.
   */
  peakCapQualityMin: number;
  /** сырой личный максимум минут работы — от него считается потолок, показывается для сверки */
  historicMaxQualityMin: number;
  /** каким был бы аэробный потолок, если брать его просто от максимума — для проверки перекоса */
  aerobicIfFromMax: number;
  /** выбранный период полураспада, дн — 42 у стабильного, короче у растущего */
  halfLifeDays: number;
  /** база при фиксированных 42 днях — для сравнения в отчёте */
  base42Aerobic: number;
  /** наклон недельного аэробного, мин/нед */
  slopeMinPerWeek: number;
  /** личная обычная доля качества, % — от неё считается допуск отклонения */
  ownSharePct: number;
  /** база, заданная тренером вручную (null — считается из истории) */
  baseAerobicManual: number | null;
  baseQualityManual: number | null;
  baseManualReason: string | null;
  /** база, посчитанная из истории — показывается рядом с ручной для сверки */
  baseAerobicComputed: number;
  baseQualityComputed: number;
  /** прежняя база за 8 недель — только для сравнения в отчёте */
  base8Aerobic: number;
  base8Quality: number;
  /** сколько недель выброшено как больные */
  illWeeks: number;
  /** чего не хватило, чтобы черновик был полным */
  gaps: string[];
};

/** Дистанция старта → тип цикла. [выведено] — границы те же, что в замерах подводки. */
export function intentFromDistance(km: number | null): CycleIntent {
  if (km == null) return "maintenance";
  if (km < 7) return "5k";
  if (km < 15) return "10k";
  if (km < 30) return "half";
  return "marathon";
}

/**
 * СТАРТ БЛИЖЕ ЭТОГО СРОКА ЦЕЛЕВЫМ БЫТЬ НЕ МОЖЕТ, недель. [решение Игоря 13.08]
 *
 * Под старт через неделю цикл уже не построить: он бежится по ходу, а цикл строится на
 * следующий. Без этого правила у 6290336 цикл строился на старт ЧЕРЕЗ ДВА ДНЯ — формально
 * верно, практически бессмысленно.
 */
export const TARGET_RACE_MIN_WEEKS = 2;

export type RaceLike = { id: string; event_date: string; distance_km: number | null };

/**
 * ВЫБОР ЦЕЛЕВОГО СТАРТА: ГЛАВНЫЙ, А НЕ БЛИЖАЙШИЙ. [решение Игоря 13.08]
 *
 * ЗАЧЕМ. До 13.08 бралась просто ближайшая строка race_events. Пока мелких стартов в базе не
 * было, это совпадало с главным; после починки скана стало хуже у четверых: у 5475652 марафон
 * 01.11 подменился десяткой 26.09, у 6290336 цикл поехал на старт через два дня.
 *
 * Три правила:
 *   1) ближе TARGET_RACE_MIN_WEEKS — не цель вообще;
 *   2) горизонт выбора — ТИПОВАЯ ДЛИНА ЦИКЛА ПОД САМУ ЭТУ ДИСТАНЦИЮ: марафон за 18 недель
 *      целью быть может, десятка за 18 недель — нет, ей столько не готовятся;
 *   3) среди прошедших фильтр ДЛИННАЯ ДИСТАНЦИЯ БЬЁТ КОРОТКУЮ, при равной — более ранняя.
 *
 * Старт без дистанции целью не берётся: тип цикла из него не вывести, а угадывать нельзя.
 */
export function pickTargetRace<T extends RaceLike>(races: T[], mondayToday: string): T | null {
  const weeksTo = (d: string): number => Math.round((Date.parse(d) - Date.parse(mondayToday)) / (7 * 86400000));
  const eligible = races
    .filter((r) => r.distance_km != null)
    .map((r) => ({ r, w: weeksTo(r.event_date) }))
    .filter((x) => x.w >= TARGET_RACE_MIN_WEEKS && x.w <= LENGTH_WEEKS[intentFromDistance(x.r.distance_km)]);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) =>
    (b.r.distance_km ?? 0) - (a.r.distance_km ?? 0) || a.r.event_date.localeCompare(b.r.event_date));
  return eligible[0].r;
}

export type WeekForecast = {
  index: number;
  weekStart: string;
  role: WeekRole;
  aerobicMin: number;
  qualityMin: number;
  days: number;
  /** какой формат качества закрывает эти минуты работы — подсказка, не предписание */
  qualityHint: string;
  /** доля работы в неделе, % — Игорь смотрит, не уехала ли она от его обычной */
  qualitySharePct: number;
  /** чем растём на этой неделе; на разгрузке и подводке не заполняется */
  lever: GrowthLever | null;
  note: string;
};

const round5 = (x: number): number => Math.round(x / 5) * 5;
const addDays = (s: string, n: number): string => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);

/**
 * Подобрать формат отрезков под минуты работы. Только ПОДСКАЗКА для прогноза:
 * настоящий выбор делает каталог при сборке недели, с гейтами и уровнем пресета.
 * Коды взяты из реального каталога workout_template_presets [практика].
 */
export function qualityFormatHint(workMin: number): string {
  if (workMin <= 0) return "—";
  const catalog: Array<[number, string]> = [
    [20, "4x5"], [20, "5x4"], [24, "3x8"], [24, "6x4"], [30, "5x6"], [30, "6x5"],
    [32, "4x8"], [32, "8x4"], [35, "5x7"], [36, "4x9"], [36, "6x6"], [40, "4x10"],
    [36, "3x12"], [42, "3x14"], [48, "3x16"], [48, "4x12"], [40, "2x20"], [48, "2x24"],
  ];
  let best = catalog[0];
  for (const c of catalog) if (Math.abs(c[0] - workMin) < Math.abs(best[0] - workMin)) best = c;
  return `${best[1]} (${best[0]} мин работы)`;
}

/**
 * Развернуть цикл в недели — ДЛЯ ОТОБРАЖЕНИЯ. Ни к чему не обязывает и в TP не пишется:
 * роль недели пересчитывается при сборке с учётом того, как прошла предыдущая (C2),
 * а реактивная разгрузка может понизить любую неделю в любой момент.
 */
export function forecast(draft: CycleDraft, firstWeekStart: string, weeks: number): WeekForecast[] {
  const out: WeekForecast[] = [];
  let aer = draft.baseAerobicMin;
  let qual = draft.baseQualityMin;
  // ПИК — максимум РЕАЛЬНО НАЗНАЧЕННЫХ недель роста, а не то, куда ушла бы арифметика,
  // если бы рост продолжался: подводка может начаться раньше, чем рост дойдёт до цифры.
  let peakAer = 0;
  // Аэробный объём ПРЕДЫДУЩЕЙ ПОКАЗАННОЙ недели. Нужен, чтобы предел одного перехода
  // работал на том, что видит тренер, а не на внутренней переменной роста: после
  // разгрузки цикл возвращался к дореразгрузочному уровню одним прыжком (330 -> 415,
  // то есть x1.26 при заявленном пределе x1.22 — страховка не срабатывала).
  let prevShownAer = 0;
  let prevShownQual = 0;
  // Уровень последней недели РОСТА до плановой разгрузки. После неё разрешён возврат
  // ровно на него — без шага и без предела перехода: разгрузка ПЛАНОВАЯ, форму человек
  // не терял, и заставлять его отыгрывать её ×1.22 неверно (у Богачева получалось
  // 310 -> 375 при том, что до разгрузки было 390). Предел остаётся для роста
  // и для реактивных случаев.
  let preDeloadAer = 0;
  let preDeloadQual = 0;
  let returningFromDeload = false;

  const taperLen = draft.taperProfile.length;
  const weeksToRace = draft.targetDate
    ? Math.round((Date.parse(draft.targetDate) - Date.parse(firstWeekStart)) / (7 * 86400000))
    : null;

  // РАЗМЕЩЕНИЕ ПЛАНОВОЙ РАЗГРУЗКИ С УЧЁТОМ ПОДВОДКИ.
  // Раньше разгрузка стояла по остатку от деления (i % deloadEveryN), и при коротком
  // горизонте её либо не было вовсе (у полумарафонца на 5 недель — ни одной), либо она
  // упиралась в подводку. Теперь недели разгрузки считаются заранее: от конца ростовой
  // части назад с шагом deloadEveryN, и между разгрузкой и подводкой оставляется
  // минимум одна полноценная неделя роста.
  const MIN_GROWTH_BETWEEN_DELOAD_AND_TAPER = 1;
  const deloadWeeks = new Set<number>();
  if (draft.intent !== "maintenance") {
    // последняя неделя, на которой ещё может стоять разгрузка
    const lastGrowthIdx = weeksToRace == null
      ? weeks
      : weeksToRace - taperLen;                       // неделя перед началом подводки
    const lastAllowed = lastGrowthIdx - MIN_GROWTH_BETWEEN_DELOAD_AND_TAPER;
    for (let k = lastAllowed; k >= 2; k -= draft.deloadEveryN) {
      if (k <= weeks) deloadWeeks.add(k);
    }
  }

  for (let i = 1; i <= weeks; i++) {
    const weekStart = addDays(firstWeekStart, 7 * (i - 1));
    const out2go = weeksToRace == null ? null : weeksToRace - (i - 1);
    const share = (a: number, q: number): number => (a + q > 0 ? Math.round(1000 * q / (a + q)) / 10 : 0);

    if (out2go === 0) {
      out.push({ index: i, weekStart, role: "старт", aerobicMin: 0, qualityMin: 0, days: draft.days,
        qualityHint: "—", qualitySharePct: 0, lever: null, note: `целевой старт ${draft.targetDate}` });
      continue;
    }
    if (out2go != null && out2go >= 1 && out2go <= taperLen) {
      const tw = draft.taperProfile.find((t) => t.weeksOut === out2go);
      if (tw) {
        // ПОДВОДКА БЕЗ ПИКА. Роста не было — усталость не копилась, сбрасывать нечего.
        // Полный профиль тут просто отнял бы форму, поэтому срез символический.
        const noPeak = peakAer === 0;
        const from = noPeak ? draft.baseAerobicMin : peakAer;
        const aF = noPeak ? TAPER_NO_PEAK_FACTOR : tw.aerobicFactor;
        const qF = noPeak ? TAPER_NO_PEAK_FACTOR : tw.qualityMinutesFactor;
        const a = round5(from * aF);
        // Доля в подводке растёт намеренно (объём режется, интенсивность держим),
        // но не больше допуска: минуты работы не выше личного потолка И доля не дальше
        // MAX_SHARE_DEVIATION_PP от обычной.
        const qRaw = round5(Math.min(qual * qF, draft.peakCapQualityMin));
        const cl = clampShare(a, qRaw, draft.ownSharePct, draft.peakCapQualityMin);
        const q = cl.q;
        out.push({ index: i, weekStart, role: "подводка", aerobicMin: a, qualityMin: q, days: draft.days,
          qualityHint: qualityFormatHint(q), qualitySharePct: share(a, q), lever: null,
          note: noPeak
            ? `ПОДВОДКА ОТ БАЗЫ, ПИКА НЕ БЫЛО: ×${aF.toFixed(2)} символически — роста не было, сбрасывать нечего`
            : `от ПИКА ${from} мин: аэробный ×${aF.toFixed(2)}, работа ×${qF.toFixed(2)}`
              + ` · темпы отрезков ТЕ ЖЕ, дней столько же` + (cl.note ? ` · ${cl.note}` : "") });
        continue;
      }
    }
    if (deloadWeeks.has(i)) {
      // Режем от ПОКАЗАННОЙ прошлой недели, а не от внутренней переменной роста.
      // Иначе заявленные −20% превращались в −15%: у Богачева 390 -> 330, потому что
      // внутри переменная уже ушла на 413. Тренер видит одно, объявлено другое.
      const fromA = prevShownAer > 0 ? prevShownAer : aer;
      const fromQ = prevShownQual > 0 ? prevShownQual : qual;
      const a = round5(fromA * draft.deloadDepthAerobic);
      const qRawD = round5(fromQ * draft.deloadQualityFactor);
      const clD = clampShare(a, qRawD, draft.ownSharePct, draft.peakCapQualityMin);
      const q = clD.q;
      out.push({ index: i, weekStart, role: "плановая разгрузка", aerobicMin: a, qualityMin: q, days: draft.days,
        qualityHint: qualityFormatHint(q), qualitySharePct: share(a, q), lever: null,
        note: `аэробный ×${draft.deloadDepthAerobic.toFixed(2)}, работа ×${draft.deloadQualityFactor.toFixed(2)}`
          + ` · день НЕ убран, качество НЕ снято, темп на ступень мягче` + (clD.note ? ` · ${clD.note}` : "") });
      prevShownAer = a; prevShownQual = q;
      returningFromDeload = true;
      continue;
    }
    if (draft.intent === "maintenance") {
      const a = round5(aer);
      const q = clampShare(a, round5(qual), draft.ownSharePct, draft.peakCapQualityMin).q;
      out.push({ index: i, weekStart, role: "поддержание", aerobicMin: a, qualityMin: q, days: draft.days,
        qualityHint: qualityFormatHint(q), qualitySharePct: share(a, q), lever: null,
        note: "шаг ×1.00 — поддержание, не прогрессия" });
      continue;
    }

    // ── РОСТ. ДВА РЫЧАГА ──
    // Когда аэробный упёрся в личный потолок, рост НЕ останавливается: дальше растёт
    // качество, пока не упрётся в свой личный потолок. У Богачева это единственный
    // доступный рычаг — самый большой объём в группе при самой низкой доле работы.
    // ВОЗВРАТ ПОСЛЕ ПЛАНОВОЙ РАЗГРУЗКИ ИДЁТ БЕЗ ШАГА И БЕЗ ПРЕДЕЛА ПЕРЕХОДА.
    // Разгрузка ПЛАНОВАЯ, форму человек не терял, и заставлять его отыгрывать её
    // по ×1.22 неверно: у Богачева получалось 310 -> 375 при том, что до разгрузки
    // было 415. Предел остаётся для обычного роста и для реактивных случаев.
    const ceilStep = returningFromDeload || prevShownAer <= 0 ? Infinity : prevShownAer * MAX_SINGLE_STEP;
    // Возврат идёт РОВНО на уровень последней недели роста, БЕЗ шага: шаг возобновляется
    // со следующей недели. Первая версия брала max(aer, preDeload), где aer уже включал
    // шаг, и неделя возврата выходила ВЫШЕ дореразгрузочной (355 -> 380 вместо 355).
    // Поймано проверкой чисел, а не глазами.
    const aerWanted = returningFromDeload && preDeloadAer > 0 ? preDeloadAer : aer;
    const qualWanted = returningFromDeload && preDeloadQual > 0 ? preDeloadQual : qual;
    // когда связывает предел перехода — округляем ВНИЗ, иначе округление к пяти
    // само по себе выводит за предел (330 x1.22 = 402.6, а round5 даёт 405 = x1.227)
    const a = aerWanted > ceilStep ? Math.floor(ceilStep / 5) * 5 : round5(Math.min(aerWanted, draft.peakCapAerobicMin));
    const qBeforeClamp = round5(Math.min(qualWanted, draft.peakCapQualityMin));
    const clG = clampShare(a, qBeforeClamp, draft.ownSharePct, draft.peakCapQualityMin);
    const q = clG.q;
    // после возврата внутренняя переменная встаёт РОВНО на показанный уровень,
    // чтобы следующий шаг пошёл от него, а не от «догнавшей» арифметики
    if (returningFromDeload) { aer = a; qual = q; }
    returningFromDeload = false;
    const aerRoom = a < draft.peakCapAerobicMin;
    const qualRoom = q < draft.peakCapQualityMin && q < (a + q) * WORK_SHARE_MAX;
    const lever: GrowthLever = aerRoom && qualRoom ? "оба" : aerRoom ? "аэробный" : qualRoom ? "качество" : "упёрлись";
    const overHist = a > draft.historicMaxAerobicMin;
    const notes: string[] = [];
    if (lever === "оба") notes.push(`шаг ×${draft.stepAerobic.toFixed(2)} / ×${draft.stepQuality.toFixed(2)}`);
    else if (lever === "аэробный") notes.push(`качество на личном потолке ${draft.peakCapQualityMin} мин — растём объёмом`);
    else if (lever === "качество") notes.push(`аэробный на потолке ${draft.peakCapAerobicMin} мин — растём качеством`);
    else notes.push(`оба на потолке — дальше только решением тренера`);
    if (overHist) notes.push(`ВЫШЕ исторического максимума ${draft.historicMaxAerobicMin} мин`);
    if (clG.note) notes.push(clG.note);
    out.push({ index: i, weekStart, role: "рост", aerobicMin: a, qualityMin: q, days: draft.days,
      qualityHint: qualityFormatHint(q), qualitySharePct: share(a, q), lever, note: notes.join(" · ") });

    peakAer = Math.max(peakAer, a);
    prevShownAer = a; prevShownQual = q;
    preDeloadAer = a; preDeloadQual = q;
    // Страховка: ни один переход не превышает предел одного шага [практика, p90, n=1715].
    // Обычный шаг (+6%) её и близко не касается — она ловит добор к потолку после разгрузки.
    if (aerRoom) aer = Math.min(aer * Math.min(draft.stepAerobic, MAX_SINGLE_STEP), draft.peakCapAerobicMin);
    if (qualRoom) qual = Math.min(qual * Math.min(draft.stepQuality, MAX_SINGLE_STEP), draft.peakCapQualityMin);
  }
  return out;
}
