/**
 * R14 — КАЧЕСТВО УНАСЛЕДОВАНО ОТСУТСТВИЕМ: порог «атлет обычно делает качество». READ-ONLY.
 * Доля = в скольких из его последних 8 своих недель (без недели старта и после старта; сигнал здоровья в счёт идёт, R4) было качество.
 * Таблица: среди целевых недель, чей ОБРАЗЕЦ качества не содержит, как часто в НАСТОЯЩЕЙ неделе оно было — по корзинам доли.
 * Порог ставится там, где вероятность перевалила за половину на ОБУЧЕНИИ (до SPLIT), проверяется на проверке.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { load, OUT_DIR } from "./load.ts";
import { indexCorpus } from "./precedent.ts";
import { abnormalReason, setRepeatParams, SKIP_REASONS } from "./repeat.ts";
import { resolveExplicitParams } from "./build-week.ts";
resolveExplicitParams(); setRepeatParams({ normal: 0.8, gap: 2, lookback: 10, recovery: true, recoveryTable: "train" });
const SPLIT = "2026-03-02", VALID_TO = "2026-08-17";
const L = load(); const ix = indexCorpus(L.corpus); const roster = new Set(L.rosterActive);
type Row = { share: number; actualQ: boolean; ws: string };
const rows: Row[] = [];
for (const [aid, ws] of ix.byAid) for (let i = 0; i < ws.length; i++) {
  const t = ws[i]; if (t.phase === "race" || t.phase === "post" || t.ill || t.avg4 <= 0) continue;
  const own = ws.slice(0, i); let base = null; for (let j = own.length - 1; j >= 0 && i - j <= 10; j--) { const why = abnormalReason(ix, own[j]); if (!why || !SKIP_REASONS.has(why)) { base = own[j]; break; } }
  if (!base || base.qCount > 0) continue;
  const win = own.slice(-12).filter((w) => w.phase !== "race" && w.phase !== "post").slice(-8); if (win.length < 4) continue;
  rows.push({ share: win.filter((w) => w.qCount > 0).length / win.length, actualQ: t.qCount > 0, ws: t.weekStart });
}
const bins: Array<[number, number]> = [[0, 0.01], [0.01, 0.25], [0.25, 0.5], [0.5, 0.625], [0.625, 0.75], [0.75, 0.875], [0.875, 1.01]];
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
p(`# R14 · порог «атлет обычно делает качество»`); p();
p(`Берём только целевые недели, у которых ОБРАЗЕЦ качества не содержит (${rows.length} недель). Доля — недель с качеством среди последних 8 своих.`); p();
p(`| доля недель с качеством | недель: обучение | в настоящей неделе было качество: обучение | недель: проверка | …: проверка | недель: всё | …: всё |`); p(`|---|---:|---:|---:|---:|---:|---:|`);
const pct = (a: Row[]): string => (a.length ? `${Math.round(100 * a.filter((r) => r.actualQ).length / a.length)}%` : "—");
for (const [lo, hi] of bins) {
  const a = rows.filter((r) => r.share >= lo && r.share < hi); const tr = a.filter((r) => r.ws < SPLIT); const va = a.filter((r) => r.ws >= SPLIT && r.ws < VALID_TO);
  p(`| ${lo.toFixed(2)}–${Math.min(hi, 1).toFixed(2)} | ${tr.length} | ${pct(tr)} | ${va.length} | ${pct(va)} | ${a.length} | ${pct(a)} |`);
}
writeFileSync(path.join(OUT_DIR, "r14-quality-share.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
