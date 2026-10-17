/**
 * R18 — КАЧЕСТВО «ПО ОЩУЩЕНИЯМ» БЕЗ ЦИФР: у скольких из группы 12. READ-ONLY (Supabase — только чтение контекстов; в TP ничего).
 * Для каждого атлета: (1) качественные сессии собранной недели; (2) качественные сессии его последних 3 недель, пропущенные через ту же адаптацию.
 * «Без цифр» = в итоговом тексте качества нет ни одного темпа m:ss. Замер ДО правки (17.10, прежняя привязка по числу уровней): 12 из 34 качественных сессий без цифр.
 * Запуск: tsx r18-quality-paces.ts [--week 2026-10-19] [--old _adapt-old.ts]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { addDays } from "./corpus.ts";
import { OUT_DIR } from "./load.ts";
import { assemble, GROUP12 } from "./assemble.ts";
import { adaptText, paceTextVsStructure } from "./adapt-text.ts";

const week = (() => { const i = process.argv.indexOf("--week"); return i > 0 ? process.argv[i + 1] : "2026-10-19"; })();
const hasPace = (t: string): boolean => /\d{1,2}:\d{2}/.test(t);
const { L, ix, results } = await assemble(week, GROUP12);
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
p(`# R18 · качество «по ощущениям» без цифр — группа 12, неделя ${week}`); p();
p(`| атлет | где | сессия | (было см. шапку) | цифры? | режим «стало» | обратное чтение | пометки «стало» |`); p(`|---|---|---|---|---|---|---|---|`);
let nNew = 0, total = 0;
for (const r of results) {
  const c = r.c; const name = L.names.get(r.aid) ?? String(r.aid);
  const thr = c?.threshold?.paceSec;
  const rows: Array<{ where: string; title: string; desc: string; struct: unknown; minutes: number; src: number }> = [];
  if (r.built) for (const s of r.built.sessions.filter((x) => x.kind === "quality")) rows.push({ where: "собранная неделя", title: s.title, desc: "", struct: null, minutes: s.minutes, src: s.minutes });
  const own = ix.byAid.get(r.aid) ?? [];
  for (const w of own.slice(-3)) for (const s of w.sessions.filter((x) => x.kind === "quality" && !x.race)) rows.push({ where: `его неделя ${w.weekStart}`, title: s.title, desc: s.desc, struct: s.struct, minutes: s.minutes, src: s.minutes });
  for (const x of rows) {
    if (x.where === "собранная неделя") { const bs = r.built!.sessions.find((s) => s.kind === "quality" && s.title === x.title)!; total++; const ok = hasPace(bs.description); if (!ok) nNew++; p(`| ${name} | ${x.where} | ${x.title} | (в сборке) | ${ok ? "да" : "**НЕТ**"} | ${bs.paceMode} | — | ${bs.flags.join("; ") || "—"} |`); continue; }
    const a = c ?? null;
    const n = adaptText({ title: x.title, desc: x.desc, struct: x.struct, kind: "quality", srcMinutes: x.src, minutes: x.minutes, a });
    total++; const okN = hasPace(n.description); if (!okN) nNew++;
    const rb = thr && okN && /^% порога/.test(n.paceMode) ? paceTextVsStructure(n.description, x.struct, thr) : null;
    p(`| ${name} | ${x.where} | ${x.title} | — | ${okN ? "да" : "**НЕТ**"} | ${n.paceMode} | ${rb == null ? "—" : rb.length ? "РАСХОДИТСЯ: " + rb.join("; ") : "сошлись"} | ${n.flags.join("; ") || "—"} |`);
  }
}
p(); p(`Качественных сессий просмотрено: ${total}. Без цифр: ${nNew}.`);
writeFileSync(path.join(OUT_DIR, "r18-quality-paces.md"), out.join("\n") + "\n"); console.log(out.join("\n"));
