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
  // Impersonal / passive completion of a run ("отбегано полтора часа", "пробежано", "набегано").
  // Running-specific, so decisive on its own like the -л verbs.
  new RegExp(`${CYR_WS}(от|про|на|за|до|вы|с|в)?бе[гж]ано`),
  // training noun immediately near a completed verb, incl. impersonal/passive forms
  // ("интервалы сделала", "длительная … прошла", "12 км пройдено", "длительная намотана")
  /(трениров[а-яё]*|интервал[а-яё]*|длительн[а-яё]*|длинн[а-яё]*|лонг|темпов[а-яё]*|пробежк[а-яё]*|отрезк[а-яё]*|дистанц[а-яё]*|км)\s.{0,24}(прошл|сделал|сделан|получил|дал|зашл|осил|отработал|выполнил|выполнен|закончил|пройден|намота|накрут)/,
];
// "беговое существительное + оценка" — a completed report phrased with no verb ("вчерашняя
// длительная, всё хорошо", "интервалы готовы, 7/10", "загрузила тренировку, было тяжело") and the
// literal "отчёт". Strong completion evidence: passes a trailing "?" (unlike weaker signals), and
// is only vetoed by a schedule request or first-person future intent.
const TRAINING_REPORT_PHRASE_PATTERNS: RegExp[] = [
  /отч[её]т|отчитыв/,
  /(трениров[а-яё]*|интервал[а-яё]*|длительн[а-яё]*|длинн[а-яё]*|темпов[а-яё]*|пробежк[а-яё]*|пробеж[а-яё]*|лонг|разминк[а-яё]*).{0,32}(хорош|отличн|норм|легк|тяжел|тяжк|комфортн|прошл|готов|в порядке|в кайф|неплох|ужасн|далась|дался|устал|изжар)/,
  /(загрузил[а]?|выложил[а]?).{0,20}(трениров|пробеж|бег|занятие)/,
  /вернул(ся|ась).{0,15}(пробеж|трениров|стадион|бег)/,
];
// SOFT report signals: a completed run described WITHOUT a run verb or noun+eval — a deliberate
// workout share, a run segment, or how the body felt. Real but more ambiguous than a verb/phrase,
// so treated as WEAK: any question, future intent (incl. бы/завтра/на следующ) or schedule request
// vetoes them — that keeps "давай медленнее в следующий раз" (a plan) from reading as a report.
const TRAINING_REPORT_SOFT_PATTERNS: RegExp[] = [
  // Deliberate Garmin/Strava workout share — the student shows a completed session for review.
  /просмотрите\s+мо\S*\s+занятие/,
  /мо\S*\s+занятие\s*[«"]?\s*(бег|плаван|велосипед|заплыв|заезд|run|ride|swim)/,
  // Descriptive segment of a completed run: "первые 600 метров", "последние 2 км".
  new RegExp(`(перв|последн|крайн)[а-яё]*\\s+\\d{1,4}\\s*(метр|м(?![а-яёa-z])|км)`),
  // How the run FELT — body/execution, not a bare "тяжело":
  // legs "ноги ватные/тяжёлые/забитые/гудят/деревянные"…
  /ноги\s+\S{0,4}(ват|тяжел|забит|гуд|деревян|свинц|налит|уста)/,
  // execution "легко пошло/бежалось", "тяжело далось", "нормально побегалось"…
  new RegExp(`(легк|тяжел|туго|непрост|норм|хорош)[оа]?\\s+\\S{0,6}(пошл|побежал|бежал|бегал|далось|дались|дался|далась|шлось|бежалось|бегалось)`),
  /(далось|дались|дался|далась)\s+\S{0,4}(тяжел|легк|непрост|норм|хорош|трудно)/,
  // post-hard-training sleep report "спалось трудно/тяжело/плохо".
  /спалось\s+\S{0,8}(трудно|тяжело|плохо|мало|ужасно|так себе)/,
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
// Plan / coaching-advice imperatives — veto the LOOSE soft signals only ("давай медленнее",
// "в следующий раз помедленнее", "сбавь темп"). Word-bounded "давай" so it never bites "давалось".
const TRAINING_SOFT_PLAN_VETO = new RegExp(
  `${CYR_WS}давай|помедленн|побыстр|поменьше|побольше|сбав|в следующ|попозж|на след`
);
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

// A weak signal is a REPORT only if the number/keyword is about the STUDENT. First-person markers:
// the "я/мне/мой" pronouns and temporal-self words ("сегодня 12 км" = I did 12 km today). Loose on
// purpose — the third-party veto below is what stops "мне сегодня попался рилс, девушка 80 км".
const FIRST_PERSON_MARKERS = new RegExp(`${CYR_WS}(я|мне|меня|мо[йяеиюг][а-яё]*)(?![а-яёa-z])|сегодня|с утра|${CYR_WS}утром|вечером|наконец|только что`, "u");
// Corroboration: a number that co-occurs with another report signal is a report even without "я"
// ("12 км, тяжело" / "10 км за 55 мин" / "5 км ✅"): a feeling/eval word, an ack/emoji, a time or a pace.
const REPORT_CORROBORATION = /тяжел|тяжко|легк|легч|устал|вымота|измота|норм|хорош|отличн|классн|бодр|кайф|изжар|дал[оаи]сь|трудно|непрост|терп[её]ж|духот|✅|👍|👌|🔥|💪|готов|\d{1,2}[:.]\d{2}|(?:мин|час|сек)[а-яё]*\s*\d|\d+\s*(?:мин|час|сек)/u;
// Third-party / media / general-norm veto for WEAK signals only (verb/phrase reports are decided
// above, untouched): a number about SOMEONE ELSE or a weekly norm, not this student's run.
const THIRD_PARTY_OR_NORM = new RegExp(`рилс|reels|ролик|видео|блогер|марафонец|девушк|подруг|парн[ияюе]|парень|у не[ёе](?![а-яё])|${CYR_WS}норм[аы](?![а-яё])|в недел`, "u");

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
  const hasSoft = TRAINING_REPORT_SOFT_PATTERNS.some((re) => re.test(normalized));
  const hasKeyword =
    normalized.length >= OBSERVER_TRAINING_REPORT_MIN_LENGTH &&
    TRAINING_REPORT_KEYWORDS.some((keyword) => normalized.includes(keyword));

  if (!hasDoneVerb && !hasReportPhrase && !hasMetric && !hasSoft && !hasKeyword) {
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
  // Plan / coaching-advice imperative vetoes ANY weak signal — a metric or segment inside advice
  // ("давай первые 2 км помедленнее в следующий раз") is a plan, not a report. Verb/phrase reports
  // are decided above and untouched by this.
  if (TRAINING_SOFT_PLAN_VETO.test(normalized)) return null;
  // A bare number can be about someone else ("девушка 80 км бегает") or a general norm ("40 км в
  // неделю"). A metric/keyword counts as a report only when it's about the STUDENT: first-person
  // self-reference OR corroboration (feeling/ack/time/pace). And a third-party/media/norm context
  // vetoes it outright, even if a first-person word ("мне сегодня попался рилс") appears elsewhere.
  if (THIRD_PARTY_OR_NORM.test(normalized)) return null;
  const selfOrCorroboration = FIRST_PERSON_MARKERS.test(normalized) || REPORT_CORROBORATION.test(normalized) || hasSoft;
  if (hasMetric && selfOrCorroboration) return 0.76;
  if (hasSoft) return 0.74; // a felt-execution report ("ноги ватные") is self by nature
  if (hasKeyword && selfOrCorroboration) return 0.72;
  return null;
}

// A WEAK confirmation: the WHOLE message is just an acknowledgement ("готово", "сделала", "✅").
// On its own this is NOT a report — too many "готово" answer a schedule move ("перенеси" → "готово").
// It becomes a report ONLY when the sweep finds a run time-correlated to it (run exists on [D-1,D]
// AND the message came after the run started). So this returns a boolean; the correlation lives in
// the sweep, which alone has the workout data. Whole-message only: an ack embedded in a longer
// sentence is either a real report (caught above) or genuinely not one.
const WEAK_CONFIRMATION_RE = new RegExp(
  `^(?:вс[её]\\s+)?(?:готово|сделал[ао]?|выполнил[ао]?|выполнено|закончил[ао]?|отработал[ао]?|отбегал[ао]?|финишировал[ао]?|финиш|есть|done|ок|окей|ok|плюс|\\+|✅|👍|🏃[\\u200d\\u2640\\u2642\\ufe0f]*)[\\s!.,)✅👍🙌🔥💪🏃\\u200d\\u2640\\u2642\\ufe0f]*$`,
  "u"
);
export function detectWeakConfirmation(normalizedInput: string): boolean {
  const normalized = normalizeObserverText(normalizedInput.replace(/https?:\/\/\S+/g, " "));
  if (!normalized) return false;
  // A weak ack that is actually a FULL report ("отбегала" hits the -л verb) is already report_like —
  // the caller only uses this when detectTrainingReport returned null, so no double-labelling.
  return WEAK_CONFIRMATION_RE.test(normalized);
}
