/**
 * Чек-ин → состояние прогрессии. Несущая связь всего контура.
 *
 * Порядок здесь важнее кода: сначала ответ ложится рядом с прежними (свежий
 * первым), потом по получившемуся ряду принимается решение, и только потом
 * состояние переписывается. Обратный порядок — решить, потом записать ответ —
 * дал бы решение по устаревшему ряду, то есть по предыдущей тренировке.
 */

import {
  BEGINNER_METHODOLOGY_ID,
  BEGINNER_METHODOLOGY_VERSION,
  decideNextStep,
  type ProgressionDecision,
  type SessionFeedback,
} from "@/features/methodology/beginner";

import type { ProgressionState } from "./types";

export type ApplyCheckinInput = {
  /** Состояние ДО ответа. null — первый чек-ин, человек только начал. */
  state: ProgressionState | null;
  sourceId: string;
  sessionDate: string;
  rpe: number | null;
  pain: boolean;
  canRunContinuously: boolean | null;
};

export type ApplyCheckinResult = {
  decision: ProgressionDecision;
  stepBefore: number;
  next: {
    sourceId: string;
    methodologyId: string;
    methodologyVersion: string;
    currentStep: number;
    sessionsAtStep: number;
    lastTransitionAt: string | null;
    recentSessions: SessionFeedback[];
    canRunContinuously: boolean | null;
  };
};

/**
 * ПОВТОРНЫЙ ОТВЕТ ПО ТОЙ ЖЕ СЕССИИ НЕ ДОЛЖЕН СЧИТАТЬСЯ ВТОРОЙ СЕССИЕЙ.
 *
 * Человек может нажать кнопку дважды или передумать («на самом деле было
 * тяжелее»). Строка чек-ина в базе одна — её правит upsert, — но и ряд обратной
 * связи обязан вести себя так же: запись за тот же день ЗАМЕНЯЕТСЯ, а счётчик
 * отработанных сессий не растёт.
 *
 * Иначе двойной тап двигал бы ступень на ровном месте — ровно тот дефект, ради
 * которого прогрессия и вынесена в состояние, а не считается из календаря.
 */
function mergeFeedback(
  recent: SessionFeedback[],
  incoming: SessionFeedback
): { merged: SessionFeedback[]; isRepeatAnswer: boolean } {
  const existingIndex = recent.findIndex((item) => item.date === incoming.date);
  if (existingIndex === -1) {
    return { merged: [incoming, ...recent], isRepeatAnswer: false };
  }
  const merged = [...recent];
  merged.splice(existingIndex, 1);
  return { merged: [incoming, ...merged], isRepeatAnswer: true };
}

export function applyCheckinToProgression(input: ApplyCheckinInput): ApplyCheckinResult {
  const state = input.state;
  const stepBefore = state?.currentStep ?? 1;
  const incoming: SessionFeedback = { date: input.sessionDate, rpe: input.rpe, pain: input.pain };

  const { merged, isRepeatAnswer } = mergeFeedback(state?.recentSessions ?? [], incoming);

  // Отработанная сессия засчитывается ДО решения: правило смотрит «сколько
  // сессий отработано на ступени», и эта — уже отработана.
  const sessionsAtStep = (state?.sessionsAtStep ?? 0) + (isRepeatAnswer ? 0 : 1);

  const decision = decideNextStep({
    currentStep: stepBefore,
    sessionsAtStep,
    recent: merged,
  });

  const movedStep = decision.action === "progress" || decision.action === "step_back";

  return {
    decision,
    stepBefore,
    next: {
      sourceId: input.sourceId,
      methodologyId: state?.methodologyId ?? BEGINNER_METHODOLOGY_ID,
      // Версия методики НЕ переписывается на текущую: человек, начавший по v2,
      // обязан дойти по v2, иначе его ступень внезапно означает другую нагрузку.
      methodologyVersion: state?.methodologyVersion ?? BEGINNER_METHODOLOGY_VERSION,
      currentStep: decision.nextStep,
      // Счётчик обнуляется ТОЛЬКО при смене ступени: на новой ступени отработано
      // ноль сессий, сколько бы их ни было на прежней.
      sessionsAtStep: movedStep ? 0 : sessionsAtStep,
      lastTransitionAt: movedStep ? input.sessionDate : state?.lastTransitionAt ?? null,
      recentSessions: merged,
      canRunContinuously: state?.canRunContinuously ?? input.canRunContinuously,
    },
  };
}
