// Context-packet builder for the feedback bridge (мост, часть 1). Turns the
// planner input (ContextPacket) into the frozen "what to say" packet stored in
// the queue's context_packet jsonb: rendered prompt sections (observations arc,
// comparison delta, few-shots, register/sex) PLUS the fact-check inputs
// (allowedNumbers, sex, hrTrusted). Deterministic, the generator only voices it.
//
// Ported from the ЭТАП 3a debugging assembler (arc thresholds, comparison-delta
// rendering, few-shot selection, all approved by Igor across v1→v3). No absolute
// workout numbers are surfaced; the only allowed digits are comparison deltas.

import { computeSplitHalf } from "./split-half.ts";
import { planObservations } from "./observation-planner.ts";
import { alignFactorsToTriggerDay } from "./stated-factors.ts";
import { FEWSHOTS, GLOSS, ordinalWord, registerWord, sexRuleText } from "./feedback-corpus.ts";
import type { ContextPacket, Observation, PlannerDerivedMetrics, PlannerLap, PlannerStudentMessage, SessionType } from "./types.ts";

export type FeedbackContextPacket = {
  workoutId: number;
  workoutDate: string;
  title: string | null;
  sessionType: SessionType | null;
  sex: "female" | "male" | null;
  register: "ty" | "vy" | "unknown";
  hrTrusted: boolean;
  // Rendered prompt sections (feedback-prompt.ts substitutes these verbatim).
  workoutHeader: string;
  observationsBlock: string;
  comparisonBlock: string;
  fewshotsText: string;
  fewshotsUsed: string[];
  // Fact-check input: the ONLY numbers a draft may contain (comparison deltas).
  allowedNumbers: number[];
  // COACH-ONLY raw comparison baseline (n похожих, было/стало, период) so Igor can verify
  // the delta in the «почему так» panel. NEVER shown to the student. null when no comparison.
  comparisonBaseline: string | null;
  // What the student ACTUALLY wrote around this workout (verbatim, windowed). Fed to the
  // model as general context (tone + cause), rendered by feedback-prompt as {{STUDENT_WORDS}}
  // and shown in the coach panel. NOT a number source — the fact-check still forbids stray digits.
  studentWords: string[];
  // Transparency for the coach panel (next part), never shown to the student.
  observations: Array<{ type: string; adviceKey: string; focused: boolean; reason: string }>;
};

export type BuildFeedbackContextPacketResult =
  | { blocked: false; packet: FeedbackContextPacket }
  | { blocked: true; reason: string };

// ── data-integrity block gate (C7): untrusted data → coach signal, no draft ──
function resolveBlock(current: PlannerDerivedMetrics): string | null {
  if (current.hasFit === false) return "нет FIT-файла, метрик для разбора нет";
  if (current.fallbackLevel && current.fallbackLevel !== "fit_full") return `неполные данные (${current.fallbackLevel}), разбор недостоверен`;
  if (current.paceTrusted === false || current.distanceTrusted === false) return "темп/дистанция физически неправдоподобны (сбой датчика/фрагмент), форму тренировки не разобрать";
  return null;
}

// ── helpers (ported) ──
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
function lapThirdsHr(laps: PlannerLap[]): { first: number | null; mid: number | null; last: number | null } {
  const withHr = laps.filter((l) => typeof l.avgHr === "number").sort((a, z) => a.lapIndex - z.lapIndex);
  if (withHr.length < 3) return { first: null, mid: null, last: null };
  const n = withHr.length;
  const seg = (arr: PlannerLap[]) => (arr.length ? arr.reduce((s, l) => s + (l.avgHr as number), 0) / arr.length : null);
  return { first: seg(withHr.slice(0, Math.ceil(n / 3))), mid: seg(withHr.slice(Math.ceil(n / 3), Math.ceil((2 * n) / 3))), last: seg(withHr.slice(Math.ceil((2 * n) / 3))) };
}
function manyStops(laps: PlannerLap[]): boolean {
  let paused = 0;
  for (const l of laps) {
    if (typeof l.elapsedTimeS === "number" && typeof l.timerTimeS === "number") paused += Math.max(0, l.elapsedTimeS - l.timerTimeS);
  }
  return paused > 150; // >2.5 min total pause → worth asking
}
// Heat detected by WORDS or by DEGREES: "жарко/пекло/духота" OR a two-digit temperature
// ("30-31°С", "было 30 градусов", "+29"). Checks the student's raw words too (break 3), so
// a report like "на улице 30-31°С" registers — not only the жара keyword.
const HEAT_RE = /жар|пекл|духот|обезвож|\d{2}\s*°|\d{2}\s*градус|[+]?[23]\d\s*[сcСC]\b/iu;
function heatContext(workoutDate: string, memoryItems: ContextPacket["memoryItems"], studentWords: string[]): boolean {
  const m = Number(workoutDate.slice(5, 7));
  if (m >= 6 && m <= 8) return true;
  if (memoryItems.some((mi) => HEAT_RE.test(mi.text))) return true;
  return studentWords.some((w) => HEAT_RE.test(w));
}

