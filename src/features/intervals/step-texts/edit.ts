/**
 * Правка тренировки из админки — чистая часть: что показать в форме, что
 * изменилось, что записать и что стало эталоном [решение Игоря, 21.10.2026].
 *
 * Правится: название, заметка ученице, текст и минуты каждого шага. Числа
 * эталоном не становятся — только текст шага с выбранным ключом.
 *
 * ПОВТОРЫ ОДНОЙ СТРОКОЙ. У сгенерированных интервалов шесть одинаковых
 * «Отрезок N» и пять «Шагом»: в форме это одна строка «× 6», правка ложится
 * на все разом. Иначе одну мысль пришлось бы вводить шесть раз — и рано или
 * поздно один отрезок остался бы со старым текстом.
 */
import { renderSegmentsDescription } from "./describe";
import { etalonTextFor, etalonTextProblem, guessStepKey, isStepKey, type StepKey } from "./keys";

type Segment = {
  minutes: number;
  fastSec: number | null;
  slowSec: number | null;
  label: string;
  noPaceText?: string;
  text?: string | null;
  key?: StepKey;
};
type Step = {
  minutes: number;
  name: string;
  detail?: string;
  target?: unknown;
  key?: StepKey;
  repeat?: { count: number; steps: Step[] };
};
type Note = { title: string | null; body: string; audience?: "student" | "coach" };

export type EditableSession = {
  id: string;
  role: string;
  title: string;
  minutes: number;
  description: string | null;
  segments: Segment[] | null;
  steps: Step[] | null;
  notes: Note[] | null;
};

export type EditableRow = {
  /** Адрес шага: «s:2» — сегмент, «h:3» / «h:3.1» — рукописный шаг, «g:interval_work» — группа повторов. */
  path: string;
  name: string;
  times: number;
  text: string;
  minutes: number;
  key: StepKey | null;
  guessedKey: StepKey | null;
};

const WORK_RE = /^Отрезок\s+\d+/u;

function segmentKey(seg: Segment, role: string): StepKey | null {
  if (seg.key) return seg.key;
  if (role === "quality" && WORK_RE.test(seg.label)) return "interval_work";
  if (role === "quality" && seg.label === "Шагом") return "interval_rest";
  return null;
}

function segText(seg: Segment): string {
  return seg.noPaceText ?? seg.text ?? "";
}

export function editableRows(session: EditableSession, onTreadmill: boolean): EditableRow[] {
  const rows: EditableRow[] = [];
  if (session.steps && session.steps.length > 0) {
    const walk = (steps: Step[], prefix: string) =>
      steps.forEach((step, i) => {
        const path = prefix ? `${prefix}.${i}` : String(i);
        if (step.repeat) {
          walk(step.repeat.steps, path);
          return;
        }
        rows.push({
          path: `h:${path}`,
          name: step.name,
          times: 1,
          text: step.detail ?? "",
          minutes: step.minutes,
          key: step.key ?? null,
          guessedKey: guessStepKey({ name: step.name, role: session.role, onTreadmill, index: i, count: steps.length }),
        });
      });
    walk(session.steps, "");
    return rows;
  }
  const segs = session.segments ?? [];
  const grouped = new Set<StepKey>();
  segs.forEach((seg, i) => {
    const key = segmentKey(seg, session.role);
    if (key === "interval_work" || key === "interval_rest") {
      if (grouped.has(key)) return;
      grouped.add(key);
      const same = segs.filter((s) => segmentKey(s, session.role) === key);
      rows.push({
        path: `g:${key}`,
        name: key === "interval_work" ? "Отрезок" : seg.label,
        times: same.length,
        text: segText(seg),
        minutes: seg.minutes,
        key,
        guessedKey: key,
      });
      return;
    }
    rows.push({
      path: `s:${i}`,
      name: seg.label,
      times: 1,
      text: segText(seg),
      minutes: seg.minutes,
      key,
      guessedKey: key ?? guessStepKey({ name: seg.label, role: session.role, onTreadmill, index: i, count: segs.length }),
    });
  });
  return rows;
}

export function studentNoteOf(session: EditableSession): string {
  return (session.notes ?? []).find((n) => (n.audience ?? "student") === "student")?.body ?? "";
}

export type RowInput = { path: string; text: string; minutes: number; key: StepKey | null };

export type EditChange = {
  field: "title" | "note" | "step_text" | "step_minutes";
  stepIndex: number | null;
  stepKey: StepKey | null;
  before: string | null;
  after: string | null;
  /** Эталон, который эта правка ставит (только текст шага с ключом и без диапазонов). */
  etalon: { key: StepKey; text: string } | null;
  /** Почему текст с ключом НЕ стал эталоном (диапазон и т.п.). */
  etalonSkipped: string | null;
};

export type EditResult = {
  patch: {
    title?: string;
    notes?: Note[] | null;
    segments?: Segment[];
    steps?: Step[];
    description?: string | null;
    minutes?: number;
  };
  changes: EditChange[];
};

