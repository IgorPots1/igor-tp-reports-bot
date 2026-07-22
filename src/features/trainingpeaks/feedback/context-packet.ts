// Context-packet builder for the feedback bridge (мост, часть 1). Turns the
// planner input (ContextPacket) into the frozen "what to say" packet stored in
// the queue's context_packet jsonb: rendered prompt sections (observations arc,
// comparison delta, few-shots, register/sex) PLUS the fact-check inputs
// (allowedNumbers, sex, hrTrusted). Deterministic — the generator only voices it.
//
// Ported from the ЭТАП 3a debugging assembler (arc thresholds, comparison-delta
// rendering, few-shot selection — all approved by Igor across v1→v3). No absolute
// workout numbers are surfaced; the only allowed digits are comparison deltas.

import { computeSplitHalf } from "./split-half.ts";
import { planObservations } from "./observation-planner.ts";
import { FEWSHOTS, GLOSS, ordinalWord, registerWord, sexRuleText } from "./feedback-corpus.ts";
import type { ContextPacket, Observation, PlannerDerivedMetrics, PlannerLap, SessionType } from "./types.ts";

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
  // Transparency for the coach panel (next part) — never shown to the student.
  observations: Array<{ type: string; adviceKey: string; focused: boolean; reason: string }>;
};

export type BuildFeedbackContextPacketResult =
  | { blocked: false; packet: FeedbackContextPacket }
  | { blocked: true; reason: string };

// ── data-integrity block gate (C7): untrusted data → coach signal, no draft ──
function resolveBlock(current: PlannerDerivedMetrics): string | null {
  if (current.hasFit === false) return "нет FIT-файла — метрик для разбора нет";
  if (current.fallbackLevel && current.fallbackLevel !== "fit_full") return `неполные данные (${current.fallbackLevel}) — разбор недостоверен`;
  if (current.paceTrusted === false || current.distanceTrusted === false) return "темп/дистанция физически неправдоподобны (сбой датчика/фрагмент) — форму тренировки не разобрать";
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
function heatContext(workoutDate: string, memoryItems: ContextPacket["memoryItems"]): boolean {
  const m = Number(workoutDate.slice(5, 7));
  if (m >= 6 && m <= 8) return true;
  return memoryItems.some((mi) => /жар|пекл|духот|обезвож/i.test(mi.text));
}

// ── narrative arc (deterministic: where it broke, why, advice; model voices it) ──
function buildLongArc(current: PlannerDerivedMetrics, laps: PlannerLap[], observations: Observation[], workoutDate: string, memoryItems: ContextPacket["memoryItems"]): { notes: string[]; rich: boolean } {
  const split = computeSplitHalf(laps);
  const D = current.hrDecouplingPct;
  const hrOk = current.hrTrusted !== false;
  const notes: string[] = [];
  const thirds = lapThirdsHr(laps);
  const endDrift = thirds.first !== null && thirds.mid !== null && thirds.last !== null && thirds.last > thirds.mid + 4 && thirds.mid <= thirds.first + 3;
  const fastStart = split !== null && split.firstHalfPaceSecPerKm < split.secondHalfPaceSecPerKm - 10;
  const paceDropped = split !== null && split.secondHalfPaceSecPerKm > split.firstHalfPaceSecPerKm + 8;

  if (!hrOk) {
    if (fastStart) {
      notes.push("[дуга-начало] старт бодроватый — первая половина быстрее");
      notes.push("[дуга-конец] к концу темп просел — из-за бодрого старта");
      notes.push("[совет] стартовать поспокойнее, разложит ровнее");
    } else if (paceDropped) {
      notes.push("[дуга] первую половину держал ровно, к концу темп просел");
      notes.push("[совет] бежать поспокойнее, чтобы удержать до конца");
    } else {
      notes.push("[дуга] длительную прошёл ровно по темпу, чисто");
      return { notes, rich: false };
    }
    if (manyStops(laps)) notes.push("[вопрос] было довольно много остановок — спросить почему");
    return { notes, rich: true };
  }

  if (D !== null && D < 5 && !paceDropped) {
    notes.push("[дуга] пульс держался ровно почти всю дистанцию, к концу не пополз — хорошая выносливость");
    if (fastStart) notes.push("[нюанс] начало чуть бодрее второй половины, но в пределах нормы");
    return { notes, rich: false };
  }
  if (D !== null && D >= 5 && D <= 10 && !paceDropped) {
    notes.push("[дуга-начало] первая половина — ровно");
    notes.push("[дуга-перелом] к концу пульс подрос, НО темп остался тот же (не просел)");
    notes.push("[вывод] нагрузка была на грани, но тренировка вытянута — для длительной это нормально, похвали");
    return { notes, rich: true };
  }
  const hasSurge = observations.some((o) => o.adviceKey === "correction_second_half_surge_tempo" || o.adviceKey === "correction_second_half_surge_easy");
  if (hasSurge && split !== null && split.secondHalfPaceSecPerKm < split.firstHalfPaceSecPerKm - 6) {
    notes.push("[дуга-начало] первая половина — ровно");
    notes.push("[дуга-перелом] во второй половине прибавил темп (разогнался), пульс на это отреагировал ростом");
    notes.push("[совет] на длительной/темповой держи ровнее, к концу не разгоняйся");
    if (manyStops(laps)) notes.push("[вопрос] было много остановок — спросить почему");
    return { notes, rich: true };
  }
  notes.push(fastStart ? "[дуга-начало] старт бодроватый — первая половина быстрее" : "[дуга-начало] первая половина более-менее ровно");
  if (endDrift) {
    notes.push("[дуга-перелом] пульс подрос ТОЛЬКО к концу (последняя треть), середину держал ровно");
    notes.push("[утешение+прогноз] ничего страшного — тело адаптируется, с регулярными длинными в следующий раз будет легче");
  } else if (heatContext(workoutDate, memoryItems)) {
    notes.push("[дуга-перелом] во второй половине пульс заметно пополз вверх");
    notes.push("[причина] жара: в жару пульс лезет от обезвоживания (это не про форму)");
    notes.push("[вопрос] спросить, достаточно ли жидкости было по ходу");
  } else if (fastStart) {
    notes.push("[дуга-перелом] к концу просадка — из-за бодрого старта");
    notes.push("[совет] стартовать поспокойнее, тогда разложит ровнее до конца");
  } else {
    notes.push("[дуга-перелом] во второй половине пульс заметно пополз и/или темп просел");
    notes.push("[совет] бежать поспокойнее, чтобы удержать до конца");
  }
  if (manyStops(laps)) notes.push("[вопрос] было довольно много остановок — спросить почему, всё ли нормально");
  return { notes, rich: true };
}

function buildIntervalArc(current: PlannerDerivedMetrics): { notes: string[]; rich: boolean } {
  const hrOk = current.hrTrusted !== false;
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
    notes.push("[дуга] вся серия ровно — от первого до последнего отрезка темп держался");
    if (hrClimb) notes.push("[нюанс] пульс по ходу ровно рос по работе, без провалов — нормально");
    return { notes, rich: hrClimb };
  }
  notes.push("[дуга-начало] первые отрезки — ровно");
  notes.push(`[дуга-перелом] примерно с ${ordinalWord(breakAt + 1)} отрезка темп начал проседать${hrOk ? " / пульс частить" : ""}`);
  notes.push(hrOk ? "[дуга-конец] восстановление там уже не так успевало, к концу тяжелее" : "[дуга-конец] к концу отрезки шли тяжелее");
  notes.push("[совет] первые отрезки не гнать, тогда конец легче");
  return { notes, rich: true };
}