// ── narrative arc (deterministic: where it broke, why, advice; model voices it) ──
// Twin drafts: two students with the same pattern (длительная with 5-10% drift) got byte-identical
// arc notes → near-identical text. Fix: each beat carries SEVERAL Igor-voice phrasings, and `vary`
// picks one deterministically off the workoutId (+ a per-beat salt so beats rotate independently).
// Same pattern, different workout → different phrasings; the prompt then leans on the student's own
// words for the rest. Hints stay impersonal (no gendered verb) — the model applies род/регистр.
function vary(seed: number, salt: number, ...opts: string[]): string {
  return opts[Math.abs((seed || 1) * 7 + salt) % opts.length]!;
}

function buildLongArc(current: PlannerDerivedMetrics, laps: PlannerLap[], observations: Observation[], workoutDate: string, memoryItems: ContextPacket["memoryItems"], studentWords: string[]): { notes: string[]; rich: boolean } {
  const split = computeSplitHalf(laps);
  const D = current.hrDecouplingPct;
  const hrOk = current.hrTrusted !== false;
  const wid = current.workoutId;
  const notes: string[] = [];
  const thirds = lapThirdsHr(laps);
  const endDrift = thirds.first !== null && thirds.mid !== null && thirds.last !== null && thirds.last > thirds.mid + 4 && thirds.mid <= thirds.first + 3;
  const fastStart = split !== null && split.firstHalfPaceSecPerKm < split.secondHalfPaceSecPerKm - 10;
  const paceDropped = split !== null && split.secondHalfPaceSecPerKm > split.firstHalfPaceSecPerKm + 8;

  if (!hrOk) {
    // HR untrusted (or student said the watch is off): NO pulse claims, pace/feel only.
    if (fastStart) {
      notes.push(vary(wid, 1, "[дуга-начало] старт бодроватый, первая половина быстрее", "[дуга-начало] со старта бодровато, первую часть быстрее плана", "[дуга-начало] в начале разогнался, первая половина шустрее"));
      notes.push(vary(wid, 2, "[дуга-конец] к концу темп просел, из-за бодрого старта", "[дуга-конец] под конец темп ушёл вниз, отдача за резвый старт", "[дуга-конец] к финишу подсел по темпу, потому что стартовал бодро"));
      notes.push(vary(wid, 3, "[совет] стартовать поспокойнее, разложит ровнее", "[совет] начинать чуть сдержаннее, тогда конец легче", "[совет] первую часть придержать, разложит ровнее до финиша"));
    } else if (paceDropped) {
      notes.push(vary(wid, 4, "[дуга] первую половину держал ровно, к концу темп просел", "[дуга] начало ровное, к финишу по темпу подсел", "[дуга] первую часть держался, во второй темп ушёл вниз"));
      notes.push(vary(wid, 5, "[совет] бежать поспокойнее, чтобы удержать до конца", "[совет] чуть сдержаннее темп, тогда дотянешь ровно", "[совет] держать поровнее, чтобы хватило до финиша"));
    } else {
      notes.push(vary(wid, 6, "[дуга] длительную прошёл ровно по темпу, чисто", "[дуга] длинную отработал ровно, без просадок", "[дуга] по темпу прошёл гладко от начала до конца"));
      return { notes, rich: false };
    }
    if (manyStops(laps)) notes.push("[вопрос] было довольно много остановок, спросить почему");
    return { notes, rich: true };
  }

  if (D !== null && D < 5 && !paceDropped) {
    notes.push(vary(wid, 7, "[дуга] пульс держался ровно почти всю дистанцию, к концу не пополз, хорошая выносливость", "[дуга] пульс всю дистанцию ровный, к финишу не полез, выносливость хорошая", "[дуга] сердце держало ровно до конца, не поползло, форма по выносливости хорошая"));
    if (fastStart) notes.push("[нюанс] начало чуть бодрее второй половины, но в пределах нормы");
    return { notes, rich: false };
  }
  if (D !== null && D >= 5 && D <= 10 && !paceDropped) {
    notes.push(vary(wid, 8, "[дуга-начало] первая половина, ровно", "[дуга-начало] начало спокойное, первую половину ровно", "[дуга-начало] первую часть держалось ровно, без рывков"));
    notes.push(vary(wid, 9, "[дуга-перелом] к концу пульс подрос, НО темп остался тот же (не просел)", "[дуга-перелом] ближе к финишу пульс подполз, а темп удержался", "[дуга-перелом] под конец пульс полез вверх, но по темпу не сдал"));
    notes.push(vary(wid, 10, "[вывод] нагрузка была на грани, но тренировка вытянута, для длительной это нормально, похвали", "[вывод] под конец было на пределе, но добежал ровно, для длинной это ок, поддержи", "[вывод] к финишу подустал, но не развалился, для длительной норм, отметь это"));
    return { notes, rich: true };
  }
  const hasSurge = observations.some((o) => o.adviceKey === "correction_second_half_surge_tempo" || o.adviceKey === "correction_second_half_surge_easy");
  if (hasSurge && split !== null && split.secondHalfPaceSecPerKm < split.firstHalfPaceSecPerKm - 6) {
    notes.push(vary(wid, 11, "[дуга-начало] первая половина, ровно", "[дуга-начало] первую часть держал ровно", "[дуга-начало] начало спокойное и ровное"));
    notes.push(vary(wid, 12, "[дуга-перелом] во второй половине прибавил темп (разогнался), пульс на это отреагировал ростом", "[дуга-перелом] во второй части разогнался, пульс сразу отозвался вверх", "[дуга-перелом] к концу поддал темп, и пульс на это полез"));
    notes.push(vary(wid, 13, "[совет] на длительной/темповой держи ровнее, к концу не разгоняйся", "[совет] на длинной темп держать ровно, к финишу не ускоряться", "[совет] на такой работе лучше ровно до конца, без разгона под финиш"));
    if (manyStops(laps)) notes.push("[вопрос] было много остановок, спросить почему");
    return { notes, rich: true };
  }
  notes.push(fastStart ? vary(wid, 14, "[дуга-начало] старт бодроватый, первая половина быстрее", "[дуга-начало] со старта бодровато, первую часть быстрее", "[дуга-начало] в начале разогнался, первая половина шустрее") : vary(wid, 15, "[дуга-начало] первая половина более-менее ровно", "[дуга-начало] начало ровное, без рывков", "[дуга-начало] первую часть держал спокойно"));
  if (endDrift) {
    notes.push(vary(wid, 16, "[дуга-перелом] пульс подрос ТОЛЬКО к концу (последняя треть), середину держал ровно", "[дуга-перелом] пульс полез лишь в последней трети, до этого держался ровно", "[дуга-перелом] середину прошёл ровно, пульс подрос только под финиш"));
    notes.push(vary(wid, 17, "[утешение+прогноз] ничего страшного, тело адаптируется, с регулярными длинными в следующий раз будет легче", "[утешение+прогноз] это нормально, тело привыкает, с регулярными длинными пойдёт легче", "[утешение+прогноз] не страшно, адаптация идёт, дальше такие будут даваться проще"));
  } else if (heatContext(workoutDate, memoryItems, studentWords)) {
    notes.push("[дуга-перелом] во второй половине пульс заметно пополз вверх");
    notes.push("[причина] жара: в жару пульс лезет от обезвоживания (это не про форму)");
    notes.push("[вопрос] спросить, достаточно ли жидкости было по ходу");
  } else if (fastStart) {
    notes.push(vary(wid, 18, "[дуга-перелом] к концу просадка, из-за бодрого старта", "[дуга-перелом] под финиш подсел, отдача за резвый старт", "[дуга-перелом] к концу тяжелее, потому что начал бодро"));
    notes.push(vary(wid, 19, "[совет] стартовать поспокойнее, тогда разложит ровнее до конца", "[совет] начинать сдержаннее, тогда конец ровнее", "[совет] придержать старт, разложит до финиша ровнее"));
  } else {
    notes.push(vary(wid, 20, "[дуга-перелом] во второй половине пульс заметно пополз и/или темп просел", "[дуга-перелом] во второй части пульс полез, темп начал сдавать", "[дуга-перелом] к концу пульс вверх и по темпу просадка"));
    notes.push(vary(wid, 21, "[совет] бежать поспокойнее, чтобы удержать до конца", "[совет] держать ровнее, чтобы дотянуть до финиша", "[совет] чуть сдержаннее, тогда хватит до конца"));
  }
  if (manyStops(laps)) notes.push("[вопрос] было довольно много остановок, спросить почему, всё ли нормально");
  return { notes, rich: true };
}

