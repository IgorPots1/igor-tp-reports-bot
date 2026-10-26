/**
 * ТЕЛО СИЛОВОЙ ИЗ programs.json — общая сборка для показа на тест-атлете и для постановки атлетам.
 * Формат тела доказан живой пробой (probe-strength-write.ts, 19.10): POST workouts/save, полный объект, UUID клиента, isHidden в теле.
 * Круговая: один блок Circuit, круги = подходы у каждого упражнения; ОТДЫХ (решение Игоря 19.10) — поля в TP нет, поэтому
 * текстом в заметке блока и в описании тренировки. Классика: блок SingleExercise на упражнение. Вес числом не задаётся.
 * Упражнения: объект из reports/strength/exercises/{id}.json; нет файла — один GET exercises/{id} (только чтение) и сохранить туда же.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CANON = "/Users/igor/igor-tp-reports-bot";
const EXDIR = path.join(CANON, "reports", "strength", "exercises");
const HERE = path.dirname(new URL(import.meta.url).pathname);

export const REST_EXERCISES = "15–20 с";
export const REST_ROUNDS = "90–120 с";
export type Rest = { exercises: string; rounds: string };
export const restLine = (r: Rest = { exercises: REST_EXERCISES, rounds: REST_ROUNDS }): string => `Отдых: ${r.exercises} между упражнениями, ${r.rounds} между кругами.`;

type ExParam = { parameter: string; title: string; unit: unknown; category: string; range?: unknown; id: string };
export type Exercise = { id: string; ownerId: number; title: string; videoUrl: string | null; instructions: string | null; parameters: ExParam[]; canEdit: boolean };
/** extra — дополнительные параметры подхода (вес в кг рядом с повторами). Значение одно на все подходы. */
export type ExtraParam = { parameter: string; libraryParameterId: string | null; prescribedValue: string; allowEmpty?: boolean };
/** warmup — разминочные подходы БЕЗ веса перед рабочими (решение Игоря 25.10): те же упражнение и параметр, вес пустой; в счёт sets не входят. */
export type PlanPrescription = { exerciseId: string; title: string; parameter: string; libraryParameterId: string | null; sets: number; prescribedValue: string; coachNotes: string | null; extra?: ExtraParam[]; warmup?: { sets: number; value: string } };
export type PlanBlock = { blockType: "SingleExercise" | "Circuit"; coachNotes: string | null; rounds?: number; prescriptions: PlanPrescription[] };
/** rest — свой отдых для круговой (по умолчанию 15–20 с / 90–120 с). */
/** keepOrder — не сортировать по классам (исключение, решение Игоря: «Зал» недели 1–4). */
export type PlanWeek = { week: number; phase: string; workoutTitle: string; instructions: string | null; blocks: PlanBlock[]; rest?: Rest; keepOrder?: boolean };

/**
 * ПОРЯДОК УПРАЖНЕНИЙ (решение Игоря 21.10): класс 0 разминка/активация, 1 прыжковое, 2 сложнокоординационное на одной ноге, 3 базовое,
 * 4 изолирующее/мелкие, 5 корпус (exercise-order.json). Классика — по возрастанию класса, внутри класса прежний порядок; круговая — свой порядок,
 * но класс 2 в начале круга. Нет класса — при сборке для записи отказ.
 */
