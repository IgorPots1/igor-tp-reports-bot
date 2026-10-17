/**
 * ПРОБА КОПИИ СТРУКТУРЫ на тест-атлете 3102415 (наряд Игоря 17.10). По умолчанию СУХАЯ: печатает ровно что было бы записано, сети нет.
 * Живой запуск — только по слову Игоря: --execute-real --confirm "ПРОБА СТРУКТУРЫ 3102415" и TP_ACTIONS_REAL_EXECUTION=true.
 * Цикл на каждый случай: создать СКРЫТОЙ с копией структуры → прочитать → сверить шаги/цели/суммарную длительность/totalTimePlanned → удалить → прочитать (удалена).
 * Любое расхождение — СТОП и удаление созданного. Выясняет формат: сначала сериализованная строка (как шлёт план создания), объект — только если строка не прошла.
 * Запуск: tsx probe-structure-copy.ts [--execute-real --confirm "..."]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildCorpus } from "./corpus.ts";
import { load, OUT_DIR } from "./load.ts";
import type { TpLike } from "./hidden-flow.ts";
import { asObject, asString, compareStructures, parseSnap, plannedHours, scaleToSeconds, totalSeconds, type Snap } from "./structure-copy.ts";

export const PROBE_ATHLETE = 3102415;
export const PROBE_CONFIRM = "ПРОБА СТРУКТУРЫ 3102415";
const PROBE_DAY = "2026-11-30T00:00:00";

export type Case = { label: string; minutes: number; snap: Snap; note: string };
export type CaseResult = { label: string; variant: "string" | "object"; steps: string[]; ok: boolean; stopped: string | null; workoutId: number | null; cleaned: boolean | null };

export const bodyFor = (c: Case, variant: "string" | "object"): Record<string, unknown> => ({
  athleteId: PROBE_ATHLETE, workoutDay: PROBE_DAY, title: `ПРОБА СТРУКТУРЫ · ${c.label}`, workoutTypeValueId: 3, workoutSubTypeId: null,
  description: "Проба копии структуры — не тренировка, будет удалена.", coachComments: null, distancePlanned: null, totalTimePlanned: plannedHours(c.snap),
  structure: variant === "string" ? asString(c.snap) : asObject(c.snap), isHidden: true,
});

/** Один случай на одном формате. Клиент внедряется — логика проверяется на подставном клиенте. */
export async function runCase(tp: TpLike, c: Case, variant: "string" | "object"): Promise<CaseResult> {
  const r: CaseResult = { label: c.label, variant, steps: [], ok: false, stopped: null, workoutId: null, cleaned: null };
  const log = (s: string): void => { r.steps.push(s); };
  try {
    const created = await tp.createWorkout(bodyFor(c, variant)); r.workoutId = created.workoutId; log(`POST (${variant}): workoutId=${created.workoutId}`);
    const got = await tp.getWorkoutDetail(PROBE_ATHLETE, created.workoutId);
    log(`GET: athleteId=${JSON.stringify(got.athleteId)} isHidden=${JSON.stringify(got.isHidden)} totalTimePlanned=${JSON.stringify(got.totalTimePlanned)} structure=${got.structure === null ? "null" : typeof got.structure}`);
    if (Number(got.athleteId) !== PROBE_ATHLETE) throw new Error(`чужой атлет ${JSON.stringify(got.athleteId)}`);
    if (got.isHidden !== true) throw new Error(`не скрыта: isHidden=${JSON.stringify(got.isHidden)}`);
    const cmp = compareStructures(parseSnap(c.snap)!, got.structure); log(`сверка структуры: ${cmp.ok ? "совпала" : cmp.diffs.join("; ")}`);
    if (!cmp.ok) throw new Error(`структура не совпала: ${cmp.diffs.join("; ")}`);
    if (Math.abs(Number(got.totalTimePlanned) - plannedHours(c.snap)) > 1e-6) throw new Error(`totalTimePlanned ${JSON.stringify(got.totalTimePlanned)} ≠ ${plannedHours(c.snap)}`);
    r.ok = true;
  } catch (e) { r.stopped = e instanceof Error ? e.message : String(e); }
  if (r.workoutId != null) { // удаляем ВСЕГДА (и при успехе: проба не оставляет следов)
    try {
      await tp.deleteWorkout(PROBE_ATHLETE, r.workoutId); log("DELETE");
      try { await tp.getWorkoutDetail(PROBE_ATHLETE, r.workoutId); r.cleaned = false; log("GET после DELETE: тренировка ВСЁ ЕЩЁ читается"); }
      catch (e) { r.cleaned = tp.isGone(e); log(`GET после DELETE: ${r.cleaned ? "удалена (400 Invalid workoutId)" : "ошибка, не похожая на «удалена»"}`); }
    } catch (e) { r.cleaned = false; log(`DELETE упал: ${e instanceof Error ? e.message : String(e)}`); }
    if (r.cleaned !== true) r.ok = false;
  }
  return r;
}