function buildIntervalArc(current: PlannerDerivedMetrics): { notes: string[]; rich: boolean } {
  const hrOk = current.hrTrusted !== false;
  const wid = current.workoutId;
  const paces = (current.repPaces ?? []).filter((p): p is number => p !== null);
  const hrs = (current.repPeakHrs ?? []).filter((h): h is number => h !== null);
  const notes: string[] = [];
  if (paces.length < 3) {
    notes.push("[дуга] серия отработана до конца");
    return { notes, rich: false };
  }
  let breakAt = -1;
  let best = paces[0]!;
  for (let i = 1; i < paces.length; i += 1) {
    if (paces[i]! > best * 1.05) {
      breakAt = i;
      break;
    }
    best = Math.min(best, paces[i]!);
  }
  const hrClimb = hrOk && hrs.length >= 3 && hrs[hrs.length - 1]! > hrs[0]! + 6;
  if (breakAt === -1) {
    notes.push(vary(wid, 22, "[дуга] вся серия ровно, от первого до последнего отрезка темп держался", "[дуга] всю серию отработал ровно, темп от первого до последнего держался", "[дуга] серия ровная, каждый отрезок в темпе, без просадок"));
    if (hrClimb) notes.push("[нюанс] пульс по ходу ровно рос по работе, без провалов, нормально");
    return { notes, rich: hrClimb };
  }
  notes.push(vary(wid, 23, "[дуга-начало] первые отрезки, ровно", "[дуга-начало] первые отрезки держал ровно", "[дуга-начало] старт серии ровный"));
  notes.push(`[дуга-перелом] примерно с ${ordinalWord(breakAt + 1)} отрезка темп начал проседать${hrOk ? " / пульс частить" : ""}`);
  notes.push(hrOk ? vary(wid, 24, "[дуга-конец] восстановление там уже не так успевало, к концу тяжелее", "[дуга-конец] к концу восстановление не догоняло, отрезки тяжелее", "[дуга-конец] под финиш пауза не спасала, шло тяжелее") : "[дуга-конец] к концу отрезки шли тяжелее");
  notes.push(vary(wid, 25, "[совет] первые отрезки не гнать, тогда конец легче", "[совет] первые не частить, и концовка пойдёт ровнее", "[совет] сдержаннее в начале серии, конец дастся легче"));
  return { notes, rich: true };
}

