import type { NextRequest } from "next/server";

import { ingestStudentActivities } from "@/features/intervals/ingest";
import { redactSecrets } from "@/features/intervals/auth";
import {
  exchangeCodeForToken,
  oauthConfigMissing,
  readOauthConfig,
} from "@/features/intervals/oauth";
import {
  connectOauthSource,
  consumeOauthState,
  recordOauthOutcome,
} from "@/features/intervals/repository";

/** Окно первой выгрузки. Короткое: человек ждёт ответа страницы. */
const FIRST_PULL_DAYS = 14;

// Точка возврата OAuth-потока Intervals.icu. Здесь код меняется на токен,
// источник ученика получает доступ, и человеку показывается, ЧТО именно
// подключилось.
//
// Важное про 500: провайдер приводит СЮДА живого человека. Любой отказ должен
// стать читаемой страницей, а не стек-трейсом Next — иначе ученик видит
// «что-то пошло не так» и идёт с этим к тренеру.
//
// ПЕРВАЯ ВЫГРУЗКА ИДЁТ ПРЯМО ЗДЕСЬ, окном в две недели. Иначе человек увидит
// «подключено» и пустой экран, и не поймёт, сработало ли: «подключено» без
// единой тренировки выглядит как неудача. Две недели — компромисс с временем
// ответа: полная история приедет раннером.

