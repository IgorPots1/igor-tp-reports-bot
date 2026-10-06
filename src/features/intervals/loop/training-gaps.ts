/**
 * Перерывы и выполнение: чем факт отличается от плана.
 *
 * ── ЗАЧЕМ ЭТО ПОЯВИЛОСЬ ──────────────────────────────────────────────────────
 *
 * Сегмент без часов отдавал генератору три нуля и одно «false»:
 * `notRunningWeeks: 0`, `lowComplianceWeeks: 0`, `complianceRatio: null` в
 * адаптере и `hasActiveIllness: false` жёстко в вызове buildWeek. Объяснение в
 * коде было такое: «плановых величин нет вообще, человеку никто не назначал
 * недели». Это было верно до 20.09.2026, когда появились отданные недели. После
 * — перестало: план есть, выполнение считается, а генератор по-прежнему слышал
 * нули и строил человеку недели от здорового периода.
 *
 * Чем это кончилось у живой ученицы: она болела 1–5 октября и пропустила две
 * тренировки, а лестница форматов шагнула вперёд, как будто неделя прошла
 * нормально. Держал ступень на месте случайный признак (боль из чек-ина 30
 * сентября), не перерыв.
 *
 * ── ЧЕГО ЗДЕСЬ НЕТ ───────────────────────────────────────────────────────────
 *
 * Решения о ступени лестницы. Этот модуль ИЗМЕРЯЕТ (сколько пропущено, сколько
 * дней без бега, какое выполнение), а что с этим делать — отдельное правило с
 * отдельными порогами, и его числа назначает тренер. Смешивать измерение с
 * решением нельзя: пороги меняются, измерение нет.
 */

/**
 * Порог «фактически не тренируется». ЗНАЧЕНИЕ ПОВТОРЯЕТ РОСТЕР
 * (tools/trainingpeaks-export/scripts/lib/autoplanner-context.ts), потому что
 * src из tools не импортирует: разные tsconfig, и тащить сборочный слой в
 * приложение ради одного числа дороже, чем повторить его.
 *
 * ЧТОБЫ КОПИЯ НЕ РАЗОШЛАСЬ МОЛЧА, равенство двух чисел проверяет
 * `npm run check:training-gaps`: он импортирует оба и падает при расхождении.
 * Без такой проверки копия живёт правильной ровно до первой правки оригинала.
 */
export const NOT_RUNNING_RATIO = 0.4;

/** Неделя плана рядом с тем, что человек реально сделал. */
export type WeekFact = {
  /** Понедельник недели, ГГГГ-ММ-ДД. */
  weekStart: string;
  /** Сумма минут запланированных тренировок. 0 — недели в плане не было. */
  plannedMin: number;
  /** Сумма минут реальных пробежек. */
  actualMin: number;
  /** Сколько пробежек было. Отличает «мало бегал» от «не бегал». */
  runs: number;
};

/**
 * ДНЕЙ БЕЗ БЕГА — ОТ ПОСЛЕДНЕЙ ПРОБЕЖКИ ДО НАЗВАННОГО ДНЯ, НЕ ВКЛЮЧАЯ ЕГО.
 *
 * Пробежек нет вообще — возвращаем null, а не большое число: «никогда не бегал»
 * и «давно не бегал» это разные вещи, и выдавать первое за второе значит
 * откатывать ступень новичку, у которого ступени ещё нет.
 */
