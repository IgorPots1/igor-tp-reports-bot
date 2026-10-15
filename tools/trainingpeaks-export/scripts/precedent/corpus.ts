/**
 * КОРПУС НЕДЕЛЬ ТРЕНЕРА — неделя как прецедент. READ-ONLY.
 *
 * Источник — выгрузка плановых строк trainingpeaks_workout_cache (см. dump-corpus.ts).
 * Автопланировщик в TP не пишет вообще, поэтому любая плановая строка в кэше — рукописная
 * (то же допущение, что в tp-week-side-by-side.ts; признака coach_authored в кэше нет).
 *
 * Классификация сессий — ТЕ ЖЕ правила, что у сборщика и витрины 12 пар:
 * качественная = isQualityForPractice(QUALITY_RE), длительная = longDayOfWeek (заголовок
 * «длительн/длинн», иначе самая длинная не-качественная с отрывом ≥5 мин).
 */
import { isQualityForPractice, isTempoForPractice, longDayOfWeek } from "../lib/practice-signals.ts";
import { tierOf } from "../lib/easy-anchor.ts";

export const QUALITY_RE = /([0-9]+\s*[xх×]\s*[0-9]|интерв|отрезк|повтор|порог|фартлек|vo\s?2|мпк|темп выше)/i;
const LONG_RE = /длительн|длинн/i;
export const RUN = 3;

export type RawRow = {
  trainingpeaks_athlete_id: number; trainingpeaks_workout_id: number; student_name: string | null;
  workout_date: string; title: string | null; workout_type_value_id: number | null;
  planned_time_raw: number | null; planned_distance_raw: number | null;
  is_completed: boolean | null; completed_time_raw: number | null; order_on_day: number | null;
  src: string | null; struct: unknown; cc: string | null;
};
export type Race = { trainingpeaks_athlete_id: number; event_date: string; distance_km: number | null; distance_raw: string | null };
export type Signal = { student_id: string | null; signal_type: string; valid_from: string | null; valid_until: string | null; source_date: string | null; target_date: string | null; created_at: string | null; resolved_at: string | null };

export type Kind = "quality" | "long" | "easy";
export type CSess = {
  wid: number; date: string; dayIdx: number; title: string; minutes: number; distKm: number | null;
  kind: Kind; tempo: boolean; work: number; desc: string; struct: unknown;
};
export type Phase = "race" | "taper" | "build" | "base" | "post" | "return";
export type CWeek = {
  aid: number; weekStart: string; sessions: CSess[]; other: number;
  total: number; aerobic: number; quality: number; days: number;
  qCount: number; longDay: number | null; longMin: number; work: number;
  roles: string; // 7 символов Пн..Вс: Q / L / E / .
  prevTotal: number; prevDays: number; prevQ: number; avg4: number; gapWeeks: number;
  weeksToRace: number | null; raceKm: number | null; weeksSinceRace: number | null;
  ill: boolean; tier: string; phase: Phase; distBucket: string; volBand: string;
  /** неделя совпадает по составу с прошлой (те же роли и минуты) — «застой» */
  repeatOfPrev: boolean;
};

const DAY = 86400000;
export const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * DAY);
export const mondayOf = (s: string): string => { const d = new Date(s + "T00:00:00Z"); return iso(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY); };
export const dayIdx = (s: string): number => (new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7;
export const weeksBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / (7 * DAY));

/** Минуты РАБОТЫ из заголовка вида «6 х 4 мин» — та же грубая оценка, что в витрине 12 пар. */
export function workMinutesFromTitle(t: string): number {
  const m = /([0-9]{1,2})\s*[xх×]\s*([0-9]{1,2}(?:[.,][0-9])?)\s*(мин|min)?/i.exec(t);
  if (!m) return 0;
  const w = Number(m[1]) * Number(m[2].replace(",", "."));
  return Number.isFinite(w) && w > 0 && w <= 90 ? w : 0;
}

