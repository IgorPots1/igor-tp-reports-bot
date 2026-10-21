/**
 * Когда тренировку можно отметить и каким днём ляжет отчёт [решение Игоря,
 * 21.10.2026]. Чистый модуль без node-зависимостей: им пользуются и страница
 * (показать «Отметить»), и сервер (решить, что записать).
 *
 * ЗАЧЕМ. Валентина часто бегает не в день из плана. Раньше «Отметить» было
 * только у прошедших и сегодняшних карточек, и пробежку в среду вместо пятницы
 * отметить было нечем. Теперь кнопка на КАЖДОЙ карточке текущей недели, как у
 * Ильи.
 *
 * ПРАВИЛО:
 * - тренировка в прошлом или сегодня — отчёт её днём, как было;
 * - тренировка в будущем этой недели — пробежка была СЕГОДНЯ (в будущем её быть
 *   не может), отчёт ложится сегодняшним днём, а тренировка переезжает на
 *   сегодня как перенос ученицей (moved_by student);
 * - тренировка следующих недель — заранее не отмечается: перенос между
 *   неделями запрещён тем же правилом, что у мини-аппа (move.ts, outside_week).
 */

export type ReportDay =
  | { ok: true; reportDate: string; moveToToday: boolean }
  | { ok: false; reason: string };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function reportDayFor(input: { sessionDate: string; weekStart: string; todayIso: string }): ReportDay {
  if (input.sessionDate <= input.todayIso) {
    return { ok: true, reportDate: input.sessionDate, moveToToday: false };
  }
  const inThisWeek = input.weekStart <= input.todayIso && input.todayIso <= addDays(input.weekStart, 6);
  if (!inThisWeek) {
    return { ok: false, reason: "Заранее отмечается только тренировка этой недели." };
  }
  return { ok: true, reportDate: input.todayIso, moveToToday: true };
}