export function daysSinceLastRun(input: { runDates: string[]; asOfIso: string }): number | null {
  const before = input.runDates.filter((date) => date < input.asOfIso).sort();
  const last = before[before.length - 1];
  if (last === undefined) return null;
  return Math.round(
    (Date.parse(`${input.asOfIso}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000
  );
}

/**
 * ПРОПУЩЕНО ПОДРЯД — В ПЛАНОВЫХ ТРЕНИРОВКАХ, А НЕ В ДНЯХ.
 *
 * ПОЧЕМУ НЕ В ДНЯХ, ХОТЯ В ДНЯХ ПОНЯТНЕЕ. У Валентины настоящие промежутки
 * между пробежками 3, 3 и 4 дня. Правило «четыре дня без бега значат перерыв»
 * срабатывало бы на её ОБЫЧНОМ ритме и держало ступень всегда. А у человека,
 * который бегает шесть раз в неделю, те же четыре дня — настоящий провал.
 * Дни сами по себе не значат ничего, пока не известна частота; плановая
 * тренировка — единица, уже нормированная на человека.
 *
 * День считается пропущенным, если он был в плане, а в нём нет ни пробежки, ни
 * отметки. Отметка без пробежки тоже закрывает день: человек мог пробежать и не
 * записать цифры, и это не пропуск.
 *
 * Счёт идёт НАЗАД от названного дня и обрывается на первом закрытом: нас
 * интересует свежая серия, а не сумма пропусков за историю.
 */
export function missedPlannedStreak(input: {
  plannedDates: string[];
  runDates: string[];
  checkinDates: string[];
  asOfIso: string;
}): number {
  const runs = new Set(input.runDates);
  const checkins = new Set(input.checkinDates);
  const planned = [...new Set(input.plannedDates)].filter((date) => date < input.asOfIso).sort().reverse();
  let streak = 0;
  for (const date of planned) {
    if (runs.has(date) || checkins.has(date)) break;
    streak += 1;
  }
  return streak;
}

/**
 * Выполнение по завершённым неделям: то, чего адаптер отдавать отказывался.
 *
 * СЧИТАЕМ ТОЛЬКО ПО НЕДЕЛЯМ, У КОТОРЫХ БЫЛ ПЛАН. Неделя без плана не «не
 * выполнена» — её просто не назначали, и делить на ноль тут значит выдумать
 * провал. Такие недели серию не рвут и не продолжают, ровно как день без
 * тренировки в счётчике пропусков у раннера напоминаний.
 */
export function weekCompliance(weeks: WeekFact[]): {
  rolling4wPlannedMin: number;
  rolling4wActualMin: number;
  lastWeekPlannedMinutes: number;
  typicalPlannedWeekMin: number;
  complianceRatio: number | null;
  notRunningWeeks: number;
} {
  const planned = [...weeks].filter((week) => week.plannedMin > 0).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const last4 = planned.slice(-4);
  const plannedSum = last4.reduce((sum, week) => sum + week.plannedMin, 0);
  const actualSum = last4.reduce((sum, week) => sum + week.actualMin, 0);

  /**
   * «НЕ БЕГАЕТ» СЧИТАЕТСЯ НАЗАД И ОБРЫВАЕТСЯ НА ПЕРВОЙ НОРМАЛЬНОЙ НЕДЕЛЕ —
   * порог и смысл те же, что у ростера (NOT_RUNNING_RATIO): недовыполнение
   * около 80 % объём не режет, план и так с запасом; ниже 40 % несколько недель
   * подряд означает, что человек фактически не тренируется.
   */
  let notRunningWeeks = 0;
  for (const week of [...planned].reverse()) {
    if (week.actualMin / week.plannedMin >= NOT_RUNNING_RATIO) break;
    notRunningWeeks += 1;
  }

  const typical = planned.length > 0
    ? Math.round(
        [...planned.map((week) => week.plannedMin)].sort((a, b) => a - b)[Math.floor(planned.length / 2)]
      )
    : 0;

  return {
    rolling4wPlannedMin: plannedSum,
    rolling4wActualMin: actualSum,
    lastWeekPlannedMinutes: planned[planned.length - 1]?.plannedMin ?? 0,
    typicalPlannedWeekMin: typical,
    complianceRatio: plannedSum > 0 ? actualSum / plannedSum : null,
    notRunningWeeks,
  };
}

/**
 * Средний недельный объём ПО ФАКТУ за последние недели.
 *
 * ЭТО НЕ ТО ЖЕ, ЧТО ЧИСЛО ИЗ АНКЕТЫ. У Валентины в анкете стояло 185 мин/нед
 * (его ставил тренер по рукописным карточкам), а по факту выходило 71. От
 * анкетного числа считаются тир и личные пол/цель/потолок лёгкой — то есть
 * ошибка в одном поле расходится по всей форме недели.
 */
export function actualWeeklyMedian(weeks: WeekFact[]): number | null {
  const values = weeks.filter((week) => week.plannedMin > 0 || week.actualMin > 0).map((week) => week.actualMin);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
