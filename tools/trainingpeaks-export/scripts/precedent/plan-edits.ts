/**
 * ПРАВКИ ТРЕНЕРА — обратная связь (решение Игоря 15.10). Чистые функции, без I/O.
 *
 * Между «раскидать» и «публикуй» Игорь правит неделю прямо в TrainingPeaks. Перед публикацией
 * неделя перечитывается из TP, и публикуется ЕГО версия. Разница «что поставили → что стало»
 * складывается в таблицу coach_plan_edits — копится, ничего по ней не чинится.
 */
export type Placed = { aid: number; weekStart: string; workoutId: number; date: string; title: string; description: string; minutes: number };
export type Current = { workoutId: number; date: string; title: string; description: string; minutes: number; isHidden: boolean | null } | null;
export type EditField = "длительность" | "формат" | "описание" | "день недели" | "удаление" | "добавление";
export type EditRow = { aid: number; weekStart: string; date: string; workoutId: number; field: EditField; before: string | null; after: string | null };

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Что тренер сделал с одной поставленной тренировкой. current = null — удалена. */
export function diffPlaced(p: Placed, c: Current): EditRow[] {
  const row = (field: EditField, before: string | null, after: string | null, date = p.date): EditRow => ({ aid: p.aid, weekStart: p.weekStart, date, workoutId: p.workoutId, field, before, after });
  if (!c) return [row("удаление", `${p.title} ${p.minutes} мин`, null)];
  const out: EditRow[] = [];
  if (c.date.slice(0, 10) !== p.date.slice(0, 10)) out.push(row("день недели", p.date.slice(0, 10), c.date.slice(0, 10), c.date.slice(0, 10)));
  if (Math.round(c.minutes) !== Math.round(p.minutes)) out.push(row("длительность", String(p.minutes), String(Math.round(c.minutes))));
  if (norm(c.title) !== norm(p.title)) out.push(row("формат", p.title, c.title));
  if (norm(c.description) !== norm(p.description)) out.push(row("описание", p.description, c.description));
  return out;
}

/** Тренировки в неделе, которых мы не ставили, — добавлены тренером. */
export function addedByCoach(aid: number, weekStart: string, placedIds: Set<number>, inWeek: Array<{ workoutId: number; date: string; title: string; minutes: number }>): EditRow[] {
  return inWeek.filter((w) => !placedIds.has(w.workoutId)).map((w) => ({ aid, weekStart, date: w.date.slice(0, 10), workoutId: w.workoutId, field: "добавление" as const, before: null, after: `${w.title} ${Math.round(w.minutes)} мин` }));
}

/** Что публиковать: только живые (не удалённые) наши тренировки, в ТЕКУЩЕЙ версии из TP. Удалённое не возвращается. */
export function toPublish(placed: Placed[], current: Map<number, Current>): Array<{ workoutId: number; aid: number }> {
  return placed.filter((p) => current.get(p.workoutId) != null).map((p) => ({ workoutId: p.workoutId, aid: p.aid }));
}
