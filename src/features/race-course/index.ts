/* Какие старты имеют разбор трассы: для кнопки «Разбор трассы» в боте. Список собирается вместе
 * с данными (src/data/race-courses/index.json) и попадает в сборку, файловая система не нужна.
 * У старта с несколькими дистанциями разборов несколько (наряд 15.10.2026): бот даёт выбор по км. */

import index from "@/data/race-courses/index.json";
import { SITE_URL } from "@/lib/site";

type Entry = {
  raceId: string; slug: string; km?: number; label?: string | null; gain?: number; loss?: number;
  summary?: string; points?: { n: number; km: number; text: string }[]; mini?: string;
};

/** Разбор для бота: адрес страницы, цифры, суть и до 4 точек короткого разбора с мини-профилем. */
export type CourseLink = {
  url: string; km: number | null; label: string | null; gain: number | null; loss: number | null;
  summary: string | null; points: { n: number; km: number; text: string }[]; mini: string | null;
};

const BY_ID = new Map<string, CourseLink[]>();
for (const x of index as Entry[]) {
  const list = BY_ID.get(x.raceId) ?? [];
  list.push({
    url: `${SITE_URL}/races/${x.slug}/trassa`, km: x.km ?? null, label: x.label ?? null, gain: x.gain ?? null, loss: x.loss ?? null,
    summary: x.summary ?? null, points: x.points ?? [], mini: x.mini ? `${SITE_URL}${x.mini}` : null,
  });
  BY_ID.set(x.raceId, list);
}
// Дистанции по возрастанию км: так их и показываем кнопками.
for (const list of BY_ID.values()) list.sort((a, b) => (a.km ?? 0) - (b.km ?? 0));

/** Все опубликованные разборы старта (пусто, если нет ни одного). */
export function courseList(raceId: string): CourseLink[] {
  return BY_ID.get(raceId) ?? [];
}

/**
 * Место под рассылку разбора тем, кто следит за стартом (экран 5 макета). НЕ ПОДКЛЮЧЕНО и никем не
 * вызывается: рассылка — отдельный наряд и отдельное «да» тренера (бот никому ничего не шлёт сам).
 * Здесь только текст, чтобы при подключении не сочинять его заново.
 */
export function courseNoticeText(raceName: string, courses: CourseLink[]): string | null {
  if (!courses.length) return null;
  return `Для «${raceName}» готов разбор трассы: подъёмы, спуски и ветер в эти дни. Открой карточку старта, кнопка «Разбор трассы».`;
}

/** Адрес разбора, если он у старта один; иначе null (несколько, значит выбор дистанции). */
export function courseUrl(raceId: string): string | null {
  const list = courseList(raceId);
  return list.length === 1 ? list[0].url : null;
}
