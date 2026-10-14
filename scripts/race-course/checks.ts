/* Сверка набора высоты: наш (DEM) против эталонов организатора и ученика.
 * Правило наряда 14.10.2026: расхождение больше 30% с любым из доступных эталонов,
 * значит профиль не публикуем и пишем почему. Эталона нет, значит сверять не с чем (не ошибка). */

export const GAIN_TOLERANCE = 0.3;

export type GainCheck = { ours: number; organizer: number | null; student: number | null; publish: boolean; reason: string | null };

export function checkGain(ours: number, organizer: number | null, student: number | null, extraReasons: string[] = []): GainCheck {
  const reasons: string[] = [];
  const cmp = (ref: number | null, who: string) => {
    if (ref == null || !(ref > 0)) return;
    const diff = Math.abs(ours - ref) / ref;
    if (diff > GAIN_TOLERANCE) {
      reasons.push(`набор по DEM ${Math.round(ours)} м расходится с ${who} (${Math.round(ref)} м) на ${Math.round(diff * 100)}%, допуск ${GAIN_TOLERANCE * 100}%`);
    }
  };
  cmp(organizer, "цифрой организатора");
  cmp(student, "треком ученика");
  reasons.push(...extraReasons);
  return { ours: Math.round(ours), organizer, student, publish: reasons.length === 0, reason: reasons.length ? reasons.join("; ") : null };
}
