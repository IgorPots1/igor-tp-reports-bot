/**
 * ПРОБА ВЕСА В КГ (Игорь 19.10: «вес в кг числом, проверить на 3102415, что сохраняется и читается»). Только 3102415, скрыто, удаление за собой.
 * У системных упражнений вес в библиотеке только в фунтах — WeightKg добавляется как параметр вне набора (без id библиотеки), как тренер
 * добавлял Duration; у собственного упражнения тренера «Leg curl machine» WeightKg свой. Дробный вес (42.5) проверяется отдельно.
 * Живой: TP_ACTIONS_REAL_EXECUTION=true tsx probe-kg.ts --execute-real --confirm "ПРОБА КГ 3102415"
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildBody, signatureOf, studentText, type PlanWeek } from "./strength-body.ts";

const CANON = "/Users/igor/igor-tp-reports-bot"; const ATHLETE = 3102415; const DATE = "2026-11-30"; const CONFIRM = "ПРОБА КГ 3102415";
const OUT = path.join(CANON, "reports", "strength", "probe-kg");
const tp = await import(`${CANON}/src/features/trainingpeaks/tp-api-client.ts`) as {
  createStrengthWorkout: (b: Record<string, unknown>) => Promise<Record<string, unknown>>; getStrengthWorkout: (id: string) => Promise<Record<string, unknown>>;
  deleteWorkout: (h: "strength", a: number, id: number) => Promise<{ status: number; body: unknown }>; getTpApiJsonRaw: (h: "strength", p: string) => Promise<{ status: number; body: unknown }>;
};
const get = (p: string) => tp.getTpApiJsonRaw("strength", p);
const kg = (v: string, lib: string | null = null) => [{ parameter: "WeightKg", libraryParameterId: lib, prescribedValue: v }];
const week: PlanWeek = { week: 1, phase: "probe", workoutTitle: "ПРОБА КГ — будет удалена", instructions: "Проба записи веса в кг, не тренировка.", blocks: [
  { blockType: "SingleExercise", coachNotes: null, prescriptions: [{ exerciseId: "16", title: "Bench Press", parameter: "Reps", libraryParameterId: null, sets: 3, prescribedValue: "10", coachNotes: "проба", extra: kg("35") }] },
  { blockType: "SingleExercise", coachNotes: null, prescriptions: [{ exerciseId: "935", title: "Wide Grip Lat Pulldown", parameter: "Reps", libraryParameterId: null, sets: 3, prescribedValue: "10", coachNotes: "проба", extra: kg("42.5") }] },
  { blockType: "SingleExercise", coachNotes: null, prescriptions: [{ exerciseId: "387590", title: "Leg curl machine", parameter: "Reps", libraryParameterId: "680620", sets: 3, prescribedValue: "12", coachNotes: "проба", extra: kg("30", "680621") }] },
  { blockType: "SingleExercise", coachNotes: null, prescriptions: [{ exerciseId: "73", title: "Pull Up", parameter: "Reps", libraryParameterId: null, sets: 2, prescribedValue: "4", coachNotes: "проба" }] },
] };
// id параметров библиотеки берутся из самого упражнения при сборке; null в плане значит «искать по имени параметра»
for (const b of week.blocks) for (const p of b.prescriptions) p.libraryParameterId = p.libraryParameterId ?? null;
const body = await buildBody(week, { athleteId: ATHLETE, date: DATE, hidden: true, get });
console.log("=== тело (как увидит ученик) ===\n" + studentText(body));
console.log("\nпараметры по упражнениям:", JSON.stringify((body.blocks as Array<Record<string, unknown>>).map((b) => ((b.prescriptions as Array<Record<string, unknown>>)[0].parameters as Array<Record<string, unknown>>).map((x) => x.parameter))));
if (!process.argv.includes("--execute-real")) { console.log(`\nСУХО. Живой: TP_ACTIONS_REAL_EXECUTION=true tsx probe-kg.ts --execute-real --confirm "${CONFIRM}"`); process.exit(0); }
const ci = process.argv.indexOf("--confirm"); if (process.argv[ci + 1] !== CONFIRM || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.error("ОТКАЗ"); process.exit(2); }
mkdirSync(OUT, { recursive: true }); const lock = path.join(OUT, "probe.lock"); if (existsSync(lock)) { console.error("ОТКАЗ: уже запускалась"); process.exit(3); } writeFileSync(lock, new Date().toISOString());
const cal = async () => { const r = await get(`/rx/activity/v1/workouts/calendar/${ATHLETE}/${DATE}/${DATE}`); if (r.status !== 200) throw new Error(`календарь HTTP ${r.status}`); return (r.body as Array<Record<string, unknown>>).map((x) => String(x.id)); };
console.log(`\n0. календарь ${DATE}: ${(await cal()).length ? "НЕ ПУСТО" : "пусто"}`); if ((await cal()).length) process.exit(4);
let id: string | null = null;
try {
  const s = await tp.createStrengthWorkout(body); id = String(s.id); console.log(`1. POST workouts/save: id=${id}, isHidden=${JSON.stringify(s.isHidden)}`);
  const g = await tp.getStrengthWorkout(id); writeFileSync(path.join(OUT, "read.json"), JSON.stringify(g, null, 2));
  const kgRead = (g.blocks as Array<Record<string, unknown>>).map((b) => { const p = (b.prescriptions as Array<Record<string, unknown>>)[0]; const s0 = (p.sets as Array<Record<string, unknown>>)[0]; return `${String((p.exercise as Record<string, unknown>).title)}: ${((s0.parameterValues as Array<Record<string, unknown>>)).map((v) => `${String(v.parameter)}=${JSON.stringify(v.prescribedValue)}/${String(v.inputFormat)}`).join(", ")}`; });
  console.log(`2. GET workouts/${id}: isHidden=${JSON.stringify(g.isHidden)} calendarId=${JSON.stringify(g.calendarId)}\n   ${kgRead.join("\n   ")}`);
  const same = signatureOf(body) === signatureOf(g); console.log(`3. сверка (упражнения, ВСЕ параметры и значения каждого подхода, включая кг и 42.5): ${same ? "совпала" : "РАСХОЖДЕНИЕ"}`);
  if (!same) { console.log("   записано:", signatureOf(body)); console.log("   прочитано:", signatureOf(g)); }
  console.log("\n=== как увидит ученик (прочитано из TP) ===\n" + studentText(g));
} catch (e) { console.log(`ОШИБКА: ${e instanceof Error ? e.message.slice(0, 400) : String(e)}`); }
const ids = [...new Set([...(id ? [id] : []), ...(await cal())])];
for (const x of ids) { const d = await tp.deleteWorkout("strength", ATHLETE, Number(x)); const a = await get(`/rx/activity/v1/workouts/${x}`); console.log(`4. DELETE ${x}: HTTP ${d.status}; 5. GET после: HTTP ${a.status}`); }
console.log(`6. календарь ${DATE} после: ${(await cal()).length ? "НЕ ПУСТО" : "пусто"}`);