function stepIndexOf(path: string): number {
  const m = path.match(/^[sh]:(\d+)/);
  return m ? Number(m[1]) : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Применить форму к тренировке. Чистая: на выходе — что записать в строку
 * тренировки и какие правки занести в историю (и какие из них эталоны).
 */
export function applySessionEdit(
  session: EditableSession,
  input: { title: string; note: string; rows: RowInput[] },
  onTreadmill: boolean,
): EditResult {
  const changes: EditChange[] = [];
  const patch: EditResult["patch"] = {};
  const before = editableRows(session, onTreadmill);

  const title = input.title.trim();
  if (title && title !== session.title) {
    patch.title = title;
    changes.push({ field: "title", stepIndex: null, stepKey: null, before: session.title, after: title, etalon: null, etalonSkipped: null });
  }

  const noteBefore = studentNoteOf(session);
  const note = input.note.trim();
  if (note !== noteBefore.trim()) {
    const others = (session.notes ?? []).filter((n) => (n.audience ?? "student") !== "student");
    const studentRest = (session.notes ?? []).filter((n) => (n.audience ?? "student") === "student").slice(1);
    const first = (session.notes ?? []).find((n) => (n.audience ?? "student") === "student");
    const next: Note[] = [...(note ? [{ title: first?.title ?? null, body: note, audience: "student" as const }] : []), ...studentRest, ...others];
    patch.notes = next.length ? next : null;
    changes.push({ field: "note", stepIndex: null, stepKey: null, before: noteBefore || null, after: note || null, etalon: null, etalonSkipped: null });
  }

  const byPath = new Map(input.rows.map((r) => [r.path, r]));
  let stepsChanged = false;

  const textChange = (row: EditableRow, next: RowInput) => {
    const key = next.key ?? null;
    let etalon: EditChange["etalon"] = null;
    let skipped: string | null = null;
    if (key) {
      const problem = etalonTextProblem(key, next.text);
      if (problem) skipped = problem;
      else etalon = { key, text: etalonTextFor(key, next.text) };
    }
    changes.push({
      field: "step_text",
      stepIndex: stepIndexOf(row.path),
      stepKey: key,
      before: row.text || null,
      after: next.text || null,
      etalon,
      etalonSkipped: skipped,
    });
  };

  for (const row of before) {
    const next = byPath.get(row.path);
    if (!next) continue;
    const text = next.text.trim();
    const minutes = Number.isFinite(next.minutes) && next.minutes > 0 ? round1(next.minutes) : row.minutes;
    if (text !== row.text.trim()) textChange(row, { ...next, text });
    if (minutes !== row.minutes) {
      changes.push({ field: "step_minutes", stepIndex: stepIndexOf(row.path), stepKey: next.key ?? row.key, before: String(row.minutes), after: String(minutes), etalon: null, etalonSkipped: null });
    }
    if (text !== row.text.trim() || minutes !== row.minutes || (next.key ?? null) !== row.key) stepsChanged = true;
  }

  if (stepsChanged) {
    if (session.steps && session.steps.length > 0) {
      const rebuild = (steps: Step[], prefix: string): Step[] =>
        steps.map((step, i) => {
          const path = prefix ? `${prefix}.${i}` : String(i);
          if (step.repeat) {
            const children = rebuild(step.repeat.steps, path);
            const per = children.reduce((s, c) => s + c.minutes, 0);
            return { ...step, minutes: round1(per * step.repeat.count), repeat: { ...step.repeat, steps: children } };
          }
          const next = byPath.get(`h:${path}`);
          if (!next) return step;
          const minutes = Number.isFinite(next.minutes) && next.minutes > 0 ? round1(next.minutes) : step.minutes;
          const out: Step = { ...step, detail: next.text.trim() || undefined, minutes };
          if (next.key) out.key = next.key;
          return out;
        });
      const steps = rebuild(session.steps, "");
      patch.steps = steps;
      patch.minutes = Math.round(steps.reduce((s, x) => s + x.minutes, 0));
    } else {
      const segs = (session.segments ?? []).map((seg, i) => {
        const key = segmentKey(seg, session.role);
        const next = key === "interval_work" || key === "interval_rest" ? byPath.get(`g:${key}`) : byPath.get(`s:${i}`);
        if (!next) return seg;
        const minutes = Number.isFinite(next.minutes) && next.minutes > 0 ? round1(next.minutes) : seg.minutes;
        const out: Segment = { ...seg, minutes };
        const text = next.text.trim();
        if ("noPaceText" in seg || !("text" in seg)) out.noPaceText = text || undefined;
        else out.text = text || null;
        const chosen = next.key ?? key;
        if (chosen) out.key = chosen;
        return out;
      });
      patch.segments = segs;
      patch.minutes = Math.round(segs.reduce((s, x) => s + x.minutes, 0));
      // Описание — та же функция, что у генератора (describe.ts).
      if (session.description !== null) patch.description = renderSegmentsDescription(segs);
    }
  }

  return { patch, changes };
}

export function parseRowKey(value: unknown): StepKey | null {
  return isStepKey(value) ? value : null;
}
