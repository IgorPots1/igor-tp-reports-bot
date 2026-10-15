/**
 * ПРАВИЛА КАК ВАЛИДАТОР. Инварианты НЕДЕЛИ, перенесённые из tp-cycle-forecast-check.ts.
 *
 * Там ~130 утверждений, но большинство проверяет МЕХАНИКУ правил (базу цикла, лестницы,
 * чтение таблицы циклов, ручной рост) и к готовой неделе неприменимо. Сюда взяты только те,
 * что формулируются про саму неделю; имя каждой — как в исходной проверке, чтобы было видно,
 * откуда она. Проверка формулируется одинаково для любой недели — прецедентной, сборщика
 * и рукописной: так видно, сколько из этих правил нарушает сам тренер.
 */
import { ranges } from "../lib/tp-recompute.ts";
import { DUR } from "./adapt-text.ts";
import type { Envelope } from "../lib/autoplanner-context.ts";
import { LONG_CEIL, WEEKLY_GROWTH_MAX } from "../lib/autoplanner-week.ts";

export type VSess = { dayIdx: number; kind: "quality" | "long" | "easy"; title: string; minutes: number; work: number; description: string; written?: Array<{ fast: number; slow: number }> };
export type VResult = { name: string; ok: boolean; detail: string };

const adj = (a: number, b: number): boolean => Math.abs(a - b) === 1;

export function validateWeek(ss: VSess[], env: Envelope | null, o: { hasActiveIllness: boolean; checkText: boolean }): VResult[] {
  const out: VResult[] = [];
  const add = (name: string, ok: boolean, detail = ""): void => { out.push({ name, ok, detail }); };
  const q = ss.filter((s) => s.kind === "quality"); const l = ss.filter((s) => s.kind === "long"); const e = ss.filter((s) => s.kind === "easy");
  const total = ss.reduce((s, x) => s + x.minutes, 0);

  add("дни: качество не смежно с длительной", !q.some((x) => l.some((y) => adj(x.dayIdx, y.dayIdx))));
  add("дни: две качественные не в смежные дни", !q.some((x) => q.some((y) => x !== y && adj(x.dayIdx, y.dayIdx))));
  add("дни: день после длительной — лёгкий, а не качественный", !l.some((y) => q.some((x) => x.dayIdx === y.dayIdx + 1)));
  add("дни: не больше одной беговой сессии в день", new Set(ss.map((s) => s.dayIdx)).size === ss.length);
  if (l.length && e.length) add("длительная длиннее любой лёгкой", l.every((y) => e.every((x) => y.minutes >= x.minutes)), `длит ${l.map((x) => x.minutes)} / лёгкие ${e.map((x) => x.minutes)}`);
  if (q.length >= 2) { const w = q.reduce((s, x) => s + x.work, 0); add("две качественные: суммарная работа не выше 20% недели", w <= 0.2 * total, `${w} из ${total}`); }
  if (env) {
    if (env.easyFloorPersonalMin > 0) add("личный пол лёгкой: ни одна лёгкая не короче собственного минимума атлета", e.every((x) => x.minutes >= env.easyFloorPersonalMin), `пол ${env.easyFloorPersonalMin}, лёгкие ${e.map((x) => x.minutes)}`);
    const longCap = env.capLongRunMin ?? LONG_CEIL;
    add("длительная не выше потолка", l.every((x) => x.minutes <= longCap), `потолок ${longCap}`);
    if (env.capWeeklyMin) add("аэробный не выше личного потолка (недельный потолок)", total <= env.capWeeklyMin, `${total} / ${env.capWeeklyMin}`);
    if (env.capQuality != null) add("качественных не больше потолка", q.length <= env.capQuality, `${q.length} / ${env.capQuality}`);
    if (env.capFrequency != null) add("беговых дней не больше потолка", ss.length <= env.capFrequency, `${ss.length} / ${env.capFrequency}`);
    if (env.lastWeekPlannedMinutes > 0) add("прирост к прошлой плановой неделе не выше ×1.22", total <= Math.round(env.lastWeekPlannedMinutes * WEEKLY_GROWTH_MAX), `${total} против ${env.lastWeekPlannedMinutes}`);
    if (o.hasActiveIllness) add("реактивность: при активном сигнале неделя не тяжелее прошлой", total <= env.lastWeekPlannedMinutes && q.length <= env.lastWeekQualityCount, `${total}/${env.lastWeekPlannedMinutes} мин, кач ${q.length}/${env.lastWeekQualityCount}`);
  }
  if (o.checkText) {
    const bad = ss.filter((s) => s.written && s.written.length > 0).filter((s) => {
      const got = ranges(s.description);
      return got.length !== s.written!.length || got.some((g, i) => g.fast !== s.written![i].fast || g.slow !== s.written![i].slow);
    });
    add("описание: каждый записанный темп читается обратно тем же парсером (обратная сверка)", bad.length === 0, bad.map((s) => s.title).join("; "));
    const minBad = ss.filter((s) => s.kind !== "quality").filter((s) => {
      const d = [...s.description.matchAll(DUR)].map((m) => Number(m[1]));
      return d.length > 0 && !d.includes(s.minutes) && d.reduce((a, b) => a + b, 0) !== s.minutes;
    });
    add("описание: минуты в тексте совпадают с минутами сессии", minBad.length === 0, minBad.map((s) => `${s.title} ${s.minutes}`).join("; "));
    add("описание: у каждой сессии есть текст", ss.every((s) => s.description.trim().length > 0));
  }
  return out;
}
