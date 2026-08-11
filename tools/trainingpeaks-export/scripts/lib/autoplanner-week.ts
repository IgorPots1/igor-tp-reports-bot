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
import { LOW_COMPLIANCE_RATIO, LOW_COMPLIANCE_WEEKS, NOT_RUNNING_RATIO, NOT_RUNNING_WEEKS, type Envelope } from "./autoplanner-context.ts";
import { CANONICAL_WARMUP, WARMUP_CANON_MINUTES, needsCanonicalWarmup, type Catalog, type QualityPreset } from "./autoplanner-catalog.ts";
import { selectQualityFromCatalog, qualityCapFromHistory, type QualityDecision } from "./quality-select.ts";
import type { Band } from "./band-collision.ts";

export const DAY_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export type Role = "quality" | "long" | "easy" | "easy_strides" | "recovery" | "rest";

/** Шаг 4: всё округляем до 5 минут — «63 минуты» в плане не бывает. */
export const ROUND_TO_MIN = 5;
/**
 * ФОРМА НЕДЕЛИ — ИЗМЕРЕНО ПО ПРАКТИКЕ (tp-week-shape-measure, 26 недель, 2481 атлето-неделя,
 * только coach_authored).
 *
 * РАЗДЕЛЕНИЕ ГЕЙТОВ И ОРИЕНТИРОВ (правило Игоря 12.08). В ГЕЙТ — только ИНВАРИАНТ: то, чего
 * в практике НЕ БЫВАЕТ ВООБЩЕ (граница min распределения). Перцентиль в роли гейта ломает
 * неделю на ровном месте: кратность 1.32 (p10) запрещала 5733231 брать thr_3x12, хотя такие
 * недели у тренера есть. Перцентили остаются ЦЕЛЯМИ: к ним тянемся, если место есть.
 */

/**
 * ПОЛ лёгкой пробежки — ИНВАРИАНТ: короче 25 минут тренер не пишет НИ РАЗУ ни в одном тире
 * (min по замеру: T1 25, T2 25, T3 30).
 */
export const EASY_FLOOR_MIN = 25;

/**
 * ПРАВИЛО, КОТОРОЕ ЛЕГКО ПЕРЕПУТАТЬ: нижний край распределения — это ПОЛ, медиана — это ЦЕЛЬ.
 * Ставить целью p05 значит целиться в самую короткую тренировку, какую тренер вообще писал,
 * и систематически недобирать. Пол защищает от бессмыслицы, цель задаёт норму.
 *
 * ЦЕЛЬ по длине лёгкой — МЕДИАНА по тирам (было p05 = 30/30/40, нижний край практики).
 * Не гейт: если неделя не вмещает, лёгкий ужимается до инварианта 25, а день не теряется.
 */
export const EASY_TARGET_BY_TIER: Record<Tier, number> = { T1: 40, T2: 50, T3: 60 };

/**
 * ЦЕЛЬ кратности длительная/лёгкий — МЕДИАНА замера (T2 1.60, T3 1.80). Было p10 (1.43/1.50),
 * то есть опять нижний край в роли ориентира. ГЕЙТА здесь нет: инвариант — только
 * «длительная не короче самого длинного лёгкого» (min кратности 1.00).
 * T1 = 1.0: длительных этому тиру не ставят вообще (пар n=0), множитель был бы выдуман.
 */
export const LONG_OVER_EASY_TARGET: Record<Tier, number> = { T1: 1.0, T2: 1.60, T3: 1.80 };

/**
 * ЦЕЛЬ кратности длительная/качественная — медиана замера (T2 1.53, T3 1.64), а не p10:
 * это ориентир, к нему и тянемся. ГЕЙТ — инвариант «длительная не короче качественной»
 * (99% недель строго длиннее, 1% поровну, короче НЕ БЫВАЕТ).
 */
