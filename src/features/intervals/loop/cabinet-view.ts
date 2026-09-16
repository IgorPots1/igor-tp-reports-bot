/**
 * Личный кабинет: то, что уже лежит в базе и раньше нигде не показывалось.
 *
 * ГРАНИЦА НАРЯДА [16.09.2026]: чистая сборка из уже загруженных строк — ни
 * запросов, ни решений о том, КАК тренировать. Решения здесь ровно одни:
 * какой блок показать пустым НЕЛЬЗЯ (см. каждую функцию ниже).
 *
 * ПУСТЫХ БЛОКОВ НЕ БЫВАЕТ. Каждый блок — null, если данных недостаточно,
 * чтобы он был содержательным, а не декоративным:
 *   - недель вместе — как только источник подключён (почти всегда есть);
 *   - неделя цикла — только пока цикл опубликован;
 *   - итоги (тренировок/минут) — только когда есть хотя бы один чек-ин:
 *     «0 тренировок, 0 минут» это ровно та пустая карточка, которую просили
 *     не показывать;
 *   - история — только когда есть хотя бы один чек-ин;
 *   - ступени — только у программы новичка (есть прогрессия) и с реальным
 *     переходом либо хотя бы одной тренировкой на текущей ступени.
 *
 * МИНУТЫ — ФАКТ, А НЕ ПЛАН [17.09.2026, правка после ревью Игоря]. Раньше
 * «минут набрано» суммировало minutes ПЛАНОВОЙ сессии — цифра выглядела
 * измеренной, а была намерением. checkin.activityId для факта не годится:
 * его пишет submitCheckin ОДИН РАЗ в момент чек-ина (service.ts), и если
 * тренировка из Intervals ещё не приехала — а обычно так и есть, человек
 * отмечается сразу после бега, синк идёт позже, — activityId навсегда
 * остаётся пустым, хотя тренировка потом придёт. Поэтому здесь НЕ читаем
 * checkin.activityId, а заново сопоставляем чек-ин с активностью ПО ДАТЕ на
 * момент открытия кабинета (actualMinutesByDate передаёт вызывающий) — это
 * тот же факт, который успел дойти к этому моменту, а не тот, что был готов
 * ровно во время чек-ина. Ручной ввод сюда попадает тем же путём:
 * submitManualEntry кладёт активность с тем же data_level='manual' и
 * настоящей self-reported длительностью — это тоже факт, а не хуже часов,
 * ровно так его уже трактует весь остальной продукт.
 *
 * Итог: minutesAccumulated считает ТОЛЬКО реально известные минуты; чек-ины
 * без совпавшей активности не увеличивают минуты, но остаются в счёте
 * тренировок (что тренировалась — факт сам по себе) и отдельно называются
 * (sessionsWithoutMeasuredMinutes), а не тонут молча в общей цифре.
 */

import { stepByIndex, BEGINNER_LADDER } from "@/features/methodology/beginner";

import { formatRuDay } from "./student-view";
import type { Checkin, PlanCycle, PlanSession, ProgressionState } from "./types";

export type CabinetHistoryEntry = {
  date: string;
  dateLabel: string;
  title: string;
  /** Реально измеренная длительность (часы или ручной ввод). null — неизвестна. */
  minutesActual: number | null;
  /** Сколько занимала ПЛАНОВАЯ сессия — только как честно подписанная альтернатива, когда факта нет. */
  minutesPlanned: number | null;
  effortLabel: string | null;
  pain: boolean;
  commentText: string | null;
};

export type CabinetLadderStep = {
  step: number;
  labelRu: string;
  sinceDateLabel: string;
};

