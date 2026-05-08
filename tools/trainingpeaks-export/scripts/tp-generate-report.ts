import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
  model: string;
  created_at: string;
  report_markdown: string;
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

function getReportModel(): string {
  return process.env.OPENAI_REPORT_MODEL?.trim() || DEFAULT_REPORT_MODEL;
}

function stripMarkdownFences(markdown: string): string {
  const trimmed = markdown.trim();
  const fencedMatch = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function buildSystemPrompt(): string {
  return [
    "Ты готовишь черновик недельного отчета тренера по бегу на русском языке.",
    "Используй weekly-summary.json как единственный источник данных.",
    "Опирайся в первую очередь на детерминированные поля: week_metrics, source.workout_files, segment_analysis, workouts[].classification, workouts[].planned, workouts[].completed, workouts[].comparison, workouts[].segment_analysis, workouts[].segment_comparison.",
    "Не рассчитывай выводы из raw-строк и не делай собственные агрегаты из сырых полей, если уже есть нормализованные значения.",
    "Не придумывай недостающие данные, цели, причины, самочувствие, травмы, прогресс, объем, зоны или выводы.",
    "Если planned.distance_km отсутствует или week_metrics.data_quality.planned_distance_available=false, не пиши, что дистанция совпала с планом.",
    "Если parser не нашел planned.targets.hr_bpm, не придумывай цели по пульсу.",
    "Если planned.targets.pace_ranges пуст, не говори о темповых ориентирах как о заданных.",
    "Если planned.targets.pace_ranges есть, но planned.targets.pace_min_per_km=null, не говори, что цели по темпу отсутствуют.",
    "В этом случае явно пиши, что темповые ориентиры есть в описании, но диапазонов несколько или они неоднозначны, поэтому автоматическое сравнение ограничено.",
    "Если planned.targets.pace_min_per_km задан, можно сравнивать фактический средний темп только с этим диапазоном.",
    "Если данные неполные, используй формулировки вроде 'по доступным данным' и явно называй, что именно нельзя оценить.",
    "Приоритет: mismatch_flags, coach_attention_flags, classification, plan_vs_fact, затем уже вторичные детали.",
    "Если suspicious_if или suspicious_tss=true, упоминай это как ограничение данных и не строй сильные выводы на IF/TSS.",
    "Для анализа по блокам используй только workouts[].segment_analysis и workouts[].segment_comparison.",
    "Никогда не оценивай отдельные блоки тренировки по whole-workout average pace/HR.",
    "Для фактического темпа блока используй только workouts[].segment_comparison[].actual.avg_pace_text.",
    "Для планового темпа блока используй workouts[].segment_comparison[].planned_targets.pace_text, если оно есть.",
    "Не конвертируй avg_pace_min_per_km вручную и не печатай десятичные значения темпа напрямую.",
    "Если у блока нет formatted pace text, не угадывай и не выводи темп текстом.",
    "Никогда не выводи фактические метрики блока, если их нет в workouts[].segment_comparison[].actual.",
    "Никогда не придумывай block-level pace/HR/distance и не рассчитывай их вручную.",
    "Если workouts[].segment_comparison[] недоступен, можно опираться только на planned.segments и сводку по тренировке, но без фактических метрик отдельных блоков.",
    "Если workouts[].segment_analysis.available=false, явно называй причину: fit_not_matched, unsupported_repeats, unsupported_segments, timer_time_unavailable, fit_parse_failed.",
    "Если source.workout_files.present=false или top-level segment_analysis.reason='no_workout_files', то в режиме fallback для каждой такой тренировки используй причину отсутствия Workout Files, а не fit_not_matched.",
    "Если workouts[].segment_comparison[].coverage='partial', явно пиши: 'Вывод только по доступной части блока.'",
    "Если coverage='missing', не пиши фактические метрики этого блока.",
    "Если coverage='unsupported', пиши, что автоматическое сравнение блока недоступно.",
    "Если pace_vs_target.status='unknown', не пиши, что темп был в диапазоне / быстрее / медленнее.",
    "Если hr_vs_target.status='unknown', не пиши, что пульс был в пределах / выше / ниже цели.",
    "Упоминай только non-null метрики.",
    "Для названия блока предпочитай segment.label; не называй беговой блок 'отдыхом' только из-за is_rest=true, если label говорит иначе.",
    "На одну тренировку выводи не более 3 блоков; сначала самые важные: mismatched, partial/missing/unsupported, затем warmup/main/cooldown.",
    "Для interval-heavy тренировок кратко суммируй повторы вместо перечисления каждого.",
    "Отчет должен быть компактным и Telegram-friendly.",
    "Раздел 2 всегда должен содержать один короткий bullet про доступность разбора по блокам.",
    "Если top-level segment_analysis.available=true, используй формулировку уровня: 'Разбор по блокам доступен для X тренировок...'.",
    "Если top-level segment_analysis.reason='no_workout_files', используй формулировку уровня: 'Разбор по блокам недоступен: Workout Files отсутствуют, поэтому доступны только сводные данные Workout Summary.'",
    "Если top-level segment_analysis.reason='no_matches', используй формулировку уровня: 'Workout Files есть, но тренировки не удалось надежно сопоставить с FIT-файлами.'",
    "Если planned сегментов в неделе нет или segment_analysis.reason='not_computed', коротко укажи, что разбор по блокам не применялся.",
    "Если workout.classification.is_skipped=true или workout.classification.type='planned_skipped', обязательно пиши: 'Тренировка пропущена, разбор по блокам не требуется.' Не упоминай FIT matching, fit_not_matched или причины недоступности блоков для такой тренировки.",
    "Раздел 3: для каждой тренировки выбери один режим.",
    "Режим A, segment-aware: если workout.segment_analysis.available=true и workout.segment_comparison.length>0. В этом режиме предпочитай segment_comparison над whole-workout comparison.",
    "Режим B, segment fallback: если planned.segments есть, но workout.segment_analysis.available=false. В этом режиме объясни причину недоступности блоков и не пиши фактический pace/HR отдельных блоков.",
    "Режим C, legacy workout-level: если planned.segments нет или детализация по блокам не добавляет ценности.",
    "В режиме A используй компактный формат вроде: 'План: Разминка — 10 мин @ 5:44–5:57/км. Факт: 10 мин, 1.72 км, 5:50/км, средний пульс 142. Оценка: темп в диапазоне.' Используй только готовые pace_text поля.",
    "В режиме B используй формулировки вроде: 'Разбор по блокам недоступен: Workout Files отсутствуют, поэтому доступны только сводные данные Workout Summary.', 'Разбор по блокам недоступен: не удалось сопоставить тренировку с FIT-файлом.', 'Разбор по блокам недоступен: структура повторов в плане пока не поддерживается автоматически.', 'Разбор по блокам недоступен: в FIT нет надежной timer_time-разметки.', 'Разбор по блокам недоступен: блоки есть, но автоматическое сравнение ограничено.'. Для skipped-тренировки вместо этого всегда используй: 'Тренировка пропущена, разбор по блокам не требуется.'",
    "Тон: кратко, профессионально, по-тренерски, без воды и без чрезмерной уверенности.",
    "Верни только Markdown без пояснений вне отчета.",
    "Используй ровно эту структуру и заголовки:",
    "## 1. Краткий вывод тренера",
    "## 2. План vs факт за неделю",
    "## 3. Разбор по тренировкам",
    "## 4. Ключевые расхождения",
    "## 5. Риски и наблюдения",
    "## 6. Что скорректировать на следующей неделе",
    "## 7. Вопросы спортсмену"
  ].join("\n");
}

function buildUserPrompt(summary: WeeklySummary): string {
  return [
    "Сгенерируй компактный и полезный недельный отчет тренера.",
    "Важно:",
    "- Отчет должен быть полностью на русском языке.",
    "- Для раздела 'План vs факт за неделю' используй week_metrics.plan_vs_fact и week_metrics.counts.",
    "- Для разбора по тренировкам опирайся на workouts[].classification, workouts[].comparison, workouts[].segment_analysis и workouts[].segment_comparison.",
    "- Явно отмечай skipped, extra, duration/distance deltas и HR/pace mismatches, только если они есть в deterministic fields.",
    "- Не утверждай, что дистанция совпала с планом, если planned distance отсутствует.",
    "- Не утверждай, что пульс соответствовал цели, если parser не нашел planned.targets.hr_bpm.",
    "- Различай три случая по темпу: целей нет; есть один сравнимый диапазон; есть несколько диапазонов и сравнение ограничено.",
    "- Если planned.targets.pace_ranges.length > 0 и planned.targets.pace_min_per_km == null, не пиши 'цели по темпу отсутствуют'.",
    "- Для такой тренировки предпочитай формулировку вида: 'Темповые ориентиры в плане: 5:44–5:57/км, 5:20–5:31/км. Автоматическое сравнение с одним целевым темпом ограничено.' Используй planned.targets.pace_ranges[].text, если оно есть.",
    "- Если week_metrics.data_quality.planned_pace_ranges_found > 0 и week_metrics.data_quality.planned_pace_targets_found == 0, в недельном summary явно скажи: 'Темповые ориентиры есть в описаниях тренировок, но часто указаны несколькими диапазонами, поэтому точное автоматическое сравнение ограничено.'",
    "- Если есть data_quality warnings, кратко укажи ограничения оценки.",
    "- Для анализа по блокам используй только workouts[].segment_analysis и workouts[].segment_comparison[].",
    "- Не делай выводы по отдельным блокам из whole-workout average pace/HR.",
    "- Для темпа блока используй только workouts[].segment_comparison[].actual.avg_pace_text и workouts[].segment_comparison[].planned_targets.pace_text.",
    "- Не конвертируй workouts[].segment_comparison[].actual.avg_pace_min_per_km вручную и не печатай decimal pace напрямую.",
    "- Если pace_text отсутствует, не угадывай и не выводи темп текстом.",
    "- Если segment_comparison недоступен, не пиши фактический темп/пульс/дистанцию блока.",
    "- Если top-level segment_analysis.available=true, в разделе 2 добавь короткий bullet вида: 'Разбор по блокам доступен для X тренировок...'.",
    "- Если source.workout_files.present=false или top-level segment_analysis.reason='no_workout_files', в разделе 2 добавь: 'Разбор по блокам недоступен: Workout Files отсутствуют, поэтому доступны только сводные данные Workout Summary.'",
    "- Если top-level segment_analysis.reason='no_matches', в разделе 2 добавь: 'Workout Files есть, но тренировки не удалось надежно сопоставить с FIT-файлами.'",
    "- Если workout.classification.is_skipped=true или workout.classification.type='planned_skipped', пиши ровно: 'Тренировка пропущена, разбор по блокам не требуется.' Не упоминай FIT matching и segment_analysis.reason для такой тренировки.",
    "- Для тренировки с available segment comparison используй компактные формулировки вида: 'Разбор по блокам доступен.', 'План: Разминка — 10 мин @ 5:44–5:57/км.', 'Факт: 10 мин, 1.72 км, 5:50/км, средний пульс 142.', 'Оценка: темп в диапазоне.'. Используй только готовые pace_text поля.",
    "- Для partial coverage пиши: 'Вывод только по доступной части блока.'",
    "- Если source.workout_files.present=false или top-level segment_analysis.reason='no_workout_files', то для всех тренировок в fallback используй формулировку про отсутствие Workout Files, а не про несопоставленный FIT.",
    "- Для fallback используй формулировки вроде: 'Разбор по блокам недоступен: Workout Files отсутствуют, поэтому доступны только сводные данные Workout Summary.', 'Разбор по блокам недоступен: не удалось сопоставить тренировку с FIT-файлом.', 'Разбор по блокам недоступен: структура повторов в плане пока не поддерживается автоматически.'. Для skipped не используй fallback-причины.",
    "- Не перечисляй больше 3 блоков на тренировку; для интервальных работ суммируй повторы.",
    "- Не используй source.workout_files, segment_analysis или segment_comparison для собственных вычислений; только для аккуратного описания того, что уже есть в JSON.",
    "- Не используй raw для собственных расчетов.",
    "",
    "weekly-summary.json:",
    JSON.stringify(summary, null, 2)
  ].join("\n");
}

async function requestReportMarkdown(params: {
  apiKey: string;
  model: string;
  summary: WeeklySummary;
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
          content: buildUserPrompt(params.summary)
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

async function main(): Promise<void> {
  loadDotEnvFile(path.join(toolRoot, ".env"));

  const args = parseArgs(process.argv.slice(2));
  const summaryPath = path.join(parsedRoot, args.student, `${args.from}_${args.to}`, "weekly-summary.json");
  const reportDir = path.join(reportsRoot, args.student, `${args.from}_${args.to}`);
  const reportMarkdownPath = path.join(reportDir, "report-draft.md");
  const reportJsonPath = path.join(reportDir, "report-draft.json");

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
  const reportMarkdown = await requestReportMarkdown({
    apiKey,
    model,
    summary
  });
  const createdAt = new Date().toISOString();

  const reportDraft: ReportDraft = {
    student_id: summary.student_id,
    week: {
      from: summary.week.from,
      to: summary.week.to
    },
    source_summary_path: relativeToToolRoot(summaryPath),
    model,
    created_at: createdAt,
    report_markdown: reportMarkdown
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportMarkdownPath, reportMarkdown, "utf8");
  await writeFile(reportJsonPath, `${JSON.stringify(reportDraft, null, 2)}\n`, "utf8");

  debugLog(`Created markdown path: ${reportMarkdownPath}`);
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
