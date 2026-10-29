/* Пробная неделя для тех, кто уже бегает (цель «бегать регулярно» или «подготовиться к старту»):
 * чистая логика без сети и без базы.
 *
 * Было [до 29.10.2026]: бот отвечал бегающему «неделя для начинающих тебе не нужна» и не давал
 * ничего. Игорь, проверив вживую: продукт НЕ только для новичков, неделю получает каждый.
 *
 * Как строится неделя: по методике тренера из приложения AI-coach (ai-running-coach,
 * src/features/plans/methodology.ts, сегмент run_regularly):
 *   — 2 пробежки: лёгкий бег + более длинный лёгкий, без работы на скорость;
 *   — 3 и больше: лёгкий + одна тренировка с интервалами + длительная;
 *   — боль или дискомфорт сейчас: работы на скорость нет совсем (hasPainCaution → 0 качества).
 * Интервалы берутся с лестницы коротких форматов через шаг (int_walk_*, та же, по которой
 * генератор Intervals ведёт учеников), усилие 6 из 10 как у пресетов в базе. Длительности
 * лёгкой и длительной выводятся из ответов анкеты: недельный объём и самая длинная пробежка.
 *
 * Темпов нет нигде: у человека из рилса нет ни порога, ни истории, любое число было бы
 * выдумано. Только минуты и ощущения, как у новичка. */

import type { Checkin } from "./logic";

// ── лестница интервалов ──────────────────────────────────────────────────────

/**
 * Первые ступени WALK_INTERVAL_LADDER из tools/trainingpeaks-export/scripts/lib/interval-ladder.ts.
 * Копия, а не импорт: src/ не тянет код из tools/ (раннеры и Next собираются по-разному).
 * Расхождение с оригиналом ловит check:trial-bot. Отдых: на трёхминутках минута шагом,
 * с четырёх минут полторы (миграции 20260918_short_interval_presets и 20260922_int_walk_ladder).
 * Выше 7 x 4 пробная неделя не поднимает: это уже работа, к которой подводят, а не первая неделя.
 */
export const TRIAL_INTERVAL_LADDER: ReadonlyArray<{ code: string; reps: number; workMin: number; restSec: number; labelRu: string }> = [
  { code: "int_walk_3x3", reps: 3, workMin: 3, restSec: 60, labelRu: "3 x 3 мин" },
  { code: "int_walk_4x3", reps: 4, workMin: 3, restSec: 60, labelRu: "4 x 3 мин" },
  { code: "int_walk_5x3", reps: 5, workMin: 3, restSec: 60, labelRu: "5 x 3 мин" },
  { code: "int_walk_6x4", reps: 6, workMin: 4, restSec: 90, labelRu: "6 x 4 мин" },
  { code: "int_walk_7x4", reps: 7, workMin: 4, restSec: 90, labelRu: "7 x 4 мин" },
];

/** Следующая ступень после всей лестницы пробной недели: в совете на следующую неделю. */
export const NEXT_AFTER_TRIAL_LADDER = "6 x 5 мин";

/** Усилие отрезка: rpe_target пресетов int_walk_* в базе. */
export const INTERVAL_RPE = 6;
/** Разминка и заминка: warmup_standard_easy_10_15 (≈12) и cooldown_easy_10_15 у тех же пресетов. */
export const INTERVAL_WARMUP_MIN = 12;
export const INTERVAL_COOLDOWN_MIN = 10;

export const EASY_PRESET = "easy_continuous";
export const LONG_PRESET = "long_aerobic";

// ── ответы, от которых зависит неделя ────────────────────────────────────────

export type WeeklyKm = "0_5" | "5_15" | "15_30" | "30_50" | "50_plus" | "unknown";
export type Longest = "up_to_3" | "3_5" | "5_10" | "10_15" | "15_21" | "21_plus" | "unknown";
export type IntervalsExp = "easy_only" | "sometimes" | "regularly" | "unknown";
export type RaceDistance = "5k" | "10k" | "21k" | "42k";
export type RaceResult = "t1" | "t2" | "t3" | "t4" | "none";

export type RunnerInput = {
  weeklyKm: WeeklyKm;
  /** null: вопрос не задавали (цель «старт»: длительная выводится из объёма и дистанции). */
  longest: Longest | null;
  intervals: IntervalsExp;
  /** Сколько пробежек в пробной неделе ведёт бот: 2 или 3 (ответ «4 и больше» тоже 3). */
  runs: 2 | 3;
  /** Сейчас бывает лёгкий дискомфорт: без работы на скорость. */
  caution: boolean;
  raceDistance: RaceDistance | null;
  raceResult: RaceResult | null;
};

