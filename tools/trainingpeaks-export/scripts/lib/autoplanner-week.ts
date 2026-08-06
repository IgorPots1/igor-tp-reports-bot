/**
 * autoplanner-week — форма недели (§4.2) + рендер описания с обратной сверкой (§3).
 *
 * Названия, RPE-рамка и структура приходят ИЗ КАТАЛОГА (autoplanner-catalog.ts), а не из
 * строк в коде. Отбор качества — selectQualityFromCatalog (guardrails + прогрессия по объёму),
 * а не одноветочная заглушка selectQualityMethodologyV0.
 * Парсер для сверки — канонический ranges()/parseSegments() из tp-recompute.ts.
 */
import { ranges, parseSegments } from "./tp-recompute.ts";
import { resolvePace, type AthleteAnchors, type IntensityIntent, type Resolved } from "./pace-resolver.ts";
import type { Envelope } from "./autoplanner-context.ts";
import type { Catalog, QualityPreset } from "./autoplanner-catalog.ts";
import { selectQualityFromCatalog, qualityCapFromHistory, type QualityDecision } from "./quality-select.ts";

export const DAY_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export type Role = "quality" | "long" | "easy" | "easy_strides" | "recovery" | "rest";

/** Шаг 4: всё округляем до 5 минут — «63 минуты» в плане не бывает. */
export const ROUND_TO_MIN = 5;
/** Шаг 4: длительная минимум на столько длиннее самого длинного лёгкого недели. */
export const LONG_OVER_EASY_MIN = 20;
/** Шаг 4: ширина полосы лёгкого сверху ограничена (сек/км), параметр. */
export const EASY_BAND_MAX_S = 25;
/** Прирост недельного объёма к предыдущей ФАКТИЧЕСКОЙ неделе — не более этого (параметр). */
export const WEEKLY_GROWTH_MAX = 1.10;
/** Разминка по наблюдаемому шаблону: 86% реальных качественных — 10 минут (n=2710). */
export const WARMUP_CANON_MINUTES = 10;
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

export type Segment = { minutes: number; fastSec: number | null; slowSec: number | null; label: string };

export const fp = (sec: number): string => {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
};
const rangeText = (f: number, s: number): string => `${fp(f)}–${fp(s)}`;