export type CabinetView = {
  weeksTogether: number | null;
  cycleProgress: { currentWeek: number; totalWeeks: number } | null;
  totals: {
    sessionsCompleted: number;
    /** Сумма ТОЛЬКО реально известных минут. null — ни для одной тренировки минуты не известны. */
    minutesAccumulated: number | null;
    /** Сколько из отмеченных тренировок не имеют измеренной длительности — не прячем в общей сумме. */
    sessionsWithoutMeasuredMinutes: number;
  } | null;
  history: CabinetHistoryEntry[] | null;
  ladder: {
    currentLabelRu: string;
    nextLabelRu: string | null;
    /** Переходы, реально случившиеся: только там, где чек-ин их зафиксировал. */
    path: CabinetLadderStep[];
  } | null;
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function buildCabinetView(input: {
  todayIso: string;
  connectedAtIso: string | null;
  cycle: PlanCycle | null;
  progression: ProgressionState | null;
  /** Любой порядок — функция сама сортирует, где это важно. */
  checkins: Checkin[];
  sessionsById: Map<string, PlanSession>;
  /** Ключ — session_date (YYYY-MM-DD) чек-ина; значение — реальные минуты активности за этот день. */
  actualMinutesByDate: Map<string, number>;
}): CabinetView {
  const { todayIso, connectedAtIso, cycle, progression, checkins, sessionsById, actualMinutesByDate } = input;

  const weeksTogether = connectedAtIso
    ? Math.max(1, Math.floor(daysBetween(connectedAtIso.slice(0, 10), todayIso) / 7) + 1)
    : null;

  const cycleProgress =
    cycle && cycle.status === "published"
      ? {
          currentWeek: Math.min(
            cycle.lengthWeeks,
            Math.max(1, Math.floor(daysBetween(cycle.firstWeekStart, todayIso) / 7) + 1)
          ),
          totalWeeks: cycle.lengthWeeks,
        }
      : null;

  const totals =
    checkins.length > 0
      ? (() => {
          let minutesKnown: number | null = null;
          let withoutMeasured = 0;
          for (const c of checkins) {
            const actual = actualMinutesByDate.get(c.sessionDate);
            if (actual !== undefined) {
              minutesKnown = (minutesKnown ?? 0) + actual;
            } else {
              withoutMeasured += 1;
            }
          }
          return {
            sessionsCompleted: checkins.length,
            minutesAccumulated: minutesKnown,
            sessionsWithoutMeasuredMinutes: withoutMeasured,
          };
        })()
      : null;

  const byDateDesc = [...checkins].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  const history: CabinetHistoryEntry[] | null =
    byDateDesc.length > 0
      ? byDateDesc.slice(0, 15).map((c) => {
          const session = c.planSessionId ? sessionsById.get(c.planSessionId) : null;
          return {
            date: c.sessionDate,
            dateLabel: formatRuDay(c.sessionDate),
            title: session?.title ?? "Незапланированная тренировка",
            minutesActual: actualMinutesByDate.get(c.sessionDate) ?? null,
            minutesPlanned: session?.minutes ?? null,
            effortLabel: c.effortLabel,
            pain: c.pain,
            commentText: c.commentText,
          };
        })
      : null;

  let ladder: CabinetView["ladder"] = null;
  if (progression) {
    const current = stepByIndex(progression.currentStep);
    const isLast = progression.currentStep >= BEGINNER_LADDER[BEGINNER_LADDER.length - 1].index;
    const nextLabelRu = isLast ? null : stepByIndex(progression.currentStep + 1).labelRu;

    // ПУТЬ ПОСТРОЕН ИЗ ЧЕК-ИНОВ, А НЕ ИЗ ОТДЕЛЬНОЙ ТАБЛИЦЫ ИСТОРИИ — ЕЁ НЕТ.
    // step_before/step_after у каждого чек-ина уже фиксируют переход в момент,
    // когда он случился; собранные по возрастанию даты, они и есть таймлайн.
    const ascending = [...checkins].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
    const path: CabinetLadderStep[] = [];
    let lastSeenStep: number | null = null;
    for (const c of ascending) {
      if (c.stepAfter !== null && c.stepAfter !== lastSeenStep) {
        path.push({ step: c.stepAfter, labelRu: stepByIndex(c.stepAfter).labelRu, sinceDateLabel: formatRuDay(c.sessionDate) });
        lastSeenStep = c.stepAfter;
      }
    }
    // Ни одного перехода ещё не было (первая тренировка новичка) — путь
    // пуст, но текущая ступень всё равно первая и её стоит назвать.
    if (path.length === 0) {
      path.push({ step: progression.currentStep, labelRu: current.labelRu, sinceDateLabel: "начало" });
    }

    ladder = { currentLabelRu: current.labelRu, nextLabelRu, path };
  }

  return { weeksTogether, cycleProgress, totals, history, ladder };
}
