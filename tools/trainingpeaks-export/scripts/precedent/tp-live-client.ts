/**
 * Живой адаптер tp-api-client под TpLike (hidden-flow.ts). Подгружается ТОЛЬКО в реальном режиме:
 * в сухом прогоне этот файл не импортируется, сетевых вызовов нет.
 */
import type { TpLike } from "./hidden-flow.ts";

export async function liveClient(): Promise<TpLike> {
  const tp = await import("../../../../src/features/trainingpeaks/tp-api-client.ts");
  return {
    createWorkout: (b) => tp.createWorkout(b as unknown as Parameters<typeof tp.createWorkout>[0]),
    getWorkoutDetail: (a, i) => tp.getWorkoutDetail(a, i),
    putWorkout: (a, i, b) => tp.putWorkout(a, i, b),
    deleteWorkout: (a, i) => tp.deleteWorkout("tpapi", a, i),
    listDay: async (a, d) => (await tp.getWorkoutsByDateRange(a, d, d)).map((w) => ({ workoutId: w.workoutId, title: String(w.title ?? "") })),
    isGone: (e) => e instanceof tp.TpApiHttpError && tp.isWorkoutGone(e.status, e.body),
  };
}

/** Состояние локального снимка сессии БЕЗ сети и без вывода секретов: есть ли файл и не протух ли. */
export async function sessionState(): Promise<string> {
  try {
    const snap = await import("../../../../src/features/trainingpeaks/tp-session-snapshot.ts");
    const s = await snap.readSessionSnapshot();
    return snap.isSnapshotCookieFresh(s) ? "снимок сессии найден и свежий" : "снимок сессии найден, но cookie скоро истечёт (<24 ч)";
  } catch (e) { return `снимка сессии нет или не читается: ${e instanceof Error ? e.constructor.name : "ошибка"}`; }
}
