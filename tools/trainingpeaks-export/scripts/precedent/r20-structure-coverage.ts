/**
 * R20 — СТРУКТУРА В СОБРАННЫХ НЕДЕЛЯХ ГРУППЫ 12 + «как увидит ученик». READ-ONLY (Supabase/TP — только чтение).
 * Шаги показываются так, как TP рисует шаг с целью «% порога темпа»: темп = порог атлета × 100 / % (тот же расчёт, что у TP; порог — из контекста атлета).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { OUT_DIR } from "./load.ts";
import { assemble, GROUP12 } from "./assemble.ts";
import { totalSeconds, type Snap } from "./structure-copy.ts";
const week = (() => { const i = process.argv.indexOf("--week"); return i > 0 ? process.argv[i + 1] : "2026-10-19"; })();
const DAY = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const dur = (sec: number): string => (sec % 60 === 0 ? `${sec / 60} мин` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`);
const CLS: Record<string, string> = { warmUp: "Разминка", coolDown: "Заминка", active: "Работа", rest: "Восстановление", recovery: "Восстановление" };
function stepLine(s: Snap["structure"][number]["steps"][number], thr: number | null): string {
  const t = s.targets?.[0]; const lo = t?.minValue ?? 0, hi = t?.maxValue ?? 0;
  const pace = thr && hi > 0 ? (lo > 0 ? `${mmss(thr * 100 / hi)}–${mmss(thr * 100 / lo)} /км` : `не быстрее ${mmss(thr * 100 / hi)} /км`) : "";
  return `${CLS[s.intensityClass ?? ""] ?? s.name ?? "Шаг"} · ${dur(s.length.value)} · ${lo}–${hi}% порога${pace ? ` · ${pace}` : ""}${(s as { notes?: string }).notes ? ` · заметка: «${(s as { notes?: string }).notes}»` : ""}`;
}
export function studentView(o: { title: string; minutes: number; description: string; structure: Snap | null; dayIdx: number; date: string }, thr: number | null): string {
  const out = [`${DAY[o.dayIdx]} ${o.date} · ${o.title} · план ${o.minutes} мин`, "", o.description, "", o.structure ? `ШАГИ (${dur(totalSeconds(o.structure))}):` : "ШАГОВ НЕТ (structure=null)"];
  if (o.structure) for (const n of o.structure.structure) { if (n.type === "repetition") { out.push(`  ${n.length.value} ×`); for (const s of n.steps) out.push(`     ${stepLine(s, thr)}`); } else for (const s of n.steps) out.push(`  ${stepLine(s, thr)}`); }
  return out.join("\n");
}
const { L, results } = await assemble(week, GROUP12);
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
p(`# R20 · структура в неделях группы 12 (${week})`); p(); p(`| атлет | сессий | со структурой | без (причина) |`); p(`|---|---:|---:|---|`);
let withS = 0, total = 0; const athWith = new Set<number>(), athNone = new Set<number>();
for (const r of results) { if (!r.built || r.built.refused) { p(`| ${L.names.get(r.aid) ?? r.aid} | — | — | ${r.ok ? "" : "нет недели: " + r.why.slice(0, 60)} |`); continue; }
  const ss = r.built.sessions; const w = ss.filter((s) => s.structure).length; withS += w; total += ss.length; if (w) athWith.add(r.aid); if (w < ss.length) athNone.add(r.aid);
  p(`| ${L.names.get(r.aid) ?? r.aid} | ${ss.length} | ${w} | ${ss.filter((s) => !s.structure).map((s) => `${s.title}: ${s.flags.find((f) => /структур/.test(f)) ?? "?"}`).join("; ") || "—"} |`); }
p(); p(`Сессий ${total}, со структурой ${withS}, без ${total - withS}. Атлетов со структурой хотя бы в одной сессии: ${athWith.size}; хотя бы одна сессия без: ${athNone.size}.`);
const y = results.find((r) => r.aid === 6009851);
if (y?.built) { const thr = y.c?.threshold?.paceSec ?? null; p(); p(`## Как увидит ученик (Ярулина, порог ${thr ? mmss(thr) : "—"} /км)`);
  for (const k of ["easy", "quality"]) { const s = y.built.sessions.find((x) => x.kind === k); if (!s) continue; p(); p("```"); p(studentView({ ...s, date: new Date(Date.parse(week) + s.dayIdx * 86400000).toISOString().slice(0, 10) }, thr)); p("```"); } }
writeFileSync(path.join(OUT_DIR, "r20-structure-coverage.md"), out.join("\n") + "\n"); console.log(out.join("\n"));
