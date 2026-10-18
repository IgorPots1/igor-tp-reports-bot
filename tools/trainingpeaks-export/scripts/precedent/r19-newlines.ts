/**
 * R19 — ПЕРЕНОСЫ СТРОК В ОПИСАНИЯХ: до и после, по группе 12. READ-ONLY (Supabase и TP — только чтение).
 * Причина потери (факт, 18.10): tp-workouts-cache-scan.ts toCompactText схлопывает \s+ → " " при записи кэша; в корпусе 0 из 18 670 описаний с переносом, в TP у оригинала они есть.
 * «До» = текст из кэша (assemble без чтения TP), «после» = подлинный текст образца из TP + адаптация. Условие проверки: число переносов в итоговом тексте = числу в подлинном описании образца.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { OUT_DIR } from "./load.ts";
import { assemble, GROUP12, liveDescFetcher } from "./assemble.ts";
const week = (() => { const i = process.argv.indexOf("--week"); return i > 0 ? process.argv[i + 1] : "2026-10-19"; })();
const nl = (s: string): number => (s.match(/\n/g) ?? []).length;
const before = await assemble(week, GROUP12, { descFetcher: null }), after = await assemble(week, GROUP12);
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
p(`# R19 · переносы строк, группа 12, неделя ${week}`); p();
p(`| атлет | сессия | переносов в подлиннике (TP) | до (кэш) | после | совпало |`); p(`|---|---|---:|---:|---:|---|`);
let lost = 0, sess = 0, bad = 0; const names = after.L.names; let exEasy: string | null = null, exQ: string | null = null;
for (const a of after.results) {
  const b = before.results.find((x) => x.aid === a.aid); if (!a.built || !b?.built) continue;
  for (const s of a.built.sessions) {
    const orig = (await liveDescFetcher(a.aid, s.srcWorkoutId)) ?? (await liveDescFetcher(after.L.corpus.find((w) => w.sessions.some((x) => x.wid === s.srcWorkoutId))?.aid ?? a.aid, s.srcWorkoutId));
    const sb = b.built.sessions.find((x) => x.srcWorkoutId === s.srcWorkoutId && x.dayIdx === s.dayIdx);
    if (orig == null) { p(`| ${names.get(a.aid) ?? a.aid} | ${s.title} | не получено | — | ${nl(s.description)} | — |`); continue; }
    sess++; const nO = nl(orig), nB = sb ? nl(sb.description) : -1, nA = nl(s.description); if (nB < nO) lost++; const ok = nA === nO; if (!ok) bad++;
    p(`| ${names.get(a.aid) ?? a.aid} | ${s.title} | ${nO} | ${nB} | ${nA} | ${ok ? "да" : "**НЕТ**"} |`);
    if (a.aid === 6009851 && s.kind === "easy" && !exEasy) exEasy = `ДО: ${JSON.stringify(sb?.description)}\nПОСЛЕ: ${JSON.stringify(s.description)}`;
    if (a.aid === 6009851 && s.kind === "quality" && !exQ) exQ = `ДО: ${JSON.stringify(sb?.description)}\nПОСЛЕ: ${JSON.stringify(s.description)}`;
  }
}
p(); p(`Сессий просмотрено: ${sess}. Теряли форматирование (до): ${lost}. Число переносов после ≠ подлиннику: ${bad}.`);
p(); p(`## Пример: лёгкая (Ярулина)`); p("```"); p(exEasy ?? "—"); p("```"); p(`## Пример: качественная (Ярулина)`); p("```"); p(exQ ?? "—"); p("```");
writeFileSync(path.join(OUT_DIR, "r19-newlines.md"), out.join("\n") + "\n"); console.log(out.join("\n"));
