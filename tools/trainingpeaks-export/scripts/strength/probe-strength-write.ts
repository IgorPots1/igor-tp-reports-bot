/**
 * ПРОБА ЗАПИСИ СИЛОВОЙ (наряд Игоря 19.10, шаг 0). Только тест-атлет 3102415, скрыто, удаление за собой.
 * Два случая: A — классика (3 блока SingleExercise), B — круговая (один блок Circuit, 3 упражнения × 3 круга; в практике Игоря не встречался ни разу).
 * Цикл на случай: проверить, что календарь на дату пуст → POST workouts/save → GET workouts/{id} → сверить → DELETE → GET (удалена) → календарь пуст.
 * Дубль от повтора POST (общий fetch повторяет при 408/429/5xx) ловится по календарю и удаляется как созданный этой же пробой.
 * Повторный запуск запрещён lock-файлом. По умолчанию СУХАЯ (печатает тела, сети нет).
 * Живой: TP_ACTIONS_REAL_EXECUTION=true tsx probe-strength-write.ts --execute-real --confirm "ПРОБА СИЛОВОЙ 3102415"
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const CANON = "/Users/igor/igor-tp-reports-bot";
export const ATHLETE = 3102415;
export const CONFIRM = "ПРОБА СИЛОВОЙ 3102415";
const DATE = "2026-11-30";
const OUT = path.join(CANON, "reports", "strength", "probe-write");
const HOST = "/rx/activity/v1";

type ExParam = { parameter: string; title: string; unit: unknown; category: string; range?: unknown; id: string };
type Exercise = { id: string; ownerId: number; title: string; videoUrl: string | null; instructions: string | null; parameters: ExParam[]; canEdit: boolean };
type Want = { exerciseId: string; parameter: string; inputFormat: "Integer" | "Time"; value: string; sets: number; note: string };

function loadExercise(id: string): Exercise {
  const raw = JSON.parse(readFileSync(path.join(CANON, "reports", "strength", "exercises", `${id}.json`), "utf8")) as { body: { data: Exercise } };
  const d = raw.body.data; return { id: String(d.id ?? id), ownerId: d.ownerId, title: d.title, videoUrl: d.videoUrl ?? null, instructions: d.instructions ?? null, parameters: d.parameters, canEdit: !!d.canEdit };
}

function prescription(w: Want): Record<string, unknown> {
  const ex = loadExercise(w.exerciseId); const lib = ex.parameters.find((p) => p.parameter === w.parameter);
  if (!lib) throw new Error(`у упражнения ${ex.title} нет параметра ${w.parameter} в библиотеке`);
  const label = w.parameter === "Duration" ? "{Duration}" : `{${w.parameter}} ${lib.title}`;
  return {
    id: randomUUID(), exercise: ex,
    parameters: [{ parameter: lib.parameter, title: lib.title, unit: lib.unit, category: lib.category, range: lib.range ?? null, id: randomUUID() }],
    sets: Array.from({ length: w.sets }, () => ({ id: randomUUID(), isComplete: false, setOrigin: "Prescribed", parameterValues: [{ id: randomUUID(), parameter: w.parameter, inputFormat: w.inputFormat, range: lib.range ?? null, prescribedValue: w.value, executedValue: null }] })),
    coachNotes: w.note, compliancePercent: 0, setSummaryTemplate: label,
  };
}

const WANTS: Want[] = [
  { exerciseId: "81", parameter: "RepsPerSide", inputFormat: "Integer", value: "15", sets: 3, note: "Без веса" },
  { exerciseId: "26", parameter: "RepsPerSide", inputFormat: "Integer", value: "15", sets: 3, note: "Без веса" },
  { exerciseId: "125", parameter: "Duration", inputFormat: "Time", value: "30", sets: 3, note: "Поясница прижата к стене" },
];

export function buildBody(kind: "classic" | "circuit"): Record<string, unknown> {
  const blocks = kind === "classic"
    ? WANTS.map((w) => ({ id: randomUUID(), blockType: "SingleExercise", title: loadExercise(w.exerciseId).title, coachNotes: null, isComplete: false, compliancePercent: 0, parameters: [], prescriptions: [prescription(w)] }))
    : [{ id: randomUUID(), blockType: "Circuit", title: "Круг", coachNotes: "3 круга", isComplete: false, compliancePercent: 0, parameters: [], prescriptions: WANTS.map(prescription) }];
  const totalSets = WANTS.reduce((a, w) => a + w.sets, 0);
  return {
    workoutType: "StructuredStrength", lastUpdatedAt: null, compliancePercent: 0, rpe: null, feel: null, blocks,
    snapshot: { totalBlocks: blocks.length, completedBlocks: 0, totalSets, completedSets: 0, totalPrescriptions: WANTS.length, completedPrescriptions: 0 },
    prescribedDate: DATE, prescribedStartTime: null, startDateTime: null, completedDateTime: null, calendarId: ATHLETE,
    title: `ПРОБА СИЛОВОЙ (${kind === "classic" ? "классика" : "круг"}) — будет удалена`, instructions: "Проба записи, не тренировка.",
    prescribedDurationInSeconds: null, orderOnDay: null, executedDurationInSeconds: null, isLocked: false, isHidden: true, workoutSubTypeId: null, id: randomUUID(),
  };
}

type Sig = { blocks: Array<{ type: string; ex: Array<{ id: string; param: string; values: string[] }> }>; hidden: unknown; cal: unknown; date: unknown; title: unknown };
export function signature(w: Record<string, unknown>): Sig {
  const bl = (w.blocks as Array<Record<string, unknown>>) ?? [];
  return {
    blocks: bl.map((b) => ({ type: String(b.blockType), ex: ((b.prescriptions as Array<Record<string, unknown>>) ?? []).map((p) => ({
      id: String((p.exercise as Record<string, unknown>)?.id), param: String(((p.parameters as Array<Record<string, unknown>>) ?? [])[0]?.parameter),
      values: ((p.sets as Array<Record<string, unknown>>) ?? []).map((s) => String(((s.parameterValues as Array<Record<string, unknown>>) ?? [])[0]?.prescribedValue)) })) })),
    hidden: w.isHidden, cal: Number(w.calendarId), date: String(w.prescribedDate).slice(0, 10), title: w.title,
  };
}
export function diffSig(a: Sig, b: Sig): string[] {
  const d: string[] = [];
  for (const k of ["hidden", "cal", "date", "title"] as const) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) d.push(`${k}: записано ${JSON.stringify(a[k])}, прочитано ${JSON.stringify(b[k])}`);
  if (JSON.stringify(a.blocks) !== JSON.stringify(b.blocks)) d.push(`блоки: записано ${JSON.stringify(a.blocks)}, прочитано ${JSON.stringify(b.blocks)}`);
  return d;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2); const real = args.includes("--execute-real"); const confirm = args.includes("--confirm") ? args[args.indexOf("--confirm") + 1] : null;
  for (const k of ["classic", "circuit"] as const) { const b = buildBody(k); console.log(`\n## тело ${k}: calendarId=${b.calendarId} isHidden=${b.isHidden} date=${b.prescribedDate} блоков=${(b.blocks as unknown[]).length}`); console.log(JSON.stringify(signature(b))); }
  if (!real) { console.log(`\nСУХО. Живой запуск: TP_ACTIONS_REAL_EXECUTION=true tsx probe-strength-write.ts --execute-real --confirm "${CONFIRM}"`); return; }
  if (confirm !== CONFIRM || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.error("ОТКАЗ: нужна фраза и TP_ACTIONS_REAL_EXECUTION=true"); process.exit(2); }
  mkdirSync(OUT, { recursive: true }); const lock = path.join(OUT, "probe.lock");
  if (existsSync(lock)) { console.error(`ОТКАЗ: проба уже запускалась (${lock}). Повтор — только вручную, после разбора.`); process.exit(3); }
  writeFileSync(lock, new Date().toISOString());
  const tp = await import(`${CANON}/src/features/trainingpeaks/tp-api-client.ts`) as {
    createStrengthWorkout: (b: Record<string, unknown>) => Promise<Record<string, unknown>>; getStrengthWorkout: (id: string) => Promise<Record<string, unknown>>;
    deleteWorkout: (h: "strength", a: number, id: number) => Promise<{ status: number; body: unknown }>; getTpApiJsonRaw: (h: "strength", p: string) => Promise<{ status: number; body: unknown }>;
  };
  const calendar = async (): Promise<Array<{ id: string; title: string }>> => { const r = await tp.getTpApiJsonRaw("strength", `${HOST}/workouts/calendar/${ATHLETE}/${DATE}/${DATE}`); if (r.status !== 200) throw new Error(`календарь: HTTP ${r.status}`); const data = (r.body as { data?: unknown })?.data; const arr = Array.isArray(r.body) ? r.body : Array.isArray(data) ? data : []; return arr.map((x) => ({ id: String((x as Record<string, unknown>).id), title: String((x as Record<string, unknown>).title) })); };
  const log: string[] = []; const say = (s: string): void => { log.push(s); console.log(s); };
  for (const kind of ["classic", "circuit"] as const) {
    say(`\n### случай ${kind === "classic" ? "A — классика" : "B — круговая (Circuit)"}`);
    const before = await calendar(); say(`0. календарь ${ATHLETE} на ${DATE} до записи: ${before.length ? before.map((x) => `${x.id} «${x.title}»`).join("; ") : "пусто"}`);
    if (before.length) { say("СТОП: календарь не пуст — не пишем"); break; }
    const body = buildBody(kind); if (Number(body.calendarId) !== ATHLETE) throw new Error("атлет не 3102415");
    let id: string | null = null;
    try {
      const saved = await tp.createStrengthWorkout(body); id = String(saved.id); say(`1. POST workouts/save: id=${id} (числовой: ${/^\d+$/.test(id)}), isHidden в ответе=${JSON.stringify(saved.isHidden)}`);
      const got = await tp.getStrengthWorkout(id); writeFileSync(path.join(OUT, `${kind}-read.json`), JSON.stringify(got, null, 2));
      say(`2. GET workouts/${id}: calendarId=${JSON.stringify(got.calendarId)} isHidden=${JSON.stringify(got.isHidden)} prescribedDate=${JSON.stringify(got.prescribedDate)} блоков=${(got.blocks as unknown[])?.length} типы=${JSON.stringify(((got.blocks as Array<Record<string, unknown>>) ?? []).map((b) => b.blockType))}`);
      const d = diffSig(signature(body), signature(got)); say(`3. сверка: ${d.length ? "РАСХОЖДЕНИЕ — " + d.join(" | ") : "совпала (типы блоков, упражнения, параметры, значения каждого подхода, скрытие, атлет, дата, название)"}`);
    } catch (e) { say(`ОШИБКА: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`); }
    const mid = await calendar(); const ours = mid.filter((x) => /ПРОБА СИЛОВОЙ/.test(x.title)); const ids = [...new Set([...(id ? [id] : []), ...ours.map((x) => x.id)])];
    if (ids.length > 1) say(`внимание: в календаре наших проб ${ids.length} (${ids.join(", ")}) — дубль от повтора POST, удаляю все`);
    for (const x of ids) {
      const del = await tp.deleteWorkout("strength", ATHLETE, Number(x)); say(`4. DELETE workouts/${x}: HTTP ${del.status}`);
      const after = await tp.getTpApiJsonRaw("strength", `${HOST}/workouts/${x}`); say(`5. GET workouts/${x} после удаления: HTTP ${after.status} ${JSON.stringify(after.body).slice(0, 160)}`);
    }
    const fin = await calendar(); say(`6. календарь ${ATHLETE} на ${DATE} после: ${fin.length ? "НЕ ПУСТО: " + fin.map((x) => `${x.id} «${x.title}»`).join("; ") : "пусто"}`);
    if (fin.length) { say("СТОП: после удаления календарь не пуст — дальше не идём"); break; }
  }
  writeFileSync(path.join(OUT, "probe-log.txt"), log.join("\n") + "\n");
}
if (process.argv[1]?.endsWith("probe-strength-write.ts")) main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