function buildArc(sessionType: SessionType | null, current: PlannerDerivedMetrics, laps: PlannerLap[], observations: Observation[], workoutDate: string, memoryItems: ContextPacket["memoryItems"], studentWords: string[]): { notes: string[]; rich: boolean } | null {
  if (sessionType === "long_tempo") return buildLongArc(current, laps, observations, workoutDate, memoryItems, studentWords);
  if (sessionType === "interval") return buildIntervalArc(current);
  return null;
}

// ── comparison-base delta → student-facing digit (the ONLY allowed number) ──
const PACE_ARTIFACT_SEC = 30;
const HR_ARTIFACT_BPM = 15;
// Time anchor: the norm window is recent (≤8 нед) or old (>6 нед). "old" → «месяц-плюс
// назад»; "recent" → «за последние недели». Beats a bare "раньше" that Igor can't place.
function comparisonPeriodPhrase(n: Record<string, number>): string {
  return n.comparisonModeOld === 1 ? "чем месяц-плюс назад" : "чем на таких же за последние недели";
}

// Coach-only raw baseline for the «почему так» panel: how many similar workouts, what the
// norm was, what it is now, so Igor can eyeball the delta. Never reaches the student.
function comparisonBaselineNote(metric: string, n: Record<string, number>): string | null {
  const baseN = n[`${metric}BaseN`];
  if (baseN === undefined) return null;
  const before = n[`${metric}Before`];
  const after = n[`${metric}After`];
  const period = n.comparisonModeOld === 1 ? "месяц-плюс назад" : "последние ~8 недель";
  const unit = metric.includes("hr") ? "уд" : metric === "rep_count" ? "отрезков" : "с/км";
  const beforeAfter =
    before !== undefined && after !== undefined
      ? `, было ~${Math.round(before)}, стало ~${Math.round(after)} ${unit}`
      : "";
  return `сравнение: ~${Math.round(baseN)} похожих (${period})${beforeAfter}`;
}

