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
import { selectQualityFromCatalog, qualityCapFromHistory, QUALITY_CAP_THRESHOLDS, type QualityDecision } from "./quality-select.ts";
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
/**
 * Максимальная ширина полосы лёгкого, с/км. ЗАМЕРЕНА 16.08 по тому, что тренер РЕАЛЬНО пишет
 * (n=2781): медиана 21, p75 25, p90 27, p95 32. Прежние 25 резали 19% его собственных полос.
 * Ставим 30, а не p90=27: полосы пишутся круглыми (20 с × 1732, 30 с × 677), и сужение до 27
 * дало бы диапазон, которого у тренера не бывает ни разу. 30 — ближайшее реальное значение
 * выше p90.
 */
export const EASY_BAND_MAX_S = 30;
/** Прирост недельного объёма к предыдущей ФАКТИЧЕСКОЙ неделе — не более этого (параметр). */
/**
 * ПОТОЛОК прироста недели. ЗАМЕРЕН 16.08, не угадан.
 *
 * ПРАВИЛО ДЛЯ ВСЕХ КОНСТАНТ-ПОТОЛКОВ: p90 практики. Машине можно то, что тренер делает в
 * девяти неделях из десяти; верхняя децима — это его личное решение, и туда автогенерация
 * лезть не должна. (Полы берутся из min, цели — из медианы; см. EASY_FLOOR_MIN / EASY_TARGET.)
 *
 * Замер шага план[N]/план[N−1] ОТ НОРМАЛЬНОЙ БАЗЫ (n=1715): медиана 0.99, p75 1.06, p90 1.22.
 * Прежняя 1.10 сидела примерно на p78 — то есть запрещала пятую часть обычной практики.
 */
export const WEEKLY_GROWTH_MAX = 1.22;

/**
 * Прошлая неделя считается ПРОВАЛОМ, если её плановый объём ниже этой доли обычной недели
 * атлета. От провала потолок прироста НЕ меряется: замер даёт возврат из провала медианой
 * ×1.65 и p90 ×3.00 — то есть тренер возвращает человека к норме одним шагом, а не за пять
 * недель по +10%. Доля 0.7 — та же граница «нормальной базы», на которой сделан замер.
 */
export const DIP_BASE_RATIO = 0.7;

/**
 * Абсолютный потолок ОДНОЙ длительной, мин. Был 180 и делал контрольную длительную тренера
 * структурно невозможной: в практике она есть на 182 мин, а выше 180 сборщик не выдавал никогда,
 * при любом недельном объёме. Поднят до 200 [решение Игоря 12.08].
 */
export const LONG_CEIL = 200;

/**
 * ЦЕЛЕВАЯ ДЛИТЕЛЬНАЯ ПОД ДИСТАНЦИЮ, мин. ЗАМЕРЕНО 13.08 по практике Игоря, не из литературы.
 *
 * Брались прошедшие старты с известной дистанцией, окно 16 недель до старта, и в каждой неделе —
 * самая длинная НЕ-качественная плановая пробежка. Пик за подготовку:
 *   марафон      (n=26 подготовок): медиана 179, p75 191, p90 200, макс 210, min 120
 *   полумарафон  (n=66 подготовок): медиана 110, p75 120, p90 140, макс 210, min  90
 * ЦЕЛЬ берётся из МЕДИАНЫ — по тому же правилу, что easyTarget и кратности: потолки из p90,
 * полы из min, цели из медианы.
 *
 * 10k и 5k СОЗНАТЕЛЬНО ОТСУТСТВУЮТ: под них отдельного замера нет, а переносить марафонскую
 * логику на короткие дистанции без данных — ровно та подгонка, которая уже пять раз ломала
 * систему. Для них потолок длительной остаётся прежним, от практики атлета.
 */
export const LONG_TARGET_BY_INTENT: Record<string, number> = { marathon: 180, half: 110 };

/**
 * ПОТОЛОК НЕДЕЛЬНОГО ПРИРОСТА длительной при подготовке к дистанции. ЗАМЕРЕНО 13.08.
 *
 * Считалась ЭФФЕКТИВНАЯ скорость за подготовку: (пик / первая неделя) ^ (1 / недель до пика).
 *   марафон     (n=24): медиана 1.075, p75 1.100, p90 1.116
 *   полумарафон (n=57): медиана 1.046, p75 1.104, p90 1.187
 * По правилу «потолок = p90 практики» берётся p90.
 *
 * ПОЧЕМУ НЕ «ШАГ В МОМЕНТ РОСТА». Первый замер дал шаг x1.20 (марафон) — но это шаг В ТУ НЕДЕЛЮ,
 * КОГДА МАКСИМУМ РАСТЁТ, а растёт он лишь в 22% недель. Применять 1.20 еженедельно значило бы
 * гнать вчетверо быстрее тренера.
 */
