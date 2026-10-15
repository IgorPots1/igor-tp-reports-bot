/**
 * R10 — АУДИТ ДОНОРОВ ПРЕЦЕДЕНТА: правила «не образец» и стиль названий живут только в ветке повтора? READ-ONLY.
 * Для тех же 809 недель (17.08–05.10), где метод 5 пошёл по ветке прецедента, смотрим на выбранного донора.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { findPrecedent, indexCorpus, type Weights } from "./precedent.ts";
import { abnormalReason, planRepeat, setRepeatParams } from "./repeat.ts";
import { useExplicitParams } from "./build-week.ts";
import type { RulesWeek } from "./rules-backtest.ts";

useExplicitParams();
const L = load(); const ix = indexCorpus(L.corpus);
const W = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
setRepeatParams({ normal: 0.8, gap: 2, lookback: 10, peak: 1.25, recovery: true });
const rules = new Map((JSON.parse(readFileSync(path.join(DATA_DIR, "rules-weeks.json"), "utf8")) as RulesWeek[]).map((r) => [`${r.aid}|${r.weekStart}`, r]));
const bSet = ix.all.filter((w) => rules.has(`${w.aid}|${w.weekStart}`) && w.avg4 > 0);
const byReason = new Map<string, number>(); let prec = 0, foreign = 0, styleMismatch = 0, styleComparable = 0;
const pulseShare = (ws: typeof L.corpus): number => { const t = ws.flatMap((w) => w.sessions.filter((s) => !s.race)); return t.length ? t.filter((s) => /пульс/i.test(s.title)).length / t.length : NaN; };
for (const t of bSet) {
  const pl = planRepeat(ix, t, null); if (pl.kind !== "precedent") continue; prec++;
  const f = findPrecedent(ix, t, W, "any"); if (!f) continue;
  const why = abnormalReason(ix, f.p) ?? "обычная"; byReason.set(why, (byReason.get(why) ?? 0) + 1);
  if (f.p.aid !== t.aid) {
    foreign++;
    const own = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart).slice(-8); const a = pulseShare(own), b = pulseShare([f.p]);
    if (Number.isFinite(a) && Number.isFinite(b)) { styleComparable++; if ((a > 0.5 && b < 0.2) || (a < 0.2 && b > 0.5)) styleMismatch++; }
  }
}
const out = [`# R10 · аудит доноров ветки прецедента (${bSet.length} недель, из них прецедент: ${prec})`, "",
  `Донор по правилам «непригодная форма» (то же определение, что для образцов в повторе):`,
  ...[...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`), "",
  `Чужой донор: ${foreign} из ${prec}. Стиль названий (по пульсу / по темпу) у донора и у самого атлета противоположный: ${styleMismatch} из ${styleComparable} сравнимых.`];
writeFileSync(path.join(OUT_DIR, "r10-donors.md"), out.join("\n") + "\n"); console.log(out.join("\n"));