export function distBucket(km: number | null): string {
  if (km == null) return "—";
  if (km <= 6) return "5к";
  if (km <= 12) return "10к";
  if (km <= 25) return "21к";
  if (km <= 43) return "42к";
  return "ультра";
}
export function volBand(min: number): string {
  if (min < 120) return "<120";
  if (min < 180) return "120-179";
  if (min < 240) return "180-239";
  if (min < 300) return "240-299";
  if (min < 400) return "300-399";
  return "400+";
}

export function classify(rows: Array<{ title: string; minutes: number; dayIdx: number }>): Kind[] {
  const q = rows.map((r) => isQualityForPractice(r.title, QUALITY_RE));
  const ld = longDayOfWeek(rows.map((r, i) => ({ day: r.dayIdx, min: r.minutes, quality: q[i], longTitled: LONG_RE.test(r.title) })));
  let longTaken = false;
  return rows.map((r, i) => {
    if (q[i]) return "quality";
    if (!longTaken && ld != null && r.dayIdx === ld && (LONG_RE.test(r.title) || r.minutes === Math.max(...rows.filter((_, j) => !q[j]).map((x) => x.minutes)))) { longTaken = true; return "long"; }
    return "easy";
  });
}

const ILLNESS = new Set(["health_issue_started", "health_issue_improving", "pain_injury", "pause_training"]);

