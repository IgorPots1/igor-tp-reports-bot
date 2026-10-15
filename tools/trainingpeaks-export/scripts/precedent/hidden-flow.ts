/**
 * ЦИКЛ «СКРЫТО → ОТКРЫТО → УДАЛЕНО» НА tp-api-client — одна реализация и для пробника, и для «раскидать».
 * Поэтому успех пробника доказывает именно тот путь, которым будет писать «раскидать»
 * (старый tp-probe-workout-hidden-field.ts шёл через Playwright и этого не доказывал).
 *
 * Клиент ВНЕДРЯЕТСЯ (TpLike): сама логика проверяется на подставном клиенте, без вызовов в TP.
 * Правила: после каждой записи — чтение (verify-by-GET); любое расхождение — СТОП; при стопе созданное
 * удаляется и это тоже проверяется; всё, что произошло, возвращается ДОСЛОВНО (observed), без пересказа.
 */
export type TpLike = {
  createWorkout(body: Record<string, unknown>): Promise<{ workoutId: number; raw: Record<string, unknown> }>;
  getWorkoutDetail(athleteId: number, workoutId: number): Promise<Record<string, unknown>>;
  putWorkout(athleteId: number, workoutId: number, fullBody: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteWorkout(athleteId: number, workoutId: number): Promise<{ status: number; body: unknown }>;
  listDay(athleteId: number, date: string): Promise<Array<{ workoutId: number; title: string }>>;
  /** Ошибка чтения означает «тренировки нет» (TP отвечает 400 «Invalid workoutId», а не 404). */
  isGone(err: unknown): boolean;
};

export type Step = { n: number; name: string; ok: boolean; observed: string };
export type FlowResult = {
  steps: Step[]; workoutId: number | null; discrepancies: string[]; stopped: string | null;
  cleanedUp: boolean | null; hiddenInPost: boolean | null;
  hiddenVerifyPass: boolean | null; unhiddenVerifyPass: boolean | null; deletedVerifyPass: boolean | null;
};

export class FlowStop extends Error {}

export const emptyFlow = (): FlowResult => ({ steps: [], workoutId: null, discrepancies: [], stopped: null, cleanedUp: null, hiddenInPost: null, hiddenVerifyPass: null, unhiddenVerifyPass: null, deletedVerifyPass: null });

const show = (v: unknown): string => (v === undefined ? "undefined" : JSON.stringify(v));

function record(res: FlowResult, name: string, ok: boolean, observed: string): void {
  res.steps.push({ n: res.steps.length + 1, name, ok, observed });
  if (!ok) throw new FlowStop(`${name}: ${observed}`);
}

/** Выставить isHidden полным PUT (прежнее тело из GET) и прочитать обратно. */
export async function setHiddenVerified(tp: TpLike, res: FlowResult, aid: number, id: number, hidden: boolean, label: string): Promise<void> {
  const cur = await tp.getWorkoutDetail(aid, id);
  const put = await tp.putWorkout(aid, id, { ...cur, isHidden: hidden });
  const back = await tp.getWorkoutDetail(aid, id);
  record(res, `${label}: PUT isHidden=${hidden}, затем GET`, back.isHidden === hidden,
    `PUT вернул isHidden=${show(put.isHidden)}; GET isHidden=${show(back.isHidden)} (ждали ${hidden}); title=${show(back.title)}`);
}

/**
 * Создать СКРЫТОЙ в самом POST. Если TP игнорирует isHidden в POST — это РАСХОЖДЕНИЕ (пишется в discrepancies),
 * тренировка скрывается отдельным PUT, как велено; если и PUT не скрыл — СТОП.
 */
export async function createHiddenVerified(tp: TpLike, res: FlowResult, aid: number, body: Record<string, unknown>): Promise<number> {
  const created = await tp.createWorkout({ ...body, isHidden: true });
  res.workoutId = created.workoutId;
  res.steps.push({ n: res.steps.length + 1, name: "POST создать с isHidden:true", ok: true, observed: `workoutId=${created.workoutId}; ответ POST isHidden=${show(created.raw.isHidden)}` });
  const got = await tp.getWorkoutDetail(aid, created.workoutId);
  res.hiddenInPost = got.isHidden === true;
  record(res, "GET после POST: тренировка читается и принадлежит тому же атлету", Number(got.workoutId) === created.workoutId && Number(got.athleteId) === aid,
    `workoutId=${show(got.workoutId)} athleteId=${show(got.athleteId)} title=${show(got.title)} workoutDay=${show(got.workoutDay)}`);
  if (got.isHidden === true) {
    res.steps.push({ n: res.steps.length + 1, name: "GET: скрыта прямо из POST", ok: true, observed: `isHidden=true` });
  } else {
    res.discrepancies.push(`TP ИГНОРИРУЕТ isHidden в POST: отправили isHidden:true, прочитали isHidden=${show(got.isHidden)}. Скрытие возможно только отдельным PUT (окно, пока тренировка видна ученику, есть).`);
    res.steps.push({ n: res.steps.length + 1, name: "GET: скрыта прямо из POST", ok: false, observed: `isHidden=${show(got.isHidden)} — РАСХОЖДЕНИЕ, скрываем отдельным PUT` });
    await setHiddenVerified(tp, res, aid, created.workoutId, true, "скрытие отдельным PUT");
  }
  res.hiddenVerifyPass = true;
  return created.workoutId;
}

export async function deleteVerified(tp: TpLike, res: FlowResult, aid: number, id: number): Promise<void> {
  const del = await tp.deleteWorkout(aid, id);
  let gone = false; let observed = "GET вернул тренировку";
  try { const back = await tp.getWorkoutDetail(aid, id); observed = `GET всё ещё читает: workoutId=${show(back.workoutId)}`; }
  catch (e) { gone = tp.isGone(e); observed = `GET бросил: ${e instanceof Error ? e.message : String(e)}`; }
  record(res, "DELETE, затем GET", del.status === 200 && gone, `DELETE status=${del.status} body=${show(del.body)}; ${observed}`);
}

/** Полный цикл пробника. aid и date проверяет вызывающий; здесь — только поток. */
export async function runProbeCycle(tp: TpLike, aid: number, date: string, body: Record<string, unknown>): Promise<FlowResult> {
  const res = emptyFlow();
  try {
    const before = await tp.listDay(aid, date);
    record(res, "до: на дату пробника у атлета нет тренировок (чужое не трогаем)", before.length === 0, `тренировок на ${date}: ${before.length}${before.length ? ` (${before.map((b) => b.workoutId).join(",")})` : ""}`);
    const id = await createHiddenVerified(tp, res, aid, body);
    const inList = (await tp.listDay(aid, date)).some((w) => w.workoutId === id);
    record(res, "список дня в календаре тренера содержит пробную тренировку", inList, `workoutId ${id} в списке дня: ${inList}`);
    await setHiddenVerified(tp, res, aid, id, false, "открытие");
    res.unhiddenVerifyPass = true;
    await deleteVerified(tp, res, aid, id);
    res.deletedVerifyPass = true;
    const after = await tp.listDay(aid, date);
    record(res, "после: на дату снова пусто", after.length === 0, `тренировок на ${date}: ${after.length}`);
  } catch (e) {
    if (!(e instanceof FlowStop)) throw e;
    res.stopped = e.message;
    if (res.workoutId != null) {
      // уборка: удалить созданное и проверить — иначе у тестового атлета остаётся мусор
      try { await deleteVerified(tp, { ...res, steps: res.steps }, aid, res.workoutId); res.cleanedUp = true; }
      catch (c) { res.cleanedUp = false; res.stopped += ` | УБОРКА НЕ УДАЛАСЬ: ${c instanceof Error ? c.message : String(c)} — удалить вручную workoutId=${res.workoutId}`; }
    }
  }
  return res;
}
