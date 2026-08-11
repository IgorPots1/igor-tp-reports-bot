/**
 * autoplanner-week — форма недели (§4.2) + рендер описания с обратной сверкой (§3).
 *
 * Названия, RPE-рамка и структура приходят ИЗ КАТАЛОГА (autoplanner-catalog.ts), а не из
 * строк в коде. Отбор качества — selectQualityFromCatalog (guardrails + прогрессия по объёму),
 * а не одноветочная заглушка selectQualityMethodologyV0.
 * Парсер для сверки — канонический ranges()/parseSegments() из tp-recompute.ts.
 */
import { ranges, parseSegments } from "./tp-recompute.ts";
import { resolvePace, type AthleteAnchors, type IntensityIntent, type Resolved, type Tier } from "./pace-resolver.ts";
import type { Envelope } from "./autoplanner-context.ts";
import { CANONICAL_WARMUP, WARMUP_CANON_MINUTES, needsCanonicalWarmup, type Catalog, type QualityPreset } from "./autoplanner-catalog.ts";
import { selectQualityFromCatalog, qualityCapFromHistory, type QualityDecision } from "./quality-select.ts";
import type { Band } from "./band-collision.ts";

export const DAY_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export type Role = "quality" | "long" | "easy" | "easy_strides" | "recovery" | "rest";

/** Шаг 4: всё округляем до 5 минут — «63 минуты» в плане не бывает. */
export const ROUND_TO_MIN = 5;
/**
 * ФОРМА НЕДЕЛИ — ИЗМЕРЕНО ПО ПРАКТИКЕ (tp-week-shape-measure, 26 недель, 2481 атлето-неделя,
 * только coach_authored). До 12.08 здесь стояли угаданные 20 мин пола и +20 мин надбавки.
 *
 * Пол лёгкого — p05 самой короткой лёгкой пробежки недели по тирам: 30 / 31 / 40 мин.
 * Прежние 20 были ЗАНИЖЕНЫ ВДВОЕ: короче получаса тренер не пишет вообще.
 */
export const EASY_FLOOR_BY_TIER: Record<Tier, number> = { T1: 30, T2: 30, T3: 40 };

/**
 * Длительная относительно самого длинного лёгкого — КРАТНО, а не аддитивно.
 * Замер: T2 медиана 1.60 / p10 1.43, T3 медиана 1.80 / p10 1.50. Берём p10 — это ПОЛ,
 * ниже которого практика почти не опускается (90% недель выше).
 * T1 = 1.0: длительных этому тиру НЕ СТАВЯТ ВООБЩЕ (пар в замере n=0), поэтому любой
 * множитель был бы выдуман; «длительный» день у T1 — просто самый длинный из лёгких.
 *
 * Аддитивной надбавки не оставляем: в наблюдаемом диапазоне (лёгкий 40–89 мин) кратность 1.5
 * и надбавка 30 мин дают ОДНО И ТО ЖЕ, а за его пределами данных нет вообще — вводить второй
 * параметр было бы подгонкой под несуществующие наблюдения.
 */
export const LONG_OVER_EASY_RATIO: Record<Tier, number> = { T1: 1.0, T2: 1.43, T3: 1.50 };

/**
 * Длительная относительно КАЧЕСТВЕННОЙ. Правило «длительная — самая длинная сессия недели»
 * подтверждено фактом: в 99% недель, где есть обе, длительная длиннее. Но насколько —
 * измерено: T2 медиана 1.53 / p10 1.32, T3 1.64 / p10 1.36. Прежние «качественная + 5 мин»
 * формально правило соблюдали, а практику занижали в разы.
 */
export const LONG_OVER_QUALITY_RATIO: Record<Tier, number> = { T1: 1.0, T2: 1.32, T3: 1.36 };
/** Шаг 4: ширина полосы лёгкого сверху ограничена (сек/км), параметр. */
export const EASY_BAND_MAX_S = 25;
/** Прирост недельного объёма к предыдущей ФАКТИЧЕСКОЙ неделе — не более этого (параметр). */
export const WEEKLY_GROWTH_MAX = 1.10;
const round5 = (m: number): number => Math.max(ROUND_TO_MIN, Math.round(m / ROUND_TO_MIN) * ROUND_TO_MIN);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function rolesForDayCount(n: number, qualityCap: number): { quality: number; long: number } {
  const cap = Math.max(0, qualityCap);
  if (n <= 2) return { quality: 0, long: 1 };
  if (n <= 5) return { quality: Math.min(cap, 1), long: 1 };
  return { quality: Math.min(cap, 2), long: 1 };
}

