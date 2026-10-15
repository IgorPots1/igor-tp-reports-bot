/**
 * КОГДА СИГНАЛ ЗДОРОВЬЯ ПЕРЕСТАЁТ ВЛИЯТЬ НА ПЛАН. Чистые функции, без I/O.
 *
 * Закрытие ДЛЯ ПЛАНИРОВАНИЯ, а не в базе: статус сигнала на столе тренера не трогается
 * (это запись в боевую таблицу и отдельное решение). Генератор просто перестаёт считать
 * такой сигнал активным, а аудит показывает его тренеру как протухший.
 *
 * Два правила (решение Игоря 15.10):
 *  (а) ПРОШЁЛ СТАРТ после начала сигнала — человек пробежал гонку, значит сигнал о болезни/боли
 *      до неё больше не описывает его состояние (Хоффман: pain_injury висел после марафона);
 *  (б) СРОК по типу — p90 жизни сигналов этого типа, которые тренер закрыл руками (замер 15.10):
 *        pain_injury            n=26  p50 15  p90 24 дн → 24
 *        health_issue_started   n=83  p50 4   p90 6  дн → 7 (как прежний ILLNESS_DEFAULT_DAYS)
 *        health_issue_improving n=9   p50 3   p90 24 дн → 10 (выборка мала, взято между)
 *        pause_training         закрытых с датой нет     → 14 (оценка, не замер)
 * Ответ ученика («нога в порядке») — подсказка тренеру в аудите, НЕ автозакрытие.
 */
export const ILLNESS_SIGNAL_TYPES = ["health_issue_started", "health_issue_improving", "pain_injury", "pause_training"];
export const SIGNAL_TTL_DAYS: Record<string, number> = { pain_injury: 24, health_issue_started: 7, health_issue_improving: 10, pause_training: 14 };

const days = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export function signalStart(s: Record<string, unknown>): string {
  return String(s.valid_from ?? s.source_date ?? s.target_date ?? String(s.created_at ?? "").slice(0, 10));
}

/** null — сигнал жив; иначе причина, по которой он больше не влияет на план. */
export function staleReason(o: { type: string; start: string; validUntil: string | null; races: string[]; today: string }): string | null {
  const raced = o.races.filter((d) => d > o.start && d < o.today).sort();
  if (raced.length) return `старт ${raced[raced.length - 1]} после начала сигнала`;
  if (o.validUntil && o.validUntil < o.today) return `срок: valid_until ${o.validUntil} прошёл`;
  const ttl = SIGNAL_TTL_DAYS[o.type] ?? 7;
  if (!o.validUntil && days(o.start, o.today) > ttl) return `срок: ${days(o.start, o.today)} дн при сроке ${ttl}`;
  return null;
}

/** Окно действия сигнала для планирования: от начала до min(срок, день после старта). */
export function signalWindow(o: { type: string; start: string; validUntil: string | null; resolvedAt: string | null; races: string[] }): { from: string; to: string } {
  const ttlEnd = new Date(Date.parse(o.start) + (SIGNAL_TTL_DAYS[o.type] ?? 7) * 86400000).toISOString().slice(0, 10);
  let to = o.validUntil ?? o.resolvedAt ?? ttlEnd;
  if (to < o.start) to = ttlEnd;
  const race = o.races.filter((d) => d > o.start).sort()[0];
  if (race && race < to) to = race;
  return { from: o.start, to };
}
