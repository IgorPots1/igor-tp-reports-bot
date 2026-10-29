/* Тексты тренировок пробной недели: из библиотеки тренера (workout_template_presets +
 * workout_template_description_refs), с запасным текстом на случай, если чтение не удалось.
 *
 * Запасной текст — stepDescriptionRu из методики новичка: тексты библиотеки порождены
 * из него же (миграция 20260929000000_beginner_run_walk_ladder_v2.sql), расхождение между
 * ними стережёт check:beginner-methodology. Поэтому при сбое базы человек получает те же
 * слова тренера, а не выдуманные.
 *
 * Перед показом текст приводится к голосу бота (ты, от первого лица, без длинных тире):
 * библиотека написана на «вы» и для страницы плана, а бот говорит как Игорь. */

import { BEGINNER_LADDER, stepByIndex, stepDescriptionRu } from "@/features/methodology/beginner";

import { WALK_PRESET, plural, presetForRung, type TrialPlanned } from "./logic";
import {
  INTERVAL_COOLDOWN_MIN,
  INTERVAL_RPE,
  INTERVAL_WARMUP_MIN,
  TRIAL_INTERVAL_LADDER,
  clampStep,
  presetForRunner,
  type RunnerSession,
} from "./runner-week";

export type WorkoutText = { presetCode: string; title: string; body: string };

/** Строки библиотеки: preset_code → название и описание. Пусто, если чтение не удалось. */
export type LibraryRows = Map<string, { title: string | null; body: string | null }>;

/** Ходьба вместо тренировки после «Что-то болело». В библиотеке такого пресета нет: текст задан тренером в сценарии бота. */
export const WALK_WORKOUT: WorkoutText = {
  presetCode: WALK_PRESET,
  title: "30 минут быстрой ходьбы",
  // Утром уходит не этот текст, а texts.MORNING_WALK; body хранится в trial_bot_sessions для истории.
  body: "Быстрая ходьба 30 минут вместо бега: спокойно, без рывков, это восстановление, а не пропуск.",
};

/* Фразы библиотеки, написанные для страницы плана и тренера, а новичку в боте непонятные
 * [правка текстов 28.10.2026]. Заменяются целиком и ДО замены тире, поэтому терпят и «—», и «–».
 *   «ступень взята рано», «от этой оценки зависит следующая ступень» → что будет со следующей
 *     тренировкой, простыми словами;
 *   «оцените усилие» → то, что реально спрашивают кнопки: легко, нормально или тяжело;
 *   «усилие 2–4 по шкале 1–10» убрано из тела: то же правило уже стоит в утреннем
 *     «Главное правило: усилие 2-4 из 10» (texts.morningText), в тексте было дважды. */
const D = "\\s*[—–-]\\s*";
const PLAIN_PHRASES: Array<[RegExp, string]> = [
  [
    new RegExp(`Если стало тяжело${D}перейдите на шаг и отметьте это: значит, ступень взята рано\\.`, "g"),
    "Если стало тяжело, перейди на шаг и отметь «Тяжело»: следующая тренировка будет легче.",
  ],
  [
    new RegExp(`усилие 2${D}4 по шкале 1${D}10, дыхание ровное, разговор возможен полными фразами\\.`, "g"),
    "дыхание ровное, можно говорить полными фразами.",
  ],
  [
    /При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру\./g,
    "При боли или дискомфорте остановись или перейди на шаг и напиши мне.",
  ],
  [
    new RegExp(`После тренировки оцените усилие${D}от этой оценки зависит следующая ступень\\.`, "g"),
    "После тренировки отметь, как прошло: легко, нормально или тяжело. От этого зависит следующая тренировка.",
  ],
];

const VOICE_REPLACEMENTS: Array<[RegExp, string]> = [
  ...PLAIN_PHRASES,
  [/\s+—\s+(?=это\s)/g, ": "],
  [/\s*—\s*/g, ", "],
  [/–/g, "-"],
  [/перейдите/g, "перейди"],
  [/Перейдите/g, "Перейди"],
  [/оцените/g, "оцени"],
  [/Оцените/g, "Оцени"],
  [/отметьте/g, "отметь"],
  [/сказать тренеру/g, "написать мне"],
];

/** Голос бота: «ты», без длинных тире, без тренерского жаргона (PLAIN_PHRASES). Смысл текста тренера не меняется. */
export function toBotVoice(text: string): string {
  let out = text;
  for (const [re, to] of VOICE_REPLACEMENTS) out = out.replace(re, to);
  return out.replace(/\s{2,}/g, " ").trim();
}