export function chooseDays(hist: number[], n: number): number[] {
  return hist.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c || a.i - b.i)
    .slice(0, Math.max(0, n)).map((x) => x.i).sort((a, b) => a - b);
}

export function assignRoles(days: number[], counts: { quality: number; long: number }, longDayHint: number | null): Map<number, Role> {
  const roles = new Map<number, Role>();
  if (days.length === 0) return roles;
  const longDay = longDayHint != null && days.includes(longDayHint) ? longDayHint : days[days.length - 1];
  if (counts.long > 0) roles.set(longDay, "long");
  const adjacent = (a: number, b: number): boolean => Math.abs(a - b) === 1 || Math.abs(a - b) === 6;
  const picked: number[] = [];
  const byDistance = days.filter((d) => !roles.has(d))
    .sort((a, b) => (Math.min(Math.abs(b - longDay), 7 - Math.abs(b - longDay))) - (Math.min(Math.abs(a - longDay), 7 - Math.abs(a - longDay))));
  for (const d of byDistance) {
    if (picked.length >= counts.quality) break;
    if (adjacent(d, longDay)) continue;
    if (picked.some((p) => adjacent(p, d))) continue;
    picked.push(d); roles.set(d, "quality");
  }
  days.filter((d) => !roles.has(d)).forEach((d, idx) => roles.set(d, idx === 0 && days.length >= 4 ? "easy_strides" : "easy"));
  return roles;
}

export type Segment = {
  minutes: number; fastSec: number | null; slowSec: number | null; label: string;
  /** чем заменить «по ощущениям» у сегмента без темпа (пауза, ускорения) */
  noPaceText?: string;
};

export const fp = (sec: number): string => {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
};
const rangeText = (f: number, s: number): string => `${fp(f)}–${fp(s)}`;

export function renderDescription(segs: Segment[]): string {
  return segs.map((s) => {
    const dur = `${s.minutes} ${s.minutes === 1 ? "минута" : s.minutes < 5 ? "минуты" : "минут"}`;
    if (s.fastSec != null && s.slowSec != null) return `${s.label}: ${dur} ${rangeText(s.fastSec, s.slowSec)}`;
    return `${s.label}: ${dur} ${s.noPaceText ?? "по ощущениям"}`;
  }).join(". ") + ".";
}

export type RoundTrip = { ok: boolean; expected: number; parsedRanges: number; parsedSegments: number; problems: string[] };

export function verifyRoundTrip(text: string, segs: Segment[]): RoundTrip {
  const problems: string[] = [];
  const expected = segs.filter((s) => s.fastSec != null && s.slowSec != null);
  const got = ranges(text); const parsed = parseSegments(text);
  if (got.length !== expected.length) problems.push(`диапазонов ${got.length}, заложено ${expected.length}`);
  for (let i = 0; i < Math.min(got.length, expected.length); i++) {
    if (got[i].fast !== expected[i].fastSec || got[i].slow !== expected[i].slowSec) {
      problems.push(`сегмент ${i + 1}: прочитано ${fp(got[i].fast)}–${fp(got[i].slow)}, заложено ${fp(expected[i].fastSec!)}–${fp(expected[i].slowSec!)}`);
    }
  }
  if (parsed.length !== segs.length) problems.push(`сегментов ${parsed.length}, заложено ${segs.length}`);
  return { ok: problems.length === 0, expected: expected.length, parsedRanges: got.length, parsedSegments: parsed.length, problems };
}

export type Session = {
  dayIdx: number; role: Role; presetCode: string; title: string; minutes: number;
  description: string; segments: Segment[];
  anchorSource: string; confidence: string; targetMode: string;
  pctMin: number | null; pctMax: number | null;
  roundTrip: RoundTrip; deferred: boolean; deferReason: string | null;
  warnings: string[]; coachReview: string[];
};

/** Шаг 4: полосу лёгкого сужаем СИММЕТРИЧНО к середине, если она шире потолка. */
function narrowBand(fast: number, slow: number): { fast: number; slow: number; narrowed: boolean } {
  if (slow - fast <= EASY_BAND_MAX_S) return { fast, slow, narrowed: false };
  const mid = (fast + slow) / 2, half = EASY_BAND_MAX_S / 2;
  return { fast: Math.round(mid - half), slow: Math.round(mid + half), narrowed: true };
}

