/**
 * autoplanner-week — форма недели (§4.2) + рендер описания с обратной сверкой (§3).
 *
 * Чистый модуль. Качество НЕ выбирается здесь заново: используется существующий
 * selectQualityMethodologyV0 / каталог из plan-quality-methodology-catalog.ts.
 * Парсер для сверки — канонический ranges()/parseSegments() из tp-recompute.ts.
 */
import { ranges, parseSegments } from "./tp-recompute.ts";
import { getQualityWorkoutCatalogEntry, selectQualityMethodologyV0, type QualityWorkoutKey } from "./plan-quality-methodology-catalog.ts";
import { resolvePace, type AthleteAnchors, type IntensityIntent, type Resolved } from "./pace-resolver.ts";
import type { Envelope } from "./autoplanner-context.ts";

export const DAY_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export type Role = "quality" | "long" | "easy" | "easy_strides" | "recovery" | "rest";

/** §4.2 — сколько чего при N беговых днях (поддерживающий цикл). */
export function rolesForDayCount(n: number, qualityCap: number | null): { quality: number; long: number } {
  const cap = qualityCap == null ? 99 : Math.max(0, Math.round(qualityCap));
  if (n <= 2) return { quality: Math.min(cap, 0), long: 1 };
  if (n === 3) return { quality: Math.min(cap, 1), long: 1 };
  if (n === 4) return { quality: Math.min(cap, 1), long: 1 };
  if (n === 5) return { quality: Math.min(cap, 1), long: 1 };
  return { quality: Math.min(cap, 2), long: 1 };
}

/** Наблюдаемые дни атлета: топ-N по частоте, в хронологическом порядке Пн→Вс (§4.2). */
export function chooseDays(hist: number[], n: number): number[] {
  return hist.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c || a.i - b.i)
    .slice(0, Math.max(0, n)).map((x) => x.i).sort((a, b) => a - b);
}

/**
 * Расстановка ролей по выбранным дням: длительная — в самый «объёмный» день (обычно выходной),
 * качество — не в смежные дни с длительной и между собой, после длительной — лёгкий.
 */
export function assignRoles(days: number[], counts: { quality: number; long: number }, longDayHint: number | null): Map<number, Role> {
  const roles = new Map<number, Role>();
  if (days.length === 0) return roles;
  const longDay = longDayHint != null && days.includes(longDayHint) ? longDayHint : days[days.length - 1];
  if (counts.long > 0) roles.set(longDay, "long");

  const adjacent = (a: number, b: number): boolean => Math.abs(a - b) === 1 || Math.abs(a - b) === 6; // 6 = Вс↔Пн
  const free = days.filter((d) => !roles.has(d));
  // качество ставим как можно дальше от длительной и друг от друга
  const picked: number[] = [];
  const byDistance = [...free].sort((a, b) => {
    const da = Math.min(Math.abs(a - longDay), 7 - Math.abs(a - longDay));
    const db = Math.min(Math.abs(b - longDay), 7 - Math.abs(b - longDay));
    return db - da;
  });
  for (const d of byDistance) {
    if (picked.length >= counts.quality) break;
    if (adjacent(d, longDay)) continue;              // после длительной — не качество
    if (picked.some((p) => adjacent(p, d))) continue; // качество не в смежные дни
    picked.push(d); roles.set(d, "quality");
  }
  // остальное — лёгкое; один из лёгких делаем «со скоростными вставками», если дней ≥4
  const rest = days.filter((d) => !roles.has(d));
  rest.forEach((d, idx) => roles.set(d, idx === 0 && days.length >= 4 ? "easy_strides" : "easy"));
  return roles;
}

/** Один сегмент описания: длительность + необязательный диапазон темпа. */
export type Segment = { minutes: number; fastSec: number | null; slowSec: number | null; label: string };

export const fp = (sec: number): string => {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
};
/** §3.1: единица только мм:сс, разделитель — только en-dash. */
const rangeText = (f: number, s: number): string => `${fp(f)}–${fp(s)}`;

export function renderDescription(segs: Segment[]): string {
  return segs.map((s) => {
    const dur = `${s.minutes} ${s.minutes === 1 ? "минута" : s.minutes < 5 ? "минуты" : "минут"}`;
    if (s.fastSec != null && s.slowSec != null) return `${s.label}: ${dur} ${rangeText(s.fastSec, s.slowSec)}`;
    return `${s.label}: ${dur} по ощущениям`;
  }).join(". ") + ".";
}

export type RoundTrip = { ok: boolean; expected: number; parsedRanges: number; parsedSegments: number; problems: string[] };

/**
 * §3.2 — обязательная обратная сверка: генератор читает СОБСТВЕННЫЙ текст каноническим
 * парсером и проверяет, что вынул ровно то, что закладывал. Не сошлось → сессия в defer.
 */
