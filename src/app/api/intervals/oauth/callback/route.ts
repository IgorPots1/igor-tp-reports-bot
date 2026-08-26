import type { NextRequest } from "next/server";

// Точка возврата OAuth-потока Intervals.icu: этот адрес указан в заявке на
// регистрацию приложения как redirect URI, поэтому он обязан ОТВЕЧАТЬ ещё до
// того, как обмен кода на токены написан. Пока это заглушка правильной формы:
// разбирает ответ провайдера, отличает отказ от успеха и ничего не дёргает
// по сети. Сюда же ляжет POST https://intervals.icu/api/oauth/token.
//
// Важное про 500: провайдер приводит СЮДА живого человека. Любой отказ должен
// стать читаемой страницей, а не стек-трейсом Next — иначе ученик видит
// «что-то пошло не так» и идёт с этим к тренеру.

export const runtime = "nodejs";
// Страница — результат авторизации конкретного человека. Кэшировать нельзя ни
// на edge, ни в браузере: закэшированное «аккаунт подключён» врало бы следующему.
export const dynamic = "force-dynamic";

const BG = "#F6F4EF";
const SURFACE = "#FFFFFF";
const INK = "#16150F";
const INK_2 = "#4D483F";
const MUTED = "#857F73";
const LINE = "#E7E1D5";
const ACCENT = "#E5480E";
const GREEN = "#2E7D45";

/**
 * Всё, что пришло в query, — чужой текст под контролем провайдера и того, кто
 * подсунул ссылку. Он попадает в HTML, значит экранируется без исключений.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Длинный error_description от провайдера не должен разносить вёрстку. */
function clamp(value: string, limit = 300): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

type PageOptions = {
  status: number;
  tone: "ok" | "error";
  eyebrow: string;
  title: string;
  body: string;
  /** Моноширинные строки технической справки. Уже экранированы. */
  facts?: string[];
};

function renderPage({ status, tone, eyebrow, title, body, facts = [] }: PageOptions): Response {
  const toneColor = tone === "ok" ? GREEN : ACCENT;
  const factsHtml = facts.length
    ? `<ul class="facts">${facts.map((fact) => `<li>${fact}</li>`).join("")}</ul>`
    : "";

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} — Игорь Поцелуев · Беговой клуб</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;background:${BG};color:${INK};font-family:'Onest',system-ui,sans-serif;font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;padding:32px 20px}
  main{width:100%;max-width:560px;background:${SURFACE};border:1px solid ${LINE};border-radius:14px;padding:32px 28px}
  .eyebrow{display:block;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:${toneColor}}
  h1{margin-top:12px;font-size:clamp(24px,4vw,32px);font-weight:700;letter-spacing:-.02em;line-height:1.1}
  p{margin-top:14px;color:${INK_2}}
  .facts{list-style:none;margin-top:22px;padding-top:18px;border-top:1px solid ${LINE};display:grid;gap:7px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px;color:${MUTED};letter-spacing:.01em;word-break:break-word}
  .back{display:inline-block;margin-top:24px;color:${ACCENT};text-decoration:none;font-weight:600;font-size:15px}
</style>
</head>
<body>
<main>
  <span class="eyebrow">${escapeHtml(eyebrow)}</span>
  <h1>${escapeHtml(title)}</h1>
  <p>${body}</p>
  ${factsHtml}
  <a class="back" href="/landing">← На сайт бегового клуба</a>
</main>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

/**
 * Ключи приложения. Читаются ТОЛЬКО из окружения и наружу не отдаются — в
 * ответ уходит один бит «задан / не задан», не значение. Пока приложение не
 * зарегистрировано, обеих переменных нет, и это штатное состояние.
 */
function readCredentialsState(): { configured: boolean; missing: string[] } {
  const clientId = process.env.INTERVALS_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.INTERVALS_CLIENT_SECRET?.trim() ?? "";
  const missing: string[] = [];
  if (!clientId) missing.push("INTERVALS_CLIENT_ID");
  if (!clientSecret) missing.push("INTERVALS_CLIENT_SECRET");
  return { configured: missing.length === 0, missing };
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const code = params.get("code")?.trim() ?? "";
  const state = params.get("state")?.trim() ?? "";
  const error = params.get("error")?.trim() ?? "";
  const errorDescription = params.get("error_description")?.trim() ?? "";

  // 1. Провайдер вернул отказ (чаще всего access_denied — человек нажал «Нет»).
  //    Это нормальный исход, а не сбой: показываем причину словами.
  if (error) {
    return renderPage({
      status: 400,
      tone: "error",
      eyebrow: "intervals.icu · подключение",
      title: "Аккаунт не подключён",
      body:
        "Intervals.icu не выдал доступ. Если вы просто передумали — ничего делать не нужно, " +
        "данные не переданы. Если это ошибка, попробуйте пройти подключение ещё раз или " +
        "напишите тренеру.",
      facts: [
        `код ошибки: ${escapeHtml(clamp(error, 120))}`,
        ...(errorDescription ? [`описание: ${escapeHtml(clamp(errorDescription))}`] : []),
      ],
    });
  }

  // 2. Ни отказа, ни кода — сюда пришли не из потока авторизации (открыли
  //    адрес руками, обрезали ссылку). Отвечаем 400, но по-человечески.
  if (!code) {
    return renderPage({
      status: 400,
      tone: "error",
      eyebrow: "intervals.icu · подключение",
      title: "Код авторизации не пришёл",
      body:
        "Эта страница — точка возврата после подключения Intervals.icu, открывать её напрямую " +
        "незачем. Начните подключение из Intervals.icu, и вы вернётесь сюда уже с кодом.",
    });
  }

  // 3. Код есть. Обмена на токены пока НЕТ — по сети не ходим, код никуда не
  //    сохраняем и на страницу не выводим (это одноразовый секрет).
  const credentials = readCredentialsState();

  return renderPage({
    status: 200,
    tone: "ok",
    eyebrow: "intervals.icu · подключение",
    title: "Аккаунт подключён",
    body:
      "Intervals.icu подтвердил доступ. Тренер увидит ваши тренировки в ближайшей выгрузке — " +
      "делать больше ничего не нужно. Отозвать доступ можно в любой момент в настройках " +
      "Intervals.icu, а что именно мы читаем, описано в " +
      `<a href="/privacy" style="color:${ACCENT};text-decoration:none;font-weight:600">политике конфиденциальности</a>.`,
    facts: [
      "код авторизации: получен",
      `state: ${state ? "получен" : "не передан"}`,
      credentials.configured
        ? "ключи приложения: заданы"
        : `ключи приложения: нет ${escapeHtml(credentials.missing.join(", "))}`,
      "обмен кода на токены: ещё не подключён",
    ],
  });
}
