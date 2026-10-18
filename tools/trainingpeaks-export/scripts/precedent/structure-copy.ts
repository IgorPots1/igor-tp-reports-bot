/**
 * КОПИЯ СТРУКТУРЫ ТРЕНИРОВКИ ИЗ ОБРАЗЦА (наряд Игоря 17.10: на часах нужны шаги). ЧИСТЫЕ ФУНКЦИИ, без сети.
 * Источник — снимок `structure`, который TP отдаёт в GET (в корпусе — поле struct сессии): { structure: [узлы], polyline, primaryLengthMetric,
 * primaryIntensityMetric }. Узел: step (один шаг) или repetition (n повторов набора шагов); у шага length {unit:"second", value}, targets [{minValue,maxValue}].
 * Правила: без повторов (лёгкая, длительная, «разминка + основная») разница минут уходит в самый длинный шаг; рецепт интервалов (повторения) не трогается;
 * нет структуры в образце — null и пометка (решает вызывающий).
 * Формат запроса (объект или сериализованная строка) НЕ доказан для POST — это выясняет проба probe-structure-copy.ts.
 */
type Step = { name?: string; length: { unit: string; value: number }; targets?: Array<{ minValue?: number; maxValue?: number }>; intensityClass?: string; openDuration?: boolean };
type Node = { type: "step" | "repetition"; steps: Step[]; length: { unit: string; value: number }; begin?: number; end?: number };
export type Snap = { structure: Node[]; polyline?: unknown; primaryLengthMetric?: string; primaryIntensityMetric?: string; primaryIntensityTargetOrRange?: string };

/** Принимает объект ИЛИ JSON-строку (TP/клиент могут вернуть любой вид); не снимок — null. */
export function parseSnap(x: unknown): Snap | null {
  let v = x;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object") return null;
  const s = v as Snap;
  return Array.isArray(s.structure) && s.structure.length > 0 ? s : null;
}

/** Суммарные секунды: step — сумма его шагов; repetition — число повторов × сумма шагов. */
export function totalSeconds(s: Snap): number {
  return s.structure.reduce((a, n) => a + (n.type === "repetition" ? n.length.value : 1) * n.steps.reduce((b, st) => b + Number(st.length?.value ?? 0), 0), 0);
}

export type Scaled = { ok: true; snap: Snap; note: string } | { ok: false; reason: string };

/** Пересчитать под новое число секунд. Одиночный шаг — меняем длину; ровно столько же секунд — копия как есть; иначе (интервалы) — отказ, рецепт не трогаем. */
export function scaleToSeconds(src: Snap, seconds: number): Scaled {
  const copy = JSON.parse(JSON.stringify(src)) as Snap;
  if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, reason: `некорректная длительность ${seconds}` };
  const total = totalSeconds(copy);
  if (total === seconds) return { ok: true, snap: copy, note: "длительность та же — копия без изменений" };
  // Повторы (repetition) — рецепт интервалов: не трогаем, длительность должна совпасть ровно.
  if (copy.structure.some((n) => n.type === "repetition")) return { ok: false, reason: `в структуре есть повторы (${total} с): рецепт интервалов не трогаем, а ${seconds} с ≠ ${total} с` };
  // Без повторов (лёгкая, длительная — один шаг или «разминка + основная» и т.п.): разница минут уходит в САМЫЙ ДЛИННЫЙ шаг — так же, как адаптация текста
  // меняет самое большое число минут (adapt-text.ts); короткие шаги (разминка 10 мин) остаются как у тренера. Основной шаг не может стать короче 2 мин и меньше четверти прежнего.
  const flat = copy.structure.flatMap((n) => n.steps);
  const main = flat.reduce((m, st) => (st.length.value > m.length.value ? st : m), flat[0]);
  const oldB = boundaries(copy); const oldMain = main.length.value; const nv = Math.round(oldMain + (seconds - total));
  if (nv < 120 || nv < oldMain * 0.25) return { ok: false, reason: `основной шаг стал бы ${nv} с (было ${oldMain} с) — пересчёт не делаем` };
  main.length = { ...main.length, value: nv };
  let t = 0; for (const n of copy.structure) { const len = n.steps.reduce((x, st) => x + st.length.value, 0); if (n.begin != null || n.end != null) { n.begin = t; n.end = t + len; } t += len; }
  remapPolyline(copy, oldB, boundaries(copy));
  return { ok: true, snap: copy, note: flat.length === 1 ? `одиночный шаг ${total} с → ${Math.round(seconds)} с, цели (%) прежние` : `основной шаг ${oldMain} с → ${nv} с, остальные шаги и цели (%) прежние` };
}

