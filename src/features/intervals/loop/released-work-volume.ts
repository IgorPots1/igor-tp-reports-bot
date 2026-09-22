/**
 * Сколько минут РАБОТЫ несла последняя отданная ученику неделя.
 *
 * ── ЗАЧЕМ ЭТО ЧИСЛО ─────────────────────────────────────────────────────────
 *
 * Цель цикла считается от объёма и ничего не знает о том, что тренер уже дал
 * человеку руками. У Валентины на неделе стояло 7 × 4 мин через полторы минуты
 * шага — 28 минут работы, написанных рукой. Генератор на следующую неделю
 * предлагал 5 × 3, то есть 15 минут: формально ближайший к цели цикла (20),
 * фактически шаг назад почти вдвое.
 *
 * Правило, которое из этого следует: назад не ходим. Сгенерированная неделя не
 * опускается ниже последней ОТДАННОЙ по объёму работы.
 *
 * ── ПОЧЕМУ ИМЕННО ОТДАННОЙ, А НЕ ПОСЛЕДНЕЙ В БАЗЕ ───────────────────────────
 *
 * Недели со статусом generated человек не видел: они черновик и могут быть
 * какими угодно. Отправной точкой может быть только то, что ему реально дали.
 *
 * ── КАК СЧИТАЕТСЯ РАБОТА ────────────────────────────────────────────────────
 *
 * У РУЧНОЙ сессии — из steps: блок повтора даёт count × минуты бегового шага,
 * восстановление внутри повтора не считается. У МАШИННОЙ — из сегментов с
 * заданным усилием: разминка, трусца и заминка идут по лёгкому и работой не
 * являются.
 */

import type { PlanSession, SessionStep } from "./types";

/** Минуты работы внутри одного шага (с учётом вложенного повтора). */
function stepWorkMinutes(step: SessionStep): number {
  if (step.repeat) {
    // Внутри повтора работа — это шаги с ориентиром по усилию или «подобрать
    // самой». Восстановление идёт свободным текстом («шагом») и не считается.
    const inner = step.repeat.steps.reduce((sum, child) => {
      const kind = child.target?.kind;
      return kind === "rpe" || kind === "self_discovery" || kind === "pace" ? sum + child.minutes : sum;
    }, 0);
    return step.repeat.count * inner;
  }
  return 0;
}

export function sessionWorkMinutes(session: PlanSession): number {
  if (session.steps && session.steps.length > 0) {
    const fromRepeats = session.steps.reduce((sum, step) => sum + stepWorkMinutes(step), 0);
    if (fromRepeats > 0) return fromRepeats;
    // Непрерывная работа без повтора: шаг с усилием и без слова «разминка» или
    // «заминка» в названии. Их у ручных сессий немного, и путать их с основной
    // частью нельзя.
    return session.steps.reduce((sum, step) => {
      if (step.repeat) return sum;
      if (step.target?.kind !== "rpe") return sum;
      if (/размин|замин|ходьб|трусц|шаг/iu.test(step.name)) return sum;
      return sum + step.minutes;
    }, 0);
  }

  if (session.segments && session.segments.length > 0) {
    // У машинной сессии работа — сегменты БЕЗ темпа лёгкого: рабочие куски
    // описаны усилием, а разминка, трусца и заминка несут полосу лёгкого либо
    // оговорку про неё.
    return session.segments.reduce((sum, seg) => {
      if (/размин|замин|трусц|шагом|спокойн|пауза|ускорен/iu.test(seg.label)) return sum;
      return sum + seg.minutes;
    }, 0);
  }

  return 0;
}

/**
 * Пол объёма работы по отданным неделям. Берётся МАКСИМУМ по сессиям последней
 * отданной недели: пол задаёт самая тяжёлая работа, которую человек уже делал,
 * а не средняя по неделе.
 */
export function releasedWorkFloor(input: {
  sessions: PlanSession[];
  releasedWeekStarts: Set<string>;
}): { weekStart: string; workMinutes: number } | null {
  const released = input.sessions.filter((s) => input.releasedWeekStarts.has(s.weekStart));
  if (released.length === 0) return null;

  const lastWeek = released.reduce((max, s) => (s.weekStart > max ? s.weekStart : max), released[0].weekStart);
  const inWeek = released.filter((s) => s.weekStart === lastWeek);
  const work = inWeek.reduce((max, s) => Math.max(max, sessionWorkMinutes(s)), 0);
  return work > 0 ? { weekStart: lastWeek, workMinutes: work } : null;
}