function aerobicSession(dayIdx: number, role: Role, a: AthleteAnchors, cat: Catalog, minutes: number): Session {
  const presetCode = role === "long" ? "long_aerobic" : role === "recovery" ? "recovery_easy"
    : role === "easy_strides" ? "easy_plus_strides" : "easy_continuous";
  const preset = cat.aerobic.get(presetCode);
  const intent: IntensityIntent = role === "recovery" ? "recovery" : role === "long" ? "long" : "easy";
  const r = resolvePace(a, intent, "maintenance", preset?.rpeTarget ?? null);
  const title = preset?.displayNameRu ?? presetCode; // НАЗВАНИЕ ИЗ КАТАЛОГА, не из кода
  if (!r.ok) {
    return { dayIdx, role, presetCode, title, minutes, description: "", segments: [], anchorSource: "—",
      confidence: "—", targetMode: "—", pctMin: null, pctMax: null,
      roundTrip: { ok: false, expected: 0, parsedRanges: 0, parsedSegments: 0, problems: [r.reason] },
      deferred: true, deferReason: r.reason, warnings: [], coachReview: [] };
  }
  const res = r as Resolved;
  const mode = preset && !preset.controlModeOverriddenByTier ? preset.targetMode : res.targetMode;
  const byFeel = mode === "rpe";
  const band = narrowBand(res.absPaceMinS, res.absPaceMaxS);
  const warnings = [...res.warnings];
  if (band.narrowed) warnings.push(`полоса лёгкого сужена до ${EASY_BAND_MAX_S} с/км симметрично к середине`);

  const segs: Segment[] = [{ minutes, label: title, fastSec: byFeel ? null : band.fast, slowSec: byFeel ? null : band.slow }];
  if (role === "easy_strides") segs.push({ minutes: 2, label: "Ускорения в конце, 4–6 коротких по пятнадцать секунд, свободно", fastSec: null, slowSec: null });
  const description = renderDescription(segs);
  const rt = verifyRoundTrip(description, segs);
  return { dayIdx, role, presetCode, title, minutes, description, segments: segs,
    anchorSource: res.anchorSource, confidence: res.confidence, targetMode: mode,
    pctMin: res.pctMin, pctMax: res.pctMax, roundTrip: rt, deferred: !rt.ok,
    deferReason: rt.ok ? null : "round_trip_mismatch", warnings, coachReview: [] };
}

/**
 * Каноническая разминка (пресеты L2–L3). Темпы: «спокойно» — из якоря лёгкого, «чуть быстрее»
 * и «в темпе» — ОТ ПОРОГА, ускорения — по ощущениям, без цифр.
 *
 * «В темпе» считается резолвером с ПРИНУДИТЕЛЬНО снятым якорем качества (`quality: null`):
 * иначе двухминутка получила бы ровно ту же полосу, что и рабочие отрезки, а по решению
 * тренера этот кусок идёт от порога. Второй формулы это не заводит — путь тот же, что у
 * фолбэка качества в резолвере.
 *
 * Запрет VO2 сюда НЕ относится: он про ВЫБОР СЕССИИ, а разминочные ускорения идут без темпа.
 *
 * Если порога нет, «чуть быстрее» и «в темпе» опускаются — разминка вырождается в спокойный
 * бег с ускорениями, но сессия не падает в defer из-за разминки.
 */
