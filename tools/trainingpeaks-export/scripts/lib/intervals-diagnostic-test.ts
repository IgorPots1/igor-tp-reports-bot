/**
 * Куда в цикле встаёт диагностический тест и на каких условиях.
 *
 * ── ПОЧЕМУ ЗДЕСЬ, А НЕ В buildWeek ──────────────────────────────────────────
 *
 * buildWeek собирает недели и ростеру TrainingPeaks, и ученикам Intervals.
 * Тест нужен только вторым. Поставить его внутрь сборщика значило бы тронуть
 * код, от которого зависят чужие 132 недели, ради одной ветки. Поэтому тест
 * ВСТАВЛЯЕТСЯ ПОСЛЕ сборки, и недели ростера остаются прежними до байта.
 *
 * ── КУДА ИМЕННО (решение и обоснование) ─────────────────────────────────────
 *
 * ВТОРАЯ НЕДЕЛЯ, на месте качественной сессии.
 *
 * Почему не первая: человек только подключился. Часы могли не синхронизоваться,
 * план мог не открыться, первая неделя уходит на то, чтобы контур заработал.
 * Тест, который не доехал, хуже теста, которого не было: он выглядит проваленным.
 *
 * Почему не третья и дальше: порог нужен, чтобы по нему шла работа цикла. Чем
 * позже тест, тем большая часть цикла проходит по усилию впустую.
 *
 * Почему на месте качества: тест И ЕСТЬ тяжёлая сессия недели. Поставить его
 * вдобавок к качественной означало бы две тяжёлые за неделю у человека, про
 * которого мы ещё ничего не знаем.
 *
 * Почему не на разгрузочной неделе: разгрузка существует ради восстановления,
 * а тест это максимальное усилие. Четвёртая неделя (DELOAD_EVERY_N = 4) отпадает
 * сама, вторая под правило не попадает.
 *
 * ── КОГДА ТЕСТА НЕТ ВООБЩЕ ──────────────────────────────────────────────────
 *
 *   • порог уже есть: мерить второй раз нечего;
 *   • цикл под старт: там свои ориентиры, и тяжёлый тест ломает подводку;
 *   • человек отказался: отказ хранится у источника и переживает перегенерацию;
 *   • тест не влезает в потолок одной тренировки из анкеты: час это час.
 *
 * Отказ всегда НАЗЫВАЕТСЯ вслух, а не молчит: «теста нет» и «тест забыли» со
 * стороны выглядят одинаково.
 */

import { buildTestPlan, DIAGNOSTIC_TEST_PRESET, TEST_TOTAL_MIN } from "@/features/intervals/diagnostic-test";

import type { Session, Week } from "./autoplanner-week.ts";
import type { AthleteAnchors } from "./pace-resolver.ts";
import type { CycleIntent } from "./training-cycle.ts";

/** Номер недели цикла, на которую ставится тест. */
export const TEST_WEEK_INDEX = 2;

export type PlacementInput = {
  built: Array<{ week: Week; target: { weekIndex: number } }>;
  anchors: AthleteAnchors;
  intent: CycleIntent;
  /** Порог уже известен. */
  hasThreshold: boolean;
  /** Человек отказался от теста. */
  declined: boolean;
  /** Потолок одной тренировки из анкеты, минут. null = не спрашивали. */
  maxSessionMinutes: number | null;
};

export type PlacementResult = {
  placed: boolean;
  /** Что именно сделано или почему не сделано. Идёт в вывод скрипта. */
  note: string;
  /** Неделя и день, куда встал тест. */
  weekIndex: number | null;
  dayIdx: number | null;
  /** Сессия, которую тест заменил. */
  replacedTitle: string | null;
};

/** Цели, где тест неуместен: идёт подготовка к старту. */
const RACE_INTENTS: CycleIntent[] = ["5k", "10k", "half", "marathon"];

/**
 * Вставляет тест в собранные недели. Мутирует built: тот же приём, что у
 * остальных пост-обработок плана, и сохраняет один источник правды по неделям.
 */
