/**
 * СОЗДАНИЕ СВОИХ УПРАЖНЕНИЙ ТРЕНЕРА В БИБЛИОТЕКЕ TP (для «Зала с весами»: жим ногами, разгибание ног, носки в тренажёре — в библиотеке TP их нет).
 * Контракт — из кода веб-клиента TP (release-20261016): getNewExerciseModel = POST /rx/activity/v1/exercises (без тела, пустая модель),
 * createNewExercise = PUT /rx/activity/v1/exercises (заполненная модель). Живьём не проверялось до первого запуска — поэтому по одному,
 * с чтением после каждого: GET exercises/{id} — название, владелец = тренер, параметры Reps + WeightKg.
 * Уже есть в custom-exercises.json или в библиотеке с тем же названием — не создаётся повторно.
 * По умолчанию СУХО. Живой: TP_ACTIONS_REAL_EXECUTION=true tsx create-custom-exercises.ts --execute-real --confirm "СОЗДАТЬ СВОИ УПРАЖНЕНИЯ"
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const CANON = "/Users/igor/igor-tp-reports-bot"; const HERE = path.dirname(new URL(import.meta.url).pathname);
const MAP = path.join(CANON, "reports", "strength", "custom-exercises.json"); const COACH = 5457637; const CONFIRM = "СОЗДАТЬ СВОИ УПРАЖНЕНИЯ";
const defs: Record<string, { title: string; parameters: string[] }> = Object.assign({}, ...readdirSync(HERE).filter((f) => /^program-.+\.json$/.test(f)).sort().map((f) => (JSON.parse(readFileSync(path.join(HERE, f), "utf8")) as { custom?: Record<string, { title: string; parameters: string[] }> }).custom ?? {}));
const PDEF = ((): Array<Record<string, unknown>> => { const p = JSON.parse(readFileSync(path.join(CANON, "reports", "strength", "probe", "parameters-exercise.json"), "utf8")); const b = p.body ?? p; return (b.data ?? b) as Array<Record<string, unknown>>; })();
const map: Record<string, string> = existsSync(MAP) ? JSON.parse(readFileSync(MAP, "utf8")) : {};
const real = process.argv.includes("--execute-real"); const ci = process.argv.indexOf("--confirm");
const todo = Object.entries(defs).filter(([k]) => !map[k]);
console.log(`уже созданы: ${Object.keys(map).length ? JSON.stringify(map) : "нет"}; создать: ${todo.map(([, d]) => `«${d.title}» (${d.parameters.join(" + ")})`).join(", ") || "нечего"}`);
if (!real) { console.log(`СУХО. Порядок на каждое: POST exercises → заполнить title/parameters/ownerId → PUT exercises → GET exercises/{id} → сверка.\nЖивой: TP_ACTIONS_REAL_EXECUTION=true tsx create-custom-exercises.ts --execute-real --confirm "${CONFIRM}"`); process.exit(0); }
if (process.argv[ci + 1] !== CONFIRM || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.error("ОТКАЗ: нужна фраза и TP_ACTIONS_REAL_EXECUTION=true"); process.exit(2); }
const REPO = path.resolve(HERE, "../../../.."); // клиент из СВОЕЙ ветки: в нём есть функции создания упражнения
const tp = await import(`${REPO}/src/features/trainingpeaks/tp-api-client.ts`) as { getTpApiJsonRaw: (h: "strength", p: string) => Promise<{ status: number; body: unknown }> };
const client = await import(`${REPO}/src/features/trainingpeaks/tp-api-client.ts`) as { newStrengthExerciseModel?: () => Promise<Record<string, unknown>>; createStrengthExercise?: (m: Record<string, unknown>) => Promise<Record<string, unknown>> };
if (!client.newStrengthExerciseModel || !client.createStrengthExercise) { console.error("СТОП: в каноническом tp-api-client нет newStrengthExerciseModel/createStrengthExercise — клиент ветки не тот"); process.exit(5); }
const lib = await tp.getTpApiJsonRaw("strength", "/rx/activity/v1/libraryContent");
const titles = JSON.stringify(lib.body);
for (const [key, d] of todo) {
  if (titles.includes(`"title":"${d.title}"`)) { console.log(`«${d.title}»: в библиотеке уже есть — не создаю, сопоставлю вручную`); continue; }
  const m = await client.newStrengthExerciseModel();
  console.log(`1. POST exercises (пустая модель): ключи ${Object.keys(m).join(",")}; id=${JSON.stringify(m.id)}`);
  const body = { ...m, title: d.title, ownerId: COACH, instructions: "", videoUrl: m.videoUrl ?? null, parameters: d.parameters.map((n) => ({ ...(PDEF.find((x) => x.parameter === n) as Record<string, unknown>), id: "0" })) };
  const s = await client.createStrengthExercise(body); const id = String(s.id);
  console.log(`2. PUT exercises: id=${id}`);
  const g = await tp.getTpApiJsonRaw("strength", `/rx/activity/v1/exercises/${id}`); const gd = ((g.body as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
  const params = ((gd.parameters as Array<Record<string, unknown>>) ?? []).map((x) => String(x.parameter));
  const ok = g.status === 200 && gd.title === d.title && Number(gd.ownerId) === COACH && JSON.stringify(params) === JSON.stringify(d.parameters);
  console.log(`3. GET exercises/${id}: HTTP ${g.status}, title «${String(gd.title)}», ownerId ${String(gd.ownerId)}, параметры ${params.join("+")} → ${ok ? "сверка совпала" : "РАСХОЖДЕНИЕ — СТОП"}`);
  if (!ok) process.exit(6);
  map[key] = id; writeFileSync(MAP, JSON.stringify(map, null, 2));
  writeFileSync(path.join(CANON, "reports", "strength", "exercises", `${id}.json`), JSON.stringify(g, null, 2));
}
console.log(`сопоставление: ${JSON.stringify(map)}`);
