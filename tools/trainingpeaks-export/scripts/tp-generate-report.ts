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
  student_id: string;
  week: {
    from: string;
    to: string;
  };
  source_files: string[];
  totals: {
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
  workouts: Array<{
    date: string | null;
    title: string | null;
    sport: string | null;
    planned_duration_minutes: number | null;
    completed_duration_minutes: number | null;
    distance_km: number | null;
    planned_distance_km: number | null;
    tss: number | null;
    if: number | null;
    rpe: number | null;
    description: string | null;
    avg_hr: number | null;
    max_hr: number | null;
    avg_pace_min_per_km: number | null;
    avg_pace_text: string | null;
    duration_text: string | null;
    planned_duration_text: string | null;
    distance_text: string | null;
    intensity_flags: string[];
    data_warnings: string[];
    athlete_comments: string | null;
    coach_comments: string | null;
    source_file: string;
  }>;
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
    "Ты спортивный тренер и готовишь краткий недельный черновик отчета для спортсмена на русском языке.",
    "Используй weekly-summary.json как единственный источник данных.",
    "Ничего не придумывай: не добавляй тренировки, цели, старты, травмы, причины, контекст или выводы, которых нет в данных.",
    "Если data_warnings содержат suspicious_if или suspicious_tss, не опирайся на IF/TSS в выводах.",
    "Предпочитай distance, duration, HR, RPE, описания тренировок и выполнение плана.",
    "Если HR выглядит высоким, формулируй осторожно: 'пульс был высоким для части работы', без медицинских диагнозов.",
    "Тон: дружелюбный тренер, коротко и по делу, без фальшивой точности, без излишней похвалы и без жесткой критики.",
    "Отчет должен быть пригоден для отправки атлету после проверки тренером.",
    "Если в данных есть ограничения, упоминай их спокойно и только если это полезно.",
    "Верни только Markdown без пояснений вне отчета.",
    "Используй ровно эту структуру и заголовки:",
    "1. Приветствие",
    "2. Краткий итог недели",
    "3. Что получилось хорошо",
    "4. На что обратить внимание",
    "5. По тренировкам",
    "6. Вывод тренера",
    "7. Фокус на следующую неделю"
  ].join("\n");
}

function buildUserPrompt(summary: WeeklySummary): string {
  return [
    "Сгенерируй краткий недельный отчет для спортсмена по этим данным.",
    "Сохрани отчет компактным и полезным.",
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

  console.log(`Summary path used: ${summaryPath}`);
  console.log(`Report output folder: ${reportDir}`);
  console.log(`Model used: ${model}`);

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

  console.log(`Created markdown path: ${reportMarkdownPath}`);
  console.log(`Created json path: ${reportJsonPath}`);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