function buildArc(sessionType: SessionType | null, current: PlannerDerivedMetrics, laps: PlannerLap[], observations: Observation[], workoutDate: string, memoryItems: ContextPacket["memoryItems"]): { notes: string[]; rich: boolean } | null {
  if (sessionType === "long_tempo") return buildLongArc(current, laps, observations, workoutDate, memoryItems);
  if (sessionType === "interval") return buildIntervalArc(current);
  return null;
}

// ── comparison-base delta → student-facing digit (the ONLY allowed number) ──
const PACE_ARTIFACT_SEC = 30;
const HR_ARTIFACT_BPM = 15;
function buildComparison(observations: Observation[]): { block: string; allowedInts: number[] } {
  const comp = observations.find((o) => o.adviceKey === "praise_comparison_progress");
  if (!comp) return { block: "Сравнения с прошлым нет — пиши только качественные наблюдения, без цифр.", allowedInts: [] };
  const n = comp.numbers;
  const deltaKey = Object.keys(n).find((k) => k.endsWith("Delta"));
  if (!deltaKey) return { block: "Есть прогресс относительно прошлых таких же тренировок (общо, без конкретной цифры).", allowedInts: [] };
  const metric = deltaKey.slice(0, -"Delta".length);
  const delta = n[deltaKey]!;
  const abs = Math.round(Math.abs(delta));
  if ((metric === "steady_pace" || metric === "rep_pace") && Math.abs(delta) <= PACE_ARTIFACT_SEC) {
    return { block: `${metric === "rep_pace" ? "Отрезки" : "Темп"} примерно на ${abs} с/км быстрее, чем на таких же тренировках раньше. (Эту цифру назвать МОЖНО.)`, allowedInts: [abs] };
  }
  if ((metric === "avg_hr" || metric === "rep_hr") && Math.abs(delta) <= HR_ARTIFACT_BPM) {
    return { block: `Пульс на том же темпе примерно на ${abs} ниже, чем раньше. (Эту цифру назвать МОЖНО.)`, allowedInts: [abs] };
  }
  if (metric === "rep_count") {
    return { block: `Отрезков на ${abs} больше, чем раньше. (Эту цифру назвать МОЖНО.)`, allowedInts: [abs] };
  }
  return { block: `Прогресс относительно прошлых таких же тренировок (${metric === "decoupling" ? "аэробно чище/ровнее" : "лучше"}, чем раньше) — назови словами, без цифры.`, allowedInts: [] };
}