/**
 * Хватит ли базы на неделю бегуна. Меньше 5 км в неделю или самая длинная до 3 км: такому
 * человеку интервалы и длительная рано, он идёт по лестнице бега с шагом (ступень 6, 25 минут
 * непрерывно), как новичок, но без отказа.
 */
export function hasRunnerBase(weeklyKm: WeeklyKm, longest: Longest | null): boolean {
  return weeklyKm !== "0_5" && longest !== "up_to_3";
}

/** Лёгкий бег, минут: по недельному объёму. «Не знаю» считаем как 5-15 км. */
export const EASY_MINUTES: Record<WeeklyKm, number> = {
  "0_5": 25,
  "5_15": 30,
  "15_30": 40,
  "30_50": 45,
  "50_plus": 50,
  unknown: 30,
};

/** Длительная, минут: не дальше того, что человек уже бегает (около его самой длинной). */
export const LONG_MINUTES_BY_LONGEST: Record<Longest, number> = {
  up_to_3: 25,
  "3_5": 35,
  "5_10": 50,
  "10_15": 75,
  "15_21": 95,
  "21_plus": 110,
  unknown: 45,
};

/** Длительная без вопроса про самую длинную (цель «старт»): по недельному объёму. */
export const LONG_MINUTES_BY_WEEKLY: Record<WeeklyKm, number> = {
  "0_5": 30,
  "5_15": 50,
  "15_30": 70,
  "30_50": 90,
  "50_plus": 105,
  unknown: 50,
};

/** Потолок длительной под дистанцию старта: к пятёрке не нужна двухчасовая длительная. */
export const LONG_CAP_BY_RACE: Record<RaceDistance, number> = { "5k": 70, "10k": 90, "21k": 110, "42k": 110 };

/**
 * Ступень интервалов на первую неделю:
 *   не было интервалов или «не знаю» → 3 x 3;
 *   иногда → 4 x 3, при объёме от 15 км в неделю 5 x 3;
 *   регулярно → 5 x 3, от 15 км 6 x 4, от 30 км 7 x 4;
 *   у цели «старт» лучший результат сдвигает на ступень: быстрые две трети шкалы (t1, t2)
 *   на одну вверх, если интервалы уже были, медленная (t4) и «стартов не было» на одну вниз.
 */
export function startIntervalStep(input: Pick<RunnerInput, "weeklyKm" | "intervals" | "raceResult">): number {
  const big = input.weeklyKm === "15_30" || input.weeklyKm === "30_50" || input.weeklyKm === "50_plus";
  const huge = input.weeklyKm === "30_50" || input.weeklyKm === "50_plus";
  let step = 0;
  if (input.intervals === "sometimes") step = big ? 2 : 1;
  if (input.intervals === "regularly") step = huge ? 4 : big ? 3 : 2;
  if (input.raceResult === "t1" || input.raceResult === "t2") {
    if (input.intervals === "sometimes" || input.intervals === "regularly") step += 1;
  }
  if (input.raceResult === "t4" || input.raceResult === "none") step -= 1;
  return clampStep(step);
}

export function clampStep(step: number): number {
  return Math.min(TRIAL_INTERVAL_LADDER.length - 1, Math.max(0, Math.round(step)));
}

// ── неделя ───────────────────────────────────────────────────────────────────

export type RunnerSession =
  | { kind: "easy"; minutes: number }
  | { kind: "intervals"; step: number }
  | { kind: "long"; minutes: number };

/** Порядок недели: лёгкий → работа → длительная. Первая лёгкая заодно показывает, как человек переносит нагрузку. */
export function buildRunnerWeek(input: RunnerInput): RunnerSession[] {
  const easy = EASY_MINUTES[input.weeklyKm];
  let long = input.longest ? LONG_MINUTES_BY_LONGEST[input.longest] : LONG_MINUTES_BY_WEEKLY[input.weeklyKm];
  // Длительная длиннее обычной лёгкой: иначе это не длительная. Ответы «30-50 км, самая длинная
  // 3-5 км» противоречат друг другу, и тогда верим объёму.
  long = Math.max(long, easy + 10);
  if (input.raceDistance) long = Math.min(long, LONG_CAP_BY_RACE[input.raceDistance]);
  const out: RunnerSession[] = [{ kind: "easy", minutes: easy }];
  if (input.runs === 3) {
    out.push(input.caution ? { kind: "easy", minutes: easy } : { kind: "intervals", step: startIntervalStep(input) });
  }
  out.push({ kind: "long", minutes: long });
  return out;
}

