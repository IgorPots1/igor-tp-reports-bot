/* Выжимка одного старта для блока «Всё о старте» в мини-приложении (16.10.2026). Открытые данные
 * организаторов (race_details читается публичным ключом), поэтому без входа; кэш на час. Раскрытие
 * блока пишется в статистику отдельно, через /api/races-bot/miniapp (там проверяется initData). */

import { courseList } from "@/features/race-course";
import { fullDetails } from "@/features/race-details/full";
import { importantLine } from "@/features/race-details/important";
import { loadRacePage } from "@/app/races/load";
import { courseRefs } from "@/app/races/DetailsSections";

// Регион функции — Дублин, рядом с базой (Supabase eu-west-1) и серверами Telegram (18.10.2026):
// было iad1 (Вашингтон), каждый запрос к базе пересекал Атлантику.
export const preferredRegion = "dub1";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id || id.length > 200) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const page = await loadRacePage(id);
  if (!page) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const courses = courseList(page.race.id);
  return Response.json(
    {
      ok: true,
      important: importantLine(page.rows),
      details: fullDetails(page.rows, page.race.ds, courses.length > 0),
      courses: courseRefs(courses),
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