const ORDER = (JSON.parse(readFileSync(path.join(HERE, "exercise-order.json"), "utf8")) as { classes: Record<string, { class: number }> }).classes;
export const orderClass = (exerciseId: string): number | null => ORDER[exerciseId]?.class ?? null;
export function orderWeek(week: PlanWeek): PlanWeek {
  if (week.keepOrder) return week;
  const cls = (b: PlanBlock): number => orderClass(b.prescriptions[0]?.exerciseId ?? "") ?? 99;
  const blocks = week.blocks.map((b, i) => ({ b, i }));
  const classic = [...blocks].sort((x, y) => (x.b.blockType === "Circuit" || y.b.blockType === "Circuit" ? x.i - y.i : cls(x.b) - cls(y.b) || x.i - y.i)).map((x) => x.b);
  return { ...week, blocks: classic.map((b) => (b.blockType !== "Circuit" ? b : { ...b, prescriptions: b.prescriptions.map((p, i) => ({ p, i })).sort((x, y) => (orderClass(x.p.exerciseId) === 2 ? 0 : 1) - (orderClass(y.p.exerciseId) === 2 ? 0 : 1) || x.i - y.i).map((x) => x.p) })) };
}
/** Нарушения порядка: классика — «класс идёт после большего»; круг — класс 2 не в начале; нет класса. */
export function orderViolations(week: PlanWeek): string[] {
  const out: string[] = []; if (week.keepOrder) return out;
  const singles = week.blocks.filter((b) => b.blockType !== "Circuit").map((b) => b.prescriptions[0]);
  for (const p of week.blocks.flatMap((b) => b.prescriptions)) if (orderClass(p.exerciseId) == null) out.push(`нет класса порядка: ${p.exerciseId} «${p.title}»`);
  for (let i = 1; i < singles.length; i++) { const a = orderClass(singles[i - 1].exerciseId) ?? 99, b = orderClass(singles[i].exerciseId) ?? 99; if (b < a) out.push(`класс идёт после большего: «${singles[i].title}» (${b}) после «${singles[i - 1].title}» (${a})`); }
  for (const c of week.blocks.filter((b) => b.blockType === "Circuit")) { const k = c.prescriptions.map((p) => orderClass(p.exerciseId)); const n2 = k.filter((x) => x === 2).length; if (k.slice(0, n2).some((x) => x !== 2)) out.push(`круг: класс 2 не в начале (${k.join(",")})`); }
  return out;
}
export type Programs = { programs: Array<{ id: string; title: string; formats: { classic: PlanWeek[]; circuit: PlanWeek[] } }> };

export const loadPrograms = (): Programs => {
  const base = JSON.parse(readFileSync(path.join(HERE, "programs.json"), "utf8")) as Programs;
  // отдельные программы с весом в кг и своими упражнениями тренера: program-gym.json («Зал с весами»), program-gym-runner.json («Силовая — зал, беговая») и т.п.
  const extra = readdirSync(HERE).filter((f) => /^program-.+\.json$/.test(f)).sort().flatMap((f) => (JSON.parse(readFileSync(path.join(HERE, f), "utf8")) as Programs).programs);
  return { ...base, programs: [...base.programs, ...extra] };
};
/** Свои упражнения тренера: custom:* → id в библиотеке TP (после создания). Нет записи — заглушка, писать с ней нельзя. */
const CUSTOM_MAP = path.join(CANON, "reports", "strength", "custom-exercises.json");
const customDefs = (): Record<string, { title: string; parameters: string[] }> => Object.assign({}, ...readdirSync(HERE).filter((f) => /^program-.+\.json$/.test(f)).sort().map((f) => (JSON.parse(readFileSync(path.join(HERE, f), "utf8")) as { custom?: Record<string, { title: string; parameters: string[] }> }).custom ?? {}));
export const customMap = (): Record<string, string> => (existsSync(CUSTOM_MAP) ? JSON.parse(readFileSync(CUSTOM_MAP, "utf8")) as Record<string, string> : {});
export const isStub = (ex: Exercise): boolean => ex.id.startsWith("custom:");

type ParamDef = { parameter: string; title: string; unit: unknown; category: string; range: unknown };
const PARAM_DEFS: ParamDef[] = (() => { const p = JSON.parse(readFileSync(path.join(CANON, "reports", "strength", "probe", "parameters-exercise.json"), "utf8")); const b = p.body ?? p; return (b.data ?? b) as ParamDef[]; })();

export async function loadExercise(id0: string, get?: (p: string) => Promise<{ status: number; body: unknown }>): Promise<Exercise> {
  let id = id0;
  if (id.startsWith("custom:")) {
    const mapped = customMap()[id];
    if (!mapped) { const def = customDefs()[id]; if (!def) throw new Error(`нет описания ${id}`);
      return { id, ownerId: 5457637, title: def.title, videoUrl: null, instructions: null, canEdit: true, parameters: def.parameters.map((n) => { const p = PARAM_DEFS.find((x) => x.parameter === n)!; return { parameter: p.parameter, title: p.title, unit: p.unit, category: p.category, range: p.range, id: "" }; }) }; }
    id = mapped;
  }
  const f = path.join(EXDIR, `${id}.json`);
  if (!existsSync(f)) {
    if (!get) throw new Error(`нет локального описания упражнения ${id} и не дан клиент чтения`);
    const r = await get(`/rx/activity/v1/exercises/${id}`); if (r.status !== 200) throw new Error(`exercises/${id}: HTTP ${r.status}`);
    mkdirSync(EXDIR, { recursive: true }); writeFileSync(f, JSON.stringify(r, null, 2));
  }
  const d = (JSON.parse(readFileSync(f, "utf8")) as { body: { data: Exercise } }).body.data;
  return { id: String(d.id ?? id), ownerId: d.ownerId, title: d.title, videoUrl: d.videoUrl ?? null, instructions: d.instructions ?? null, parameters: d.parameters, canEdit: !!d.canEdit };
}