export const runtime = "nodejs";
// Обмен кода плюс первая выгрузка не укладываются в дефолтные десять секунд.
export const maxDuration = 60;
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
  <a class="back" href="/club">← На сайт бегового клуба</a>
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

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const code = params.get("code")?.trim() ?? "";
  const state = params.get("state")?.trim() ?? "";
  const error = params.get("error")?.trim() ?? "";
  const errorDescription = params.get("error_description")?.trim() ?? "";

  // 1. Провайдер вернул отказ (чаще всего access_denied — человек нажал «Нет»).
  //    Это нормальный исход, а не сбой: показываем причину словами.
  if (error) {
    if (state) await recordOauthOutcome(state, "denied");
    return renderPage({
      status: 400,
      tone: "error",
      eyebrow: "intervals.icu · подключение",
      title: "Часы не подключены",
      body:
        "Intervals.icu не выдал доступ. Если вы просто передумали, ничего делать не нужно: " +
        "данные не переданы. Если это вышло случайно, вернитесь в приложение и нажмите " +
        "«Подключить часы» ещё раз.",
      facts: [
        `код ошибки: ${escapeHtml(clamp(error, 120))}`,
        ...(errorDescription ? [`описание: ${escapeHtml(clamp(errorDescription))}`] : []),
      ],
    });
  }

  // 2. Ни отказа, ни кода — сюда пришли не из потока авторизации.
  if (!code) {
    return renderPage({
      status: 400,
      tone: "error",
      eyebrow: "intervals.icu · подключение",
      title: "Код авторизации не пришёл",
      body:
        "Эта страница — точка возврата после подключения Intervals.icu, открывать её напрямую " +
        "незачем. Начните подключение из приложения, и вы вернётесь сюда уже с кодом.",
    });
  }

  // 3. STATE ПРОВЕРЯЕТСЯ ДО ЛЮБОГО ОБРАЩЕНИЯ К ПРОВАЙДЕРУ. Он отвечает на два
  //    вопроса: наш ли это возврат и ЧЕЙ он. Без него код, подсунутый со
  //    стороны, привязал бы чужой аккаунт к чьей-то карточке.
  if (!state) {
    return renderPage({
      status: 400,
      tone: "error",
      eyebrow: "intervals.icu · подключение",
      title: "Не удалось подтвердить, чьё это подключение",
      body:
        "В возврате не хватает метки, по которой мы узнаём, кому выдавали ссылку. " +
        "Вернитесь в приложение и начните подключение заново.",
    });
  }

  const checked = await consumeOauthState(state);
  if (!checked.ok) {
    const titles: Record<string, string> = {
      unknown: "Ссылка не наша",
      replayed: "Эта ссылка уже сработала",
      expired: "Ссылка устарела",
    };
    const bodies: Record<string, string> = {
      unknown:
        "Метка возврата нам незнакома. Так бывает, если ссылку открыли не из приложения. " +
        "Начните подключение заново.",
      replayed:
        "По этой ссылке подключение уже прошло. Если часы не подключились, вернитесь в " +
        "приложение и начните заново: каждая ссылка одноразовая.",
      expired:
        "С момента, когда вы начали подключение, прошло больше часа. Начните заново, это быстро.",
    };
    if (checked.code !== "unknown") await recordOauthOutcome(state, checked.code);
    return renderPage({
      status: 400,
      tone: "error",
      eyebrow: "intervals.icu · подключение",
      title: titles[checked.code] ?? "Подключение не прошло",
      body: bodies[checked.code] ?? "Начните подключение заново.",
    });
  }

  const config = readOauthConfig();
  if (!config) {
    console.error("[intervals.oauth.callback] нет ключей приложения", { missing: oauthConfigMissing() });
    await recordOauthOutcome(state, "failed");
    return renderPage({
      status: 503,
      tone: "error",
      eyebrow: "intervals.icu · подключение",
      title: "Подключение пока недоступно",
      body: "Напишите тренеру: на нашей стороне не хватает настройки. Ваши данные не пострадали.",
    });
  }

  // 4. Обмен кода на токен.
  const exchange = await exchangeCodeForToken({ config, code });
  if (!exchange.ok) {
    // Причина уходит в лог тренеру, человеку — человеческие слова. В причине
    // может быть кусок ответа провайдера, поэтому она прогнана через redact.
    console.error("[intervals.oauth.callback] обмен кода не прошёл", {
      reason: redactSecrets(exchange.reason),
    });
    await recordOauthOutcome(state, "failed");
    return renderPage({
      status: 502,
      tone: "error",
      eyebrow: "intervals.icu · подключение",
      title: "Intervals.icu не выдал доступ",
      body:
        "Разрешение вы дали, но обменять его на доступ не получилось. Попробуйте подключить " +
        "ещё раз из приложения. Если повторится, напишите тренеру.",
    });
  }

  // 5. Токен в источник. Отказ здесь — это либо чужой занятый аккаунт, либо
  //    сбой базы; и то и другое человеку надо назвать, а не свести к «ошибке».
  const connected = await connectOauthSource({
    studentUuid: checked.studentUuid,
    externalAthleteId: exchange.token.athleteId,
    accessToken: exchange.token.accessToken,
    scope: exchange.token.scope,
  });
  if (!connected.ok) {
    console.error("[intervals.oauth.callback] не удалось привязать источник", {
      reason: redactSecrets(connected.reason),
    });
    await recordOauthOutcome(state, "failed");
    return renderPage({
      status: 409,
      tone: "error",
      eyebrow: "intervals.icu · подключение",
      title: "Не удалось привязать аккаунт",
      body: `${escapeHtml(clamp(connected.reason, 200))}. Напишите тренеру, он разберётся.`,
    });
  }

  await recordOauthOutcome(state, "connected");

  // 6. ПЕРВАЯ ВЫГРУЗКА. Человеку нужно увидеть, что подключилось не «вообще», а
  //    его тренировки. Окно короткое: полная история приедет раннером.
  let pulled: number | null = null;
  let pullNote: string | null = null;
  try {
    const summary = await ingestStudentActivities({
      studentUuid: checked.studentUuid,
      from: new Date(Date.now() - FIRST_PULL_DAYS * 86_400_000).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
    });
    pulled = summary.activitiesSaved;
  } catch (caught) {
    // Подключение СОСТОЯЛОСЬ, выгрузка — нет. Врать про неудачу подключения
    // нельзя, замалчивать пустой экран тоже.
    console.error("[intervals.oauth.callback] первая выгрузка не прошла", {
      error: redactSecrets(caught instanceof Error ? caught.message : String(caught)),
    });
    pullNote = "Тренировки подтянутся в течение получаса.";
  }

  const athleteName = exchange.token.athleteName;
  const scopeGranted = exchange.token.scope;

  return renderPage({
    status: 200,
    tone: "ok",
    eyebrow: "intervals.icu · подключение",
    title: "Часы подключены",
    body:
      (athleteName
        ? `Подключён аккаунт <b>${escapeHtml(athleteName)}</b>. `
        : "Аккаунт Intervals.icu подключён. ") +
      (pulled !== null
        ? pulled > 0
          ? `За последние ${FIRST_PULL_DAYS} дней перенесли тренировок: <b>${pulled}</b>. Остальная история подтянется в ближайшие полчаса. `
          : `За последние ${FIRST_PULL_DAYS} дней тренировок не нашлось — это нормально, если вы давно не записывали. Новые появятся сами. `
        : `${pullNote} `) +
      "Возвращайтесь в приложение: дальше пара вопросов про график, и тренер соберёт план.",
    facts: [
      `аккаунт: ${escapeHtml(exchange.token.athleteId)}`,
      ...(scopeGranted ? [`выданные права: ${escapeHtml(clamp(scopeGranted, 160))}`] : []),
      "доступ можно отозвать в настройках Intervals.icu в любой момент",
    ],
  });
}