export function renderDescription(segs: Segment[]): string {
  return segs.map((s) => {
    const dur = `${s.minutes} ${s.minutes === 1 ? "минута" : s.minutes < 5 ? "минуты" : "минут"}`;
    if (s.fastSec != null && s.slowSec != null) return `${s.label}: ${dur} ${rangeText(s.fastSec, s.slowSec)}`;
    return `${s.label}: ${dur} по ощущениям`;
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
  // Разминка по методологии из РЕАЛЬНЫХ описаний (замер: 86% качественных — 10 минут,
  // формулировка «Разминка — 10 минут @ темп (Zone 2), спокойно»). Ускорения внутри разминки
  // встречаются лишь в 15% — по умолчанию НЕ ставим.
  const warmMin = p.warmupMinutes || WARMUP_CANON_MINUTES;
  const segs: Segment[] = [{ minutes: warmMin, label: "Разминка, спокойно (Zone 2)", fastSec: eb.fast, slowSec: eb.slow }];
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

export type Week = { athleteId: number; tier: string; weekStart: string; days: number[]; sessions: Session[]; notes: string[]; qualityDecision: string };

export function buildWeek(a: AthleteAnchors, env: Envelope, cat: Catalog, weekStart: string, hasActiveIllness: boolean): Week {
  const notes: string[] = [];
  let n = Math.round(env.rolling4wFrequency || 0);
  if (n <= 0) n = Math.min(3, Math.round(env.capFrequency ?? 3));
  if (env.capFrequency != null && n > env.capFrequency) { n = Math.round(env.capFrequency); notes.push("частота подрезана потолком baseline"); }
  n = clamp(n, 1, 7);

  const days = chooseDays(env.dayHistogram, n);
  const longDayHint = env.dayHistogram.indexOf(Math.max(...env.dayHistogram));

  // ПОТОЛОК КАЧЕСТВА НА ЛЕТУ (шаг 3): 8-недельная история из кэша, НЕ замороженные baselines
  const counts = rolesForDayCount(n, qualityCapFromHistory(env.qualityLast8w));

  // Без порога качество не назначаем ВООБЩЕ: резолвер всё равно откажет (числа брать неоткуда),
  // и сессия уйдёт в defer уже после раскладки. Отсекаем до выбора, а не после.
  const dec: QualityDecision = a.threshold == null
    ? { selected: false, reason: "no_threshold_cannot_do_quality", detail: "порога нет — качество не назначается" }
    : selectQualityFromCatalog(cat.quality, cat.guardrails, cat.reviewRules, {
    qualityLast8w: env.qualityLast8w, plannedRunCount: n,
    lastQualityWorkMinutes: env.lastQualityWorkMinutes,
    hasActiveIllnessOrInjury: hasActiveIllness, hasRaceContext: false,
    contextFlags: hasActiveIllness ? ["injury"] : [], rolling4wWeeklyMin: env.rolling4wWeeklyMin,
      });
  if (!dec.selected) { counts.quality = 0; notes.push(`качество не назначено: ${dec.reason} (${dec.detail})`); }

  const roles = assignRoles(days, counts, longDayHint);

  // ДЛИТЕЛЬНОСТИ (шаг 4): округление до 5, лёгкие разные, длительная выше самого длинного лёгкого
  // ОБЪЁМ НЕДЕЛИ: конверт сверху И не более +10% к предыдущей фактической неделе.
  // Раньше правило «длительная +20 мин к лёгкому» раздувало неделю вверх (у T1 80 → 120 мин).
  let weekly = Math.min(env.rolling4wWeeklyMin || 0, env.capWeeklyMin ?? Infinity) || 150;
  if (env.lastWeekMinutes > 0) {
    const ceil = Math.round(env.lastWeekMinutes * WEEKLY_GROWTH_MAX);
    if (weekly > ceil) { weekly = ceil; notes.push(`объём подрезан до +${Math.round((WEEKLY_GROWTH_MAX - 1) * 100)}% к прошлой неделе (${env.lastWeekMinutes} мин)`); }
  }
  const qMin = dec.selected ? dec.preset.warmupMinutes + dec.preset.reps * dec.preset.workMinutes
    + (dec.preset.reps - 1) * dec.preset.recoveryMinutes + dec.preset.cooldownMinutes : 0;
  const easyRoles = [...roles.values()].filter((r) => r === "easy" || r === "easy_strides").length;
  const easyBudget = Math.max(weekly - qMin, easyRoles * 20);
  const easyBase = round5(clamp(easyBudget / Math.max(easyRoles + 1, 1), 20, 70));
  const easyVariants = [easyBase, Math.max(20, easyBase - ROUND_TO_MIN)]; // лёгкие не одинаковые
  const longMin = round5(clamp(Math.min(env.capLongRunMin ?? weekly * 0.35, weekly * 0.45), easyBase + LONG_OVER_EASY_MIN, 180));

  const sessions: Session[] = []; let easyIdx = 0;
  for (const d of days) {
    const role = roles.get(d) ?? "easy";
    if (role === "quality" && dec.selected) sessions.push(qualitySession(d, a, dec));
    else if (role === "long") sessions.push(aerobicSession(d, "long", a, cat, longMin));
    else { sessions.push(aerobicSession(d, role === "quality" ? "easy" : role, a, cat, easyVariants[easyIdx % easyVariants.length])); easyIdx++; }
  }
  return { athleteId: a.athleteId, tier: a.tier, weekStart, days, sessions, notes,
    qualityDecision: dec.selected ? `${dec.preset.presetCode}: ${dec.reason}` : `отказ: ${dec.reason}` };
}