const NO_STUDENT_COMPARISON = "Сравнения с прошлым нет, пиши только качественные наблюдения, без цифр.";

function buildComparison(observations: Observation[]): { block: string; allowedInts: number[]; baseline: string | null } {
  const comp = observations.find((o) => o.adviceKey === "praise_comparison_progress");
  if (!comp) return { block: NO_STUDENT_COMPARISON, allowedInts: [], baseline: null };
  const n = comp.numbers;
  // The comparison is COACH-ONLY when either (#2) the norm rests on <3 comparable sessions, or (#4) the
  // student's own words for THIS run were negative («тяжело»/«еле добежал»). In both cases the student
  // gets NO comparison (no digit, no «прогресс»); the coach still sees the raw baseline, flagged with
  // the reason. Must run BEFORE the deltaKey branch below, else the "есть прогресс (общо)" line leaks.
  if (n.comparisonProvisional === 1 || n.comparisonWordsSuppressed === 1) {
    const dk = Object.keys(n).find((k) => k.endsWith("Delta"));
    const m = dk ? dk.slice(0, -"Delta".length) : null;
    const strip = m ? comparisonBaselineNote(m, n)?.replace(/^сравнение:\s*/u, "") ?? null : null;
    let baseline: string;
    if (n.comparisonWordsSuppressed === 1) {
      baseline = strip ? `ученик написал, что тяжело — темп/прогресс не показан ученику: ${strip}` : "ученик написал, что тяжело — сравнение не показано ученику";
    } else {
      const bn = Math.round(n.comparisonBaseN ?? 0);
      const word = bn === 1 ? "точка" : "точки"; // n is only 1 or 2 here (n≥3 goes to the student)
      baseline = strip ? `предварительно (${bn} ${word}, n<3, ученику не показано): ${strip}` : `предварительно: норма всего из ${bn} ${word} (n<3), ученику не показано`;
    }
    return { block: NO_STUDENT_COMPARISON, allowedInts: [], baseline };
  }
  const deltaKey = Object.keys(n).find((k) => k.endsWith("Delta"));
  if (!deltaKey) return { block: "Есть прогресс относительно прошлых таких же тренировок (общо, без конкретной цифры).", allowedInts: [], baseline: null };
  const metric = deltaKey.slice(0, -"Delta".length);
  const delta = n[deltaKey]!;
  const abs = Math.round(Math.abs(delta));
  const period = comparisonPeriodPhrase(n);
  const baseline = comparisonBaselineNote(metric, n);
  if ((metric === "steady_pace" || metric === "rep_pace") && Math.abs(delta) <= PACE_ARTIFACT_SEC) {
    return { block: `${metric === "rep_pace" ? "Отрезки" : "Темп"} примерно на ${abs} с/км быстрее, ${period}. (Эту цифру назвать МОЖНО.)`, allowedInts: [abs], baseline };
  }
  if ((metric === "avg_hr" || metric === "rep_hr") && Math.abs(delta) <= HR_ARTIFACT_BPM) {
    return { block: `Пульс на том же темпе примерно на ${abs} ниже, ${period}. (Эту цифру назвать МОЖНО.)`, allowedInts: [abs], baseline };
  }
  if (metric === "rep_count") {
    return { block: `Отрезков на ${abs} больше, ${period}. (Эту цифру назвать МОЖНО.)`, allowedInts: [abs], baseline };
  }
  return { block: `Прогресс относительно прошлых таких же тренировок (${metric === "decoupling" ? "аэробно чище/ровнее" : "лучше"}, ${period}), назови словами, без цифры.`, allowedInts: [], baseline };
}

