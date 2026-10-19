/**
 * ТЕЛО СИЛОВОЙ ИЗ programs.json — общая сборка для показа на тест-атлете и для постановки атлетам.
 * Формат тела доказан живой пробой (probe-strength-write.ts, 19.10): POST workouts/save, полный объект, UUID клиента, isHidden в теле.
 * Круговая: один блок Circuit, круги = подходы у каждого упражнения; ОТДЫХ (решение Игоря 19.10) — поля в TP нет, поэтому
 * текстом в заметке блока и в описании тренировки. Классика: блок SingleExercise на упражнение. Вес числом не задаётся.
 * Упражнения: объект из reports/strength/exercises/{id}.json; нет файла — один GET exercises/{id} (только чтение) и сохранить туда же.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CANON = "/Users/igor/igor-tp-reports-bot";
const EXDIR = path.join(CANON, "reports", "strength", "exercises");
const HERE = path.dirname(new URL(import.meta.url).pathname);

export const REST_EXERCISES = "15–20 с";
export const REST_ROUNDS = "90–120 с";
export const restLine = (): string => `Отдых: ${REST_EXERCISES} между упражнениями, ${REST_ROUNDS} между кругами.`;

type ExParam = { parameter: string; title: string; unit: unknown; category: string; range?: unknown; id: string };
export type Exercise = { id: string; ownerId: number; title: string; videoUrl: string | null; instructions: string | null; parameters: ExParam[]; canEdit: boolean };
export type PlanPrescription = { exerciseId: string; title: string; parameter: string; libraryParameterId: string | null; sets: number; prescribedValue: string; coachNotes: string | null };
export type PlanBlock = { blockType: "SingleExercise" | "Circuit"; coachNotes: string | null; rounds?: number; prescriptions: PlanPrescription[] };
export type PlanWeek = { week: number; phase: string; workoutTitle: string; instructions: string | null; blocks: PlanBlock[] };
export type Programs = { programs: Array<{ id: string; title: string; formats: { classic: PlanWeek[]; circuit: PlanWeek[] } }> };

export const loadPrograms = (): Programs => JSON.parse(readFileSync(path.join(HERE, "programs.json"), "utf8")) as Programs;

type ParamDef = { parameter: string; title: string; unit: unknown; category: string; range: unknown };
const PARAM_DEFS: ParamDef[] = (() => { const p = JSON.parse(readFileSync(path.join(CANON, "reports", "strength", "probe", "parameters-exercise.json"), "utf8")); const b = p.body ?? p; return (b.data ?? b) as ParamDef[]; })();

export async function loadExercise(id: string, get?: (p: string) => Promise<{ status: number; body: unknown }>): Promise<Exercise> {
  const f = path.join(EXDIR, `${id}.json`);
  if (!existsSync(f)) {
    if (!get) throw new Error(`нет локального описания упражнения ${id} и не дан клиент чтения`);
    const r = await get(`/rx/activity/v1/exercises/${id}`); if (r.status !== 200) throw new Error(`exercises/${id}: HTTP ${r.status}`);
    mkdirSync(EXDIR, { recursive: true }); writeFileSync(f, JSON.stringify(r, null, 2));
  }
  const d = (JSON.parse(readFileSync(f, "utf8")) as { body: { data: Exercise } }).body.data;
  return { id: String(d.id ?? id), ownerId: d.ownerId, title: d.title, videoUrl: d.videoUrl ?? null, instructions: d.instructions ?? null, parameters: d.parameters, canEdit: !!d.canEdit };
}

function paramObject(ex: Exercise, p: PlanPrescription): ExParam {
  const lib = ex.parameters.find((x) => x.parameter === p.parameter);
  if (lib) { if (p.libraryParameterId && lib.id !== p.libraryParameterId) throw new Error(`${ex.title}: id параметра ${p.parameter} в библиотеке ${lib.id}, в программе ${p.libraryParameterId}`); return lib; }
  // параметр «добавленный» (вне набора упражнения, как Duration у моста с удержанием) — определение из parameters/exercise
  const def = PARAM_DEFS.find((x) => x.parameter === p.parameter); if (!def) throw new Error(`нет определения параметра ${p.parameter}`);
  return { ...def, id: "" };
}

export function signatureOf(w: Record<string, unknown>): string {
  const bl = (w.blocks as Array<Record<string, unknown>>) ?? [];
  return JSON.stringify({ title: w.title, cal: Number(w.calendarId), date: String(w.prescribedDate).slice(0, 10), hidden: w.isHidden, instr: w.instructions ?? null,
    blocks: bl.map((b) => ({ t: b.blockType, n: b.coachNotes ?? null, p: ((b.prescriptions as Array<Record<string, unknown>>) ?? []).map((p) => ({
      ex: String((p.exercise as Record<string, unknown>)?.id), n: p.coachNotes ?? null, par: String(((p.parameters as Array<Record<string, unknown>>) ?? [])[0]?.parameter),
      v: ((p.sets as Array<Record<string, unknown>>) ?? []).map((s) => String(((s.parameterValues as Array<Record<string, unknown>>) ?? [])[0]?.prescribedValue)) })) })) });
}

export async function buildBody(week: PlanWeek, o: { athleteId: number; date: string; hidden: boolean; get?: (p: string) => Promise<{ status: number; body: unknown }> }): Promise<Record<string, unknown>> {
  const circuit = week.blocks.some((b) => b.blockType === "Circuit");
  const blocks = [];
  for (const b of week.blocks) {
    const prescriptions = [];
    for (const p of b.prescriptions) {
      const ex = await loadExercise(p.exerciseId, o.get); const par = paramObject(ex, p);
      const fmt = p.parameter === "Duration" ? "Time" : "Integer";
      prescriptions.push({
        id: randomUUID(), exercise: ex, parameters: [{ parameter: par.parameter, title: par.title, unit: par.unit, category: par.category, range: par.range ?? null, id: randomUUID() }],
        sets: Array.from({ length: p.sets }, () => ({ id: randomUUID(), isComplete: false, setOrigin: "Prescribed", parameterValues: [{ id: randomUUID(), parameter: p.parameter, inputFormat: fmt, range: par.range ?? null, prescribedValue: p.prescribedValue, executedValue: null }] })),
        coachNotes: p.coachNotes, compliancePercent: 0, setSummaryTemplate: p.parameter === "Duration" ? "{Duration}" : `{${p.parameter}} ${par.title}`,
      });
    }
    const notes = b.blockType === "Circuit" ? `${b.coachNotes ?? `${b.rounds} круга`}. ${restLine()}` : b.coachNotes;
    blocks.push({ id: randomUUID(), blockType: b.blockType, title: b.blockType === "Circuit" ? "Круг" : prescriptions.length ? (prescriptions[0].exercise as Exercise).title : "", coachNotes: notes, isComplete: false, compliancePercent: 0, parameters: [], prescriptions });
  }
  const instructions = [week.instructions, circuit ? restLine() : null].filter(Boolean).join("\n\n") || null;
  const totalSets = week.blocks.reduce((a, b) => a + b.prescriptions.reduce((x, p) => x + p.sets, 0), 0); const totalPres = week.blocks.reduce((a, b) => a + b.prescriptions.length, 0);
  return {
    workoutType: "StructuredStrength", lastUpdatedAt: null, compliancePercent: 0, rpe: null, feel: null, blocks,
    snapshot: { totalBlocks: blocks.length, completedBlocks: 0, totalSets, completedSets: 0, totalPrescriptions: totalPres, completedPrescriptions: 0 },
    prescribedDate: o.date, prescribedStartTime: null, startDateTime: null, completedDateTime: null, calendarId: o.athleteId,
    title: week.workoutTitle, instructions, prescribedDurationInSeconds: null, orderOnDay: null, executedDurationInSeconds: null,
    isLocked: false, isHidden: o.hidden, workoutSubTypeId: null, id: randomUUID(),
  };
}

/** Как тренировку увидит ученик (текстом): название, описание, блоки/упражнения/подходы, заметки. */
export function studentText(w: Record<string, unknown>): string {
  const out = [`«${String(w.title)}» · ${String(w.prescribedDate).slice(0, 10)}`, "", String(w.instructions ?? ""), ""];
  for (const b of (w.blocks as Array<Record<string, unknown>>) ?? []) {
    const ps = (b.prescriptions as Array<Record<string, unknown>>) ?? [];
    if (b.blockType === "Circuit") out.push(`КРУГ — ${String(b.coachNotes ?? "")}`);
    for (const p of ps) {
      const sets = (p.sets as Array<Record<string, unknown>>) ?? []; const par = String(((p.parameters as Array<Record<string, unknown>>) ?? [])[0]?.parameter);
      const v = String(((sets[0]?.parameterValues as Array<Record<string, unknown>>) ?? [])[0]?.prescribedValue);
      const unit = par === "Duration" ? " с" : par === "RepsPerSide" ? " на сторону" : " повт.";
      out.push(`${b.blockType === "Circuit" ? "  " : ""}${String((p.exercise as Record<string, unknown>)?.title)} — ${sets.length} × ${v}${unit}${p.coachNotes ? ` · ${String(p.coachNotes)}` : ""}`);
    }
    if (b.blockType !== "Circuit" && b.coachNotes) out.push(`  (${String(b.coachNotes)})`);
  }
  return out.join("\n");
}
