/**
 * Шаг 2 — ТЕКСТЫ И НАЗВАНИЯ. Словарь заголовков и формулировок описаний тренера. READ-ONLY.
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/step2-lexicon-report.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { load, OUT_DIR } from "./load.ts";
import { phraseStats, titleStats } from "./lexicon.ts";

const L = load();
const W = L.corpus;
const out: string[] = [];
const p = (s = ""): void => { out.push(s); };
const ks = (k: { quality: number; long: number; easy: number }): string =>
  [k.quality ? `Q${k.quality}` : "", k.long ? `L${k.long}` : "", k.easy ? `E${k.easy}` : ""].filter(Boolean).join(" ");

const sess = W.flatMap((w) => w.sessions);
const withDesc = sess.filter((s) => s.desc.length > 0);
p(`# Шаг 2 · названия и формулировки тренера`);
p();
p(`Беговых плановых сессий: ${sess.length}; с описанием: ${withDesc.length} (${Math.round(100 * withDesc.length / sess.length)}%)`);
const raw = titleStats(W, false); const norm = titleStats(W, true);
p(`Разных заголовков дословно: ${raw.length}; после нормализации чисел: ${norm.length}`);
const top30cover = norm.slice(0, 30).reduce((s, x) => s + x.n, 0);
p(`30 частых шаблонов покрывают ${Math.round(100 * top30cover / sess.length)}% сессий.`);
p();
p(`## 30 самых частых названий (дословно)`);
p(`| # | название | раз | атлетов | роль (Q/L/E) | медиана мин |`);
p(`|---:|---|---:|---:|---|---:|`);
raw.slice(0, 30).forEach((t, i) => p(`| ${i + 1} | ${t.title} | ${t.n} | ${t.athletes} | ${ks(t.kinds)} | ${t.medMin} |`));
p();
p(`## 30 самых частых шаблонов названий (числа → #)`);
p(`| # | шаблон | раз | атлетов | роль | медиана мин |`);
p(`|---:|---|---:|---:|---|---:|`);
norm.slice(0, 30).forEach((t, i) => p(`| ${i + 1} | ${t.title} | ${t.n} | ${t.athletes} | ${ks(t.kinds)} | ${t.medMin} |`));
p();
p(`## Названия качественных по шаблону (топ-20)`);
titleStats(W.map((w) => ({ ...w, sessions: w.sessions.filter((s) => s.kind === "quality") })), true).slice(0, 20)
  .forEach((t, i) => p(`${i + 1}. ${t.title} — ${t.n} раз, ${t.athletes} атлетов, медиана ${t.medMin} мин`));
p();
const ph = phraseStats(W);
p(`## 20 типовых формулировок описаний (темп → #темп, числа → #)`);
p(`Разных фраз-шаблонов: ${ph.length}.`);
ph.slice(0, 20).forEach((x, i) => p(`${i + 1}. «${x.example}» — ${x.n} раз, ${x.athletes} атлетов, ${ks(x.kinds)}`));
p();
p(`## Частые формулировки по роли`);
for (const k of ["quality", "long", "easy"] as const) {
  p(`### ${k}`);
  ph.filter((x) => x.kinds[k] / x.n > 0.6).slice(0, 8).forEach((x) => p(`- «${x.example}» — ${x.n}`));
  p();
}
writeFileSync(path.join(OUT_DIR, "step2-lexicon.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