function workoutHeader(sessionType: SessionType | null): string {
  const t = sessionType === "interval" ? "интервалы" : sessionType === "long_tempo" ? "длительная" : "лёгкая";
  return `Тип: ${t}. (Числа этой тренировки НЕ называй, только словами.)`;
}

// Block 2 — few-shots were mixed «ты»/«вы» and picked regardless of the student's register, so a
// «вы» prompt shipped «ты» exemplars and the body drifted to the wrong register (with the greeting
// following its own rule, the two diverged). Tag each example by the register its wording implies
// («вы»/«вас»/«-йте» → vy; «ты»/«тебя»/«-ешь»/«делай» → ty; neither → neutral) and drop examples
// whose register contradicts the target. Neutral examples (most praise) stay for both.
const EXAMPLE_VY_RE = /(?<![а-яё])(вы|вас|вам|ваш[а-яё]*)(?![а-яё])|[а-яё]йте(?![а-яё])/iu;
const EXAMPLE_TY_RE = /(?<![а-яё])(ты|тебя|тебе|тво[а-яё]*|делай|держи|бегай|начинаешь|разгоняйся)(?![а-яё])|[а-яё](ешь|ишь)(?![а-яё])/iu;
function exampleMatchesRegister(example: string, register: "ty" | "vy" | "unknown"): boolean {
  const isVy = EXAMPLE_VY_RE.test(example);
  const isTy = EXAMPLE_TY_RE.test(example);
  if (isVy === isTy) return true; // neutral (neither, or ambiguous both) → fits any register
  const target = register === "ty" ? "ty" : "vy"; // unknown defaults to вы, same as registerWord
  return target === "ty" ? isTy : isVy;
}

function pickFewshots(observations: Observation[], register: "ty" | "vy" | "unknown"): { text: string; used: string[] } {
  const studentFacing = observations.filter((o) => o.type !== "coach_signal");
  const types = new Set(studentFacing.map((o) => o.type));
  const fit = (examples: string[], n: number) => examples.filter((e) => exampleMatchesRegister(e, register)).slice(0, n);
  const used: string[] = [];
  const a = fit(FEWSHOTS.A, 4);
  const parts: string[] = [...a];
  used.push(`A×${a.length}`);
  if (types.has("correction")) {
    const b = fit(FEWSHOTS.B, 3);
    parts.push(...b);
    used.push(`B×${b.length}`);
  }
  if (types.has("question")) {
    const c = fit(FEWSHOTS.C, 3);
    parts.push(...c);
    used.push(`C×${c.length}`);
  }
  if (studentFacing.some((o) => o.adviceKey.startsWith("cause_confirmed"))) {
    const d = fit(FEWSHOTS.D, 2);
    parts.push(...d);
    used.push(`D×${d.length}`);
  }
  return { text: parts.map((p) => `- ${p}`).join("\n"), used };
}

const ARC_OWNED_KEYS = new Set([
  "praise_long_held_steady", "praise_hr_steady_long", "correction_hr_drift_tempo", "correction_second_half_surge_tempo",
  "correction_second_half_surge_easy", "praise_even_pace", "praise_good_recovery", "praise_steady_hr_rise",
  "praise_full_structure", "correction_interval_fade", "praise_default_good",
]);

// The gloss the model sees for one observation. For a stated cause we PREPEND the student's real quote
// (from the observation's reason «…») so the model обыгрывает ИМЕННО его слова — the gloss itself no
// longer carries example words to parrot (урок Трофимовой: «работа/ремонт» из скобок глоссы утекали в
// текст, хотя ученик говорил про операцию).
function glossFor(o: Observation): string {
  const gloss = GLOSS[o.adviceKey as keyof typeof GLOSS] ?? o.adviceKey;
  if (o.adviceKey.startsWith("cause_confirmed")) {
    const quote = o.reason.match(/«([^»]+)»/)?.[1];
    if (quote) return `ученик написал: «${quote}» — ${gloss}`;
  }
  return gloss;
}

