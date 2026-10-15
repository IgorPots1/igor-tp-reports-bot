/**
 * Шаги 4–5 — ПРОТОТИП АДАПТАЦИИ и СРАВНЕНИЕ ТРЁХ НЕДЕЛЬ. READ-ONLY, в TP не пишет ничего.
 *
 * Неделя сравнения — последняя ЗАВЕРШЁННАЯ (у тренера она написана целиком). Для неё:
 *   1) неделя тренера — как в кэше;
 *   2) неделя сборщика по правилам — rules-backtest.ts на тот же понедельник (тот же код, что в бою);
 *   3) неделя по прецеденту — гибрид из precedent.ts + adapt-text.ts, якоря атлета «на тот понедельник».
 * Все три прогоняются через один валидатор (validate.ts). Для группы 12 — полный текст.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/step45-compare.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadAthleteContexts, type AthleteContext } from "../lib/autoplanner-context.ts";
import { DAY_RU } from "../lib/autoplanner-week.ts";
import { addDays, workMinutesFromTitle, type CWeek } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { adapt, adaptTransition, findPrecedent, indexCorpus, needsWholePrecedent, setTransitionBase, TRANSITION_BASE, type TransitionBase, type Found, type PSess, type Weights } from "./precedent.ts";
import { adaptText } from "./adapt-text.ts";
import { validateWeek, type VResult, type VSess } from "./validate.ts";
import type { RulesWeek } from "./rules-backtest.ts";

export const GROUP = [5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336];

type Built = { sessions: Array<VSess & { flags: string[]; paceMode: string }>; source: string; why: string; whole: boolean; f: Found };

export function buildPrecedentWeek(ix: ReturnType<typeof indexCorpus>, t: CWeek, W: Weights, c: AthleteContext | undefined, names: Map<number, string>): Built | null {
  const f = findPrecedent(ix, t, W, "any"); if (!f) return null;
  const whole = needsWholePrecedent(t);
  const a = whole ? adapt(ix, t, f) : adaptTransition(ix, t, f) ?? adapt(ix, t, f);
  const p = f.p; const pn = p.aid === t.aid ? "своя" : `чужая — ${names.get(p.aid) ?? p.aid}`;
  const parts = [...f.why.parts].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 4).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${Math.round(100 * v) / 100}`).join(", ");
  const state = (w: CWeek): string => `фаза ${w.phase}${w.weeksToRace != null ? `, до старта ${w.weeksToRace} нед (${w.distBucket})` : ""}, 4 нед ~${w.avg4} мин, прошлая ${w.prevTotal} мин/${w.prevDays} дн/${w.prevQ} кач${w.illAtStart ? ", сигнал здоровья" : ""}`;
  const ownPrev = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart).pop();
  const repeat = !whole && TRANSITION_BASE === "none";
  const source = whole
    ? `ЦЕЛАЯ НЕДЕЛЯ ПРЕЦЕДЕНТА (неделя старта): ${p.weekStart} (${pn}), масштаб ×${Math.round(100 * a.scale) / 100}, ${a.dayMap}`
    : repeat
      ? `ПОВТОР СОБСТВЕННОЙ НЕДЕЛИ ${ownPrev?.weekStart ?? "?"} — заголовки и тексты Игоря, темпы пересчитаны по якорям атлета на ${t.weekStart}`
      : `ПЕРЕХОД: собственная прошлая неделя атлета × шаг тренера с недели ${p.weekStart} (${pn}): объём ×${Math.round(100 * a.scale) / 100}, качественных ${p.prevQ}→${p.qCount}, дней ${p.prevDays}→${p.days}`;
  const why = repeat
    ? `фаза «${t.phase}» — вне недели старта прецедент на обучающем отрезке (2025-06…2026-03) проигрывает повтору во всех фазах. Ближайший прецедент для справки: ${p.weekStart} (${pn}), дистанция ${Math.round(100 * f.why.d) / 100}. Цель: ${state(t)}`
    : `дистанция ${Math.round(100 * f.why.d) / 100} (${parts}). Цель: ${state(t)}. Прецедент: ${state(p)}`;
  const sessions = a.sessions.map((s: PSess) => {
    const tx = adaptText({ title: s.title, desc: s.src.desc, struct: s.src.struct, kind: s.kind, srcMinutes: s.src.minutes, minutes: s.minutes, a: c ?? null });
    return { dayIdx: s.dayIdx, kind: s.kind, title: tx.title, minutes: s.minutes, work: s.kind === "quality" ? workMinutesFromTitle(tx.title) : 0, description: tx.description, written: tx.written, flags: tx.flags, paceMode: tx.paceMode };
  });
  return { sessions, source, why, whole, f };
}

async function main(): Promise<void> {
  const L = load();
  const ix = indexCorpus(L.corpus);
  const TUNED = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
  setTransitionBase(JSON.parse(readFileSync(path.join(DATA_DIR, "transition-base.json"), "utf8")) as TransitionBase);
  const W = addDays(L.thisMonday, -7);
  const ctx = await loadAthleteContexts(sbc(), W);
  const rules = (JSON.parse(readFileSync(path.join(DATA_DIR, "rules-weeks.json"), "utf8")) as RulesWeek[]).filter((r) => r.weekStart === W);
  const rulesBy = new Map(rules.map((r) => [r.aid, r]));
  const targets = ix.all.filter((w) => w.weekStart === W && ctx.has(w.aid));

  const tally = new Map<string, { igor: [number, number]; rules: [number, number]; prec: [number, number] }>();
  const bump = (side: "igor" | "rules" | "prec", rs: VResult[]): void => {
    for (const r of rs) { const e = tally.get(r.name) ?? tally.set(r.name, { igor: [0, 0], rules: [0, 0], prec: [0, 0] }).get(r.name)!; e[side][1]++; if (r.ok) e[side][0]++; }
  };
  const full: string[] = [];
  const p = (s = ""): void => { full.push(s); };
  let flagged = 0, sessCount = 0; const paceModes = new Map<string, number>(); const flagKinds = new Map<string, number>();

  p(`# Шаг 5 · три недели рядом — неделя ${W}`);
  p();
  p(`Слева направо: неделя, которую написал Игорь; неделя нынешнего сборщика по правилам на тот же понедельник; неделя по прецеденту (гибрид).`);
  p(`Прецедент видит только недели СТРОГО раньше ${W}; неделю Игоря ${W} он не видел. Якоря темпа — «на ${W}».`);
  p(`Ничего не записано в TP.`);

  for (const t of targets) {
    const c = ctx.get(t.aid)!;
    const igorV: VSess[] = t.sessions.filter((s) => !s.race).map((s) => ({ dayIdx: s.dayIdx, kind: s.kind, title: s.title, minutes: s.minutes, work: s.work, description: s.desc }));
    const r = rulesBy.get(t.aid);
    const rulesV: VSess[] = (r?.sessions ?? []).filter((s) => !s.deferred).map((s) => ({ dayIdx: s.dayIdx, kind: s.role === "quality" ? "quality" : s.role === "long" ? "long" : "easy", title: s.title, minutes: s.minutes, work: s.role === "quality" ? workMinutesFromTitle(s.title) : 0, description: s.description }));
    const b = buildPrecedentWeek(ix, t, TUNED, c, L.names);
    const vi = validateWeek(igorV, c.envelope, { hasActiveIllness: c.hasActiveIllness, checkText: false });
    const vr = validateWeek(rulesV, c.envelope, { hasActiveIllness: c.hasActiveIllness, checkText: false });
    const vp = b ? validateWeek(b.sessions, c.envelope, { hasActiveIllness: c.hasActiveIllness, checkText: true }) : [];
    bump("igor", vi); bump("rules", vr); bump("prec", vp.filter((x) => !x.name.startsWith("описание")));
    for (const x of vp.filter((y) => y.name.startsWith("описание"))) { const e = tally.get(x.name) ?? tally.set(x.name, { igor: [0, 0], rules: [0, 0], prec: [0, 0] }).get(x.name)!; e.prec[1]++; if (x.ok) e.prec[0]++; }
    if (b) for (const s of b.sessions) { sessCount++; if (s.flags.length) flagged++; for (const fl of s.flags) { const k = fl.replace(/[0-9]+/g, "N"); flagKinds.set(k, (flagKinds.get(k) ?? 0) + 1); } paceModes.set(s.paceMode, (paceModes.get(s.paceMode) ?? 0) + 1); }

    if (!GROUP.includes(t.aid)) continue;
    const nm = L.names.get(t.aid) ?? String(t.aid);
    const sum = (ss: Array<{ minutes: number; kind: string }>): string => `${ss.reduce((a, x) => a + x.minutes, 0)} мин, ${ss.length} сесс., качественных ${ss.filter((x) => x.kind === "quality").length}`;
    p(`\n\n${"═".repeat(100)}`);
    p(`## ${nm} (${t.aid}) · тир ${c.tier}${c.hasActiveIllness ? " · активный health-сигнал" : ""}`);
    p(`${"═".repeat(100)}`);
    p(`\n### 1. Неделя Игоря — ${sum(igorV)}`);
    for (const s of igorV) { p(`\n**${DAY_RU[s.dayIdx]} · ${s.title} · ${s.minutes} мин** [${s.kind}]`); p(s.description || "_(без описания)_"); }
    for (const s of t.sessions.filter((x) => x.race)) p(`\n_${DAY_RU[s.dayIdx]} · ${s.title} · ${s.minutes} мин — сам СТАРТ (день из race_events), в сравнение не входит_`);
    p(`\n### 2. Сборщик по правилам — ${sum(rulesV)}${r?.withCycle ? " · с целью цикла" : " · без цикла"}${r?.refused ? " · ОТКАЗ" : ""}`);
    for (const s of rulesV) { p(`\n**${DAY_RU[s.dayIdx]} · ${s.title} · ${s.minutes} мин** [${s.kind}]`); p(s.description || "_(без описания)_"); }
    if (r?.studentNotes.length) p(`\n_Заметки ученице:_ ${r.studentNotes.join(" · ")}`);
    if (!b) { p(`\n### 3. Прецедент — НЕ НАЙДЕН`); continue; }
    p(`\n### 3. По прецеденту — ${sum(b.sessions)}`);
    p(`_Откуда:_ ${b.source}`);
    p(`_Почему выбран:_ ${b.why}`);
    for (const s of b.sessions) {
      p(`\n**${DAY_RU[s.dayIdx]} · ${s.title} · ${s.minutes} мин** [${s.kind}] · темп: ${s.paceMode}`);
      p(s.description || "_(без описания)_");
      for (const fl of s.flags) p(`⚑ ${fl}`);
    }
    const fails = (vs: VResult[]): string => vs.filter((x) => !x.ok).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`).join("; ") || "все прошли";
    p(`\n_Валидатор:_ Игорь — ${fails(vi)}`);
    p(`_Валидатор:_ правила — ${fails(vr)}`);
    p(`_Валидатор:_ прецедент — ${fails(vp)}`);
  }

  // ── сводка валидатора ──
  const v: string[] = [];
  v.push(`# Шаг 4 · валидатор на трёх неделях — ${W}, ${targets.length} атлетов`);
  v.push();
  v.push(`Инварианты перенесены из tp-cycle-forecast-check.ts (только те, что формулируются про саму неделю).`);
  v.push(`Ячейка — сколько недель прошло проверку из скольких, где она применима.`);
  v.push();
  v.push(`| проверка | Игорь | правила | прецедент |`);
  v.push(`|---|---:|---:|---:|`);
  const cell = (x: [number, number]): string => (x[1] ? `${x[0]}/${x[1]} (${Math.round(100 * x[0] / x[1])}%)` : "—");
  for (const [n, e] of tally) v.push(`| ${n} | ${cell(e.igor)} | ${cell(e.rules)} | ${cell(e.prec)} |`);
  v.push();
  v.push(`Сессий в прецедентных неделях: ${sessCount}; с пометкой тренеру: ${flagged}.`);
  v.push(`Как получены темпы: ${[...paceModes.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} — ${n}`).join("; ")}`);
  v.push(`Пометки тренеру: ${[...flagKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `«${k}» — ${n}`).join("; ")}`);
  writeFileSync(path.join(OUT_DIR, "step4-validator.md"), v.join("\n") + "\n");
  writeFileSync(path.join(OUT_DIR, "step5-three-columns.md"), full.join("\n") + "\n");
  console.log(v.join("\n"));
  console.log(`\n→ ${OUT_DIR}/step5-three-columns.md`);
}

if (process.argv[1]?.endsWith("step45-compare.ts")) main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