function canonicalWarmup(a: AthleteAnchors, eb: { fast: number; slow: number }): Segment[] {
  const C = CANONICAL_WARMUP;
  const segs: Segment[] = [{ minutes: C.easyIn, label: "Разминка, спокойно (Zone 2)", fastSec: eb.fast, slowSec: eb.slow }];
  const faster = resolvePace(a, "steady_tempo", "maintenance", null);
  const tempo = resolvePace({ ...a, quality: null }, "controlled_threshold", "maintenance", null);
  const t = tempo.ok ? (tempo as Resolved) : null;
  if (faster.ok) {
    const f = faster as Resolved;
    // «Чуть быстрее» обязано остаться МЕДЛЕННЕЕ «в темпе»: это лестница разминки, а не две
    // равные части. Расширение полосы по доверию (§2.5) подтягивает steady вплотную к порогу,
    // и без подрезки обе части начинались с одного числа — в тексте это читается как ошибка.
    let ff = f.absPaceMinS, fs = f.absPaceMaxS;
    if (t && ff < t.absPaceMaxS) { ff = t.absPaceMaxS; if (fs <= ff) fs = ff + 10; }
    segs.push({ minutes: C.faster, label: "Чуть быстрее", fastSec: ff, slowSec: fs });
  }
  if (t) segs.push({ minutes: C.tempo, label: "В темпе", fastSec: t.absPaceMinS, slowSec: t.absPaceMaxS });
  segs.push({ minutes: C.strides, label: "Ускорения, 3–4 коротких по пятнадцать секунд", fastSec: null, slowSec: null, noPaceText: "свободно, по ощущениям" });
  segs.push({ minutes: C.easyOut, label: "Спокойно (Zone 2)", fastSec: eb.fast, slowSec: eb.slow });
  segs.push({ minutes: C.pause, label: "Пауза перед работой", fastSec: null, slowSec: null, noPaceText: "полный отдых, часы на паузу" });
  return segs;
}

function qualitySession(dayIdx: number, a: AthleteAnchors, dec: Extract<QualityDecision, { selected: true }>): Session {
  const p: QualityPreset = dec.preset;
  const intent: IntensityIntent = p.intensityIntent === "threshold" ? "threshold" : "controlled_threshold";
  const work = resolvePace(a, intent, "maintenance", p.rpeTarget);
  const easy = resolvePace(a, "easy", "maintenance", null);
  if (!work.ok || !easy.ok) {
    const reason = !work.ok ? work.reason : (easy as { reason: string }).reason;
    return { dayIdx, role: "quality", presetCode: p.presetCode, title: p.displayNameRu, minutes: 0, description: "",
      segments: [], anchorSource: "—", confidence: "—", targetMode: "—", pctMin: null, pctMax: null,
      roundTrip: { ok: false, expected: 0, parsedRanges: 0, parsedSegments: 0, problems: [reason] },
      deferred: true, deferReason: reason, warnings: [], coachReview: dec.coachReview };
  }
  const w = work as Resolved, e = easy as Resolved;
  const eb = narrowBand(e.absPaceMinS, e.absPaceMaxS);
  const warmMin = p.warmupMinutes || WARMUP_CANON_MINUTES;
  // Каноническая разминка НЕ сворачивается ради экономии минут — протокол задан уровнем
  // пресета, это решение тренера. Не помещается в неделю — отбор берёт пресет поменьше.
  const segs: Segment[] = needsCanonicalWarmup(p.athleteLevelMin)
    ? canonicalWarmup(a, eb)
    // Простая разминка (L0–L1) по методологии из РЕАЛЬНЫХ описаний: 86% качественных — 10 минут,
    // формулировка «Разминка — 10 минут @ темп (Zone 2), спокойно». Ускорения внутри разминки
    // встречаются лишь в 15% — в простой разминке НЕ ставим.
    : [{ minutes: warmMin, label: "Разминка, спокойно (Zone 2)", fastSec: eb.fast, slowSec: eb.slow }];
  for (let i = 0; i < p.reps; i++) {
    segs.push({ minutes: p.workMinutes, label: `Отрезок ${i + 1}`, fastSec: w.absPaceMinS, slowSec: w.absPaceMaxS });
    if (i < p.reps - 1) segs.push({ minutes: p.recoveryMinutes, label: "Трусца", fastSec: eb.fast, slowSec: eb.slow });
  }
  segs.push({ minutes: p.cooldownMinutes, label: "Заминка, свободно (Zone 2)", fastSec: eb.fast, slowSec: eb.slow });
  const total = segs.reduce((s, x) => s + x.minutes, 0);
  const description = renderDescription(segs);
  const rt = verifyRoundTrip(description, segs);
  return { dayIdx, role: "quality", presetCode: p.presetCode, title: p.displayNameRu, minutes: Math.round(total),
    description, segments: segs, anchorSource: w.anchorSource, confidence: w.confidence, targetMode: w.targetMode,
    pctMin: w.pctMin, pctMax: w.pctMax, roundTrip: rt, deferred: !rt.ok,
    deferReason: rt.ok ? null : "round_trip_mismatch",
    warnings: [...w.warnings, ...dec.warnings], coachReview: dec.coachReview };
}

