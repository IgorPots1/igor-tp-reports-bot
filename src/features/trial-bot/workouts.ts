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

import { WALK_PRESET, presetForRung, type PlannedSession } from "./logic";

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

export function workoutFor(planned: PlannedSession, library: LibraryRows): WorkoutText {
  if (planned.kind === "walk") return WALK_WORKOUT;
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
  return rows;
}