function renderObservations(observations: Observation[], arc: { notes: string[]; rich: boolean } | null): string {
  const studentFacing = observations.filter((o) => o.type !== "coach_signal");
  if (arc && arc.rich) {
    const extras = studentFacing.filter((o) => !ARC_OWNED_KEYS.has(o.adviceKey));
    const out: string[] = ["Разбери ДУГОЙ тренировки (2-3 живые фразы голосом Игоря, СГРУППИРУЙ, не список цифр). Точки дуги:", ...arc.notes.map((s) => `- ${s}`)];
    if (extras.length) {
      out.push("", "Если ложится, можно добавить (по желанию, не обязательно):");
      for (const o of extras) out.push(`- ${o.type === "question" ? "[ВОПРОС]" : o.type === "praise" ? "[ПОХВАЛА]" : "[ЗАМЕТКА]"} ${glossFor(o)}`);
    }
    return out.join("\n");
  }
  const focused = studentFacing.filter((o) => o.focused);
  const other = studentFacing.filter((o) => !o.focused);
  const line = (o: Observation) => {
    const label = o.type === "praise" ? "ПОХВАЛА" : o.type === "correction" && o.adviceKey.startsWith("cause") ? "ЗАБОТА" : o.type === "correction" ? "МЯГКАЯ КОРРЕКЦИЯ" : "ВОПРОС";
    return `- [${label}] ${glossFor(o)}`;
  };
  const arcOpener = arc && !arc.rich ? [`- [ПОХВАЛА] ${arc.notes[0]!.replace(/^\[[^\]]+\]\s*/, "")}`] : [];
  const out: string[] = ["Тут не богато, скажи коротко (1-2 фразы, не надувай):", ...arcOpener, ...focused.map(line)];
  if (other.length) out.push("", "Можно упомянуть, если ложится:", ...other.map(line));
  return out.join("\n");
}

void median; // reserved for future recovery-drop phrasing; keeps the ported helper available

