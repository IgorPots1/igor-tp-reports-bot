import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  buildTrainingPeaksCoachNotes,
  type RecoveryContextForCoachNotes,
} from "./lib/trainingpeaks-coach-notes.ts";
import { buildTrainingPeaksRecoverySummary } from "./lib/trainingpeaks-recovery-summary.ts";
import { readStudentsConfig } from "./lib/students.ts";

type CliArgs = {
  student: string;
  from: string;
  to: string;
};

type WeeklySegmentAnalysis = {
  available: boolean;
  reason?: "computed" | "no_workout_files" | "no_matches" | "not_computed";
  workouts_with_planned_segments?: number;
  workouts_with_matched_fit?: number;
  workouts_analyzed?: number;
  workouts_partial?: number;
  workouts_unsupported?: number;
};

type WorkoutFilesSource = {
  present?: boolean;
  files?: unknown[];
};

type PaceTarget = {
  fast_min_per_km: number;
  slow_min_per_km: number;
};

type HrbpmTarget = {
  min: number;
  max: number;
};

type WorkoutSegmentAnalysis = {
  available: boolean;
  reason?:
    | "computed"
    | "no_planned_segments"
    | "fit_not_matched"
    | "fit_parse_failed"
    | "timer_time_unavailable"
    | "unsupported_segments"
    | "unsupported_repeats";
  comparable_segments_count?: number;
  compared_segments_count?: number;
  extra_after_plan_seconds?: number;
  data_quality_flags?: string[];
};

type SegmentComparisonEntry = {
  label?: string | null;
  segment_type?: string;
  is_rest?: boolean;
  planned_duration_minutes?: number | null;
  planned_targets?: {
    pace_min_per_km?: PaceTarget | null;
    pace_text?: string | null;
    hr_bpm?: HrbpmTarget | null;
  };
  actual?: {
    duration_minutes?: number | null;
    distance_km?: number | null;
    avg_pace_min_per_km?: number | null;
    avg_pace_text?: string | null;
    avg_hr?: number | null;
    avg_cadence?: number | null;
    avg_power?: number | null;
  };
  coverage?: "full" | "partial" | "missing" | "unsupported";
  coverage_ratio?: number | null;
  pace_vs_target?: {
    status?: "too_fast" | "too_slow" | "within" | "unknown";
    outside_by_min_per_km?: number | null;
  };
  hr_vs_target?: {
    status?: "above" | "below" | "within" | "unknown";
    outside_by_bpm?: number | null;
  };
  data_quality_flags?: string[];
};

type WorkoutSummary = Record<string, unknown> & {
  classification?: Record<string, unknown>;
  planned?: {
    segments?: unknown[];
    targets?: {
      hr_bpm?: unknown;
      pace_ranges?: Array<{ text?: string | null }>;
      pace_min_per_km?: number | null;
    };
  };
  completed?: Record<string, unknown>;
  comparison?: Record<string, unknown>;
  segment_analysis?: WorkoutSegmentAnalysis;
  segment_comparison?: SegmentComparisonEntry[];
};

type WeeklySummary = {
  schema_version?: string;
  student_id: string;
  week: {
    from: string;
    to: string;
  };
  source_files: string[];
  source?: {
    workout_files?: WorkoutFilesSource;
  };
  segment_analysis?: WeeklySegmentAnalysis;
  totals?: {
    workouts_count: number;
    completed_workouts_count: number;
    total_distance_km: number | null;
    planned_duration_minutes: number | null;
    completed_duration_minutes: number | null;
    total_completed_duration_text: string | null;
    total_planned_duration_text: string | null;
    total_distance_text: string | null;
    data_warnings_count: number;
    intensity_flags_count: number;
  };
  week_metrics?: Record<string, unknown>;
  workouts: WorkoutSummary[];
};

