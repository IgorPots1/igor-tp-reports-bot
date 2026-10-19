/**
 * ПОКАЗ КРУГОВОЙ С ОТДЫХОМ НА ТЕСТ-АТЛЕТЕ 3102415 (Игорь 19.10: «показать, как это выглядит у ученика в приложении, на 3102415»).
 * Ставится «Основная», неделя 1, круговая. Чтобы её можно было увидеть в приложении тест-атлета, она ОТКРЫТА (isHidden=false) —
 * только у 3102415, это тестовый аккаунт, не ученик. Остаётся в календаре до слова «удалить показ» (--remove), id пишется в манифест.
 * Сухо по умолчанию. Живой: TP_ACTIONS_REAL_EXECUTION=true tsx show-circuit.ts --execute-real --confirm "ПОКАЗ КРУГОВОЙ 3102415"
 * Удалить: TP_ACTIONS_REAL_EXECUTION=true tsx show-circuit.ts --remove --confirm "ПОКАЗ КРУГОВОЙ 3102415"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildBody, loadPrograms, signatureOf, studentText } from "./strength-body.ts";

const CANON = "/Users/igor/igor-tp-reports-bot";
const ATHLETE = 3102415; const DATE = "2026-10-21"; const CONFIRM = "ПОКАЗ КРУГОВОЙ 3102415";
const OUT = path.join(CANON, "reports", "strength", "show-circuit"); const MAN = path.join(OUT, "manifest.json");

const args = process.argv.slice(2); const real = args.includes("--execute-real"); const remove = args.includes("--remove");
const confirm = args.includes("--confirm") ? args[args.indexOf("--confirm") + 1] : null;
const tp = await import(`${CANON}/src/features/trainingpeaks/tp-api-client.ts`) as {
  createStrengthWorkout: (b: Record<string, unknown>) => Promise<Record<string, unknown>>; getStrengthWorkout: (id: string) => Promise<Record<string, unknown>>;
  deleteWorkout: (h: "strength", a: number, id: number) => Promise<{ status: number; body: unknown }>; getTpApiJsonRaw: (h: "strength", p: string) => Promise<{ status: number; body: unknown }>;
};
const get = (p: string) => tp.getTpApiJsonRaw("strength", p);
const calendar = async (): Promise<Array<{ id: string; title: string }>> => { const r = await get(`/rx/activity/v1/workouts/calendar/${ATHLETE}/${DATE}/${DATE}`); if (r.status !== 200) throw new Error(`календарь HTTP ${r.status}`); return (Array.isArray(r.body) ? r.body : []).map((x) => ({ id: String((x as Record<string, unknown>).id), title: String((x as Record<string, unknown>).title) })); };
const gate = (): void => { if (confirm !== CONFIRM || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.error(`ОТКАЗ: нужны --confirm "${CONFIRM}" и TP_ACTIONS_REAL_EXECUTION=true`); process.exit(2); } };

if (remove) {
  gate(); const m = JSON.parse(readFileSync(MAN, "utf8")) as { id: string };
  const d = await tp.deleteWorkout("strength", ATHLETE, Number(m.id)); console.log(`DELETE ${m.id}: HTTP ${d.status}`);
  const g = await get(`/rx/activity/v1/workouts/${m.id}`); console.log(`GET после: HTTP ${g.status}`); console.log(`календарь ${DATE}: ${(await calendar()).length ? "НЕ ПУСТО" : "пусто"}`);
  process.exit(0);
}
const week = loadPrograms().programs.find((p) => p.id === "main")!.formats.circuit[0];
const body = await buildBody(week, { athleteId: ATHLETE, date: DATE, hidden: false, get });
if (Number(body.calendarId) !== ATHLETE) throw new Error("атлет не 3102415");
console.log("=== КАК УВИДИТ УЧЕНИК (из тела запроса) ===\n" + studentText(body));
if (!real) { console.log(`\nСУХО. Живой: TP_ACTIONS_REAL_EXECUTION=true tsx show-circuit.ts --execute-real --confirm "${CONFIRM}"`); process.exit(0); }
gate(); mkdirSync(OUT, { recursive: true }); if (existsSync(MAN)) { console.error(`ОТКАЗ: показ уже поставлен (${MAN})`); process.exit(3); }
const before = await calendar(); console.log(`\n0. календарь ${ATHLETE} на ${DATE}: ${before.length ? before.map((x) => x.title).join("; ") : "пусто"}`); if (before.length) { console.error("СТОП: не пусто"); process.exit(4); }
const saved = await tp.createStrengthWorkout(body); const id = String(saved.id); writeFileSync(MAN, JSON.stringify({ id, athleteId: ATHLETE, date: DATE, createdAt: new Date().toISOString() }));
console.log(`1. POST workouts/save: id=${id}, isHidden=${JSON.stringify(saved.isHidden)}`);
const got = await tp.getStrengthWorkout(id); writeFileSync(path.join(OUT, "read.json"), JSON.stringify(got, null, 2));
const same = signatureOf(body) === signatureOf(got);
console.log(`2. GET workouts/${id}: блоков ${(got.blocks as unknown[]).length}, тип ${JSON.stringify((got.blocks as Array<Record<string, unknown>>).map((b) => b.blockType))}, isHidden=${JSON.stringify(got.isHidden)}`);
console.log(`3. сверка (название, описание, заметки блока и упражнений, упражнения, значения подходов, скрытие, атлет, дата): ${same ? "совпала" : "РАСХОЖДЕНИЕ"}`);
if (!same) { console.log("  записано:", signatureOf(body)); console.log("  прочитано:", signatureOf(got)); }
const after = await calendar(); console.log(`4. календарь ${DATE}: ${after.map((x) => `${x.id} «${x.title}»`).join("; ")}`);
console.log("\n=== КАК УВИДИТ УЧЕНИК (прочитано из TP) ===\n" + studentText(got));
