/* igorp.run/bd/<код>: короткая ссылка на разбор Strava. Код — 6 случайных a-z0-9 из
 * bd_uploads.code (ставит scripts/bd-upload.py), по нику его не угадать.
 *
 * Отдаёт не 302, а маленькую HTML-страницу (раньше был 302 сразу на PDF — превью в Instagram и
 * Telegram выходило пустым: на PDF карточку не построить). Превьюшники JS не исполняют и видят
 * og:*-карточку; человек сразу уходит в PDF через location.replace, без JS — кнопка. Страница
 * нарочно пустая (белый фон, заголовок, кнопка): ничего не должно мелькать перед PDF.
 * Подпись на ig-reels/breakdowns/<name> свежая на каждый заход и живёт час: сама короткая
 * ссылка не протухает, утёкшая подпись — час. Нет строки (или код не того вида), нет файла — 404. */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_RE = /^[a-z0-9]{6}$/;
const SIGN_SECONDS = 3600;
const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

const OG_TITLE = "Your Strava breakdown";
const OG_DESCRIPTION = "Your zones, your training week and 3 fixes. From Igor, running coach.";
const OG_IMAGE = "https://igorp.run/og-breakdown-1200x630.png";

const notFound = () => new Response("Not found", { status: 404, headers: noStore });

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(pdfUrl: string): string {
  // JSON.stringify + экранированный "<": подпись не может закрыть <script>.
  const js = JSON.stringify(pdfUrl).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${OG_TITLE}</title>
<meta name="description" content="${OG_DESCRIPTION}">
<meta property="og:type" content="website">
<meta property="og:title" content="${OG_TITLE}">
<meta property="og:description" content="${OG_DESCRIPTION}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${OG_TITLE}">
<meta name="twitter:description" content="${OG_DESCRIPTION}">
<meta name="twitter:image" content="${OG_IMAGE}">
<style>
  /* Нарочно пусто и нейтрально: белый фон, чёрная кнопка. Прежний вариант (серый фон, кнопка
     цвета Strava #fc4c02, строка «Opening your PDF…») на телефоне мелькал «чем-то похожим на
     Страву» за долю секунды до PDF. Ни внешних ресурсов, ни общих layout'ов. */
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font: 17px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fff; color: #111; text-align: center; }
  main { padding: 24px 16px; width: 100%; max-width: 420px; box-sizing: border-box; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 20px; }
  a { display: block; padding: 16px 20px; border-radius: 12px; background: #111; color: #fff;
    font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
  <h1>${OG_TITLE}</h1>
  <a href="${escHtml(pdfUrl)}">Open your breakdown (PDF)</a>
</main>
<script>location.replace(${js});</script>
</body>
</html>`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return notFound();

  const supabase = createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("bd_uploads")
    .select("name")
    .eq("code", code)
    .eq("status", "done")
    .maybeSingle();
  if (error) {
    console.error(`[bd] ${code}: ${describeSupabaseError(error)}`);
    return new Response("Temporarily unavailable", { status: 503, headers: noStore });
  }
  if (!row) return notFound();

  const { data: signed, error: signError } = await supabase.storage
    .from("ig-reels")
    .createSignedUrl(`breakdowns/${row.name}`, SIGN_SECONDS);
  if (signError || !signed?.signedUrl) {
    // Строка есть, а объекта в Storage нет — для человека это тот же «не найдено».
    console.error(`[bd] ${code}: sign failed: ${describeSupabaseError(signError)}`);
    return notFound();
  }

  return new Response(page(signed.signedUrl), {
    status: 200,
    headers: { ...noStore, "Content-Type": "text/html; charset=utf-8" },
  });
}
