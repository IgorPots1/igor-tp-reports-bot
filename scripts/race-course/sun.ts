/* Восход и закат для подсказки «фонарь»: упрощённая формула NOAA (точность пара минут, нам хватает).
 * Чистая функция без сети, её стережёт scripts/check-race-course.ts. */

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Восход и закат в минутах от полуночи местного времени (utcOffsetMin — смещение пояса).
 *  Полярный день или ночь: null. */
export function sunTimes(lat: number, lon: number, isoDate: string, utcOffsetMin: number): { sunrise: number; sunset: number } | null {
  const [y, m, d] = isoDate.split("-").map(Number);
  const n = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = deg(Math.acos(cosH));
  const noonUtc = 720 - 4 * lon - eqtime;
  return { sunrise: Math.round(noonUtc - 4 * ha + utcOffsetMin), sunset: Math.round(noonUtc + 4 * ha + utcOffsetMin) };
}

export const hhmm = (min: number) => `${Math.floor((((min % 1440) + 1440) % 1440) / 60)}:${String(Math.round(((min % 60) + 60) % 60)).padStart(2, "0")}`;