export function buildCorpus(rows: RawRow[], races: Race[], sig: Signal[], students: Array<{ id: string; trainingpeaks_athlete_url: string | null }>, beforeMonday: string): CWeek[] {
  const sidByAid = new Map<number, string>();
  for (const s of students) { const m = /athletes?\/(\d+)/.exec(s.trainingpeaks_athlete_url ?? ""); if (m) sidByAid.set(Number(m[1]), s.id); }
  const ill = new Map<string, Array<{ from: string; to: string }>>();
  for (const s of sig) {
    if (!s.student_id || !ILLNESS.has(s.signal_type)) continue;
    const from = s.valid_from ?? s.source_date ?? s.target_date ?? s.created_at?.slice(0, 10) ?? null; if (!from) continue;
    let to = s.valid_until ?? s.resolved_at?.slice(0, 10) ?? null; if (!to || to < from) to = addDays(from, 7);
    (ill.get(s.student_id) ?? ill.set(s.student_id, []).get(s.student_id)!).push({ from, to });
  }
  const raceBy = new Map<number, Race[]>();
  for (const r of races) (raceBy.get(r.trainingpeaks_athlete_id) ?? raceBy.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!).push(r);
  for (const v of raceBy.values()) v.sort((a, b) => a.event_date.localeCompare(b.event_date));

  const byAthWeek = new Map<number, Map<string, RawRow[]>>();
  for (const r of rows) {
    if (r.workout_date >= beforeMonday) continue;
    const wk = mondayOf(r.workout_date);
    const m = byAthWeek.get(r.trainingpeaks_athlete_id) ?? byAthWeek.set(r.trainingpeaks_athlete_id, new Map()).get(r.trainingpeaks_athlete_id)!;
    (m.get(wk) ?? m.set(wk, []).get(wk)!).push(r);
  }

  const out: CWeek[] = [];
  for (const [aid, weeks] of byAthWeek) {
    const keys = [...weeks.keys()].sort();
    const totals = new Map<string, { total: number; days: number; q: number; sig: string }>();
    const built: CWeek[] = [];
    for (const wk of keys) {
      const all = weeks.get(wk)!;
      const runs = all.filter((r) => r.workout_type_value_id === RUN && (r.planned_time_raw ?? 0) > 0)
        .sort((a, b) => a.workout_date.localeCompare(b.workout_date) || (a.order_on_day ?? 0) - (b.order_on_day ?? 0));
      if (runs.length === 0) continue;
      const base = runs.map((r) => ({ title: String(r.title ?? "").trim(), minutes: Math.round((r.planned_time_raw ?? 0) * 60), dayIdx: dayIdx(r.workout_date) }));
      const kinds = classify(base);
      const sessions: CSess[] = runs.map((r, i) => ({
        wid: r.trainingpeaks_workout_id, date: r.workout_date, dayIdx: base[i].dayIdx, title: base[i].title, minutes: base[i].minutes,
        distKm: r.planned_distance_raw ? Math.round(r.planned_distance_raw / 100) / 10 : null,
        kind: kinds[i], tempo: isTempoForPractice(base[i].title, QUALITY_RE),
        work: kinds[i] === "quality" ? workMinutesFromTitle(base[i].title) : 0,
        desc: String(r.src ?? "").trim(), struct: r.struct,
      }));
      const total = sessions.reduce((s, x) => s + x.minutes, 0);
      const quality = sessions.filter((x) => x.kind === "quality").reduce((s, x) => s + x.minutes, 0);
      const days = new Set(sessions.map((s) => s.dayIdx)).size;
      const roles = [".", ".", ".", ".", ".", ".", "."];
      for (const s of sessions) { const c = s.kind === "quality" ? "Q" : s.kind === "long" ? "L" : "E"; if (roles[s.dayIdx] === "." || c === "Q" || (c === "L" && roles[s.dayIdx] === "E")) roles[s.dayIdx] = c; }
      const long = sessions.find((s) => s.kind === "long");
      const sigStr = sessions.map((s) => `${s.dayIdx}${s.kind[0]}${s.minutes}`).join("|");
      totals.set(wk, { total, days, q: sessions.filter((s) => s.kind === "quality").length, sig: sigStr });

      const prevWk = addDays(wk, -7);
      const prev = totals.get(prevWk);
      // зазор: сколько недель подряд перед этой не было плана
      let gap = 0; for (let k = 1; k <= 8 && !totals.has(addDays(wk, -7 * k)); k++) gap = k;
      const last4 = [1, 2, 3, 4].map((k) => totals.get(addDays(wk, -7 * k))?.total ?? 0);
      const avg4 = Math.round(last4.reduce((a, b) => a + b, 0) / 4);
      const rs = raceBy.get(aid) ?? [];
      const next = rs.find((r) => r.event_date >= wk && weeksBetween(wk, mondayOf(r.event_date)) <= 26);
      const lastR = [...rs].reverse().find((r) => r.event_date < wk);
      const weeksToRace = next ? weeksBetween(wk, mondayOf(next.event_date)) : null;
      const weeksSinceRace = lastR ? weeksBetween(mondayOf(lastR.event_date), wk) : null;
      const sid = sidByAid.get(aid);
      const end = addDays(wk, 6);
      const isIll = sid ? (ill.get(sid) ?? []).some((w) => !(end < w.from || wk > w.to)) : false;
      const phase: Phase = weeksToRace === 0 ? "race"
        : weeksToRace != null && weeksToRace <= 2 ? "taper"
        : weeksSinceRace != null && weeksSinceRace <= 1 && (weeksToRace == null || weeksToRace > 2) ? "post"
        : gap >= 2 || isIll ? "return"
        : weeksToRace != null && weeksToRace <= 12 ? "build" : "base";
      built.push({
        aid, weekStart: wk, sessions, other: all.length - runs.length,
        total, aerobic: total - quality, quality, days,
        qCount: sessions.filter((s) => s.kind === "quality").length, longDay: long?.dayIdx ?? null, longMin: long?.minutes ?? 0,
        work: sessions.reduce((s, x) => s + x.work, 0), roles: roles.join(""),
        prevTotal: prev?.total ?? 0, prevDays: prev?.days ?? 0, prevQ: prev?.q ?? 0, avg4, gapWeeks: gap,
        weeksToRace, raceKm: next?.distance_km ?? null, weeksSinceRace, ill: isIll,
        tier: tierOf(avg4 > 0 ? avg4 : total), phase, distBucket: distBucket(next?.distance_km ?? null), volBand: volBand(total),
        repeatOfPrev: prev?.sig === sigStr,
      });
    }
    out.push(...built);
  }
  return out;
}