export type Week = {
  athleteId: number; tier: string; weekStart: string; days: number[]; sessions: Session[];
  notes: string[]; qualityDecision: string;
  /** null — неделя выдана. Иначе причина отказа. */
  refused: string | null;
  /** род отказа: не влезает в потолок или истории не хватает на конверт */
  refusedKind: "does_not_fit" | "insufficient_data" | null;
  /** потолок объёма недели, мин — по нему проверяется, что раскладка его не нарушила */
  weeklyCap: number;
  /** сумма минут выданных сессий */
  plannedMinutes: number;
};

/**
 * Полосы, которые РЕАЛЬНО увидит ученик в готовом описании — вход проверки на слипание.
 *
 * Берём из отрендеренных сегментов, а не из якорей: полоса лёгкого перед показом сужается
 * до потолка ширины (narrowBand), поэтому широкая зона 2 в тексте выглядит иначе, чем в якоре.
 * null = чисел нет (сессия идёт «по ощущениям» либо такой сессии на неделе нет).
 */
export function shownBands(w: Week): { easy: Band | null; quality: Band | null } {
  const AEROBIC: Role[] = ["easy", "easy_strides", "recovery", "long"];
  let easy: Band | null = null;
  for (const s of w.sessions) {
    if (s.deferred || !AEROBIC.includes(s.role) || s.targetMode !== "pace") continue;
    const seg = s.segments.find((x) => x.fastSec != null && x.slowSec != null);
    if (seg) { easy = { fastSec: seg.fastSec!, slowSec: seg.slowSec! }; break; }
  }
  let quality: Band | null = null;
  for (const s of w.sessions) {
    if (s.deferred || s.role !== "quality" || s.targetMode !== "pace") continue;
    const seg = s.segments.find((x) => x.label.startsWith("Отрезок") && x.fastSec != null && x.slowSec != null);
    if (seg) { quality = { fastSec: seg.fastSec!, slowSec: seg.slowSec! }; break; }
  }
  return { easy, quality };
}

/** Абсолютный пол длительной, мин: совпадает с самым низким полом лёгкого по замеру. */
export const LONG_FLOOR = 30;

/** Минимум наблюдённых недель, ниже которого конверт объёма считать не из чего (§п.3 наряда). */
export const MIN_WEEKS_FOR_ENVELOPE = 4;

