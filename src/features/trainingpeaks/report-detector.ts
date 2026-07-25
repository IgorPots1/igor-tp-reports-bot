// Pure, dependency-free detector for "is this Telegram message a completed-training report?".
// Split out of context-observer.ts so it can be unit-tested with plain `node --test` (no @/
// aliases, no Supabase). This is the load-bearing gate for message-triggered feedback generation:
// a missed report means the coach never sees the student's words, so recall matters most, with
// precision kept in check (was ~8% false, keep no worse).
//
// Boundary note: JS \b and \w are ASCII-only and never match around/within Cyrillic, so a
// word-start is spelled (?<![а-яёa-z0-9]) and a stem tail is [а-яё]*, never \b / \w*.

export function normalizeObserverText(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

const CYR_WS = "(?<![а-яёa-z0-9])"; // Cyrillic-safe word start

// Nouns that, with the length floor, hint at a training report even without a verb.
const TRAINING_REPORT_KEYWORDS = [
  "тренировка",
  "пробежка",
  "темп",
  "интервалы",
  "пульс",
  "hr",
  "км",
  "km",
  "workout",
  "run",
  "pace",
];
const OBSERVER_TRAINING_REPORT_MIN_LENGTH = 24;

// A first-person COMPLETED-run report often has no noun like "тренировка" — just a past-tense
// verb ("побегал, всё хорошо") below the length floor. Verbs target the PAST -л stem, NOT
// "побега"/"пробега" which also fire on the infinitive/future ("побегать", "побегу").
const TRAINING_REPORT_DONE_PATTERNS: RegExp[] = [
  /побежал/,
  /пробежал/,
  /побегал/,
  /пробегал/,
  new RegExp(`${CYR_WS}бегал`),
  new RegExp(`${CYR_WS}бежал`),
  /сбегал/,
  /отбегал/,
  /забегал/,
  /добежал/,
  /выбежал/,
  /выбегал/,
  /вбегал/,
  /потренировал/,
  /размял/,
  /финишировал/,
  // training noun immediately near a completed verb: "интервалы сделала", "длительная … прошла"
  /(трениров[а-яё]*|интервал[а-яё]*|длительн[а-яё]*|темпов[а-яё]*|пробежк[а-яё]*|отрезк[а-яё]*|дистанц[а-яё]*)\s.{0,24}(прошл|сделал|получил|дал|зашл|осил|отработал|выполнил|закончил)/,
];
// "беговое существительное + оценка" — a completed report phrased with no verb ("вчерашняя
// длительная, всё хорошо", "интервалы готовы, 7/10", "загрузила тренировку, было тяжело") and the
// literal "отчёт". Strong completion evidence: passes a trailing "?" (unlike weaker signals), and
// is only vetoed by a schedule request or first-person future intent.
const TRAINING_REPORT_PHRASE_PATTERNS: RegExp[] = [
  /отч[её]т|отчитыв/,
  /(трениров[а-яё]*|интервал[а-яё]*|длительн[а-яё]*|темпов[а-яё]*|пробежк[а-яё]*|пробеж[а-яё]*|лонг|разминк[а-яё]*).{0,32}(хорош|отличн|норм|легк|тяжел|тяжк|комфортн|прошл|готов|в порядке|в кайф|неплох|ужасн|далась|дался|устал|изжар)/,
  /(загрузил[а]?|выложил[а]?).{0,20}(трениров|пробеж|бег|занятие)/,
  /вернул(ся|ась).{0,15}(пробеж|трениров|стадион|бег)/,
];
// Schedule request ("перенеси/передвинь/поставь тренировку") — a plan change, not a report.
const TRAINING_SCHEDULE_REQUEST = /перенес|передвин|постав|перенос|перекин/;
// First-person FUTURE intent — refuses a non-verb report ("попробую …", "буду …"). Kept apart
// from weak markers (бы/завтра) that legitimately appear inside a completed-run report.
const TRAINING_STRONG_INTENT: RegExp[] = [
  /попроб/,
  /планир/,
  /собира[юе]/,
  new RegExp(`${CYR_WS}буду`),
  new RegExp(`${CYR_WS}начну`),
  new RegExp(`${CYR_WS}хочу`),
];
// A running-specific NUMERIC result is a report even without words: distance, marked pace, pulse
// ("10 км за 55 мин", "по 5:30", "пульс 165").
const TRAINING_REPORT_METRIC_PATTERNS: RegExp[] = [
  /\d{1,3}([.,]\d{1,2})?\s*(км|km)(?![а-яёa-z])/,
  /(по|темп[а-яё]*)\s*\d{1,2}[:.]\d{2}/,
  /\d{1,2}[:.]\d{2}\s*(мин|\/\s*км|на км|темп)/,
  /(пульс|чсс)\s*\d{2,3}/,
  /\d{2,3}\s*(уд|bpm)/,
];
// Any future intention / hypothetical / weak marker — used to veto a weak (metric/keyword) report.
const TRAINING_INTENT_PATTERNS: RegExp[] = [
  /попроб/,
  /планир/,
  /собира[юе]/,
  new RegExp(`${CYR_WS}буду`),
  new RegExp(`${CYR_WS}начну`),
  new RegExp(`${CYR_WS}хочу`),
  new RegExp(`${CYR_WS}бы(?![а-яёa-z])`),
  /завтра/,
  /послезавтра/,
  /на следующ/,
  /на этой неделе/,
];

/**
 * Decide if a NORMALIZED message (see normalizeObserverText) is a completed-training report, and
 * how confident. Returns a score in [0,1] or null. Precedence: a past-tense run VERB is decisive;
 * a report PHRASE is strong (a trailing "?" doesn't veto it, only a schedule request / future
 * intent); a metric or bare keyword is weak (any question / intent / schedule request vetoes it).
 * Negated run spans ("вчера не бегала") are dropped before the verb check.
 */
export function detectTrainingReport(normalizedInput: string): number | null {
  const normalized = normalizedInput.replace(/https?:\/\/\S+/g, " ");
  // Drop negated run spans ("вчера НЕ бегала") before the verb check — but keep a real report that
  // merely contains a negation elsewhere ("побегал, но не добежал"). The (?<!…) keeps "не" a word
  // so it never bites the "не" inside "стадиоНЕ бегала".
  const deNegated = normalized.replace(new RegExp(`${CYR_WS}не\\s+\\S{0,4}(бегал|бежал)[а-яё]*`, "g"), " ");
  const hasDoneVerb = TRAINING_REPORT_DONE_PATTERNS.some((re) => re.test(deNegated));
  const hasReportPhrase = TRAINING_REPORT_PHRASE_PATTERNS.some((re) => re.test(normalized));
  const hasMetric = TRAINING_REPORT_METRIC_PATTERNS.some((re) => re.test(normalized));
  const hasKeyword =
    normalized.length >= OBSERVER_TRAINING_REPORT_MIN_LENGTH &&
    TRAINING_REPORT_KEYWORDS.some((keyword) => normalized.includes(keyword));

  if (!hasDoneVerb && !hasReportPhrase && !hasMetric && !hasKeyword) {
    return null;
  }
  // A completed-run VERB is decisive — report regardless of anything else.
  if (hasDoneVerb) return 0.82;

  const isSchedule = TRAINING_SCHEDULE_REQUEST.test(normalized);
  const isStrongIntent = TRAINING_STRONG_INTENT.some((re) => re.test(normalized));

  // A report PHRASE is strong completion evidence: it may carry a trailing unrelated question
  // ("…было хорошо) в выходные тренировка?"), so "?" does not veto it — only schedule / future.
  if (hasReportPhrase) {
    if (isSchedule || isStrongIntent) return null;
    return 0.78;
  }
  // Weaker signals (metric- or keyword-only): a bare question, any intention (incl. бы/завтра), or
  // a schedule request means it's a plan/question, not a report.
  if (normalized.includes("?")) return null;
  if (isSchedule || isStrongIntent) return null;
  if (TRAINING_INTENT_PATTERNS.some((re) => re.test(normalized))) return null;
  if (hasMetric) return 0.76;
  return 0.72;
}