export function fallbackWorkout(rung: number): WorkoutText {
  const step = stepByIndex(rung);
  return { presetCode: step.presetCode, title: step.labelRu, body: toBotVoice(stepDescriptionRu(step)) };
}

export function workoutFor(planned: TrialPlanned, library: LibraryRows): WorkoutText {
  if (planned.kind === "walk") return WALK_WORKOUT;
  if (planned.kind !== "rung") return runnerWorkout(planned, library);
  const code = presetForRung(planned.rung);
  const fb = fallbackWorkout(planned.rung);
  const row = library.get(code);
  const title = row?.title?.trim();
  const body = row?.body?.trim();
  return {
    presetCode: code,
    title: title ? toBotVoice(title) : fb.title,
    body: body ? toBotVoice(body) : fb.body,
  };
}

// ── неделя бегуна: лёгкий, интервалы, длительная ─────────────────────────────

/**
 * ТЕКСТЫ ШАГОВ НЕДЕЛИ БЕГУНА. Источник: эталоны тренера (intervals_step_text_etalons, по ключу
 * шага, тот же словарь, что у генератора Intervals: src/features/intervals/step-texts/keys.ts).
 * Запасной текст здесь: тексты генератора (autoplanner-week.ts: treadmillText лёгкой и
 * длительной, effortText(6) у отрезка, «Заминка: спокойный бег или шаг»), сразу на «ты».
 *
 * Эталон берётся, только если после toBotVoice в нём не осталось обращения на «вы» (эталоны
 * пишутся для страницы плана, бот говорит как Игорь на «ты») и нет цифр: числа в шаге ставит
 * бот, а не текст. Не прошёл: запасной текст, не полу-переведённый эталон.
 *
 * interval_rest намеренно не из эталона: у генератора это «Просто идти. С дорожки не сходить.»,
 * про дорожку, а человек из рилса бегает где угодно.
 */
export const RUNNER_STEP_KEYS = ["warmup_easy", "easy_main_street", "long_main_street", "interval_work", "cooldown"] as const;
export type RunnerStepKey = (typeof RUNNER_STEP_KEYS)[number];

export const RUNNER_STEP_FALLBACK: Record<RunnerStepKey, string> = {
  warmup_easy: "спокойно, дыхание ровное.",
  easy_main_street: "Разговорный темп: можешь говорить предложениями. Если тяжело дышать, сбавь или перейди на шаг.",
  long_main_street: "Спокойнее обычной лёгкой. Задача не быстрее, а ровно до конца: к концу должно оставаться ощущение, что можешь ещё.",
  interval_work: "дышать заметно чаще, говорить можно предложениями. Все отрезки ровно, не на максимум.",
  cooldown: "спокойный бег или шаг.",
};

/** Ключ строки эталона в LibraryRows: «step:<ключ шага>» рядом с пресетами. */
export const stepRowKey = (k: RunnerStepKey) => `step:${k}`;

const FORMAL_YOU = /(^|[^А-Яа-яЁё])(вы|вас|вам|вами|ваш\p{L}*)(?=[^А-Яа-яЁё]|$)|\p{L}+(ете|ите|йте|ьте)(?=[^А-Яа-яЁё]|$)/iu;

/** Эталон годится боту: на «ты», без цифр. Иначе null. */
export function usableEtalon(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  const voiced = toBotVoice(t);
  if (FORMAL_YOU.test(voiced) || /\d/.test(voiced)) return null;
  return voiced;
}

/** Разминка, отрезок и заминка встают после запятой: там эталон начинается со строчной. */
const AFTER_COMMA: ReadonlySet<RunnerStepKey> = new Set(["warmup_easy", "interval_work", "cooldown"]);

function stepText(key: RunnerStepKey, library: LibraryRows): string {
  const t = usableEtalon(library.get(stepRowKey(key))?.body) ?? RUNNER_STEP_FALLBACK[key];
  const ended = /[.!?]$/.test(t) ? t : `${t}.`;
  return AFTER_COMMA.has(key) ? ended.charAt(0).toLowerCase() + ended.slice(1) : ended;
}

const minutesWord = (m: number) => `${m} ${plural(m, "минута", "минуты", "минут")}`;
const minutesGen = (m: number) => `${m} ${plural(m, "минуту", "минуты", "минут")}`;

