/* igorp.run/go/<код>: клик по «Регистрация» или «Сайт» из бота «Забеги России». Записать клик
 * и сразу 302 на нужный адрес. Запись — без ожидания человека: если база задумается, переход
 * всё равно случится. Код: r|s + код старта (+ tg_id и подпись, см. runtime.ts goLink). */

import { after } from "next/server";

import { findRaceByCode, parseGo } from "@/features/races-bot/core";
import { goUser, loadBotRaces, productionBot } from "@/features/races-bot/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const g = parseGo(code);
  const fallback = "https://igorp.run/races";
  if (!g) return Response.redirect(fallback, 302);
  let target = fallback;
  try {
    const race = findRaceByCode(await loadBotRaces(), g.code);
    if (race) {
      target = g.kind === "r" ? race.reg || race.site || race.src || fallback : race.site || race.reg || race.vk || race.src || fallback;
      const tgId = goUser(g);
      after(async () => {
        await productionBot().click(tgId, race, g.kind);
      });
    }
  } catch (e) {
    console.error(`[races-bot] go ${code}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store" } });
}
