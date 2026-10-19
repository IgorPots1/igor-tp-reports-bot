/**
 * ПОСТАНОВКА СИЛОВЫХ АТЛЕТАМ (наряд Игоря 19.10). По умолчанию СУХО: показывает тренировки полным текстом, сети на запись нет.
 * Живой: TP_ACTIONS_REAL_EXECUTION=true tsx strength-place.ts --plan <plan.json> --execute-real --confirm "ПОСТАВИТЬ СИЛОВЫЕ СКРЫТО"
 * Снести по манифесту: TP_ACTIONS_REAL_EXECUTION=true tsx strength-place.ts --snesti <run.json> --confirm "СНЕСТИ СИЛОВЫЕ"
 * Гарантии: только атлеты из плана; перед каждой — в календаре силовых на этот день пусто; создаётся СКРЫТОЙ; после каждой — GET и
 * сверка (название, описание, заметки, упражнения, значения подходов, скрытие, атлет, дата); любое расхождение — откат ВСЕГО прогона
 * (удаление и проверка 404). Манифест пишется после каждой записи.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildBody, loadPrograms, signatureOf, studentText, type PlanWeek } from "./strength-body.ts";

const CANON = "/Users/igor/igor-tp-reports-bot";
const RUNS = path.join(CANON, "reports", "strength", "runs");
/** inline — разовая тренировка вне программ (свой состав); hidden=false — видимой ученику (только по слову Игоря). */
export type PlanItem = { athleteId: number; label: string; programId: string; format: "classic" | "circuit"; week: number; date: string; inline?: PlanWeek; hidden?: boolean };
type Run = { runId: string; mode: "dry" | "real"; items: Array<PlanItem & { workoutId: string | null; verified: boolean }>; deleted: string[] };

const args = process.argv.slice(2); const arg = (n: string): string | null => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? null : null; };
const tp = await import(`${CANON}/src/features/trainingpeaks/tp-api-client.ts`) as {
  createStrengthWorkout: (b: Record<string, unknown>) => Promise<Record<string, unknown>>; getStrengthWorkout: (id: string) => Promise<Record<string, unknown>>;
  deleteWorkout: (h: "strength", a: number, id: number) => Promise<{ status: number; body: unknown }>; getTpApiJsonRaw: (h: "strength", p: string) => Promise<{ status: number; body: unknown }>;
};
const get = (p: string) => tp.getTpApiJsonRaw("strength", p);
const dayList = async (aid: number, d: string): Promise<Array<{ id: string; title: string }>> => { const r = await get(`/rx/activity/v1/workouts/calendar/${aid}/${d}/${d}`); if (r.status !== 200) throw new Error(`календарь ${aid} ${d}: HTTP ${r.status}`); return (Array.isArray(r.body) ? r.body : []).map((x) => ({ id: String((x as Record<string, unknown>).id), title: String((x as Record<string, unknown>).title) })); };
const save = (r: Run): void => { mkdirSync(RUNS, { recursive: true }); writeFileSync(path.join(RUNS, `${r.runId}.json`), JSON.stringify(r, null, 2)); };
async function del(aid: number, id: string): Promise<boolean> { await tp.deleteWorkout("strength", aid, Number(id)); const g = await get(`/rx/activity/v1/workouts/${id}`); return g.status === 404; }

if (arg("snesti")) {
  if (arg("confirm") !== "СНЕСТИ СИЛОВЫЕ" || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.error("ОТКАЗ: нужна фраза и TP_ACTIONS_REAL_EXECUTION=true"); process.exit(2); }
  const r = JSON.parse(readFileSync(arg("snesti")!, "utf8")) as Run;
  for (const it of r.items.filter((x) => x.workoutId && !r.deleted.includes(x.workoutId))) { const ok = await del(it.athleteId, it.workoutId!); if (ok) r.deleted.push(it.workoutId!); save(r); console.log(`${it.label} ${it.date} ${it.workoutId}: ${ok ? "удалена (404)" : "НЕ УДАЛЕНА — убрать вручную"}`); }
  process.exit(0);
}

