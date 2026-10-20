/* Выжимка одного старта для блока «Всё о старте» в мини-приложении (16.10.2026). Только для
 * мини-приложения (наряд 20.10.2026): подписанный initData в заголовке X-Telegram-Init-Data, иначе
 * 401 и строка в журнал отказов (src/features/race-guard/miniapp-auth.ts). Страница старта на сайте
 * берёт выжимку на сервере (loadRacePage), этот адрес ей не нужен. Ответ личный: в CDN не кэшируется,
 * иначе закэшированную выжимку получил бы и запрос без подписи. Раскрытие блока пишется в статистику
 * отдельно, через /api/races-bot/miniapp. */

import { courseList } from "@/features/race-course";
import { fullDetails } from "@/features/race-details/full";
import { importantLine } from "@/features/race-details/important";
import { COPYRIGHT_HEADERS } from "@/features/race-guard/guard";
import { requireMiniapp } from "@/features/race-guard/miniapp-auth";
import { loadRacePage } from "@/app/races/load";
import { courseRefs } from "@/app/races/DetailsSections";

export const runtime = "nodejs";
// Регион функции — Дублин, рядом с базой (Supabase eu-west-1) и серверами Telegram (18.10.2026):
// было iad1 (Вашингтон), каждый запрос к базе пересекал Атлантику.
export const preferredRegion = "dub1";

export async function GET(request: Request) {
  const auth = await requireMiniapp(request);
  if (auth instanceof Response) return auth;
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
    { headers: { "Cache-Control": "private, no-store", ...COPYRIGHT_HEADERS } },
  );
}