/** Границы шагов по времени (без повторов): [0, конец 1-го, …, итог]. */
function boundaries(s: Snap): number[] { const out = [0]; for (const n of s.structure) for (const st of n.steps) out.push(out[out.length - 1] + st.length.value); return out; }
/** polyline TP — точки [доля времени, уровень]; доли пересчитываются кусочно-линейно по новым границам шагов, уровни не меняются. */
function remapPolyline(s: Snap, oldB: number[], newB: number[]): void {
  if (!Array.isArray(s.polyline)) return; const To = oldB[oldB.length - 1], Tn = newB[newB.length - 1]; if (!(To > 0 && Tn > 0)) return;
  s.polyline = (s.polyline as unknown[]).map((pt) => {
    if (!Array.isArray(pt) || typeof pt[0] !== "number") return pt;
    const tOld = pt[0] * To; let i = 0; while (i < oldB.length - 2 && tOld > oldB[i + 1] + 1e-6) i++;
    const span = oldB[i + 1] - oldB[i]; const tNew = newB[i] + (span > 0 ? (tOld - oldB[i]) * (newB[i + 1] - newB[i]) / span : 0);
    return [Math.round((tNew / Tn) * 1000) / 1000, ...pt.slice(1)];
  });
}

/** Два вида тела для POST: объект и сериализованная строка. Какой принимает TP — выясняет проба. */
export const asObject = (s: Snap): Snap => s;
export const asString = (s: Snap): string => JSON.stringify(s);

export type Cmp = { ok: boolean; diffs: string[] };
/** Сверка записанного (из GET) с ожидаемым: число узлов, у каждого шага имя/класс/длина/цели, суммарные секунды. polyline и begin/end не сравниваются (производные). */
export function compareStructures(want: Snap, gotRaw: unknown): Cmp {
  const got = parseSnap(gotRaw); const diffs: string[] = [];
  if (!got) return { ok: false, diffs: [`из TP структура не читается как снимок (${typeof gotRaw}${gotRaw === null ? ", null" : ""})`] };
  if (got.structure.length !== want.structure.length) diffs.push(`узлов ${got.structure.length}, ждали ${want.structure.length}`);
  want.structure.forEach((n, i) => {
    const g = got.structure[i]; if (!g) return;
    if (g.type !== n.type) diffs.push(`узел ${i}: тип ${g.type}, ждали ${n.type}`);
    if ((g.length?.value ?? 1) !== n.length.value) diffs.push(`узел ${i}: повторов ${g.length?.value}, ждали ${n.length.value}`);
    if (g.steps.length !== n.steps.length) { diffs.push(`узел ${i}: шагов ${g.steps.length}, ждали ${n.steps.length}`); return; }
    n.steps.forEach((s, j) => {
      const t = g.steps[j];
      if (t.length.value !== s.length.value || t.length.unit !== s.length.unit) diffs.push(`узел ${i} шаг ${j}: длина ${t.length.value} ${t.length.unit}, ждали ${s.length.value} ${s.length.unit}`);
      if ((t.intensityClass ?? "") !== (s.intensityClass ?? "")) diffs.push(`узел ${i} шаг ${j}: класс ${t.intensityClass}, ждали ${s.intensityClass}`);
      const a = JSON.stringify((t.targets ?? []).map((x) => [x.minValue, x.maxValue])), b = JSON.stringify((s.targets ?? []).map((x) => [x.minValue, x.maxValue]));
      if (a !== b) diffs.push(`узел ${i} шаг ${j}: цели ${a}, ждали ${b}`);
    });
  });
  if (totalSeconds(got) !== totalSeconds(want)) diffs.push(`суммарно ${totalSeconds(got)} с, ждали ${totalSeconds(want)} с`);
  return { ok: diffs.length === 0, diffs };
}

/** totalTimePlanned в часах (как TP) из снимка — для сверки с полем totalTimePlanned. */
export const plannedHours = (s: Snap): number => totalSeconds(s) / 3600;