export function verifyRoundTrip(text: string, segs: Segment[]): RoundTrip {
  const problems: string[] = [];
  const expected = segs.filter((s) => s.fastSec != null && s.slowSec != null);
  const got = ranges(text);
  const parsedSegments = parseSegments(text);
  if (got.length !== expected.length) problems.push(`диапазонов в тексте ${got.length}, заложено ${expected.length}`);
  const n = Math.min(got.length, expected.length);
  for (let i = 0; i < n; i++) {
    if (got[i].fast !== expected[i].fastSec || got[i].slow !== expected[i].slowSec) {
      problems.push(`сегмент ${i + 1}: прочитано ${fp(got[i].fast)}–${fp(got[i].slow)}, заложено ${fp(expected[i].fastSec!)}–${fp(expected[i].slowSec!)}`);
    }
  }
  if (parsedSegments.length !== segs.length) problems.push(`сегментов по длительности ${parsedSegments.length}, заложено ${segs.length}`);
  return { ok: problems.length === 0, expected: expected.length, parsedRanges: got.length, parsedSegments: parsedSegments.length, problems };
}

export type Session = {
  dayIdx: number; role: Role; title: string; minutes: number;
  description: string; segments: Segment[];
  anchorSource: string; confidence: string; targetMode: string;
  pctMin: number | null; pctMax: number | null;
  roundTrip: RoundTrip; deferred: boolean; deferReason: string | null;
  warnings: string[];
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function easySession(dayIdx: number, role: Role, a: AthleteAnchors, env: Envelope, minutes: number): Session {
  const intent: IntensityIntent = role === "recovery" ? "recovery" : role === "long" ? "long" : "easy";
  const r = resolvePace(a, intent, "maintenance", role === "recovery" ? 3 : 4);
  const title = role === "long" ? "Длительный бег" : role === "recovery" ? "Восстановительный бег"
    : role === "easy_strides" ? "Лёгкий бег с ускорениями" : "Лёгкий бег";
  if (!r.ok) {
    return { dayIdx, role, title, minutes, description: "", segments: [], anchorSource: "—", confidence: "—",
      targetMode: "—", pctMin: null, pctMax: null,
      roundTrip: { ok: false, expected: 0, parsedRanges: 0, parsedSegments: 0, problems: [r.reason] },
      deferred: true, deferReason: r.reason, warnings: [] };
  }
  const res = r as Resolved;
  // §2.7: T1 бежит по ощущениям — тогда темп в описании НЕ пишем (иначе это не «по ощущениям»)
  const byFeel = res.targetMode === "rpe";
  const segs: Segment[] = [{
    minutes, label: title,
    fastSec: byFeel ? null : res.absPaceMinS, slowSec: byFeel ? null : res.absPaceMaxS,
  }];
  // ВНИМАНИЕ: в тексте сегмента не должно быть «число + единица времени» кроме собственной
  // длительности — parseSegments прочитает это как ЕЩЁ ОДИН сегмент. Формулировка «по 15 секунд»
  // именно так и ломала сверку (3 сегмента вместо 2), поэтому длительность ускорения словами.
  if (role === "easy_strides") segs.push({ minutes: 2, label: "Ускорения в конце, 4–6 коротких по пятнадцать секунд, свободно", fastSec: null, slowSec: null });
  const description = renderDescription(segs);
  const rt = verifyRoundTrip(description, segs);
  return { dayIdx, role, title, minutes, description, segments: segs,
    anchorSource: res.anchorSource, confidence: res.confidence, targetMode: res.targetMode,
    pctMin: res.pctMin, pctMax: res.pctMax, roundTrip: rt, deferred: !rt.ok,
    deferReason: rt.ok ? null : "round_trip_mismatch", warnings: res.warnings };
}

function qualitySession(dayIdx: number, a: AthleteAnchors, env: Envelope, key: QualityWorkoutKey): Session {
  const entry = getQualityWorkoutCatalogEntry(key);
  const st = entry.structure;
  const intent: IntensityIntent = entry.intent === "vo2max_intervals" ? "vo2"
    : entry.intent === "threshold_tempo" ? "steady_tempo" : "threshold";
  const work = resolvePace(a, intent, "maintenance", null);
  const easy = resolvePace(a, "easy", "maintenance", null);
  const title = entry.display_title_ru;
  if (!work.ok || !easy.ok) {
    const reason = !work.ok ? work.reason : (easy as { reason: string }).reason;
    return { dayIdx, role: "quality", title, minutes: st.total_minutes, description: "", segments: [],
      anchorSource: "—", confidence: "—", targetMode: "—", pctMin: null, pctMax: null,
      roundTrip: { ok: false, expected: 0, parsedRanges: 0, parsedSegments: 0, problems: [reason] },
      deferred: true, deferReason: reason, warnings: [] };
  }
  const w = work as Resolved, e = easy as Resolved;
  const segs: Segment[] = [{ minutes: st.warmup_minutes, label: "Разминка", fastSec: e.absPaceMinS, slowSec: e.absPaceMaxS }];
  if (st.repeats) {
    for (let i = 0; i < st.repeats.repeat_count; i++) {
      segs.push({ minutes: st.repeats.work_minutes, label: `Отрезок ${i + 1}`, fastSec: w.absPaceMinS, slowSec: w.absPaceMaxS });
      if (i < st.repeats.repeat_count - 1) segs.push({ minutes: st.repeats.recovery_minutes, label: "Трусца", fastSec: e.absPaceMinS, slowSec: e.absPaceMaxS });
    }
  }
  segs.push({ minutes: st.cooldown_minutes, label: "Заминка", fastSec: e.absPaceMinS, slowSec: e.absPaceMaxS });
  const description = renderDescription(segs);
  const rt = verifyRoundTrip(description, segs);
  return { dayIdx, role: "quality", title, minutes: st.total_minutes, description, segments: segs,
    anchorSource: w.anchorSource, confidence: w.confidence, targetMode: w.targetMode,
    pctMin: w.pctMin, pctMax: w.pctMax, roundTrip: rt, deferred: !rt.ok,
    deferReason: rt.ok ? null : "round_trip_mismatch", warnings: [...w.warnings, ...e.warnings] };
}

export type Week = { athleteId: number; tier: string; weekStart: string; days: number[]; sessions: Session[]; notes: string[] };

/** Собрать неделю: конверт → дни → роли → пресет/качество → резолвер → описание → сверка. */
export function buildWeek(a: AthleteAnchors, env: Envelope, weekStart: string, hasActiveIllness: boolean): Week {
  const notes: string[] = [];
  // N дней: катящаяся 4-нед частота, ограниченная потолком baseline (§4.1 — потолки только вниз)
  let n = Math.round(env.rolling4wFrequency || 0);
  if (n <= 0) n = Math.min(3, Math.round(env.capFrequency ?? 3));
  if (env.capFrequency != null && n > env.capFrequency) { n = Math.round(env.capFrequency); notes.push("частота подрезана потолком baseline"); }
  n = clamp(n, 1, 7);

  const days = chooseDays(env.dayHistogram, n);
  const longDayHint = env.dayHistogram.indexOf(Math.max(...env.dayHistogram));
  const counts = rolesForDayCount(n, env.capQuality);

  // выбор качества — существующий селектор, второй не пишем
  const sel = selectQualityMethodologyV0({
    quality_count_cap: env.capQuality, planned_run_count: n,
    has_active_illness_or_injury: hasActiveIllness, has_race_context: false,
    recent_quality_diagnostic_available: false, found_20x1_candidate: false,
  });
  const qualityKey: QualityWorkoutKey | null = sel.selected ? sel.key : null;
  if (!sel.selected) { counts.quality = 0; notes.push(`качество не назначено: ${sel.selection_reason ?? sel.reason}`); }

  const roles = assignRoles(days, counts, longDayHint);

  // длительность лёгких: недельный объём (катящийся, но не выше потолка) минус длительная, поровну
  const weekly = Math.min(env.rolling4wWeeklyMin || 0, env.capWeeklyMin ?? Infinity) || 150;
  const easyDays = [...roles.values()].filter((r) => r === "easy" || r === "easy_strides").length;
  // ДЛИТЕЛЬНАЯ ОБЯЗАНА БЫТЬ НЕ КОРОЧЕ ЛЁГКОГО. Наивный расчёт (потолок длительной из baseline
  // против объёма, размазанного по дням) давал длительную 30 мин при лёгких 63 — неделя, в которой
  // «длительный бег» самый короткий. Поэтому: сначала грубый лёгкий, потом длительная не ниже него.
  const easyRough = clamp(Math.round(weekly / Math.max(days.length, 1)), 20, 70);
  const longMin = clamp(Math.round(Math.min(env.capLongRunMin ?? weekly * 0.35, weekly * 0.4)), easyRough, 180);
  const easyMin = Math.min(
    easyRough,
    clamp(Math.round((weekly - longMin) / Math.max(easyDays + (counts.quality ? 1 : 0), 1)), 20, 70),
  );

  const sessions: Session[] = [];
  for (const d of days) {
    const role = roles.get(d) ?? "easy";
    if (role === "quality" && qualityKey) sessions.push(qualitySession(d, a, env, qualityKey));
    else if (role === "long") sessions.push(easySession(d, "long", a, env, longMin));
    else sessions.push(easySession(d, role === "quality" ? "easy" : role, a, env, easyMin));
  }
  return { athleteId: a.athleteId, tier: a.tier, weekStart, days, sessions, notes };
}