export const LONG_CAP_STEP_BY_INTENT: Record<string, number> = { marathon: 1.116, half: 1.187 };
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

/**
 * Минимум наблюдённых недель, ниже которого конверт объёма считать не из чего.
 *
 * ЗАМЕР 16.08 ЭТУ КОНСТАНТУ НЕ ПОДТВЕРДИЛ И НЕ ОПРОВЕРГ — он показал, что она НЕ ПРО ТОЧНОСТЬ.
 * Медианная ошибка предсказания планового объёма следующей недели по среднему за K недель:
 *   K=1 → 20.0%   K=2 → 20.0%   K=3 → 19.6%   K=4 → 19.6%   K=5 → 19.5%   K=8 → 21.1%
 * Плоско: четыре недели предсказывают ровно так же, как одна. Значит порог 4 не улучшает
 * оценку, он только решает, СО СКОЛЬКИХ НЕДЕЛЬ ЗНАКОМСТВА машине вообще позволено планировать
 * человека. Это тренерское решение, а не статистическое, и данными не берётся.
 * ОСТАВЛЕНО 4 до явного решения Игоря.
 */
export const MIN_WEEKS_FOR_ENVELOPE = 4;

/**
 * ЦЕЛЬ НЕДЕЛИ ОТ ЦИКЛА. Передана — неделя строится ОТ НЕЁ, а не от конверта истории.
 * Не передана — поведение ровно прежнее (см. режимы ниже).
 */
export type CycleWeekTarget = {
  weekIndex: number;
  totalWeeks: number;
  role: "рост" | "плановая разгрузка" | "подводка" | "старт" | "поддержание";
  aerobicMin: number;
  qualityMin: number;
  days: number;
  /**
   * Базовая неделя цикла (аэробный + работа), мин. Нужна, чтобы понять, НАСКОЛЬКО урезана
   * эта неделя относительно обычной: разгрузка и подводка режут цель, и пол длительной
   * обязан ехать вместе с ней, а не тянуть к полной медиане практики.
   */
  baseWeekMin?: number;
  /**
   * Есть ли у атлета БУДУЩИЙ целевой старт (из trainingpeaks_race_events через черновик цикла).
   * У кого старт есть — длительная режется ПОСЛЕДНЕЙ: при понижении недели она уменьшается
   * пропорционально, а не обнуляется [решение Игоря 12.08].
   */
  hasTargetRace?: boolean;
  /**
   * Тип цикла (marathon / half / 10k / 5k / maintenance). Нужен, чтобы потолок длительной РОС
   * к целевому значению под дистанцию, а не упирался в прошлое атлета.
   */
  intent?: string;
};