function workoutHeader(sessionType: SessionType | null): string {
  const t = sessionType === "interval" ? "интервалы" : sessionType === "long_tempo" ? "длительная / темповая" : "лёгкая";
  return `Тип: ${t}. (Числа этой тренировки НЕ называй — только словами.)`;
}

function pickFewshots(observations: Observation[]): { text: string; used: string[] } {
  const studentFacing = observations.filter((o) => o.type !== "coach_signal");
  const types = new Set(studentFacing.map((o) => o.type));
  const used: string[] = [];
  const parts: string[] = [...FEWSHOTS.A.slice(0, 4)];
  used.push("A×4");
  if (types.has("correction")) {
    parts.push(...FEWSHOTS.B.slice(0, 3));
    used.push("B×3");
  }
  if (types.has("question")) {
    parts.push(...FEWSHOTS.C.slice(0, 3));
    used.push("C×3");
  }
  if (studentFacing.some((o) => o.adviceKey.startsWith("cause_confirmed"))) {
    parts.push(...FEWSHOTS.D.slice(0, 2));
    used.push("D×2");
  }
  return { text: parts.map((p) => `- ${p}`).join("\n"), used };
}

const ARC_OWNED_KEYS = new Set([
  "praise_long_held_steady", "praise_hr_steady_long", "correction_hr_drift_tempo", "correction_second_half_surge_tempo",
  "correction_second_half_surge_easy", "praise_even_pace", "praise_good_recovery", "praise_steady_hr_rise",
  "praise_full_structure", "correction_interval_fade", "praise_default_good",
]);

function renderObservations(observations: Observation[], arc: { notes: string[]; rich: boolean } | null): string {
  const studentFacing = observations.filter((o) => o.type !== "coach_signal");
  if (arc && arc.rich) {
    const extras = studentFacing.filter((o) => !ARC_OWNED_KEYS.has(o.adviceKey));
    const out: string[] = ["Разбери ДУГОЙ тренировки (2-3 живые фразы голосом Игоря, СГРУППИРУЙ, не список цифр). Точки дуги:", ...arc.notes.map((s) => `- ${s}`)];
    if (extras.length) {
      out.push("", "Если ложится — можно добавить (по желанию, не обязательно):");
      for (const o of extras) out.push(`- ${o.type === "question" ? "[ВОПРОС]" : o.type === "praise" ? "[ПОХВАЛА]" : "[ЗАМЕТКА]"} ${GLOSS[o.adviceKey as keyof typeof GLOSS] ?? o.adviceKey}`);
    }
    return out.join("\n");
  }
  const focused = studentFacing.filter((o) => o.focused);
  const other = studentFacing.filter((o) => !o.focused);
  const line = (o: Observation) => {
    const label = o.type === "praise" ? "ПОХВАЛА" : o.type === "correction" && o.adviceKey.startsWith("cause") ? "ЗАБОТА" : o.type === "correction" ? "МЯГКАЯ КОРРЕКЦИЯ" : "ВОПРОС";
    return `- [${label}] ${GLOSS[o.adviceKey as keyof typeof GLOSS] ?? o.adviceKey}`;
  };
  const arcOpener = arc && !arc.rich ? [`- [ПОХВАЛА] ${arc.notes[0]!.replace(/^\[[^\]]+\]\s*/, "")}`] : [];
  const out: string[] = ["Тут не богато — скажи коротко (1-2 фразы, не надувай):", ...arcOpener, ...focused.map(line)];
  if (other.length) out.push("", "Можно упомянуть, если ложится:", ...other.map(line));
  return out.join("\n");
}

void median; // reserved for future recovery-drop phrasing; keeps the ported helper available

export function buildFeedbackContextPacket(input: ContextPacket): BuildFeedbackContextPacketResult {
  const blockReason = resolveBlock(input.current);
  if (blockReason !== null) {
    return { blocked: true, reason: blockReason };
  }

  const observations = planObservations(input);
  const sessionType = (observations[0]?.sessionType as SessionType | null) ?? null;
  const arc = buildArc(sessionType, input.current, input.laps, observations, input.workout.workoutDate, input.memoryItems);
  const comparison = buildComparison(observations);
  const fewshots = pickFewshots(observations);

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
    observations: observations.map((o) => ({ type: o.type, adviceKey: o.adviceKey, focused: o.focused, reason: o.reason })),
  };
  return { blocked: false, packet };
}

export { registerWord, sexRuleText };