function paramObject(ex: Exercise, p: { parameter: string; libraryParameterId: string | null }): ExParam {
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
      ex: String((p.exercise as Record<string, unknown>)?.id), n: p.coachNotes ?? null, par: ((p.parameters as Array<Record<string, unknown>>) ?? []).map((x) => String(x.parameter)).sort().join("+"),
      v: ((p.sets as Array<Record<string, unknown>>) ?? []).map((s) => ((s.parameterValues as Array<Record<string, unknown>>) ?? []).map((pv) => `${String(pv.parameter)}=${String(pv.prescribedValue)}`).sort().join(",")) })) })) });
}

export async function buildBody(week0: PlanWeek, o: { athleteId: number; date: string; hidden: boolean; forWrite?: boolean; get?: (p: string) => Promise<{ status: number; body: unknown }> }): Promise<Record<string, unknown>> {
  const week = orderWeek(week0);
  if (o.forWrite) { const v = orderViolations(week); if (v.length) throw new Error(`порядок упражнений: ${v.join("; ")} — записывать нельзя`); }
  if (o.forWrite) for (const b of week.blocks) for (const p of b.prescriptions) for (const x of [{ prescribedValue: p.prescribedValue, allowEmpty: false }, ...(p.extra ?? [])])
    if (!/^\d+(\.\d+)?$/.test(x.prescribedValue) && !(x.allowEmpty && x.prescribedValue === "")) throw new Error(`«${p.title}»: значение «${x.prescribedValue}» не число — записывать нельзя`);
  const circuit = week.blocks.some((b) => b.blockType === "Circuit");
  const blocks = [];
  for (const b of week.blocks) {
    const prescriptions = [];
    for (const p of b.prescriptions) {
      const ex = await loadExercise(p.exerciseId, o.get);
      if (o.forWrite && isStub(ex)) throw new Error(`«${ex.title}»: своё упражнение ещё не создано в библиотеке TP — записывать нельзя`);
      const all = [{ parameter: p.parameter, libraryParameterId: p.libraryParameterId, prescribedValue: p.prescribedValue }, ...(p.extra ?? [])];
      const pars = all.map((x) => ({ x, par: paramObject(ex, x) }));
      const fmt = (name: string): string => (name === "Duration" ? "Time" : /^Weight/.test(name) ? "Decimal" : "Integer");
      const tmpl = pars.map(({ x, par }) => (x.parameter === "Duration" ? "{Duration}" : /^Weight/.test(x.parameter) ? `@ {${x.parameter}} ${(par.unit as { abbreviation?: string })?.abbreviation ?? ""}`.trim() : `{${x.parameter}} ${par.title}`)).join(" ");
      prescriptions.push({
        id: randomUUID(), exercise: ex, parameters: pars.map(({ par }) => ({ parameter: par.parameter, title: par.title, unit: par.unit, category: par.category, range: par.range ?? null, id: randomUUID() })),
        sets: [
          // разминочные: основной параметр — своё значение, вес — пусто
          ...Array.from({ length: p.warmup?.sets ?? 0 }, () => ({ id: randomUUID(), isComplete: false, setOrigin: "Prescribed", parameterValues: pars.map(({ x, par }, i) => ({ id: randomUUID(), parameter: x.parameter, inputFormat: fmt(x.parameter), range: par.range ?? null, prescribedValue: i === 0 ? p.warmup!.value : null, executedValue: null })) })),
          ...Array.from({ length: p.sets }, () => ({ id: randomUUID(), isComplete: false, setOrigin: "Prescribed", parameterValues: pars.map(({ x, par }) => ({ id: randomUUID(), parameter: x.parameter, inputFormat: fmt(x.parameter), range: par.range ?? null, prescribedValue: x.prescribedValue === "" ? null : x.prescribedValue, executedValue: null })) })),
        ],
        coachNotes: p.coachNotes, compliancePercent: 0, setSummaryTemplate: tmpl,
      });
    }
    const notes = b.blockType === "Circuit" ? `${b.coachNotes ?? `${b.rounds} круга`}. ${restLine(week.rest)}` : b.coachNotes;
    blocks.push({ id: randomUUID(), blockType: b.blockType, title: b.blockType === "Circuit" ? "Круг" : prescriptions.length ? (prescriptions[0].exercise as Exercise).title : "", coachNotes: notes, isComplete: false, compliancePercent: 0, parameters: [], prescriptions });
  }
  // «Начинай с более слабой ноги…» — только если в тренировке есть упражнения на одну ногу (параметр «на сторону»); решение Игоря 19.10
  const unilateral = week.blocks.some((b) => b.prescriptions.some((p) => p.parameter === "RepsPerSide" || (p.extra ?? []).some((x) => x.parameter === "RepsPerSide")));
  // убирается только АБЗАЦ про слабую ногу, остальное описание (разминка и т.п.) остаётся
  const base = week.instructions && !unilateral ? week.instructions.split(/\n\s*\n/).filter((x) => !/слабой ноги/i.test(x)).join("\n\n") || null : week.instructions;
  const instructions = [base, circuit ? restLine(week.rest) : null].filter(Boolean).join("\n\n") || null;
  const totalSets = week.blocks.reduce((a, b) => a + b.prescriptions.reduce((x, p) => x + p.sets, 0), 0); const totalPres = week.blocks.reduce((a, b) => a + b.prescriptions.length, 0);
  return {
    workoutType: "StructuredStrength", lastUpdatedAt: null, compliancePercent: 0, rpe: null, feel: null, blocks,
    snapshot: { totalBlocks: blocks.length, completedBlocks: 0, totalSets, completedSets: 0, totalPrescriptions: totalPres, completedPrescriptions: 0 },
    prescribedDate: o.date, prescribedStartTime: null, startDateTime: null, completedDateTime: null, calendarId: o.athleteId,
    title: week.workoutTitle, instructions, prescribedDurationInSeconds: null,
    // БЫЛО orderOnDay: null — у ручных силовых тренера всегда 1; с null Игорь не мог править наши в интерфейсе TP (наряд 26.10, гипотеза; проба на 3102415)
    orderOnDay: 1, executedDurationInSeconds: null,
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
      const valOf = (st: Record<string, unknown>): string => String(((st.parameterValues as Array<Record<string, unknown>>) ?? []).find((x) => !/^Weight/.test(String(x.parameter)))?.prescribedValue);
      const last = sets[sets.length - 1]; const nWarm = sets.findIndex((st) => valOf(st) === valOf(last)); const warm = nWarm > 0 ? sets.slice(0, nWarm) : [];
      const pvs = (last?.parameterValues as Array<Record<string, unknown>>) ?? [];
      const main = pvs.find((x) => !/^Weight/.test(String(x.parameter))) ?? pvs[0]; const w = pvs.find((x) => /^Weight/.test(String(x.parameter)));
      const v = String(main?.prescribedValue); const unit = par === "Duration" ? " с" : String(main?.parameter) === "RepsPerSide" ? " на сторону" : " повт.";
      const wTxt = w && w.prescribedValue == null ? " · вес не задан (подбирается)" : w ? ` · ${String(w.prescribedValue)} ${/Kg$/.test(String(w.parameter)) ? "кг" : "lb"}${/PerSide/.test(String(w.parameter)) ? " на сторону" : ""}` : "";
      const warmTxt = warm.length ? `${warm.length} × ${valOf(warm[0])}${unit} разминочный без веса, затем ` : "";
      out.push(`${b.blockType === "Circuit" ? "  " : ""}${String((p.exercise as Record<string, unknown>)?.title)} — ${warmTxt}${sets.length - warm.length} × ${v}${unit}${wTxt}${p.coachNotes ? ` · ${String(p.coachNotes)}` : ""}`);
    }
    if (b.blockType !== "Circuit" && b.coachNotes) out.push(`  (${String(b.coachNotes)})`);
  }
  return out.join("\n");
}