export function placeDiagnosticTest(input: PlacementInput): PlacementResult {
  const none = (note: string): PlacementResult => ({
    placed: false, note, weekIndex: null, dayIdx: null, replacedTitle: null,
  });

  if (input.hasThreshold) return none("тест не ставится: порог уже известен, мерить нечего");
  if (input.declined) return none("тест не ставится: человек от него отказался, работа идёт по усилию");
  if (RACE_INTENTS.includes(input.intent)) {
    return none(`тест не ставится: цикл под старт (${input.intent}), там свои ориентиры`);
  }
  if (input.maxSessionMinutes !== null && input.maxSessionMinutes < TEST_TOTAL_MIN) {
    return none(
      `тест не ставится: он занимает ${TEST_TOTAL_MIN} мин, а потолок одной тренировки из анкеты ${input.maxSessionMinutes} мин`
    );
  }
  const easy = input.anchors.easy;
  if (!easy) {
    return none("тест не ставится: нет измеренного якоря лёгкого, а темпы разминки берутся от него");
  }

  const target = input.built.find((item) => item.target.weekIndex === TEST_WEEK_INDEX);
  if (!target) return none(`тест не ставится: недели ${TEST_WEEK_INDEX} в цикле нет`);
  if (target.week.sessions.length === 0) {
    return none(`тест не ставится: неделя ${TEST_WEEK_INDEX} не собрана (${target.week.refused ?? "причина не названа"})`);
  }

  // Место теста: качественная сессия недели. Её может не быть как назначенной
  // (порога нет, сборщик отложил), но строка с днём при этом остаётся, и день
  // недели у неё правильный.
  const quality = target.week.sessions.find((s) => s.role === "quality");
  const victim = quality ?? pickHardestNonLong(target.week.sessions);
  if (!victim) {
    return none(`тест не ставится: на неделе ${TEST_WEEK_INDEX} некуда его поставить, кроме длительной`);
  }

  const plan = buildTestPlan(easy.fastSec, easy.slowSec);
  const testSession: Session = {
    dayIdx: victim.dayIdx,
    role: "quality",
    presetCode: DIAGNOSTIC_TEST_PRESET,
    title: plan.title,
    minutes: plan.minutes,
    description: plan.description,
    segments: plan.segments.map((s) => ({
      minutes: s.minutes,
      fastSec: s.fastSec,
      slowSec: s.slowSec,
      label: s.label,
      ...(s.noPaceText ? { noPaceText: s.noPaceText } : {}),
    })),
    anchorSource: easy.source,
    confidence: easy.confidence,
    targetMode: "rpe",
    pctMin: null,
    pctMax: null,
    roundTrip: { ok: true, expected: plan.segments.length, parsedRanges: 0, parsedSegments: 0, problems: [] },
    deferred: false,
    deferReason: null,
    warnings:
      plan.minutes > victim.minutes + 20
        ? [`тест длиннее заменённой сессии на ${plan.minutes - victim.minutes} мин: неделя выйдет объёмнее плана`]
        : [],
    coachReview: [
      "диагностический тест: результат не пишется сам, порог появится только после разбора записи",
    ],
  };

  const at = target.week.sessions.indexOf(victim);
  target.week.sessions[at] = testSession;
  target.week.plannedMinutes = target.week.plannedMinutes - (victim.deferred ? 0 : victim.minutes) + plan.minutes;
  target.week.notes.push(`неделя ${TEST_WEEK_INDEX}: вместо качественной сессии поставлен диагностический тест`);

  return {
    placed: true,
    note:
      `тест поставлен на неделю ${TEST_WEEK_INDEX}, вместо «${victim.title}»` +
      (victim.deferred ? " (она и так была отложена без порога)" : ""),
    weekIndex: TEST_WEEK_INDEX,
    dayIdx: victim.dayIdx,
    replacedTitle: victim.title,
  };
}

/** Запасной выбор жертвы: самая длинная сессия недели, кроме длительной. */
function pickHardestNonLong(sessions: Session[]): Session | null {
  const usable = sessions.filter((s) => s.role !== "long" && s.role !== "rest");
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => b.minutes - a.minutes)[0];
}