/** «через минуту шагом» / «через 1:30 шагом». */
function restLabel(sec: number): string {
  return sec === 60 ? "минуту" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function intervalsTitle(step: number): string {
  const r = TRIAL_INTERVAL_LADDER[clampStep(step)];
  return `Интервалы ${r.labelRu} через ${restLabel(r.restSec)} шагом`;
}

export function runnerTitle(s: RunnerSession): string {
  if (s.kind === "easy") return `Лёгкий бег ${minutesWord(s.minutes)}`;
  if (s.kind === "long") return `Длительная ${minutesWord(s.minutes)}`;
  return intervalsTitle(s.step);
}

/**
 * Тело в формате карточек тренера: блоки «Разминка / Основная часть / Заминка», каждый с новой
 * строки, у шага минуты и короткая подсказка. Название пресета из базы для лёгкой и длительной не
 * берётся («Длительный аэробный» человеку из рилса ничего не говорит); у интервалов название
 * составлено из той же лестницы, что пресеты int_walk_*.
 */
export function runnerWorkout(s: RunnerSession, library: LibraryRows): WorkoutText {
  const presetCode = presetForRunner(s);
  if (s.kind === "easy") {
    return { presetCode, title: runnerTitle(s), body: `Основная часть: ${minutesWord(s.minutes)} лёгкого бега. ${stepText("easy_main_street", library)}` };
  }
  if (s.kind === "long") {
    return { presetCode, title: runnerTitle(s), body: `Основная часть: ${minutesWord(s.minutes)} ровного лёгкого бега. ${stepText("long_main_street", library)}` };
  }
  const r = TRIAL_INTERVAL_LADDER[clampStep(s.step)];
  const rest = r.restSec === 60 ? "1 минута" : "1:30";
  const body =
    `Разминка: ${minutesWord(INTERVAL_WARMUP_MIN)} лёгкого бега, ${stepText("warmup_easy", library)}\n` +
    `Основная часть: ${r.reps} ${plural(r.reps, "отрезок", "отрезка", "отрезков")} по ${minutesGen(r.workMin)}, усилие ${INTERVAL_RPE} из 10, ${stepText("interval_work", library)} ` +
    `Между отрезками ${rest} шагом: просто идти, не стоять.\n` +
    `Заминка: ${minutesWord(INTERVAL_COOLDOWN_MIN)}, ${stepText("cooldown", library)}`;
  return { presetCode, title: runnerTitle(s), body };
}

export const TRIAL_PRESET_CODES = BEGINNER_LADDER.map((s) => s.presetCode);

/** Чтение библиотеки. Любая ошибка → пустая карта (бот возьмёт запасной текст), не исключение. */
export async function loadLibrary(): Promise<LibraryRows> {
  const rows: LibraryRows = new Map();
  try {
    const { createSupabaseServerClient } = await import("@/features/supabase/server");
    const { data, error } = await createSupabaseServerClient()
      .from("workout_template_presets")
      .select("preset_code, display_name_ru, is_enabled, workout_template_description_refs(description_text_ru)")
      .in("preset_code", TRIAL_PRESET_CODES);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{
      preset_code: string;
      display_name_ru: string | null;
      is_enabled: boolean | null;
      workout_template_description_refs: { description_text_ru: string | null } | Array<{ description_text_ru: string | null }> | null;
    }>) {
      if (r.is_enabled === false) continue;
      const ref = Array.isArray(r.workout_template_description_refs)
        ? r.workout_template_description_refs[0]
        : r.workout_template_description_refs;
      rows.set(r.preset_code, { title: r.display_name_ru, body: ref?.description_text_ru ?? null });
    }
  } catch (e) {
    console.warn(`[trial-bot] библиотека тренировок недоступна, беру запасной текст: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Эталоны текстов шагов для недели бегуна. Отдельной попыткой: их сбой не должен лишать
  // новичка текстов лестницы, и наоборот.
  try {
    const { createSupabaseServerClient } = await import("@/features/supabase/server");
    const { data, error } = await createSupabaseServerClient()
      .from("intervals_step_text_etalons")
      .select("step_key, text")
      .in("step_key", [...RUNNER_STEP_KEYS])
      .is("retired_at", null);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ step_key: RunnerStepKey; text: string | null }>) {
      rows.set(stepRowKey(r.step_key), { title: null, body: r.text });
    }
  } catch (e) {
    console.warn(`[trial-bot] эталоны шагов недоступны, беру запасной текст: ${e instanceof Error ? e.message : String(e)}`);
  }
  return rows;
}
