/* Данные календаря на сервере для /races и /api/races/query (наряд 30.10.2026): список, ожидаемые,
 * правки дат — один раз на 10 минут на экземпляр функции. Без этого каждый запрос порции заново читал
 * бы ~2400 строк календаря и все ожидаемые. База обновляется раз в неделю, страница — раз в час,
 * 10 минут разницы не видно. Сбой чтения не запоминается: следующий запрос попробует снова. */

import { publicExpected } from "@/features/races-bot/core";

import { loadExpected } from "./expected";
import { loadDateFixed, loadDetailsIndex, loadRaces, todayIso } from "./load";
import { publicRace } from "./races-logic";
import type { Ctx } from "./race-query";

const TTL_MS = 10 * 60 * 1000;

let ctxMemo: { at: number; day: string; p: Promise<Ctx | null> } | null = null;

/** null — база недоступна (страница покажет «не получилось загрузить»). */
export function raceContext(): Promise<Ctx | null> {
  const now = Date.now();
  const day = todayIso();
  if (ctxMemo && now - ctxMemo.at < TTL_MS && ctxMemo.day === day) return ctxMemo.p;
  const p = (async () => {
    const [loaded, expected, dateFixed] = await Promise.all([loadRaces(), loadExpected(), loadDateFixed()]);
    if (!loaded) return null;
    // В браузер — только публичные поля: без страницы-источника, «Важного» и прошлого проведения.
    return {
      races: loaded.map((r) => ({ ...publicRace(r), dateFixed: dateFixed.has(r.id) })),
      expected: expected.map(publicExpected),
      today: day,
    };
  })();
  ctxMemo = { at: now, day, p };
  p.then((c) => {
    if (!c && ctxMemo?.p === p) ctxMemo = null;
  }).catch(() => {
    if (ctxMemo?.p === p) ctxMemo = null;
  });
  return p;
}

let detailsMemo: { at: number; p: Promise<Map<string, { line: string | null; n: number }>> } | null = null;

/** «Важное» и число полей выжимки по старту — только для ответов мини-приложению. */
export function detailsIndex(): Promise<Map<string, { line: string | null; n: number }>> {
  const now = Date.now();
  if (detailsMemo && now - detailsMemo.at < TTL_MS) return detailsMemo.p;
  const p = loadDetailsIndex();
  detailsMemo = { at: now, p };
  // пустая карта — сбой чтения (loadDetailsIndex его глотает): не запоминаем
  void p.then((m) => {
    if (!m.size && detailsMemo?.p === p) detailsMemo = null;
  });
  return p;
}