// ── поправки внутри недели ───────────────────────────────────────────────────

export type RunnerPlanned = RunnerSession | { kind: "walk" };

/** Минуты при «Тяжело»: минус пятая часть, кратно 5, не меньше 20. */
export function softerMinutes(m: number): number {
  return Math.max(20, Math.round((m * 0.8) / 5) * 5);
}

/**
 * ЧТО ДАВАТЬ НА ТРЕНИРОВКЕ idx (1..), по отметкам предыдущих.
 *   «Что-то болело» → следующая заменяется 30 минутами быстрой ходьбы (как у новичка), и до
 *     конца недели работы на скорость нет: интервалы становятся лёгким бегом (методика:
 *     при боли качество отключается);
 *   «Тяжело» → следующая тренировка легче: лёгкая и длительная на пятую часть короче,
 *     интервалы ступенью ниже (ниже 3 x 3 некуда). «Легко» или «Нормально» после этого
 *     возвращают план как был;
 *   «Легко», «Нормально», «Не получилось», молчание → по плану. Внутри пробной недели не
 *     прибавляем: прибавка по методике между неделями, о ней итог дня 7.
 */
export function planRunnerSession(
  base: RunnerSession[],
  idx: number,
  history: Array<{ planned: RunnerPlanned; checkin: Checkin | null }>,
): RunnerPlanned {
  const planned = base[Math.min(base.length, Math.max(1, idx)) - 1];
  let walkNext = false;
  let softer = false;
  let caution = false;
  for (const h of history) {
    if (h.checkin === "pain") {
      walkNext = true;
      caution = true;
      softer = false;
      continue;
    }
    if (h.planned.kind === "walk") {
      walkNext = false;
      continue;
    }
    walkNext = false;
    if (h.checkin === "hard") softer = true;
    else if (h.checkin === "easy" || h.checkin === "ok") softer = false;
  }
  if (walkNext) return { kind: "walk" };
  let s: RunnerSession = planned;
  if (caution && s.kind === "intervals") {
    const easy = base.find((b) => b.kind === "easy");
    s = { kind: "easy", minutes: easy && easy.kind === "easy" ? easy.minutes : 30 };
  }
  if (softer) {
    if (s.kind === "intervals") s = { kind: "intervals", step: clampStep(s.step - 1) };
    else s = { ...s, minutes: softerMinutes(s.minutes) };
  }
  return s;
}

/** Совет на следующую неделю по всей неделе. */
export type RunnerAdvice =
  | { kind: "careful" }
  | { kind: "same" }
  | { kind: "up"; nextIntervals: string | null };

export function runnerWeekAdvice(
  base: RunnerSession[],
  history: Array<{ planned: RunnerPlanned; checkin: Checkin | null }>,
): RunnerAdvice {
  if (history.some((h) => h.checkin === "pain")) return { kind: "careful" };
  if (history.some((h) => h.checkin === "hard")) return { kind: "same" };
  const clean = history.filter((h) => h.checkin === "easy" || h.checkin === "ok").length;
  // Прибавка только когда большая часть недели сделана без «Тяжело»: иначе нечего наращивать.
  if (clean < Math.max(2, base.length - 1)) return { kind: "same" };
  const q = base.find((b) => b.kind === "intervals");
  if (!q || q.kind !== "intervals") return { kind: "up", nextIntervals: null };
  const next = q.step + 1 < TRIAL_INTERVAL_LADDER.length ? TRIAL_INTERVAL_LADDER[q.step + 1].labelRu : NEXT_AFTER_TRIAL_LADDER;
  return { kind: "up", nextIntervals: next };
}

/** Код пресета под сессию: пишется в trial_bot_sessions.preset_code, по нему же история читается обратно. */
export function presetForRunner(s: RunnerSession): string {
  if (s.kind === "easy") return EASY_PRESET;
  if (s.kind === "long") return LONG_PRESET;
  return TRIAL_INTERVAL_LADDER[clampStep(s.step)].code;
}

/** Обратно из сохранённой строки: что было запланировано (минуты для истории не нужны). */
export function runnerFromPreset(code: string | null, minutes: number | null): RunnerSession | null {
  if (code === EASY_PRESET) return { kind: "easy", minutes: minutes ?? 30 };
  if (code === LONG_PRESET) return { kind: "long", minutes: minutes ?? 45 };
  const step = TRIAL_INTERVAL_LADDER.findIndex((r) => r.code === code);
  return step >= 0 ? { kind: "intervals", step } : null;
}
