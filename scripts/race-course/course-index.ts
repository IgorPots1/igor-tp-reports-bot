/* index.json: какие разборы опубликованы (его читает бот). Ключ — slug: у старта с несколькими
 * дистанциями их может быть несколько. Общий для build.ts и relite.ts. */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** lite — урезанный разбор (без эталона набора): gain/loss null, мини-профиля нет. */
export type IndexExtra = {
  km: number; label: string | null; gain: number | null; loss: number | null; summary: string;
  points: { n: number; km: number; text: string }[]; mini?: string; lite?: boolean;
};

/** slug — имя файла разбора без .json (у дистанций старта свой: probeg_74251-12k). */
export function updateIndex(dataDir: string, id: string, slug: string, publish: boolean, extra?: IndexExtra) {
  const file = path.join(dataDir, "index.json");
  let list: ({ raceId: string; slug: string } & Partial<IndexExtra>)[] = [];
  try {
    list = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    list = [];
  }
  list = list.filter((x) => x.slug !== slug);
  // km и label — для кнопок выбора дистанции в боте, когда у старта разборов несколько
  if (publish) list.push({ raceId: id, slug, ...(extra ?? {}) });
  list.sort((a, b) => a.raceId.localeCompare(b.raceId));
  writeFileSync(file, JSON.stringify(list, null, 1) + "\n");
}