type ReportDraft = {
  student_id: string;
  week: {
    from: string;
    to: string;
  };
  source_summary_path: string;
  coach_notes_path: string;
  model: string;
  created_at: string;
  recovery_context: RecoveryContextForPrompt;
  coach_notes: ReturnType<typeof buildTrainingPeaksCoachNotes>;
  report_markdown: string;
};

type RecoveryContextDecision =
  | "included"
  | "skipped_insufficient_data"
  | "skipped_no_profile"
  | "skipped_no_cache"
  | "skipped_error";

type RecoveryContextForPrompt = {
  decision: RecoveryContextDecision;
  student_id: string;
  student_name: string;
  profile: {
    status: string;
    recovery_metrics_enabled: boolean;
  } | null;
  summary: ReturnType<typeof buildTrainingPeaksRecoverySummary> | null;
  include_in_athlete_report: boolean;
  error?: string;
};

type HealthMetricProfileRow = {
  student_id: string;
  student_name: string;
  status: string;
  recovery_metrics_enabled: boolean;
};

type HealthMetricCacheRow = {
  metric_key: string;
  metric_date: string;
  value_numeric: number | null;
  value_avg_numeric: number | null;
};

type RuntimeStudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

const DEFAULT_REPORT_MODEL = "gpt-4.1-mini";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_TIMEOUT_MS = 60_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const parsedRoot = path.join(toolRoot, "parsed");
const reportsRoot = path.join(toolRoot, "reports");
const DEBUG = process.env.TP_DEBUG === "1";

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-generate-report -- --student=Olga --from=2026-04-27 --to=2026-05-03"
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<CliArgs> = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (!value) {
      continue;
    }

    if (rawKey === "student" || rawKey === "from" || rawKey === "to") {
      values[rawKey] = value;
    }
  }

  if (!values.student || !values.from || !values.to) {
    throw new Error(`Missing required CLI args.\n\n${usage()}`);
  }

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDatePattern.test(values.from) || !isoDatePattern.test(values.to)) {
    throw new Error("`--from` and `--to` must use YYYY-MM-DD format.");
  }

  return values as CliArgs;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function relativeToToolRoot(filePath: string): string {
  return toPosixPath(path.relative(toolRoot, filePath));
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) {
    return;
  }

  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ];

  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function getRequiredEnv(name: "OPENAI_API_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      "Missing OPENAI_API_KEY. Set it in process.env or tools/trainingpeaks-export/.env."
    );
  }

  return value;
}

function getRequiredSupabaseEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Recovery context will be skipped unless Supabase credentials are available.`
    );
  }

  return value;
}

function getReportModel(): string {
  return process.env.OPENAI_REPORT_MODEL?.trim() || DEFAULT_REPORT_MODEL;
}

function stripMarkdownFences(markdown: string): string {
  const trimmed = markdown.trim();
  const fencedMatch = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function normalizeMatchValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function addLookupToken(tokens: Set<string>, value: string | null | undefined): void {
  if (!value) {
    return;
  }
  const normalized = normalizeMatchValue(value);
  if (!normalized) {
    return;
  }
  tokens.add(normalized);
}

function getSafeErrorReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
  return raw.replace(/\s+/g, " ").trim().slice(0, 200) || "unknown error";
}

function buildSystemPrompt(): string {
  return [
    "Ты готовишь короткий недельный отчёт тренера для спортсмена по бегу на русском языке.",
    "Это athlete-facing текст для Telegram: тёплый coach-style, без технического аудита.",
    "Используй weekly-summary.json как основной источник и recovery_context как опциональный дополнительный источник.",
    "Опирайся на детерминированные поля: week_metrics, workouts[].classification, workouts[].planned, workouts[].completed, workouts[].comparison, workouts[].segment_analysis, workouts[].segment_comparison.",
    "Не рассчитывай выводы из raw-строк и не делай собственные агрегаты, если уже есть нормализованные значения.",
    "Не придумывай недостающие данные, цели, причины, самочувствие, травмы, прогресс, объём, зоны или выводы.",
    "",
    "ФОРМАТ ВЫВОДА:",
    "- Только plain text для Telegram: без заголовков ##, без нумерованных разделов, без **жирного** markdown.",
    "- Разделяй смысловые части пустой строкой.",
    "- Верни только текст отчёта, без пояснений вне отчёта.",
    "",
    ...buildAthleteFacingFormatRules(),
    "",
    ...buildAthleteFacingDataRules(),
    "",
    ...buildAthleteFacingRecoveryRules(),
  ].join("\n");
}

function buildAthleteFacingFormatRules(): string[] {
  return [
    "СТРУКТУРА (plain text для Telegram, без markdown и нумерации):",
    "Используй ровно эти смысловые метки разделов (как отдельные строки, без ## и без цифр):",
    "Итог недели",
    "Цифры",
    "Как прошли тренировки",
    "Восстановление (только если recovery включён)",
    "После последнего раздела — одно короткое закрывающее предложение отдельным абзацем.",
    "",
    "Итог недели: 2–4 коротких предложения. Как прошла неделя, выполнен ли план, одна спокойная интерпретация.",
    "Цифры: компактный список строк (объём в км, число тренировок, общее время; средний темп по неделе, если есть в данных).",
    "Единицы только по-русски: «км», не «km».",
    "Разница с планом в процентах — только компактная числовая форма: «+3%», «+5%», «примерно +3%», «чуть меньше плана».",
    "Не пиши «плюс три процента», «103 процентов», «процентов» в строках цифр и в «Итог недели».",
    "Перевыполнение по времени: «По времени: чуть больше плана, примерно +3%» или «чуть меньше плана», не «Выполнение плана по времени: 103 процентов».",
    "Как прошли тренировки: для каждой тренировки отдельный мини-блок:",
    "  - строка 1: дата + короткое человеческое название (например «11 мая. Час по комфорту.»);",
    "  - строка 2: факт (длительность, дистанция, темп, пульс — только если есть в completed);",
    "  - строка 3: одно coach-наблюдение по сути тренировки.",
    "Восстановление: 2–3 простых предложения, только если recovery_context.include_in_athlete_report=true и decision='included'.",
    "Закрытие: одна спокойная финальная фраза; можно пригласить написать, если что-то ощущалось необычно.",
    "",
    "ЗАПРЕЩЕНО В ТЕКСТЕ ДЛЯ СПОРТСМЕНА:",
    "- Символы длинного и среднего тире: — и –. Если хочется тире, разбей на два коротких предложения или используй точку/двоеточие.",
    "- Разделы и фразы: 'Ключевые расхождения', 'Риски и наблюдения', 'Что скорректировать', 'Вопросы спортсмену'.",
    "- Любые упоминания IF, TSS, HRV, baseline, 'подозрительные IF/TSS'.",
    "- Системные формулировки: 'автоматическое сравнение', 'разбор по блокам доступен/недоступен', 'данные ограничены', 'не задано в формате для автоматического сравнения', 'Workout Files', 'FIT', 'segment_analysis', 'parser', 'coverage', 'data_quality'.",
    "- Шаблонные AI-фразы: 'ты держался молодцом', 'поддерживая нужный настрой', 'что говорит о хорошем настрое', 'отличный результат', 'продуктивная неделя', 'молодец' как стандартное завершение.",
    "- Не выводи настроение, мотивацию или характер из цифр («хороший настрой», «внимание к нагрузке»), если это не следует явно из данных.",
    "- Не используй конструкцию «что говорит о…» для выводов из цифр. Вместо этого: «Перевыполнение небольшое, в пределах нормы.»",
    "- Медицинские/тревожные формулировки, диагнозы, 'срочно', 'перетренированность', 'организм не восстановился', 'недовосстановление', 'нельзя тренироваться'.",
    "- Если recovery_context.decision начинается с skipped_ или include_in_athlete_report=false — раздел «Восстановление» полностью пропусти. Не пиши 'данных недостаточно' и не объясняй отсутствие recovery.",
    "",
    "ТОН И ВАРИАТИВНОСТЬ:",
    "- Обращение на 'ты'.",
    "- Звучит как сообщение живого тренера, не как системный отчёт.",
    "- Предпочитай приземлённые coach-фразы, если они подходят фактам: 'Неделя получилась ровной.', 'План выполнен без пропусков.', 'Перевыполнение небольшое, в пределах нормы.', 'Объём набран спокойно.', 'Ключевая работа сделана.', 'Хорошая рабочая неделя.'",
    "- Не повторяй одну и ту же похвалу или формулу закрытия из недели в неделю. Формулировки должны опираться на то, что реально было на этой неделе.",
    "- Без диагнозов и пугающих выводов.",
  ];
}

function buildAthleteFacingDataRules(): string[] {
  return [
    "ПРАВИЛА ДАННЫХ (внутренние, не озвучивай ограничения системы спортсмену):",
    "- Если planned.distance_km отсутствует или week_metrics.data_quality.planned_distance_available=false, не пиши, что дистанция совпала с планом.",
    "- Если parser не нашёл planned.targets.hr_bpm, не придумывай цели по пульсу и не оценивай пульс как 'в цели/вне цели'.",
    "- Без цели по пульсу: только факт ('средний пульс 168'), без 'хорошо контролировал пульс', 'пульс в норме' и подобных выводов, если данные этого не поддерживают.",
    "- Если planned.targets.pace_ranges пуст, не говори о темповых ориентирах как о заданных.",
    "- Если planned.targets.pace_ranges есть, но planned.targets.pace_min_per_km=null, не говори спортсмену про 'несколько диапазонов' или ограничения сравнения — просто опиши факт и coach-наблюдение по segment_comparison, если оно есть.",
    "- Если workouts[].comparison.data_quality_flags.whole_workout_pace_comparison_suppressed=true, не сравнивай средний темп всей тренировки с planned.targets.pace_min_per_km.",
    "- Если suspicious_if или suspicious_tss=true, полностью игнорируй IF/TSS в тексте для спортсмена.",
    "- Для сводного факта каждой тренировки используй только workouts[].completed: duration_text / completed_duration_minutes, distance_km / distance_text, avg_pace_text, heart_rate_average (если есть). Никогда не подставляй segment_comparison[].actual как факт всей тренировки.",
    "- Если есть duration_text, distance_text или avg_pace_text, используй их как в JSON, без округления (например 15.02 км, 1:35, 6:19/км). В факте дистанции пиши «км», даже если в JSON было «km».",
    "- segment_comparison используй только для coach-наблюдения (интервалы, просадка темпа к концу и т.п.), без технических терминов.",
    "- Для темпа блока используй только avg_pace_text и planned_targets.pace_text; не конвертируй avg_pace_min_per_km вручную.",
    "- Если pace_vs_target.status='unknown', не пиши, что темп был в диапазоне / быстрее / медленнее.",
    "- Если hr_vs_target.status='unknown', по пульсу — только факт ('средний пульс 147'), без оценки соответствия плану.",
    "- Для интервальных тренировок суммируй повторы; не перечисляй каждый, если не нужно. Если последние повторы медленнее: 'к концу серии темп немного просел, похоже на накопление усталости'.",
    "- Если workout.classification.is_skipped=true, напиши просто, что тренировка была пропущена.",
    "- Упоминай только non-null метрики.",
  ];
}

function buildAthleteFacingRecoveryRules(): string[] {
  return [
    "ВОССТАНОВЛЕНИЕ (только при include_in_athlete_report=true и decision='included'):",
    "- 2–3 коротких предложения простым языком под меткой «Восстановление».",
    "- Сон главный сигнал. Если avg_sleep_hours < 6.5 или nights_sleep_lt_6h >= 2, предпочитай одну связную фразу:",
    "  «Сон был коротковат: в среднем около 6 часов 20 минут, несколько ночей меньше 6 часов.»",
    "- Длительность сна по-человечески, не десятичные часы.",
    "- Garmin charge/readiness: «Garmin показывал невысокую оценку заряда.» Без технического жаргона Garmin.",
    "- Можно мягко успокоить: «Это не повод для тревоги, но может влиять на ощущения на тренировках.»",
    "- Не пиши: «динамика показателей», «динамика показателей восстановления», HRV, baseline, Body Battery, readiness score и подобное.",
    "- Если сон без явных ограничений — раздел «Восстановление» можно опустить или сделать одной нейтральной фразой.",
  ];
}

function buildUserPrompt(summary: WeeklySummary, recoveryContext: RecoveryContextForPrompt | null): string {
  return [
    "Сгенерируй короткий athlete-facing недельный отчёт тренера для Telegram.",
    "Отчёт полностью на русском, обращение на «ты», без технического аудита.",
    "",
    "Структура (plain text, метки разделов без markdown):",
    "Итог недели",
    "Цифры",
    "Как прошли тренировки",
    "Восстановление (если есть данные)",
    "закрывающее предложение",
    "",
    "Используй week_metrics.plan_vs_fact, week_metrics.counts и totals для блока «Цифры». Единицы: «км», не «km».",
    "Разница с планом в %: только «+3%», «+5%», «примерно +3%»; не «плюс три процента», не «103 процентов», не «процентов» в строках цифр и в «Итог недели».",
    "Перевыполнение по времени: «По времени: чуть больше плана, примерно +3%», не «103 процентов».",
    "По каждой тренировке в «Как прошли тренировки»: дата + короткое название; факт из workouts[].completed (duration_text, distance_text или distance_km, avg_pace_text, heart_rate_average) без округления готовых полей; одно coach-наблюдение.",
    "segment_comparison — только для coach-наблюдения (интервалы, просадка к концу), не как факт всей тренировки.",
    "Не используй символы — и –. Не упоминай IF, TSS, HRV, baseline, автоматическое сравнение, разбор по блокам, Workout Files, FIT, parser, data_quality.",
    "Не добавляй разделы «Ключевые расхождения», «Риски и наблюдения», «Что скорректировать», «Вопросы спортсмену».",
    "Избегай шаблонов: «ты держался молодцом», «что говорит о…», «отличный результат», «продуктивная неделя», «молодец» в конце.",
    "Пульс без цели в плане: только факт, без «хорошо контролировал пульс».",
    "Формулировки и закрытие привязывай к фактам этой недели, не копируй одну и ту же похвалу каждую неделю.",
    "Если recovery_context.include_in_athlete_report=true и decision='included' — раздел «Восстановление» простым языком (сон, оценка заряда Garmin). Иначе раздел «Восстановление» не пиши.",
    "",
    "recovery_context (optional):",
    JSON.stringify(recoveryContext, null, 2),
    "",
    "weekly-summary.json:",
    JSON.stringify(summary, null, 2)
  ].join("\n");
}

async function requestReportMarkdown(params: {
  apiKey: string;
  model: string;
  summary: WeeklySummary;
  recoveryContext: RecoveryContextForPrompt | null;
}): Promise<string> {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt()
        },
        {
          role: "user",
          content: buildUserPrompt(params.summary, params.recoveryContext)
        }
      ]
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error("OpenAI response did not include report text.");
  }

  return `${stripMarkdownFences(content)}\n`;
}

async function buildRecoveryContext(input: {
  args: CliArgs;
  summary: WeeklySummary;
}): Promise<RecoveryContextForPrompt> {
  const inputStudent = input.summary.student_id || input.args.student;
  const fallbackName = input.args.student;

  try {
    const supabase = createClient(
      getRequiredSupabaseEnv("SUPABASE_URL"),
      getRequiredSupabaseEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const lookupTokens = new Set<string>();
    addLookupToken(lookupTokens, inputStudent);
    addLookupToken(lookupTokens, input.args.student);
    let studentName = fallbackName;

    try {
      const students = await readStudentsConfig();
      const configMatch = students.find((student) => {
        const studentIdToken = normalizeMatchValue(student.student_id);
        const studentNameToken = normalizeMatchValue(student.name ?? "");
        return lookupTokens.has(studentIdToken) || (studentNameToken ? lookupTokens.has(studentNameToken) : false);
      });
      if (configMatch) {
        addLookupToken(lookupTokens, configMatch.student_id);
        addLookupToken(lookupTokens, configMatch.name);
        studentName = configMatch.name || studentName;
      }
    } catch {
      debugLog("Recovery context: students config unavailable, using student_id as label.");
    }

    const runtimeStudentOr = await (async () => {
      const { data, error } = await supabase
        .from("trainingpeaks_students")
        .select("id, student_id, student_name")
        .eq("is_active", true);
      if (error) {
        throw new Error(`Failed to read trainingpeaks_students for recovery resolution: ${error.message}`);
      }
      const runtimeStudents = (data as RuntimeStudentRow[] | null) ?? [];
      return runtimeStudents.find((student) => {
        const tokens = [
          normalizeMatchValue(student.id),
          normalizeMatchValue(student.student_id),
          normalizeMatchValue(student.student_name),
        ];
        return tokens.some((token) => lookupTokens.has(token));
      });
    })();

    if (runtimeStudentOr) {
      addLookupToken(lookupTokens, runtimeStudentOr.id);
      addLookupToken(lookupTokens, runtimeStudentOr.student_id);
      addLookupToken(lookupTokens, runtimeStudentOr.student_name);
      studentName = runtimeStudentOr.student_name || studentName;
    }

    const { data: profileRowsRaw, error: profilesError } = await supabase
      .from("trainingpeaks_student_health_metric_profiles")
      .select("student_id, student_name, status, recovery_metrics_enabled");
    if (profilesError) {
      throw new Error(`Failed to read recovery profiles: ${profilesError.message}`);
    }
    const profileRows = (profileRowsRaw as HealthMetricProfileRow[] | null) ?? [];
    const profile = profileRows.find((row) => {
      const idToken = normalizeMatchValue(row.student_id);
      const nameToken = normalizeMatchValue(row.student_name);
      return lookupTokens.has(idToken) || lookupTokens.has(nameToken);
    });

    if (!profile) {
      return {
        decision: "skipped_no_profile",
        student_id: runtimeStudentOr?.id ?? inputStudent,
        student_name: studentName,
        profile: null,
        summary: null,
        include_in_athlete_report: false,
      };
    }

    const { data: metricRows, error: metricsError } = await supabase
      .from("trainingpeaks_health_metrics_cache")
      .select("metric_key, metric_date, value_numeric, value_avg_numeric")
      .eq("student_id", profile.student_id)
      .gte("metric_date", input.args.from)
      .lte("metric_date", input.args.to)
      .order("metric_date", { ascending: true })
      .order("metric_timestamp", { ascending: true })
      .order("metric_type_id", { ascending: true });
    if (metricsError) {
      throw new Error(`Failed to read health metrics cache: ${metricsError.message}`);
    }
    const rows = (metricRows as HealthMetricCacheRow[] | null) ?? [];
    if (rows.length === 0) {
      return {
        decision: "skipped_no_cache",
        student_id: profile.student_id,
        student_name: profile.student_name,
        profile: {
          status: profile.status,
          recovery_metrics_enabled: profile.recovery_metrics_enabled,
        },
        summary: null,
        include_in_athlete_report: false,
      };
    }

    const recoverySummary = buildTrainingPeaksRecoverySummary({
      studentName: profile.student_name,
      from: input.args.from,
      to: input.args.to,
      profile: {
        status: profile.status,
        recovery_metrics_enabled: profile.recovery_metrics_enabled,
      },
      metrics: rows.map((row) => ({
        metric_key: row.metric_key,
        metric_date: row.metric_date,
        value_numeric: row.value_numeric,
        value_avg_numeric: row.value_avg_numeric,
      })),
      baseline: null,
    });

    const include =
      profile.recovery_metrics_enabled &&
      (recoverySummary.status === "ready" || recoverySummary.status === "partial");

    return {
      decision: include ? "included" : "skipped_insufficient_data",
      student_id: profile.student_id,
      student_name: profile.student_name,
      profile: {
        status: profile.status,
        recovery_metrics_enabled: profile.recovery_metrics_enabled,
      },
      summary: recoverySummary,
      include_in_athlete_report: include,
    };
  } catch (error: unknown) {
    const safeReason = getSafeErrorReason(error);
    debugLog("Recovery context failed, returning skipped_error:", safeReason);
    return {
      decision: "skipped_error",
      student_id: inputStudent,
      student_name: fallbackName,
      profile: null,
      summary: null,
      include_in_athlete_report: false,
      error: safeReason,
    };
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const args = parseArgs(process.argv.slice(2));
  const summaryPath = path.join(parsedRoot, args.student, `${args.from}_${args.to}`, "weekly-summary.json");
  const reportDir = path.join(reportsRoot, args.student, `${args.from}_${args.to}`);
  const reportMarkdownPath = path.join(reportDir, "report-draft.md");
  const reportJsonPath = path.join(reportDir, "report-draft.json");
  const coachNotesPath = path.join(reportDir, "coach-notes.json");

  if (!existsSync(summaryPath)) {
    throw new Error(`Weekly summary does not exist: ${summaryPath}`);
  }

  const apiKey = getRequiredEnv("OPENAI_API_KEY");
  const model = getReportModel();

  console.log(`Report generation started: student=${args.student} week=${args.from}..${args.to}`);
  debugLog(`Summary path used: ${summaryPath}`);
  debugLog(`Report output folder: ${reportDir}`);
  debugLog(`Model used: ${model}`);

  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as WeeklySummary;
  const recoveryContext = await buildRecoveryContext({ args, summary });
  const recoveryDecision = recoveryContext.decision;
  console.log(`recovery_context: ${recoveryDecision}`);
  const reportMarkdown = await requestReportMarkdown({
    apiKey,
    model,
    summary,
    recoveryContext,
  });
  const createdAt = new Date().toISOString();
  const coachNotes = buildTrainingPeaksCoachNotes({
    summary,
    recoveryContext: recoveryContext as RecoveryContextForCoachNotes,
    generatedAt: createdAt,
  });

  const reportDraft: ReportDraft = {
    student_id: summary.student_id,
    week: {
      from: summary.week.from,
      to: summary.week.to
    },
    source_summary_path: relativeToToolRoot(summaryPath),
    coach_notes_path: relativeToToolRoot(coachNotesPath),
    model,
    created_at: createdAt,
    recovery_context: recoveryContext,
    coach_notes: coachNotes,
    report_markdown: reportMarkdown
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportMarkdownPath, reportMarkdown, "utf8");
  await writeFile(coachNotesPath, `${JSON.stringify(coachNotes, null, 2)}\n`, "utf8");
  await writeFile(reportJsonPath, `${JSON.stringify(reportDraft, null, 2)}\n`, "utf8");

  debugLog(`Created markdown path: ${reportMarkdownPath}`);
  debugLog(`Created coach notes path: ${coachNotesPath}`);
  debugLog(`Created json path: ${reportJsonPath}`);
  console.log(`Report generated: student=${args.student} week=${args.from}..${args.to}`);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
