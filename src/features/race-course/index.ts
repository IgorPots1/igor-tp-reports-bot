/* Какие старты имеют разбор трассы: для кнопки «Разбор трассы» в боте. Список собирается вместе
 * с данными (src/data/race-courses/index.json) и попадает в сборку, файловая система не нужна. */

import index from "@/data/race-courses/index.json";
import { SITE_URL } from "@/lib/site";

const BY_ID = new Map((index as { raceId: string; slug: string }[]).map((x) => [x.raceId, x.slug]));

/** Адрес разбора трассы или null, если разбора нет. */
export function courseUrl(raceId: string): string | null {
  const slug = BY_ID.get(raceId);
  return slug ? `${SITE_URL}/races/${slug}/trassa` : null;
}