export function buildWeek(a: AthleteAnchors, env: Envelope, cat: Catalog, weekStart: string, hasActiveIllness: boolean,
  tierNote: string | null = null, cycle: CycleWeekTarget | null = null): Week {
  const notes: string[] = [];
  if (tierNote) notes.push(tierNote);
  // ГЕЙТЫ — инварианты, ЦЕЛИ — перцентили. Минимальная неделя считается по инвариантам,
  // рост остатка тянется к целям.
  const EASY_FLOOR = EASY_FLOOR_MIN;                    // гейт: короче не бывает
  const easyTarget = EASY_TARGET_BY_TIER[a.tier];       // цель: типичная длина лёгкой
  const ratioEasy = LONG_OVER_EASY_TARGET[a.tier];      // цель
  // ЦЕЛЬ, НО БОЛЬШЕ НЕ МНОЖИТЕЛЬ ДЛИНЫ ДЛИТЕЛЬНОЙ (правка 16.08). Кратность замерена на
  // качественных ТРЕНЕРА (медиана полной длительности у T3 — 61 мин), а машина ставит сессию
  // с канонической разминкой на 96 мин. 96 × 1.64 = 157 мин длительной — так тренер не пишет,
  // и в пакете на приёмку это дало неделю «длительная 155 при лёгких 30». Применять кратность
  // к сессии вне того диапазона, на котором она замерена, нельзя. Инвариант «длительная длиннее
  // качественной» держится отдельно (см. начальное значение longMin). Расхождение с кратностью
  // не прячем — оно уходит ПОМЕТКОЙ тренеру.
  const ratioQual = LONG_OVER_QUALITY_TARGET[a.tier];
  // ЧИСЛО ДНЕЙ: из цикла, если он есть; иначе как прежде — из медианы плановой частоты.
  let nWant: number;
  if (cycle) {
    nWant = clamp(cycle.days, 1, 7);
    notes.push(`цикл: неделя ${cycle.weekIndex} из ${cycle.totalWeeks}, роль «${cycle.role}»`);
  } else {
    nWant = Math.round(env.rolling4wFrequency || 0);
    if (nWant <= 0) nWant = Math.min(3, Math.round(env.capFrequency ?? 3));
    if (env.capFrequency != null && nWant > env.capFrequency) { nWant = Math.round(env.capFrequency); notes.push("частота подрезана потолком baseline"); }
    nWant = clamp(nWant, 1, 7);
  }

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
  // ── РЕЖИМ ЦИКЛА ──
  // Цикл задаёт целевой объём недели, и конверт истории (rolling4w, WEEKLY_GROWTH_MAX,
  // подрезка после провала) на него НЕ действует: это планирование, а его взял на себя цикл.
  // ЗАЩИТЫ ОСТАЮТСЯ ВСЕ: полы сессий, потолок доли работы, сужение полосы, проверка
  // слипания, обратная сверка, отказ при невместимости, фильтр действующих.
  //
  // РЕАКТИВНОСТЬ СОХРАНЯЕТСЯ (спека C2): при активном health-сигнале или «не бегает»
  // потолок считается ОТ ФАКТА даже в цикле — цикл задаёт НАМЕРЕНИЕ, а не обязательство,
  // и одна неделя тратится на разгрузку, не сдвигая остального плана.
  if (cycle && !notTraining) {
    weekly = Math.max(0, cycle.aerobicMin + cycle.qualityMin);
    notes.push(`цель цикла: ${cycle.aerobicMin} аэробных + ${cycle.qualityMin} работы = ${weekly} мин`);
  } else if (notTraining) {
    weekly = Math.min(env.rolling4wWeeklyMin || 0, env.capWeeklyMin ?? Infinity) || 30;
    if (env.lastWeekMinutes > 0) weekly = Math.min(weekly, Math.round(env.lastWeekMinutes * WEEKLY_GROWTH_MAX));
    notes.push(hasActiveIllness
      ? `потолок от ФАКТА (${weekly} мин): активный health-сигнал — план здорового периода не ориентир`
      : `потолок от ФАКТА (${weekly} мин): выполнение ниже ${Math.round(NOT_RUNNING_RATIO * 100)}% ${env.notRunningWeeks} нед подряд — человек фактически не тренируется`);
    if (cycle) {
      notes.push(`РОЛЬ НЕДЕЛИ ПОНИЖЕНА до разгрузочной: цикл просил «${cycle.role}» и ${cycle.aerobicMin + cycle.qualityMin} мин.`
        + ` Неделя потрачена, остальной план цикла НЕ сдвинут.`);
    }
  } else {
    weekly = Math.min(env.rolling4wPlannedMin || 0, env.capWeeklyMin ?? Infinity) || 150;
    // ПРИРОСТ МЕРЯЕТСЯ ОТ НОРМЫ, А НЕ ОТ ПРОВАЛА (замер 16.08).
    // Прежде базой безусловно была прошлая плановая неделя. Если она оказывалась провальной
    // (болезнь, отпуск, недописанный план), «+процент к прошлой неделе» запирал человека в
    // провале: чтобы вернуться к своим 200 мин с 60, потребовалось бы шесть недель подряд.
    // Тренер так не делает — он возвращает к норме одним шагом (медиана возврата ×1.65).
    // Поэтому от провала базой берётся ОБЫЧНАЯ неделя атлета, а прирост считается от неё.
    if (env.lastWeekPlannedMinutes > 0) {
      const typical = env.typicalPlannedWeekMin;
      const isDip = typical > 0 && env.lastWeekPlannedMinutes < typical * DIP_BASE_RATIO;
      const base = isDip ? typical : env.lastWeekPlannedMinutes;
      const ceil = Math.round(base * WEEKLY_GROWTH_MAX);
      if (weekly > ceil) {
        weekly = ceil;
        notes.push(isDip
          ? `объём подрезан до +${Math.round((WEEKLY_GROWTH_MAX - 1) * 100)}% к ОБЫЧНОЙ неделе (${typical} мин): прошлая неделя ${env.lastWeekPlannedMinutes} мин — провал, базой не берётся`
          : `объём подрезан до +${Math.round((WEEKLY_GROWTH_MAX - 1) * 100)}% к плану прошлой недели (${env.lastWeekPlannedMinutes} мин)`);
      }
    }
  }
  if (!notTraining && env.lowComplianceWeeks >= LOW_COMPLIANCE_WEEKS) {
    notes.push(`✋ выполнение ниже ${Math.round(LOW_COMPLIANCE_RATIO * 100)}% ${env.lowComplianceWeeks} нед подряд`
      + `${env.complianceRatio != null ? ` (за окно ${Math.round(env.complianceRatio * 100)}%)` : ""} — объём НЕ срезан, нужен взгляд тренера`);
  }

  // ГЕЙТ КАЧЕСТВА: без цикла работает как прежде; при активном цикле ЦИКЛ ГЛАВНЕЕ,
  // и гейт превращается в пометку тренеру [решение Игоря].
  const gateCap = qualityCapFromHistory(env.qualityLast8w);
  let qualityCap = gateCap;
  if (cycle && cycle.qualityMin > 0 && gateCap < 1) {
    qualityCap = 1;
    notes.push(`✋ гейт качества снят циклом: за 8 нед качественных ${env.qualityLast8w}`
      + ` (гейту нужно ${QUALITY_CAP_THRESHOLDS.oneSessionMin}) — цикл просит работу, нужен взгляд тренера`);
  }
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
        // цель по минутам работы от цикла — отборщик берёт ближайший формат, а не прогрессию
        targetWorkMinutes: cycle ? cycle.qualityMin : null,
        // доля работы считается от недели ЦИКЛА, а не от исторического факта
        cycleWeeklyMin: cycle ? weekly : null,
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
  // ── ПОТОЛОК ДЛИТЕЛЬНОЙ: ТРИ ПРИЧИНЫ, ПО КОТОРЫМ ОН БЫЛ НИЖЕ ПРАКТИКИ ТРЕНЕРА (правка 12.08) ──
  // Замер 11.08 по двенадцати: у 7 из 12 длительная сборщика КОРОЧЕ той, что ставит тренер сам,
  // у двоих её не выдавалось вовсе. Причины разные, чиним все три.
  //
  // (а) Жёсткий предел 180 мин делал контрольную длительную тренера (182 мин, есть в практике)
  //     структурно невозможной при любом недельном объёме. Поднят до 200 [решение Игоря].
  // (б) baseline = 0 у двоих — не решение тренера, а артефакт классификатора (см. Envelope.
  //     longRunPracticeMaxMin). Нуль не отличался от «потолка нет», потому что проверка была
  //     `?? weekly*0.35`, а нуль не null: Math.min(0, …) = 0 → clamp до пола 30 → сессия
  //     переставала быть длиннее обычной лёгкой и переименовывалась в лёгкую.
  // (в) baseline заморожен на окне 11.03–03.06 и с тех пор не пересчитывался. При АКТИВНОМ ЦИКЛЕ
  //     потолок берётся из ПРАКТИКИ атлета за 26 недель (максимум), а не из мёртвого числа:
  //     цикл уже отменил исторический конверт объёма, и держать при этом длительную на конверте
  //     трёхмесячной давности — та же отменённая отмена, что была в доборе.
  // Без цикла порядок прежний: baseline главный, практика — только подмена нуля/пропуска.
  const baselineLong = (env.capLongRunMin ?? 0) > 0 ? (env.capLongRunMin as number) : null;
  const practiceLong = env.longRunPracticeMaxMin > 0 ? env.longRunPracticeMaxMin : null;
  const longCapSource = cycle ? (practiceLong ?? baselineLong) : (baselineLong ?? practiceLong);

  // ── МЕДИАНА ПРАКТИКИ — ЦЕЛЬ, А НЕ ЖЕРТВА ОГРАНИЧИТЕЛЕЙ (правка 12.08, третий заход) ──
  // Игорь третий раз говорит «мало объёма, особенно длительные». После починки потолка
  // длительная всё ещё выходила короче его собственной медианы у четверых. Связывали её
  // ДВА ЧИСЛА, ОБА ВЫВЕДЕННЫЕ ИЗ ПРАКТИКИ, НО ПОСТАВЛЕННЫЕ ОГРАНИЧИТЕЛЯМИ:
  //   • доля недели ×0.45 — у 6009851 это 81 мин при её собственной медиане 90;
  //   • пропорция длительная/лёгкий — задавала ориентир ниже медианы.
  // Это ровно та же ошибка, что была с кратностью 1.32 и полом лёгкого: РАСПРЕДЕЛЕНИЕ,
  // ПОСТАВЛЕННОЕ В РОЛЬ ЗАПРЕТА. Медиана — то, что тренер ставит этому человеку в половине
  // случаев; запрещать её числом, выведенным из того же распределения, бессмысленно.
  //
  // Теперь при активном цикле медиана практики — ПОЛ цели длительной. Доля ×0.45 остаётся
  // защитой от абсурда (она по-прежнему режет ВЫШЕ медианы), но рабочим пределом быть
  // перестала. Пропорция длительная/лёгкий уступает: она ориентир, не гейт.
  //
  // Бюджет недели при этом НЕ нарушается: шаг (1) растит длительную только пока есть spare,
  // поэтому на тесной неделе она просто не дорастёт — деградация естественная, без отказа.
  // РЕАКТИВНОСТЬ ГЛАВНЕЕ НАМЕРЕНИЯ: на неделе, ПОНИЖЕННОЙ health-сигналом, пола нет.
  // Без этой оговорки пол срабатывал и там: у 5475968 длительная прыгала 70 → 115 мин на
  // неделе, где объём считается ОТ ФАКТА из-за активного сигнала, то есть 44% недели
  // отдавалось длительной ровно тогда, когда человека надо разгрузить. Цикл задаёт
  // намерение, а не обязательство — на понижённой неделе намерение уступает целиком.
  const intentKey = cycle?.intent ?? "";
  const distTarget = LONG_TARGET_BY_INTENT[intentKey];
  const distStep = LONG_CAP_STEP_BY_INTENT[intentKey];
  // ПОЛ МАСШТАБИРУЕТСЯ ТЕМ ЖЕ, ЧЕМ УРЕЗАНА НЕДЕЛЯ (правка 12.08). Одно правило вместо трёх:
  //  • неделя роста      — пол равен медиане практики;
  //  • разгрузка/подводка — цель цикла уже снижена, и пол едет вместе с ней (иначе на
  //    разгрузке длительная тянулась бы к полной медиане и разгрузки бы не было);
  //  • понижение сигналом — у кого ЕСТЬ целевой старт, пол режется пропорционально факту,
  //    то есть длительная уменьшается последней; у кого старта нет — пола нет вовсе.
  // Отдельно от пола держится инвариант «длительная не обнуляется» — он ниже, в именовании.
  const cycleWeekTarget = cycle ? Math.max(1, cycle.aerobicMin + cycle.qualityMin) : 1;
  const cycleBaseWeek = cycle && cycle.baseWeekMin ? Math.max(1, cycle.baseWeekMin) : cycleWeekTarget;
  let floorScale = Math.min(1, cycleWeekTarget / cycleBaseWeek);
  if (notTraining) floorScale = cycle?.hasTargetRace ? floorScale * Math.min(1, weekly / cycleWeekTarget) : 0;
  // ПОЛ ТОЖЕ РАСТЁТ. Поднять один потолок мало: потолок — предел, а тянет длительную вверх ПОЛ.
  // На первом прогоне правки потолок у 5807145 вырос до 110, а длительная осталась 95, потому
  // что ориентир задавали пропорция и доля. При подготовке к дистанции к цели должен идти
  // именно ориентир, поэтому пол растёт тем же шагом и с тем же ограничением целью.
  const floorBase = cycle && distTarget && distStep && cycle.hasTargetRace
    ? Math.min(distTarget, env.longRunPracticeMedianMin * Math.pow(distStep, Math.max(0, (cycle.weekIndex ?? 1) - 1)))
    : env.longRunPracticeMedianMin;
  const longPracticeFloor = cycle && env.longRunPracticeMedianMin > 0 && floorScale > 0
    ? Math.min(round5(floorBase * floorScale), LONG_CEIL) : 0;
  // ── ПОТОЛОК РАСТЁТ ВМЕСТЕ С ЦИКЛОМ (правка 13.08) ──
  // Потолок «максимум практики атлета» верен для ПОДДЕРЖАНИЯ и неверен для ПОДГОТОВКИ: цель
  // подготовки по определению за пределами прошлого. У 5807145 практический максимум 90 мин,
  // марафону нужно 180 — сборщик не вывел бы её выше 90 ни за 6 недель, ни за 16, то есть
  // марафонский цикл был структурно невозможен для всех, кто марафон ещё не бегал.
  //
  // Теперь при цикле ПОД ДИСТАНЦИЮ потолок идёт от практики к целевому значению шагом за неделю:
  //   потолок(N) = практика x шаг^(N-1), но не выше цели дистанции.
  // Оба числа замерены по практике Игоря (см. LONG_TARGET_BY_INTENT / LONG_CAP_STEP_BY_INTENT).
  // Доля недели x0.45 остаётся защитой и режет сверху, как и раньше.
  // РАСТЁТ ТОЛЬКО ПОЛ, ПОТОЛОК НЕ ДУБЛИРУЕТСЯ. Первая версия растила и потолок: capLong =
  // max(пол, …), поэтому выросший пол почти всегда перекрывал выросший потолок, и мутация
  // «снять рост потолка» не роняла проверку. Честно: совсем мёртвым он не был — на подводочной
  // неделе 5807145 давал +5 мин (115 против 110). Пять минут не стоят ветки, которую нечем
  // проверить: зелёная проверка рядом с непроверяемым кодом хуже отсутствия обоих.
  const capLong = round5(clamp(
    Math.max(longPracticeFloor, Math.min(longCapSource ?? weekly * 0.35, weekly * 0.45)),
    LONG_FLOOR, LONG_CEIL));
  let easyBase = EASY_FLOOR;
  let longMin = round5(Math.max(LONG_FLOOR, easyRoles > 0 ? easyBase + ROUND_TO_MIN : 0,
    qLongest > 0 ? qLongest + ROUND_TO_MIN : 0));
  let spare = weekly - (qTotal + longMin + easyBase * easyRoles);

  const canGrowEasy = (): boolean => easyRoles > 0 && spare >= ROUND_TO_MIN * easyRoles
    && longMin > easyBase + ROUND_TO_MIN;

  // ПОРЯДОК РОСТА: ДЛИТЕЛЬНАЯ ПЕРВОЙ (правка 16.08).
  // Раньше первыми росли лёгкие, и на тесной неделе длительной уже не оставалось: теневое
  // сравнение показало ухудшение по этой оси (машина короче тренера в 45% → 50% пар) ровно
  // после того, как подняли цели лёгких. Лёгкий день — расходный, длительная — смысл недели;
  // платить длительной за лёгкие нельзя. Ориентир длительной — ФУНКЦИЯ от длины лёгкого, а не
  // число, посчитанное один раз: иначе лёгкие подрастают следом и кратность молча съезжает.
  // ФОРМА НЕДЕЛИ СЧИТАЕТСЯ ПРОПОРЦИЕЙ, А НЕ «КТО ПЕРВЫЙ ВСТАЛ» (правка 16.08, вторая итерация).
  //
  // Первый заход этого пункта просто отдал длительной приоритет — и получилось ХУЖЕ, чем было:
  // в пакете на приёмку T3-неделя вышла «длительная 155 мин при лёгких по 30–35», кратность 4.4
  // при замеренной по практике 1.80. Причина в том, что ориентиром длительной служил её ПОТОЛОК:
  // взяв приоритет, она забирала весь бюджет, а лёгкие оставались на полу.
  //
  // Правильно — сначала разделить бюджет в ЗАМЕРЕННОЙ пропорции, и уже потом подгонять под
  // полы и потолки:  длительная = ratioEasy × лёгкий,  лёгкие × их число + длительная = бюджет.
  const shapeBudget = Math.max(0, weekly - qTotal);
  const easyShape = easyRoles > 0 ? shapeBudget / (easyRoles + ratioEasy) : 0;
  const longShape = easyRoles > 0 ? ratioEasy * easyShape : shapeBudget;

  // ПОТОЛОК ДЛИТЕЛЬНОЙ — ПОТОЛОК, А НЕ ЦЕЛЬ. Прежде он входил в ориентир через Math.max и
  // работал как ПОЛ: длительная всегда дорастала минимум до него. Правило Игоря обратное —
  // потолок объёма главнее полов.
  // МЕДИАНА ПРАКТИКИ входит сюда именно ПОЛОМ (см. longPracticeFloor выше): при активном цикле
  // длительная тянется как минимум до неё, даже если пропорция и доля просят меньше.
  const longTargetFor = (easy: number): number =>
    round5(Math.min(capLong, Math.max(LONG_FLOOR, longPracticeFloor, easy * ratioEasy, longShape)));

  // (1) длительная до своей доли — раньше лёгких, но именно до ДОЛИ, а не до потолка
  while (spare >= ROUND_TO_MIN && longMin < longTargetFor(easyBase)) { longMin += ROUND_TO_MIN; spare -= ROUND_TO_MIN; }
  // (2) лёгкие до ЦЕЛИ тира, но не выше своей доли в пропорции. Шаг лёгкого, который ломает
  //     кратность, СНАЧАЛА оплачивает длительную — так лёгкие не растут за её счёт.
  const easyCeilShape = Math.max(EASY_FLOOR, round5(easyShape));
  while (canGrowEasy() && easyBase < Math.min(easyTarget, easyCeilShape)) {
    const need = longTargetFor(easyBase + ROUND_TO_MIN);
    if (longMin < need) {
      if (spare < ROUND_TO_MIN) break;
      longMin += ROUND_TO_MIN; spare -= ROUND_TO_MIN; continue;
    }
    easyBase += ROUND_TO_MIN; spare -= ROUND_TO_MIN * easyRoles;
  }
  // (3) остаток — лёгким, пока кратность-ориентир к длительной не нарушена
  while (canGrowEasy() && easyBase < EASY_MAX && longMin >= (easyBase + ROUND_TO_MIN) * ratioEasy) {
    easyBase += ROUND_TO_MIN; spare -= ROUND_TO_MIN * easyRoles;
  }

  // (4) ДОБОР ДО ЦЕЛИ ПО ОБЪЁМУ. Раньше сборка останавливалась на первом же ориентире и
  // отдавала неделю заметно ниже потолка (замер 14.08: медиана выдано 125 при потолке 150),
  // а теневое сравнение показывало систематический недобор объёма против тренера.
  // Цель — плановый объём самого атлета, та же валюта, что потолок. Идём шагами по 5 минут,
  // отдавая шаг тому, кто дальше от своего ориентира, и не нарушая ни потолок, ни инварианты.
  //
  // ПРИ АКТИВНОМ ЦИКЛЕ ЦЕЛЬ ДОБОРА — ЦЕЛЬ ЦИКЛА, А НЕ КОНВЕРТ ИСТОРИИ (правка 12.08).
  // Конверт rolling4wPlannedMin цикл отменяет ещё в расчёте потолка недели — и он же
  // возвращался сюда через Math.min, то есть отмена отменялась в шаге добора. Замер 11.08:
  // сработало у 8 атлетов из 12 и стоило 93 минуты из 129 недобранных. У 5733446 цикл просил
  // 410, потолок недели был 410, а добор останавливался на 365 — ровно его rolling4wPlannedMin.
  // Без цикла поведение прежнее: там конверт и есть план, и целиться больше не во что.
  const targetWeekly = cycle
    ? weekly
    : Math.min(weekly, env.rolling4wPlannedMin > 0 ? env.rolling4wPlannedMin : weekly);
  const total = (): number => qTotal + longMin + easyBase * easyRoles;
  let guard = 0;
  while (total() < targetWeekly && spare >= ROUND_TO_MIN && guard++ < 200) {
    const longRoom = longMin < capLong && spare >= ROUND_TO_MIN;
    const easyRoom = canGrowEasy() && easyBase < EASY_MAX && longMin >= (easyBase + ROUND_TO_MIN) * ratioEasy;
    if (!longRoom && !easyRoom) break;
    // ДОБОР ДЕРЖИТ ФОРМУ, а не отдаёт всё одному. Шаг получает тот, кто отстаёт от замеренной
    // кратности: если длительная сейчас короче ratioEasy × лёгкий — ей, иначе лёгким.
    // Прежде шаг шёл «тому, кто дальше от ориентира», и лёгкие выигрывали всегда (длительная
    // уже стояла на потолке); безусловный приоритет длительной ломал неделю в другую сторону.
    const behindOnLong = easyBase > 0 && longMin < easyBase * ratioEasy;
    if (longRoom && (!easyRoom || behindOnLong)) { longMin += ROUND_TO_MIN; spare -= ROUND_TO_MIN; }
    else { easyBase += ROUND_TO_MIN; spare -= ROUND_TO_MIN * easyRoles; }
  }
  if (qLongest > 0 && longMin < qLongest * ratioQual) {
    notes.push(`длительная ${longMin} мин против ориентира ${Math.round(qLongest * ratioQual)} (×${ratioQual} к качественной ${qLongest} мин)`
      + ` — в бюджет недели такая не входит, кратность к качественной не выдержана`);
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
      // ── ДЛИТЕЛЬНАЯ НЕ ОБНУЛЯЕТСЯ НИКОГДА (правка 12.08) ──
      // Историческое сравнение с «обычной лёгкой» нужно, чтобы не называть длительной сессию,
      // которая для этого человека обычная лёгкая (у T1 длительных в практике нет вовсе).
      // Но на ПОНИЖЕННОЙ неделе оно даёт ноль: у 5807145 объём считается от факта, длительная
      // оседает ровно на её исторической лёгкой (60 против 60), переименовывается — и
      // длительной не остаётся ВООБЩЕ. «Нет длительной» и «короткая длительная» — разные вещи:
      // понижение должно делать её короче, а не отменять.
      //
      // Поэтому на понижённой неделе длительная — это самый длинный день ЭТОЙ недели, а не
      // сравнение с историей: внутри урезанной недели вопрос «длиннее ли обычного» не имеет
      // смысла, вся неделя короче обычного по построению. Пол LONG_FLOOR держится всегда.
      // Платить за это лёгкими нельзя: шаг длительной стоил бы 5 мин × число лёгких дней,
      // и неделя худела на ровном месте (замер: 220 -> 210).
      const longestEasyThisWeek = Math.max(...easyVariants, 0);
      // «НИКОГДА» ЗНАЧИТ НИКОГДА (правка 13.08). Первая версия этой оговорки покрывала только
      // неделю, понижённую health-сигналом (notTraining), и на ПОДВОДКЕ ноль возвращался:
      // у 5807145 на 6-й неделе марафонского цикла (цель 155 мин) длительная снова обнулялась,
      // потому что там работало прежнее историческое сравнение. Подводка урезает неделю ровно
      // так же, как понижение сигналом, и вопрос «длиннее ли обычного» в ней так же бессмыслен.
      //
      // Правило теперь одно: если неделя УРЕЗАНА относительно обычной (сигналом или ролью цикла),
      // длительная — это самый длинный день ЭТОЙ недели. На обычной неделе роста сравнение с
      // исторической лёгкой остаётся: там оно и нужно, чтобы не звать длительной обычную лёгкую.
      const weekIsReduced = notTraining
        || (cycle != null && cycle.baseWeekMin != null && weekly < cycle.baseWeekMin);
      const isReallyLong = weekIsReduced
        ? longMin >= LONG_FLOOR && longMin > longestEasyThisWeek
        : (env.typicalEasyMinutes <= 0 || longMin > env.typicalEasyMinutes);
      if (!isReallyLong) notes.push(`длинный день назван лёгким: ${longMin} мин не больше `
        + (weekIsReduced ? `самого длинного лёгкого этой недели (${longestEasyThisWeek} мин)`
                         : `обычной лёгкой (${env.typicalEasyMinutes} мин)`));
      sessions.push(aerobicSession(d, isReallyLong ? "long" : "easy", a, cat, longMin));
    }
    else { sessions.push(aerobicSession(d, role === "quality" ? "easy" : role, a, cat, easyVariants[easyIdx % easyVariants.length])); easyIdx++; }
  }
  return { athleteId: a.athleteId, tier: a.tier, weekStart, days, sessions, notes, refused: null, refusedKind: null,
    weeklyCap: weekly, plannedMinutes: sessions.reduce((s, x) => s + (x.deferred ? 0 : x.minutes), 0),
    qualityDecision: dec.selected ? `${dec.preset.presetCode}: ${dec.reason}` : `отказ: ${dec.reason}` };
}