const plan = JSON.parse(readFileSync(arg("plan")!, "utf8")) as PlanItem[];
const real = args.includes("--execute-real");
const run: Run = { runId: `strength-${Date.now()}`, mode: real ? "real" : "dry", items: plan.map((p) => ({ ...p, workoutId: null, verified: false })), deleted: [] };
const progs = loadPrograms();
const bodies: Record<string, unknown>[] = [];
for (const it of run.items) {
  const prog = it.inline ? null : progs.programs.find((p) => p.id === it.programId); if (!it.inline && !prog) throw new Error(`нет программы ${it.programId}`);
  const wk = it.inline ?? prog!.formats[it.format].find((w) => w.week === it.week); if (!wk) throw new Error(`нет недели ${it.week}`);
  const b = await buildBody(wk, { athleteId: it.athleteId, date: it.date, hidden: it.hidden !== false, forWrite: real, get }); bodies.push(b);
  console.log(`\n======== ${it.label} · ${it.inline ? "разовая тренировка" : `программа «${prog!.title}», ${it.format === "classic" ? "классика" : "круговая"}, неделя ${it.week}`} · ${it.hidden === false ? "ВИДИМОЙ ученику" : "скрыто"} ========\n${studentText(b)}`);
}
const PHRASE = run.items.some((x) => x.hidden === false) ? "ПОСТАВИТЬ СИЛОВЫЕ ВИДИМЫМИ" : "ПОСТАВИТЬ СИЛОВЫЕ СКРЫТО";
if (!real) { console.log(`\nСУХО, ничего не записано. Живой: TP_ACTIONS_REAL_EXECUTION=true tsx strength-place.ts --plan ${arg("plan")} --execute-real --confirm "${PHRASE}"`); process.exit(0); }
if (arg("confirm") !== PHRASE || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.error("ОТКАЗ: нужна фраза и TP_ACTIONS_REAL_EXECUTION=true"); process.exit(2); }
save(run);
const rollback = async (why: string): Promise<never> => {
  console.error(`СТОП: ${why}. Откат всего прогона:`);
  for (const it of run.items.filter((x) => x.workoutId && !run.deleted.includes(x.workoutId))) { const ok = await del(it.athleteId, it.workoutId!); if (ok) run.deleted.push(it.workoutId!); save(run); console.error(`  ${it.label} ${it.date} ${it.workoutId}: ${ok ? "удалена (404)" : "НЕ УДАЛЕНА — убрать вручную"}`); }
  process.exit(1);
};
for (let i = 0; i < run.items.length; i++) {
  const it = run.items[i]; const b = bodies[i];
  const before = await dayList(it.athleteId, it.date); if (before.length) await rollback(`${it.label} ${it.date}: в календаре силовых уже есть ${before.map((x) => `«${x.title}»`).join(", ")}`);
  let saved: Record<string, unknown>;
  try { saved = await tp.createStrengthWorkout(b); } catch (e) { await rollback(`${it.label} ${it.date}: POST упал: ${e instanceof Error ? e.message.slice(0, 200) : e}`); throw e; }
  it.workoutId = String(saved.id); save(run);
  const got = await tp.getStrengthWorkout(it.workoutId);
  if (signatureOf(got) !== signatureOf(b)) await rollback(`${it.label} ${it.date} ${it.workoutId}: прочитанное не совпало с записанным`);
  if (got.isHidden !== (it.hidden !== false)) await rollback(`${it.label} ${it.date} ${it.workoutId}: isHidden=${String(got.isHidden)}, ждали ${String(it.hidden !== false)}`);
  const after = await dayList(it.athleteId, it.date); if (after.length !== 1) await rollback(`${it.label} ${it.date}: силовых в дне ${after.length}, ждали 1 (дубль от повтора POST?)`);
  it.verified = true; save(run);
  console.log(`поставлена ${it.label} ${it.date} id=${it.workoutId} · isHidden=${String(got.isHidden)} · сверка совпала · в дне ровно одна силовая`);
}
console.log(`\nМанифест: ${path.join(RUNS, `${run.runId}.json`)}`);
