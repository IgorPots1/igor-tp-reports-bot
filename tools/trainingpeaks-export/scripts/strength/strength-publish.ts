/**
 * ПУБЛИКАЦИЯ (ОТКРЫТИЕ) СИЛОВЫХ ПО МАНИФЕСТУ. PUT /rx/activity/v1/workouts/updateHidden { isHidden:false, workoutId } — как веб-клиент TP.
 * По умолчанию СУХО: только GET — что сейчас в TP (дата, название, скрыта ли, менял ли тренер) и что было бы отправлено.
 * Удалённое тренером назад не возвращается; уже открытое не трогается повторно.
 * Открыть: TP_ACTIONS_REAL_EXECUTION=true tsx strength-publish.ts --run <manifest.json> [...] --execute-real --confirm "ОТКРЫТЬ СИЛОВЫЕ"
 * Проба на тест-атлете (создать скрытой → открыть → прочитать → удалить → 404):
 *   TP_ACTIONS_REAL_EXECUTION=true tsx strength-publish.ts --probe --confirm "ПРОБА ОТКРЫТИЯ 3102415"
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildBody, type PlanWeek } from "./strength-body.ts";

const HERE = path.dirname(new URL(import.meta.url).pathname); const REPO = path.resolve(HERE, "../../../..");
const tp = await import(`${REPO}/src/features/trainingpeaks/tp-api-client.ts`) as {
  getTpApiJsonRaw: (h: "strength", p: string) => Promise<{ status: number; body: unknown }>; getStrengthWorkout: (id: string) => Promise<Record<string, unknown>>;
  createStrengthWorkout: (b: Record<string, unknown>) => Promise<Record<string, unknown>>; deleteWorkout: (h: "strength", a: number, id: number) => Promise<{ status: number; body: unknown }>;
  setStrengthWorkoutHidden: (id: number, hidden: boolean) => Promise<Record<string, unknown>>;
};
type Item = { athleteId: number; label: string; date: string; workoutId: string | null; verified: boolean; hidden?: boolean };
type Run = { runId: string; items: Item[]; deleted: string[]; published?: string[] };
const args = process.argv.slice(2); const flag = (n: string): boolean => args.includes(`--${n}`); const val = (n: string): string | null => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? null : null; };
const runs = args.flatMap((a, i) => (args[i - 1] === "--run" ? [a] : []));
const gate = (phrase: string): void => { if (val("confirm") !== phrase || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.error(`ОТКАЗ: нужны --confirm "${phrase}" и TP_ACTIONS_REAL_EXECUTION=true`); process.exit(2); } };

if (flag("probe")) {
  gate("ПРОБА ОТКРЫТИЯ 3102415"); const A = 3102415, D = "2026-11-30";
  const cal = async () => { const r = await tp.getTpApiJsonRaw("strength", `/rx/activity/v1/workouts/calendar/${A}/${D}/${D}`); return (r.body as Array<Record<string, unknown>>).map((x) => String(x.id)); };
  console.log(`0. календарь ${A} на ${D}: ${(await cal()).length ? "НЕ ПУСТО — стоп" : "пусто"}`); if ((await cal()).length) process.exit(4);
  const wk: PlanWeek = { week: 1, phase: "probe", workoutTitle: "ПРОБА ОТКРЫТИЯ — будет удалена", instructions: null, blocks: [{ blockType: "SingleExercise", coachNotes: null, prescriptions: [{ exerciseId: "26", title: "Single Leg Calf Raise", parameter: "RepsPerSide", libraryParameterId: "88", sets: 2, prescribedValue: "10", coachNotes: null }] }] };
  const body = await buildBody(wk, { athleteId: A, date: D, hidden: true, forWrite: true, get: (p) => tp.getTpApiJsonRaw("strength", p) });
  let id: string | null = null;
  try {
    const s = await tp.createStrengthWorkout(body); id = String(s.id); console.log(`1. POST workouts/save: id=${id}, isHidden=${JSON.stringify(s.isHidden)}`);
    const g0 = await tp.getStrengthWorkout(id); console.log(`2. GET: isHidden=${JSON.stringify(g0.isHidden)} (ждали true)`);
    const put = await tp.setStrengthWorkoutHidden(Number(id), false); console.log(`3. PUT workouts/updateHidden {isHidden:false}: ответ ${JSON.stringify(put).slice(0, 160)}`);
    const g1 = await tp.getStrengthWorkout(id); console.log(`4. GET: isHidden=${JSON.stringify(g1.isHidden)} (ждали false); блоков ${(g1.blocks as unknown[]).length}, название «${String(g1.title)}», дата ${String(g1.prescribedDate)} — содержимое ${(g1.blocks as unknown[]).length === 1 ? "не потеряно" : "ИЗМЕНИЛОСЬ"}`);
    const put2 = await tp.setStrengthWorkoutHidden(Number(id), true); const g2 = await tp.getStrengthWorkout(id); console.log(`5. обратно скрыть: PUT ${JSON.stringify(put2).slice(0, 60)}… → GET isHidden=${JSON.stringify(g2.isHidden)} (ждали true)`);
  } catch (e) { console.log(`ОШИБКА: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`); }
  for (const x of [...new Set([...(id ? [id] : []), ...(await cal())])]) { const d = await tp.deleteWorkout("strength", A, Number(x)); const g = await tp.getTpApiJsonRaw("strength", `/rx/activity/v1/workouts/${x}`); console.log(`6. DELETE ${x}: HTTP ${d.status}; GET после: HTTP ${g.status}`); }
  console.log(`7. календарь ${D} после: ${(await cal()).length ? "НЕ ПУСТО" : "пусто"}`);
  process.exit(0);
}

const real = flag("execute-real"); if (real) gate("ОТКРЫТЬ СИЛОВЫЕ");
for (const f of runs) {
  const run = JSON.parse(readFileSync(f, "utf8")) as Run; run.published ??= [];
  console.log(`\n# ${path.basename(f)} — ${real ? "ОТКРЫВАЮ" : "СУХОЙ ПРОГОН (только чтение)"}`);
  for (const it of run.items.filter((x) => x.workoutId && !run.deleted.includes(x.workoutId))) {
    const g = await tp.getTpApiJsonRaw("strength", `/rx/activity/v1/workouts/${it.workoutId}`);
    if (g.status === 404) { console.log(`- ${it.label} ${it.date} ${it.workoutId}: в TP уже нет (удалена тренером) — назад не возвращаю`); continue; }
    const w = (g.body as { data?: Record<string, unknown> }).data ?? {};
    const moved = String(w.prescribedDate).slice(0, 10) !== it.date ? ` · тренер перенёс на ${String(w.prescribedDate).slice(0, 10)}` : "";
    if (w.isHidden === false) { console.log(`- ${it.label} ${it.date} ${it.workoutId}: уже открыта${moved} — не трогаю`); continue; }
    if (!real) { console.log(`- ${it.label} ${it.date} ${it.workoutId} «${String(w.title)}» · сейчас isHidden=${JSON.stringify(w.isHidden)}${moved} · БУДЕТ открыта: PUT workouts/updateHidden {"isHidden":false,"workoutId":${it.workoutId}}`); continue; }
    await tp.setStrengthWorkoutHidden(Number(it.workoutId), false); const back = await tp.getStrengthWorkout(it.workoutId!);
    if (back.isHidden !== false) { console.error(`- ${it.label} ${it.date} ${it.workoutId}: после PUT isHidden=${JSON.stringify(back.isHidden)} — СТОП`); process.exit(1); }
    run.published.push(it.workoutId!); writeFileSync(f, JSON.stringify(run, null, 2)); console.log(`- ${it.label} ${it.date} ${it.workoutId}: открыта, проверено чтением (isHidden=false)`);
  }
}
