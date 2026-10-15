/**
 * R6 — ТРИ КОЛОНКИ ЗАНОВО: неделя Игоря / повтор + дельта / старый генератор (как в main).
 * READ-ONLY, в TP не пишет. Неделя — последняя завершённая, те же атлеты группы 12.
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/r6-three-columns.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadAthleteContexts } from "../lib/autoplanner-context.ts";
import { DAY_RU } from "../lib/autoplanner-week.ts";
import { addDays } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { indexCorpus, type Weights } from "./precedent.ts";
import { buildRepeatWeek } from "./build-week.ts";
import type { RulesWeek } from "./rules-backtest.ts";

const GROUP = [5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336];

async function main(): Promise<void> {
  const L = load(); const ix = indexCorpus(L.corpus);
  const Wt = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
  const W = addDays(L.thisMonday, -7);
  const ctx = await loadAthleteContexts(sbc(), W);
  const byKey = (p: string): Map<number, RulesWeek> => new Map((JSON.parse(readFileSync(p, "utf8")) as RulesWeek[]).filter((r) => r.weekStart === W).map((r) => [r.aid, r]));
  const orig = byKey(path.join(OUT_DIR, "orig", "data", "rules-weeks.json"));
  const now = byKey(path.join(DATA_DIR, "rules-weeks.json"));
  const out: string[] = []; const p = (s = ""): void => { out.push(s); };
  const sum = (ss: Array<{ minutes: number; kind: string }>): string => `${ss.reduce((a, x) => a + x.minutes, 0)} мин, ${ss.length} сесс., качественных ${ss.filter((x) => x.kind === "quality").length}`;
  p(`# Три недели рядом — ${W} (заново)`);
  p();
  p(`1 — неделя, которую написал Игорь. 2 — повтор + дельта цикла (новый метод). 3 — генератор по правилам, как в main.`);
  p(`Новый метод видит только недели СТРОГО раньше ${W}; якоря темпа и сигналы — «на ${W}». Ничего не записано в TP.`);
  const summary: string[] = [];
  for (const aid of GROUP) {
    const t = ix.all.find((w) => w.aid === aid && w.weekStart === W);
    const nm = L.names.get(aid) ?? String(aid);
    if (!t) { p(`\n\n## ${nm} (${aid}) — недели Игоря на ${W} в плане нет, сравнивать не с чем`); summary.push(`| ${nm} | — | — | — | нет недели Игоря |`); continue; }
    const c = ctx.get(aid);
    const cyc = now.get(aid)?.cycle; // цель цикла на тот понедельник (прогноз сборщика)
    const b = buildRepeatWeek(ix, t, Wt, cyc ? { role: cyc.role, target: cyc.target, base: cyc.base } : null, c, L.names);
    const r = orig.get(aid);
    const igor = t.sessions.filter((s) => !s.race);
    const rules = (r?.sessions ?? []).filter((s) => !s.deferred).map((s) => ({ ...s, kind: s.role === "quality" ? "quality" : s.role === "long" ? "long" : "easy" }));
    p(`\n\n${"═".repeat(100)}`);
    p(`## ${nm} (${aid})${c?.hasActiveIllness ? " · активный health-сигнал" : ""}${t.raceDayIdx != null && t.raceDayIdx <= 6 ? ` · СТАРТ в ${DAY_RU[t.raceDayIdx]}` : ""}`);
    p(`${"═".repeat(100)}`);
    p(`\n### 1. Неделя Игоря — ${sum(igor)}`);
    for (const s of igor) { p(`\n**${DAY_RU[s.dayIdx]} · ${s.title} · ${s.minutes} мин** [${s.kind}]`); p(s.desc || "_(без описания)_"); }
    for (const s of t.sessions.filter((x) => x.race)) p(`\n_${DAY_RU[s.dayIdx]} · ${s.title} · ${s.minutes} мин — сам СТАРТ, в сравнение не входит_`);
    if (!b) p(`\n### 2. Повтор + дельта — НЕ СОБРАНА`);
    else {
      p(`\n### 2. Повтор + дельта — ${sum(b.sessions)}${b.refused ? " · ⛔ ОТКАЗ ВАЛИДАТОРА" : ""}`);
      p(`_Откуда:_ ${b.source}`);
      p(`_Почему:_ ${b.why}`);
      for (const s of b.sessions) { p(`\n**${DAY_RU[s.dayIdx]} · ${s.title} · ${s.minutes} мин** [${s.kind}] · темп: ${s.paceMode}`); p(s.description || "_(без описания)_"); }
      if (b.warnings.length) { p(`\n_Пометки тренеру:_`); for (const w of b.warnings) p(`- ${w}`); }
    }
    p(`\n### 3. Генератор по правилам (как в main) — ${sum(rules)}${r?.withCycle ? " · с целью цикла" : ""}${r?.refused ? " · ОТКАЗ" : ""}`);
    for (const s of rules) { p(`\n**${DAY_RU[s.dayIdx]} · ${s.title} · ${s.minutes} мин** [${s.kind}]`); p(s.description || "_(без описания)_"); }
    const tot = (ss: Array<{ minutes: number }>): number => ss.reduce((a, x) => a + x.minutes, 0);
    const q = (ss: Array<{ kind: string }>): number => ss.filter((x) => x.kind === "quality").length;
    summary.push(`| ${nm} | ${tot(igor)} · ${q(igor)} | ${b ? `${tot(b.sessions)} · ${q(b.sessions)}${b.refused ? " ⛔" : ""}` : "—"} | ${tot(rules)} · ${q(rules)} | ${b ? b.source.split(":")[0].replace(/ × дельта.*/, "").slice(0, 70) : "—"} |`);
  }
  const head = [`\n## Сводка (мин · качественных)`, `| атлет | Игорь | повтор + дельта | правила (main) | откуда новая неделя |`, `|---|---|---|---|---|`, ...summary];
  writeFileSync(path.join(OUT_DIR, "r6-three-columns.md"), [...out.slice(0, 4), ...head, ...out.slice(4)].join("\n") + "\n");
  console.log(head.join("\n"));
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
