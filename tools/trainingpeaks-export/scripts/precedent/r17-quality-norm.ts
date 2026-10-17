/**
 * R17 — «ОБЫЧНО ДЕЛАЕТ КАЧЕСТВО» ПО НОРМЕ ТРЕНЕРА, а не по предсказанию факта (замечание Игоря 17.10).
 * Прежний замер (r14) спрашивал: «будет ли качество в настоящей неделе» — по ВСЕМ неделям, включая старт, после старта, подводку, болезнь, где отсутствие
 * объяснено. Правильный вопрос: «считает ли тренер неделю БЕЗ качества у этого человека нормальной». Её задают только ЧИСТЫЕ недели (фаза base/build,
 * нет сигнала, не провал/пик/мало дней): отсутствие качества в такой неделе ничем не объяснено — это либо норма для человека, либо ошибка.
 * Доля — по последним 8 своим неделям (из 12), без недель старта и после старта; сигнал в счёт идёт (R4).
 * Таблицы: (1) чистые недели вообще, (2) чистые недели, у которых ОБРАЗЕЦ качества не содержит (ровно тот случай, где правило срабатывает).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildCorpus } from "./corpus.ts";
import { load, OUT_DIR } from "./load.ts";
import { indexCorpus } from "./precedent.ts";
import { abnormalReason, setRepeatParams, SKIP_REASONS, QUALITY_SHARE_MIN } from "./repeat.ts";
import { stateFor, useExplicitParams } from "./build-week.ts";
import { GROUP12 } from "./assemble.ts";
useExplicitParams(); setRepeatParams({ normal: 0.8, gap: 2, lookback: 10, recovery: true, recoveryTable: "train", peak: 1.5, peakRule: null });
const SPLIT = "2026-03-02", VALID_TO = "2026-08-17";
const L = load(); const ix = indexCorpus(L.corpus);
type Row = { share: number; q: boolean; baseNoQ: boolean; ws: string };
const rows: Row[] = [];
for (const [, ws] of ix.byAid) for (let i = 0; i < ws.length; i++) {
  const t = ws[i]; if (t.phase !== "base" && t.phase !== "build") continue; if (t.ill || t.avg4 <= 0 || abnormalReason(ix, t) != null) continue;
  const own = ws.slice(0, i); const win = own.slice(-12).filter((w) => w.phase !== "race" && w.phase !== "post").slice(-8); if (win.length < 4) continue;
  let base = null; for (let j = own.length - 1; j >= 0 && i - j <= 10; j--) { const why = abnormalReason(ix, own[j]); if (!why || !SKIP_REASONS.has(why)) { base = own[j]; break; } }
  rows.push({ share: win.filter((w) => w.qCount > 0).length / win.length, q: t.qCount > 0, baseNoQ: !!base && base.qCount === 0, ws: t.weekStart });
}
const bins: Array<[number, number]> = [[0, 0.01], [0.01, 0.25], [0.25, 0.4], [0.4, 0.5], [0.5, 0.625], [0.625, 0.75], [0.75, 0.875], [0.875, 1.01]];
const pct = (a: Row[]): string => (a.length ? `${Math.round(100 * a.filter((r) => r.q).length / a.length)}% (n=${a.length})` : "—");
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
p(`# R17 · «обычно делает качество» по норме тренера`); p();
p(`Чистых недель: ${rows.length}. В ячейке — доля недель С качеством (значит, доля недель БЕЗ качества = остальное: «тренер считает пустую неделю нормой» там, где эта доля низкая).`); p();
p(`| доля недель с качеством у человека | чистые недели: обучение | чистые: проверка | чистые, образец без качества: обучение | …: проверка | …: всё |`); p(`|---|---|---|---|---|---|`);
for (const [lo, hi] of bins) { const a = rows.filter((r) => r.share >= lo && r.share < hi); const tr = a.filter((r) => r.ws < SPLIT), va = a.filter((r) => r.ws >= SPLIT && r.ws < VALID_TO);
  p(`| ${lo.toFixed(3)}–${Math.min(hi, 1).toFixed(3)} | ${pct(tr)} | ${pct(va)} | ${pct(tr.filter((r) => r.baseNoQ))} | ${pct(va.filter((r) => r.baseNoQ))} | ${pct(a.filter((r) => r.baseNoQ))} |`); }
p();
const wk = "2026-10-19"; const ixw = indexCorpus(buildCorpus(L.rows, L.races, L.sig, L.students, wk));
p(`## Доля у группы 12 на ${wk}`); p(`| атлет | недель в окне | с качеством | доля | фаза цели |`); p(`|---|---:|---:|---:|---|`);
for (const aid of GROUP12) { const own = ixw.byAid.get(aid) ?? []; const win = own.slice(-12).filter((w) => w.phase !== "race" && w.phase !== "post").slice(-8); const q = win.filter((w) => w.qCount > 0).length;
  const t = stateFor(ixw, aid, wk, L.races.filter((r) => r.trainingpeaks_athlete_id === aid), false); p(`| ${L.names.get(aid) ?? aid} | ${win.length} | ${q} | ${win.length ? (q / win.length).toFixed(3) : "—"} | ${t.phase} |`); }
writeFileSync(path.join(OUT_DIR, "r17-quality-norm.md"), out.join("\n") + "\n"); console.log(out.join("\n"));