export function buildCases(): Case[] {
  const L = load(); const corpus = buildCorpus(L.rows, L.races, L.sig, L.students, "2026-10-19");
  const w = corpus.find((x) => x.aid === 6009851 && x.weekStart === "2026-10-12"); if (!w) throw new Error("нет недели 12.10 в корпусе");
  const easy = w.sessions.find((s) => s.kind === "easy"), q = w.sessions.find((s) => s.kind === "quality");
  if (!easy || !q) throw new Error("нет лёгкой/качественной в образце");
  const cases: Case[] = [];
  const es = scaleToSeconds(parseSnap(easy.struct)!, 40 * 60); if (!es.ok) throw new Error(es.reason);
  cases.push({ label: "лёгкая 90→40 мин (пересчёт одиночного шага)", minutes: 40, snap: es.snap, note: es.note });
  const qs = scaleToSeconds(parseSnap(q.struct)!, totalSeconds(parseSnap(q.struct)!)); if (!qs.ok) throw new Error(qs.reason);
  cases.push({ label: "интервалы 8 x 4 мин (рецепт как есть)", minutes: Math.round(totalSeconds(qs.snap) / 60), snap: qs.snap, note: qs.note });
  return cases;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2); const real = args.includes("--execute-real");
  const confirm = args.includes("--confirm") ? args[args.indexOf("--confirm") + 1] : null;
  const cases = buildCases(); const out: string[] = []; const p = (s = ""): void => { out.push(s); };
  p(`# Проба копии структуры — ${real ? "ЖИВОЙ ЗАПУСК" : "СУХОЙ ПРОГОН (в TP ничего не пишется, сети нет)"}`); p();
  p(`Атлет ${PROBE_ATHLETE} (тест), день ${PROBE_DAY.slice(0, 10)}, тренировки скрыты и удаляются в конце каждого случая. Источник структуры — реальные снимки образца 12.10 (Ярулина), без ПДн в отчёте.`); p();
  for (const c of cases) {
    p(`## ${c.label}`); p(`- пересчёт: ${c.note}`); p(`- суммарно ${totalSeconds(c.snap)} с = ${plannedHours(c.snap).toFixed(4)} ч (идёт в totalTimePlanned)`);
    p(`- шаги: ${c.snap.structure.map((n) => (n.type === "repetition" ? `${n.length.value}× [${n.steps.map((s) => `${s.name} ${s.length.value}с ${JSON.stringify(s.targets?.map((t) => [t.minValue, t.maxValue]))}`).join(" + ")}]` : n.steps.map((s) => `${s.name} ${s.length.value}с ${JSON.stringify(s.targets?.map((t) => [t.minValue, t.maxValue]))}`).join(""))).join(" → ")}`);
    const b = bodyFor(c, "string"); p("- тело POST (формат A — сериализованная строка), structure показана обрезанной:"); p("```json"); p(JSON.stringify({ ...b, structure: String(b.structure).slice(0, 160) + `… (${String(b.structure).length} симв.)` }, null, 1)); p("```"); p();
  }
  p(`## Порядок запуска (после слова Игоря)`);
  p(`1. Случай «лёгкая 90→40», формат A (строка): POST скрытой → GET → сверка шагов/целей/суммарных секунд/totalTimePlanned → DELETE → GET (ждём 400 «Invalid workoutId»).`);
  p(`2. Если A прошёл — случай «интервалы 8×4», формат A. Если A НЕ прошёл (TP не принял строку или вернул иное) — тот же случай 1 в формате B (объект); выбранный формат записывается в отчёт.`);
  p(`3. Любое расхождение — СТОП, созданное удаляется и это проверяется. Следов в календаре тест-атлета не остаётся; чужие атлеты не затрагиваются (атлет жёстко ${PROBE_ATHLETE}).`);
  p(`Запуск: TP_ACTIONS_REAL_EXECUTION=true tsx probe-structure-copy.ts --execute-real --confirm "${PROBE_CONFIRM}"`);
  if (real) {
    if (confirm !== PROBE_CONFIRM || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.log(out.join("\n")); console.error("\nОТКАЗ: нужны --confirm \"" + PROBE_CONFIRM + "\" и TP_ACTIONS_REAL_EXECUTION=true. Ничего не записано."); process.exit(2); }
    const { liveClient } = await import("./tp-live-client.ts"); const tp = await liveClient(); const results: CaseResult[] = [];
    let variant: "string" | "object" = "string";
    const first = await runCase(tp, cases[0], "string"); results.push(first);
    if (!first.ok) { variant = "object"; results.push(await runCase(tp, cases[0], "object")); }
    const good = results.at(-1)!;
    if (good.ok) results.push(await runCase(tp, cases[1], variant));
    p(); p(`## РЕЗУЛЬТАТ (дословно)`); for (const r of results) { p(`### ${r.label} · формат ${r.variant}: ${r.ok ? "ПРОШЁЛ" : "НЕ ПРОШЁЛ"}${r.stopped ? ` — ${r.stopped}` : ""}`); for (const s of r.steps) p(`- ${s}`); p(`- удалена и проверено: ${r.cleaned}`); }
    p(); p(`Выбранный формат: ${results.every((r) => r.ok || r.variant !== variant) && results.some((r) => r.ok) ? variant : "НЕ ВЫЯСНЕН"}`);
  }
  mkdirSync(path.join(OUT_DIR, "probe"), { recursive: true });
  writeFileSync(path.join(OUT_DIR, "probe", `structure-copy-${real ? "real" : "dry"}.md`), out.join("\n") + "\n");
  console.log(out.join("\n"));
}
if (process.argv[1]?.endsWith("probe-structure-copy.ts")) main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