export const LONG_OVER_QUALITY_TARGET: Record<Tier, number> = { T1: 1.0, T2: 1.53, T3: 1.64 };
/** Потолок отдельной лёгкой пробежки, мин. max наблюдений 130, но это уже длительная по сути. */
export const EASY_MAX = 70;
/** Ниже этой доли цели неделя помечается как недобранная (параметр отчётности, не гейт). */
export const VOLUME_TARGET_TOL = 0.9;
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
  // ГЕЙТЫ — инварианты, ЦЕЛИ — перцентили. Минимальная неделя считается по инвариантам,
  // рост остатка тянется к целям.
  const EASY_FLOOR = EASY_FLOOR_MIN;                    // гейт: короче не бывает
  const easyTarget = EASY_TARGET_BY_TIER[a.tier];       // цель: типичная длина лёгкой
  const ratioEasy = LONG_OVER_EASY_TARGET[a.tier];      // цель
  const ratioQual = LONG_OVER_QUALITY_TARGET[a.tier];   // цель
  let nWant = Math.round(env.rolling4wFrequency || 0);
  if (nWant <= 0) nWant = Math.min(3, Math.round(env.capFrequency ?? 3));
  if (env.capFrequency != null && nWant > env.capFrequency) { nWant = Math.round(env.capFrequency); notes.push("частота подрезана потолком baseline"); }
  nWant = clamp(nWant, 1, 7);

  const longDayHint = env.dayHistogram.indexOf(Math.max(...env.dayHistogram));

  // ПОТОЛОК НЕДЕЛИ — НЕПРИКОСНОВЕНЕН (правило Игоря 11.08) И СЧИТАЕТСЯ ОТ ПЛАНА (12.08).
  //
  // Раньше он считался от ЗАВЕРШЁННЫХ минут, а полы сессий измерены по ПЛАНАМ тренера. Две
  // валюты в одной формуле сжимали неделю на каждом прогоне: медиана выполнено/запланировано
  // 0.83, у 41 атлета из 119 ниже 70%, третий день переставал влезать и качество отменялось
  // (12 недель с качеством из 110). Теперь и потолок, и полы — в плановых минутах.
  //
  // Выполнение НЕ выбрасываем: низкое выполнение уходит ПОМЕТКОЙ тренеру ниже, но объём им
  // не режется — иначе пропуск недели навсегда занижает план.
  // ИСКЛЮЧЕНИЕ: КОГДА ЧЕЛОВЕК НЕ ТРЕНИРУЕТСЯ, ПЛАН ЗДОРОВОГО ПЕРИОДА ЕМУ НЕ ОРИЕНТИР.
  // 5847207 с активной травмой получал 145 мин, потому что потолок брал план ДО травмы, а
  // понижение тира меняет только режим контроля и объёма не касается. В таких случаях считаем
  // потолок ОТ ФАКТА. Два входа: активный health-сигнал и «не бегает» (выполнение ниже 40%
  // подряд 3 недели). Обычное недовыполнение (около 80%) объём НЕ режет — план и так с запасом.
  const notTraining = hasActiveIllness || env.notRunningWeeks >= NOT_RUNNING_WEEKS;

  let weekly: number;
  if (notTraining) {
    weekly = Math.min(env.rolling4wWeeklyMin || 0, env.capWeeklyMin ?? Infinity) || 30;
    if (env.lastWeekMinutes > 0) weekly = Math.min(weekly, Math.round(env.lastWeekMinutes * WEEKLY_GROWTH_MAX));
    notes.push(hasActiveIllness
      ? `потолок от ФАКТА (${weekly} мин): активный health-сигнал — план здорового периода не ориентир`
      : `потолок от ФАКТА (${weekly} мин): выполнение ниже ${Math.round(NOT_RUNNING_RATIO * 100)}% ${env.notRunningWeeks} нед подряд — человек фактически не тренируется`);
  } else {
    weekly = Math.min(env.rolling4wPlannedMin || 0, env.capWeeklyMin ?? Infinity) || 150;
    if (env.lastWeekPlannedMinutes > 0) {
      const ceil = Math.round(env.lastWeekPlannedMinutes * WEEKLY_GROWTH_MAX);
      if (weekly > ceil) { weekly = ceil; notes.push(`объём подрезан до +${Math.round((WEEKLY_GROWTH_MAX - 1) * 100)}% к плану прошлой недели (${env.lastWeekPlannedMinutes} мин)`); }
    }
  }
  if (!notTraining && env.lowComplianceWeeks >= LOW_COMPLIANCE_WEEKS) {
    notes.push(`✋ выполнение ниже ${Math.round(LOW_COMPLIANCE_RATIO * 100)}% ${env.lowComplianceWeeks} нед подряд`
      + `${env.complianceRatio != null ? ` (за окно ${Math.round(env.complianceRatio * 100)}%)` : ""} — объём НЕ срезан, нужен взгляд тренера`);
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
  // на полах). Раздувать объём, чтобы вписать лишний день, нельзя — сокращается именно число дней.
  type Plan = { n: number; days: number[]; roles: Map<number, Role>; dec: QualityDecision; qSessions: Session[]; easyRoles: number; fits: boolean; minWeek: number };
  let lastRefusal = `минимальная неделя не помещается в потолок ${weekly} мин`;

  const tryPlan = (n: number): Plan => {
    const days = chooseDays(env.dayHistogram, n);
    const counts = rolesForDayCount(n, qualityCap);
    let easyRoles = n - counts.quality - counts.long;

    // Бюджет ПОЛНОЙ длительности качественной: длительная обязана её перерасти (+1 шаг),
    // у лёгких дней есть пол. Отсюда потолок на саму сессию, который уходит в отбор.
    // Бюджет ПОЛНОЙ длительности качественной. Выводится из ИНВАРИАНТА (не из кратности):
    //   k·Q + (Q + шаг) + пол_лёгкого·лёгкие_дни <= потолок,
    // где k — число качественных дней, а длительная обязана быть лишь ДЛИННЕЕ качественной.
    // Шаг округления в числителе обязателен: без него бюджет промахивается ровно на эти 5 минут,
    // отбор берёт пресет на грани, и неделя не проходит проверку вместимости.
    const sessionBudget = counts.quality > 0
      ? Math.floor((weekly - ROUND_TO_MIN - EASY_FLOOR * easyRoles) / (counts.quality + 1))
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
    // ИНВАРИАНТЫ: длительная не короче самого длинного лёгкого и не короче качественной.
    // Кратности сюда НЕ входят — они цели, и неделю из-за них не ломаем.
    const minLong = Math.max(LONG_FLOOR, easyRoles > 0 ? EASY_FLOOR + ROUND_TO_MIN : 0,
      qLongest > 0 ? qLongest + ROUND_TO_MIN : 0);
    const minWeek = qTotal + round5(minLong) * counts.long + EASY_FLOOR * easyRoles;
    return { n, days, roles, dec, qSessions, easyRoles, fits: minWeek <= weekly, minWeek };
  };

  // КАЧЕСТВО ВАЖНЕЕ ЛИШНЕГО ЛЁГКОГО ДНЯ. Первый проход ищет вариант, где качественная
  // ПОМЕЩАЕТСЯ: иначе побеждало большее число дней, и у 5733231 выходили четыре лёгких дня
  // вместо трёх дней с отрезками, хотя качество он стабильно получает.
  let plan: Plan | null = null;
  if (qualityCap >= 1 && a.threshold != null) {
    for (let n = nWant; n >= 1; n--) {
      const p = tryPlan(n);
      if (p.fits && p.dec.selected) { plan = p; break; }
    }
  }
  if (!plan) {
    for (let n = nWant; n >= 1; n--) {
      const p = tryPlan(n);
      if (p.fits) { plan = p; break; }
      lastRefusal = `минимальная неделя ${p.minWeek} мин при ${n} ${n === 1 ? "дне" : "днях"} выше потолка ${weekly} мин`;
    }
  }
  if (!plan) return refuse(lastRefusal, "does_not_fit");
  if (plan.n < nWant) {
    notes.push(plan.dec.selected
      ? `беговых дней ${nWant} → ${plan.n}: столько дней с качественной не помещается в потолок ${weekly} мин`
      : `беговых дней ${nWant} → ${plan.n}: больше не помещается в потолок ${weekly} мин`);
  }
  if (!plan.dec.selected) notes.push(`качество не назначено: ${plan.dec.reason} (${plan.dec.detail})`);

  const { days, roles, dec, qSessions, easyRoles } = plan;
  const qTotal = qSessions.reduce((s, x) => s + (x.deferred ? 0 : x.minutes), 0);
  const qLongest = qSessions.reduce((m, x) => (x.deferred ? m : Math.max(m, x.minutes)), 0);

  // ── РАСКЛАДКА ОСТАТКА: стартуем с ИНВАРИАНТОВ и РАСТЁМ к ЦЕЛЯМ, пока есть место ──
  // Потолок не может быть нарушен по построению — мы никогда не начинаем сверху.
  // Порядок: (1) лёгкие до типичной длины своего тира, (2) длительная до кратности-ориентира,
  // (3) остаток — длительной. Инвариант «длительная строго длиннее лёгкого» держится на
  // каждом шаге; при кратности 1.0 (T1) одной проверки кратности было мало — она пропускала
  // ровно тот шаг, который делал лёгкий равным длительной.
  const capLong = round5(clamp(Math.min(env.capLongRunMin ?? weekly * 0.35, weekly * 0.45), LONG_FLOOR, 180));
  let easyBase = EASY_FLOOR;
  let longMin = round5(Math.max(LONG_FLOOR, easyRoles > 0 ? easyBase + ROUND_TO_MIN : 0,
    qLongest > 0 ? qLongest + ROUND_TO_MIN : 0));
  let spare = weekly - (qTotal + longMin + easyBase * easyRoles);

  const canGrowEasy = (): boolean => easyRoles > 0 && spare >= ROUND_TO_MIN * easyRoles
    && longMin > easyBase + ROUND_TO_MIN;
  // (1) лёгкие до ЦЕЛИ тира — иначе при инварианте 25 мин план выглядит короче обычного
  while (canGrowEasy() && easyBase < easyTarget) { easyBase += ROUND_TO_MIN; spare -= ROUND_TO_MIN * easyRoles; }
  // (2) длительная до ориентира: кратность к лёгкому, кратность к качественной, потолок baseline
  const longTarget = round5(Math.max(capLong, easyBase * ratioEasy, qLongest > 0 ? qLongest * ratioQual : 0));
  while (spare >= ROUND_TO_MIN && longMin < longTarget) { longMin += ROUND_TO_MIN; spare -= ROUND_TO_MIN; }
  // (3) остаток — лёгким, пока кратность-ориентир к длительной не нарушена
  while (canGrowEasy() && easyBase < EASY_MAX && longMin >= (easyBase + ROUND_TO_MIN) * ratioEasy) {
    easyBase += ROUND_TO_MIN; spare -= ROUND_TO_MIN * easyRoles;
  }

  // (4) ДОБОР ДО ЦЕЛИ ПО ОБЪЁМУ. Раньше сборка останавливалась на первом же ориентире и
  // отдавала неделю заметно ниже потолка (замер 14.08: медиана выдано 125 при потолке 150),
  // а теневое сравнение показывало систематический недобор объёма против тренера.
  // Цель — плановый объём самого атлета, та же валюта, что потолок. Идём шагами по 5 минут,
  // отдавая шаг тому, кто дальше от своего ориентира, и не нарушая ни потолок, ни инварианты.
  const targetWeekly = Math.min(weekly, env.rolling4wPlannedMin > 0 ? env.rolling4wPlannedMin : weekly);
  const total = (): number => qTotal + longMin + easyBase * easyRoles;
  let guard = 0;
  while (total() < targetWeekly && spare >= ROUND_TO_MIN && guard++ < 200) {
    const longRoom = longMin < capLong && spare >= ROUND_TO_MIN;
    const easyRoom = canGrowEasy() && easyBase < EASY_MAX && longMin >= (easyBase + ROUND_TO_MIN) * ratioEasy;
    if (!longRoom && !easyRoom) break;
    // Кто дальше от своего ориентира, тот и получает шаг: так неделя не перекашивается
    // в одну длинную сессию и не расползается в одинаковые лёгкие.
    const longGap = longRoom ? (capLong - longMin) / Math.max(capLong, 1) : -1;
    const easyGap = easyRoom ? (EASY_MAX - easyBase) / EASY_MAX : -1;
    if (longRoom && (!easyRoom || longGap >= easyGap)) { longMin += ROUND_TO_MIN; spare -= ROUND_TO_MIN; }
    else { easyBase += ROUND_TO_MIN; spare -= ROUND_TO_MIN * easyRoles; }
  }
  if (total() < targetWeekly * VOLUME_TARGET_TOL) {
    notes.push(`объём ${total()} мин ниже цели ${targetWeekly}: упёрлись в потолки сессий, не в потолок недели`);
  }

  const easyVariants = [easyBase, Math.max(EASY_FLOOR, easyBase - ROUND_TO_MIN)]; // лёгкие не одинаковые

  const sessions: Session[] = []; let easyIdx = 0; let qIdx = 0;
  for (const d of days) {
    const role = roles.get(d) ?? "easy";
    if (role === "quality" && qIdx < qSessions.length) sessions.push(qSessions[qIdx++]);
    // НАЗЫВАЕМ ВЕЩИ СВОИМИ ИМЕНАМИ. У T1 длительных в практике нет вовсе (пар в замере n=0),
    // и единственная сессия недели выходила «Длительный аэробный 30 минут» при том, что
    // обычная лёгкая у этого же атлета ровно 30. Если сессия не длиннее его обычной лёгкой —
    // это лёгкий бег, а не длительная.
    else if (role === "long") {
      const isReallyLong = env.typicalEasyMinutes <= 0 || longMin > env.typicalEasyMinutes;
      if (!isReallyLong) notes.push(`длинный день назван лёгким: ${longMin} мин не больше обычной лёгкой (${env.typicalEasyMinutes} мин)`);
      sessions.push(aerobicSession(d, isReallyLong ? "long" : "easy", a, cat, longMin));
    }
    else { sessions.push(aerobicSession(d, role === "quality" ? "easy" : role, a, cat, easyVariants[easyIdx % easyVariants.length])); easyIdx++; }
  }
  return { athleteId: a.athleteId, tier: a.tier, weekStart, days, sessions, notes, refused: null, refusedKind: null,
    weeklyCap: weekly, plannedMinutes: sessions.reduce((s, x) => s + (x.deferred ? 0 : x.minutes), 0),
    qualityDecision: dec.selected ? `${dec.preset.presetCode}: ${dec.reason}` : `отказ: ${dec.reason}` };
}