export function buildWeek(a: AthleteAnchors, env: Envelope, cat: Catalog, weekStart: string, hasActiveIllness: boolean,
  tierNote: string | null = null): Week {
  const notes: string[] = [];
  if (tierNote) notes.push(tierNote);
  const EASY_FLOOR = EASY_FLOOR_BY_TIER[a.tier];
  const ratioEasy = LONG_OVER_EASY_RATIO[a.tier];
  const ratioQual = LONG_OVER_QUALITY_RATIO[a.tier];
  let nWant = Math.round(env.rolling4wFrequency || 0);
  if (nWant <= 0) nWant = Math.min(3, Math.round(env.capFrequency ?? 3));
  if (env.capFrequency != null && nWant > env.capFrequency) { nWant = Math.round(env.capFrequency); notes.push("частота подрезана потолком baseline"); }
  nWant = clamp(nWant, 1, 7);

  const longDayHint = env.dayHistogram.indexOf(Math.max(...env.dayHistogram));

  // ПОТОЛОК НЕДЕЛИ — НЕПРИКОСНОВЕНЕН (правило Игоря 11.08). Конверт сверху И не более +10%
  // к предыдущей ФАКТИЧЕСКОЙ неделе. Раньше полы сессий побеждали потолок и неделя вылезала
  // за него (5847207: потолок 28 мин, выдавалось 80 при активной травме). Теперь наоборот:
  // не помещается — сокращаем ЧИСЛО ДНЕЙ, а если и одна сессия не влезает, неделю не выдаём.
  let weekly = Math.min(env.rolling4wWeeklyMin || 0, env.capWeeklyMin ?? Infinity) || 150;
  if (env.lastWeekMinutes > 0) {
    const ceil = Math.round(env.lastWeekMinutes * WEEKLY_GROWTH_MAX);
    if (weekly > ceil) { weekly = ceil; notes.push(`объём подрезан до +${Math.round((WEEKLY_GROWTH_MAX - 1) * 100)}% к прошлой неделе (${env.lastWeekMinutes} мин)`); }
  }

  const qualityCap = qualityCapFromHistory(env.qualityLast8w);
  const refuse = (detail: string, kind: Week["refusedKind"]): Week => ({
    athleteId: a.athleteId, tier: a.tier, weekStart, days: [], sessions: [], notes,
    qualityDecision: "не выдана", refused: detail, refusedKind: kind, weeklyCap: weekly, plannedMinutes: 0,
  });

  // МАЛО ДАННЫХ ≠ НЕ ПОМЕЩАЕТСЯ. У 5524773 потолок выходил 23 мин и он попадал в отказ «не
  // помещается», хотя причина другая: истории почти нет, и конверт объёма считать не из чего.
  // Это разные случаи для тренера: один про нагрузку, другой про пробел в данных.
  if (env.weeksObserved < MIN_WEEKS_FOR_ENVELOPE) {
    return refuse(`наблюдённых недель ${env.weeksObserved} (нужно ${MIN_WEEKS_FOR_ENVELOPE}) — конверт объёма считать не из чего`, "insufficient_data");
  }
  if (env.lastWeekMinutes <= 0 && env.rolling4wWeeklyMin <= 0) {
    return refuse("ни одной завершённой пробежки в окне — конверт объёма считать не из чего", "insufficient_data");
  }

  // ── ПОДБОР ЧИСЛА ДНЕЙ ПОД ПОТОЛОК ──
  // Идём от желаемой частоты вниз. Для каждого варианта считаем МИНИМАЛЬНУЮ неделю (все сессии
  // на полах) и берём первый, который помещается. Раздувать объём, чтобы вписать лишний день,
  // нельзя — сокращается именно число дней.
  type Plan = { n: number; days: number[]; roles: Map<number, Role>; dec: QualityDecision; qSessions: Session[]; easyRoles: number };
  let plan: Plan | null = null;
  let lastRefusal = `минимальная неделя не помещается в потолок ${weekly} мин`;

  for (let n = nWant; n >= 1; n--) {
    const days = chooseDays(env.dayHistogram, n);
    const counts = rolesForDayCount(n, qualityCap);
    let easyRoles = n - counts.quality - counts.long;

    // Бюджет ПОЛНОЙ длительности качественной: длительная обязана её перерасти (+1 шаг),
    // у лёгких дней есть пол. Отсюда потолок на саму сессию, который уходит в отбор.
    const sessionBudget = counts.quality > 0
      ? Math.floor((weekly - ROUND_TO_MIN - EASY_FLOOR * easyRoles - LONG_FLOOR * 0) / (counts.quality + 1))
      : 0;

    // Без порога качество не назначаем ВООБЩЕ: резолвер всё равно откажет (числа брать неоткуда).
    // Отбор сам знает про потолок качества и про «меньше 3 беговых дней» — свою причину поверх
    // его причины не пишем, иначе в отчёте не видно, что реально помешало.
    const dec: QualityDecision = a.threshold == null
      ? { selected: false, reason: "no_threshold_cannot_do_quality", detail: "порога нет — качество не назначается" }
      : selectQualityFromCatalog(cat.quality, cat.guardrails, cat.reviewRules, {
        qualityLast8w: env.qualityLast8w, plannedRunCount: n,
        lastQualityWorkMinutes: env.lastQualityWorkMinutes,
        hasActiveIllnessOrInjury: hasActiveIllness, hasRaceContext: false,
        contextFlags: hasActiveIllness ? ["injury"] : [], rolling4wWeeklyMin: env.rolling4wWeeklyMin,
        sessionBudgetMin: sessionBudget,
      });
    if (!dec.selected) { counts.quality = 0; easyRoles = n - counts.long; }

    const roles = assignRoles(days, counts, longDayHint);
    const qDays = [...roles.entries()].filter(([, r]) => r === "quality").map(([d]) => d);
    // Каноническая разминка НЕ сворачивается: она задана уровнем пресета, это решение тренера.
    const qSessions = dec.selected ? qDays.map((d) => qualitySession(d, a, dec)) : [];
    const qTotal = qSessions.reduce((s, x) => s + (x.deferred ? 0 : x.minutes), 0);
    const qLongest = qSessions.reduce((m, x) => (x.deferred ? m : Math.max(m, x.minutes)), 0);

    // Пол длительной относительно лёгкого имеет смысл ТОЛЬКО когда лёгкие дни есть.
    const minLong = Math.max(LONG_FLOOR, easyRoles > 0 ? Math.max(EASY_FLOOR * ratioEasy, EASY_FLOOR + ROUND_TO_MIN) : 0,
      qLongest > 0 ? qLongest * ratioQual : 0);
    const minWeek = qTotal + round5(minLong) * counts.long + EASY_FLOOR * easyRoles;
    if (minWeek <= weekly) {
      plan = { n, days, roles, dec, qSessions, easyRoles };
      if (n < nWant) notes.push(`беговых дней ${nWant} → ${n}: больше не помещается в потолок ${weekly} мин`);
      if (!dec.selected) notes.push(`качество не назначено: ${dec.reason} (${dec.detail})`);
      break;
    }
    lastRefusal = `минимальная неделя ${minWeek} мин при ${n} ${n === 1 ? "дне" : "днях"} выше потолка ${weekly} мин`;
  }
  if (!plan) return refuse(lastRefusal, "does_not_fit");

  const { days, roles, dec, qSessions, easyRoles } = plan;
  const qTotal = qSessions.reduce((s, x) => s + (x.deferred ? 0 : x.minutes), 0);
  const qLongest = qSessions.reduce((m, x) => (x.deferred ? m : Math.max(m, x.minutes)), 0);

  // ── РАСКЛАДКА ОСТАТКА: стартуем с полов и РАСТЁМ, пока есть место под потолком ──
  // Порядок роста: сначала длительная до желаемой (она главная сессия недели), потом лёгкие.
  // Так потолок не может быть нарушен по построению — мы никогда не начинаем сверху.
  const longWant = round5(clamp(Math.min(env.capLongRunMin ?? weekly * 0.35, weekly * 0.45), LONG_FLOOR, 180));
  let easyBase = EASY_FLOOR;
  // У T1 кратность 1.0 (длительных им не ставят), но «самая длинная» должна оставаться
  // буквально самой длинной — иначе в плане два дня по 30 мин, и один зачем-то «длительный».
  let longMin = round5(Math.max(LONG_FLOOR, easyRoles > 0 ? Math.max(easyBase * ratioEasy, easyBase + ROUND_TO_MIN) : 0,
    qLongest > 0 ? qLongest * ratioQual : 0));
  let spare = weekly - (qTotal + longMin + easyBase * easyRoles);

  while (spare >= ROUND_TO_MIN && longMin < longWant) { longMin += ROUND_TO_MIN; spare -= ROUND_TO_MIN; }
  // Лёгкие растут, пока длительная остаётся длиннее них в измеренной кратности И строго длиннее
  // по абсолюту: при кратности 1.0 (T1) одна проверка кратности пропускала ровно тот шаг,
  // который делал лёгкий равным длительной.
  while (easyRoles > 0 && spare >= ROUND_TO_MIN * easyRoles && easyBase < 70
         && longMin >= (easyBase + ROUND_TO_MIN) * ratioEasy
         && longMin > easyBase + ROUND_TO_MIN) {
    easyBase += ROUND_TO_MIN; spare -= ROUND_TO_MIN * easyRoles;
  }

  const easyVariants = [easyBase, Math.max(EASY_FLOOR, easyBase - ROUND_TO_MIN)]; // лёгкие не одинаковые

  const sessions: Session[] = []; let easyIdx = 0; let qIdx = 0;
  for (const d of days) {
    const role = roles.get(d) ?? "easy";
    if (role === "quality" && qIdx < qSessions.length) sessions.push(qSessions[qIdx++]);
    else if (role === "long") sessions.push(aerobicSession(d, "long", a, cat, longMin));
    else { sessions.push(aerobicSession(d, role === "quality" ? "easy" : role, a, cat, easyVariants[easyIdx % easyVariants.length])); easyIdx++; }
  }
  return { athleteId: a.athleteId, tier: a.tier, weekStart, days, sessions, notes, refused: null, refusedKind: null,
    weeklyCap: weekly, plannedMinutes: sessions.reduce((s, x) => s + (x.deferred ? 0 : x.minutes), 0),
    qualityDecision: dec.selected ? `${dec.preset.presetCode}: ${dec.reason}` : `отказ: ${dec.reason}` };
}
