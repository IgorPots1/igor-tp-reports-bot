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

type WeeklySummary = {
  schema_version?: string;
  student_id: string;
  week: {
    from: string;
    to: string;
  };
  source_files: string[];
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
  workouts: Array<Record<string, unknown>>;
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
    "Опирайся в первую очередь на детерминированные поля: week_metrics, workouts[].classification, workouts[].planned, workouts[].completed, workouts[].comparison.",
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
    "- Для разбора по тренировкам опирайся на workouts[].classification и workouts[].comparison.",
    "- Явно отмечай skipped, extra, duration/distance deltas и HR/pace mismatches, только если они есть в deterministic fields.",
    "- Не утверждай, что дистанция совпала с планом, если planned distance отсутствует.",
    "- Не утверждай, что пульс соответствовал цели, если parser не нашел planned.targets.hr_bpm.",
    "- Различай три случая по темпу: целей нет; есть один сравнимый диапазон; есть несколько диапазонов и сравнение ограничено.",
    "- Если planned.targets.pace_ranges.length > 0 и planned.targets.pace_min_per_km == null, не пиши 'цели по темпу отсутствуют'.",
    "- Для такой тренировки предпочитай формулировку вида: 'Темповые ориентиры в плане: 5:44–5:57/км, 5:20–5:31/км. Автоматическое сравнение с одним целевым темпом ограничено.' Используй planned.targets.pace_ranges[].text, если оно есть.",
    "- Если week_metrics.data_quality.planned_pace_ranges_found > 0 и week_metrics.data_quality.planned_pace_targets_found == 0, в недельном summary явно скажи: 'Темповые ориентиры есть в описаниях тренировок, но часто указаны несколькими диапазонами, поэтому точное автоматическое сравнение ограничено.'",
    "- Если есть data_quality warnings, кратко укажи ограничения оценки.",
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
