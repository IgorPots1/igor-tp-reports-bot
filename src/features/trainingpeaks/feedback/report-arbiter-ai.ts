// Haiku report-arbiter (наряд «ИИ решает, отчёт это или нет»). Four regex iterations couldn't
// separate «сделала длительную» (report) from «переставьте длительную» (request) or «завтра побегу»
// (plan) — that's meaning, not keywords. A one-word Haiku pass reads intent, given the message + the
// «была ли тренировка в окне» context the SWEEP has (that's why it runs in the sweep, not at ingest).
//
// Mirrors factor-extraction-ai.ts: raw fetch, graceful degradation — NEVER throws; any failure
// (disabled, no key, HTTP error, unparseable) returns null so the caller falls back to the regex
// report_like label. Output is a single word (max_tokens 8, no rationale) to keep it cheap.

export type ReportVerdict = "report" | "clarification" | "not_report";

const CLAUDE_MODEL = process.env.FEEDBACK_ARBITER_MODEL?.trim() || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Generous prefilter: forward anything that MIGHT be a report (misses are often keyword-less, so we do
// NOT gate on run-words alone). Only the obviously-not (empty, bare «спасибо»/sticker, pure payment)
// skip Haiku. report_like / weak labels always qualify. Cheap boolean, no model call.
const RUN_KW = /бег|побег|пробеж|отбег|выбег|трениров|интервал|длительн|темпов|разминк|заминк|\bкм\b|лонг|дистанц|стади|дорожк|манеж|восстанов|легк|устал|тяжел|далось|дал[оа]сь|пульс|темп|финиш|сплит|заб(е|её)г/iu;
const DONE_MARK = /сделал|готов|отбега|пробеж|финиш|осилил|добежал|выбежал|добила|набегал/iu;

export function isReportCandidate(text: string, labels: string[]): boolean {
  if (labels.includes("report_like") || labels.includes("weak_report_confirmation")) return true;
  const t = (text ?? "").trim();
  if (t.length < 2) return false;
  return /\d/.test(t) || RUN_KW.test(t) || /[✅✔👍💪🏃]/u.test(t) || DONE_MARK.test(t);
}

export function buildArbiterPrompt(text: string, hadRun: boolean): string {
  return [
    `Контекст: у ученика ${hadRun ? "БЫЛА" : "НЕ БЫЛА"} беговая тренировка в последние 1-2 дня.`,
    "",
    `Сообщение ученика: """${text}"""`,
    "",
    "Что это? Ответь ОДНИМ словом — report, clarification или not_report:",
    "- report — ОТЧЁТ о ВЫПОЛНЕННОЙ тренировке: как прошла, ощущения, «сделал/пробежала/✅», данные бега, даже без слова «бег». ВКЛЮЧАЯ ЗАПОЗДАЛЫЙ отчёт («забыла отписать про вчерашние интервалы, всё ок, GPS не работал») — это report, даже если написано с опозданием и раньше про этот бег не писали.",
    "- clarification — уточнение/ответ по УЖЕ рассказанной тренировке: бери ТОЛЬКО если ученик ранее в разговоре УЖЕ отчитался про этот бег и теперь добавляет деталь. Если прежнего отчёта не было — это report, а не clarification.",
    "- not_report — НЕ отчёт: просьба перенести/поставить тренировку, план на будущее («завтра побегу»), вопрос тренеру, болтовня, про третьих лиц (рилс/подруга), оплата, самочувствие/болезнь без пробежки, велосипед/зал вместо бега.",
    "",
    "Ответь строго одним словом: report / clarification / not_report",
  ].join("\n");
}

/** Pure mapping from the (cached-or-fresh) AI label to the sweep's decision, with the regex fallback
 *  baked in. aiLabel === null means "arbiter off / errored for this message" → behave exactly as the
 *  pre-arbiter sweep (report_like → report; weak → report with the start-time gate; else drop). */
export function resolveArbiterDecision(input: { aiLabel: ReportVerdict | null; isReportLike: boolean; isWeak: boolean }): { kind: "report" | "clarification" | "drop"; weak: boolean } {
  if (input.aiLabel === "report") return { kind: "report", weak: false };
  if (input.aiLabel === "clarification") return { kind: "clarification", weak: false };
  if (input.aiLabel === "not_report") return { kind: "drop", weak: false };
  // fallback: regex behaviour
  if (input.isReportLike) return { kind: "report", weak: false };
  if (input.isWeak) return { kind: "report", weak: true };
  return { kind: "drop", weak: false };
}

function parseVerdict(raw: string): ReportVerdict | null {
  const s = raw.toLowerCase();
  // order matters: "not_report" contains "report"; check the specific labels first
  if (/not[_\s-]?report/.test(s)) return "not_report";
  if (s.includes("clarification") || s.includes("уточнен")) return "clarification";
  if (s.includes("report") || s.includes("отчёт") || s.includes("отчет")) return "report";
  return null;
}

/** Classify one message. Returns the verdict, or null on ANY failure (disabled/no key/HTTP/parse) so
 *  the caller falls back to the regex label. Enabled only when FEEDBACK_AI_ARBITER_ENABLED=1. */
export async function classifyReport(text: string, hadRun: boolean): Promise<ReportVerdict | null> {
  const enabled = process.env.FEEDBACK_AI_ARBITER_ENABLED?.trim() === "1";
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!enabled || !apiKey || !(text ?? "").trim()) return null;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 8, system: "Отвечай строго одним словом.", messages: [{ role: "user", content: buildArbiterPrompt(text, hadRun) }] }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { content?: Array<{ type: string; text: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const out = payload.content?.find((b) => b.type === "text")?.text?.trim();
    if (!out) return null;
    // Cost is tracked in the Anthropic console; ai_call_logs INSERT is grant-blocked for feedback_*
    // sites (pre-existing), so we don't log here — a per-message console.warn ×60/sweep is pure noise.
    return parseVerdict(out);
  } catch {
    return null;
  }
}