// ── sensor-glitch / no-reliable-metrics draft (Игорь: молчание тренера хуже) ──
// When the data can't be trusted (treadmill/no-GPS, sensor fragment, no FIT) we still
// draft, WITHOUT numbers, leaning on what the student SAID. The person likely ran and
// wrote; a warm "how did it go?" beats silence. The fact-check still forbids any digit
// (allowedNumbers empty) and any pulse talk (hrTrusted=false), so the draft stays honest.
// The general "student words" channel. Anchored to the TRIGGER when known (the report that matched
// this run): its own message + same-day messages from it ONWARD (a 10-min lookback catches a report
// split across a burst just before the report_like one). Yesterday's report about a DIFFERENT run is
// earlier than the trigger and on another day → it can't bleed in (the Левина bug). Same-day follow-
// ups ("а ещё ноги гудели" 5 мин спустя) DO stay — people add detail right after the report.
// Fallback with no trigger (targeted rebuilds / tests): the old tight date window (date−1 … date+2),
// report_like preferred. Newest first, deduped, capped — verbatim, tone/cause context (never numbers).
function windowStudentWords(input: ContextPacket): string[] {
  let chosen: PlannerStudentMessage[];
  if (input.triggerObservedAt) {
    const triggerMs = Date.parse(input.triggerObservedAt);
    const triggerDay = input.triggerObservedAt.slice(0, 10);
    // trigger + same-day-onward: ALL of them (report + its follow-ups), not just report_like.
    chosen = input.studentMessages.filter((mm) => mm.date === triggerDay && (!mm.at || Date.parse(mm.at) >= triggerMs - 10 * 60_000));
  } else {
    const wd = new Date(`${input.workout.workoutDate}T00:00:00Z`).getTime();
    const inWindow = input.studentMessages.filter((mm) => {
      if (!mm.date) return false;
      const diffDays = (new Date(`${mm.date}T00:00:00Z`).getTime() - wd) / 86_400_000;
      return Number.isFinite(diffDays) && diffDays >= -1 && diffDays <= 2;
    });
    const reports = inWindow.filter((mm) => mm.labels.includes("report_like"));
    chosen = reports.length ? reports : inWindow;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const mm of chosen) {
    const t = mm.text.trim();
    if (!t || seen.has(t)) continue;
    if (/^https?:\/\/\S+$/iu.test(t)) continue; // bare link (e.g. a race URL), not a report
    // Garmin/Strava auto-share boilerplate («Просмотрите мое занятие … в Garmin Connect. #beatyesterday
    // <link>») is a SHARE notification, not a report — it carried no words, but landed in studentWords
    // as if the student said something, so the draft tried to обыграть it. Drop it (once the URL is
    // stripped the remainder is short boilerplate); a real report that merely mentions Garmin survives.
    if (/#beatyesterday|garmin connect|strava\.com|просмотрите мо[её] занятие/iu.test(t) && t.replace(/https?:\/\/\S+/gu, "").trim().length < 80) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

function buildSensorGlitchPacket(input: ContextPacket, reason: string): FeedbackContextPacket {
  const words = windowStudentWords(input);
  const wordsBlock = words.length
    ? `Слова ученика про эту тренировку (его сообщения):\n${words.map((w) => `- ${w}`).join("\n")}`
    : "Ученик ничего про эту тренировку не писал.";
  const observationsBlock = [
    `Данные датчика по этой тренировке НЕДОСТОВЕРНЫ: ${reason}.`,
    "Цифр нет, ни темпа, ни пульса, ни дистанции. Разбирать метрики НЕЛЬЗЯ.",
    "Но молчать не надо, человек мог пробежать и написать. Напиши тёплый КОРОТКИЙ черновик БЕЗ единой цифры:",
    "- если в словах ученика ниже видно, как далась тренировка, мягко обыграй это и спроси самочувствие;",
    "- если слов нет, просто короткий тёплый вопрос: как прошла пробежка, что по ощущениям?",
    "Не выдумывай метрики и не делай вид, что разобрал тренировку.",
    "",
    wordsBlock,
  ].join("\n");
  return {
    workoutId: input.workout.workoutId,
    workoutDate: input.workout.workoutDate,
    title: input.workout.title,
    sessionType: null,
    sex: input.sex,
    register: input.telegramFormality,
    hrTrusted: false, // no pulse talk, data untrusted
    workoutHeader: "Тип: не разобрать, данные датчика сломаны (дорожка / сбой часов). Числа НЕ называй.",
    observationsBlock,
    comparisonBlock: "Сравнения с прошлым нет, цифр нет вообще.",
    fewshotsText: [...FEWSHOTS.A.slice(0, 4), ...FEWSHOTS.C.slice(0, 2)].map((p) => `- ${p}`).join("\n"),
    fewshotsUsed: ["A×4", "C×2"],
    allowedNumbers: [],
    comparisonBaseline: null,
    studentWords: words,
    observations: [
      { type: "question", adviceKey: "sensor_glitch_ask", focused: true, reason: `данные датчика недостоверны (${reason}), черновик по словам/ощущениям, без цифр` },
    ],
  };
}

export function buildFeedbackContextPacket(input: ContextPacket): BuildFeedbackContextPacketResult {
  // Align factors to the trigger day (same window as studentWords). Done HERE, not at extraction, because
  // the trigger is only known when the sweep matches the report to the run — extraction runs earlier.
  if (input.triggerObservedAt && Array.isArray(input.statedFactors)) {
    input.statedFactors = alignFactorsToTriggerDay(input.statedFactors, input.triggerObservedAt);
  }
  const blockReason = resolveBlock(input.current);
  if (blockReason !== null) {
    // Данные недостоверны, НЕ молчим: словесный черновик по словам ученика (правка 2).
    return { blocked: false, packet: buildSensorGlitchPacket(input, blockReason) };
  }

  const observations = planObservations(input);
  const sessionType = (observations[0]?.sessionType as SessionType | null) ?? null;
  const studentWords = windowStudentWords(input);
  const arc = buildArc(sessionType, input.current, input.laps, observations, input.workout.workoutDate, input.memoryItems, studentWords);
  const comparison = buildComparison(observations);
  const fewshots = pickFewshots(observations, input.telegramFormality);

  const packet: FeedbackContextPacket = {
    workoutId: input.workout.workoutId,
    workoutDate: input.workout.workoutDate,
    title: input.workout.title,
    sessionType,
    sex: input.sex,
    register: input.telegramFormality,
    hrTrusted: input.current.hrTrusted !== false,
    workoutHeader: workoutHeader(sessionType),
    observationsBlock: renderObservations(observations, arc),
    comparisonBlock: comparison.block,
    fewshotsText: fewshots.text,
    fewshotsUsed: fewshots.used,
    allowedNumbers: [...new Set(comparison.allowedInts)],
    comparisonBaseline: comparison.baseline,
    studentWords,
    observations: observations.map((o) => ({ type: o.type, adviceKey: o.adviceKey, focused: o.focused, reason: o.reason })),
  };
  return { blocked: false, packet };
}

export { registerWord, sexRuleText };
