/**
 * OAuth Intervals.icu: ссылка авторизации и обмен кода на токен.
 *
 * ФАКТЫ О ПРОВАЙДЕРЕ [сверено по их объявлению об OAuth, 14.09.2026]:
 *
 *   авторизация:  GET  https://intervals.icu/oauth/authorize
 *                      ?client_id&redirect_uri&scope&state
 *   обмен кода:   POST https://intervals.icu/api/oauth/token
 *                      client_id, client_secret, code
 *   ответ:        { token_type, access_token, scope, athlete: { id, name } }
 *
 * ТОКЕН НЕ ПРОТУХАЕТ, И ОБНОВЛЯТЬ ЕГО НЕЧЕМ. В ответе нет ни expires_in, ни
 * refresh_token, и сроков жизни провайдер не объявляет: новая авторизация
 * выдаёт новый токен и ЗАМЕЩАЕТ прежний. Поэтому здесь нет функции обновления —
 * не потому что «потом», а потому что обновлять нечего.
 *
 * Доступ всё же может кончиться: человек отзовёт его в настройках Intervals или
 * переавторизует приложение где-то ещё. Снаружи оба случая выглядят одинаково —
 * 401/403 на обычном запросе, и лечатся они повторным подключением, а не
 * обновлением токена. Распознаёт их isAuthFailure ниже.
 */

import { SITE_URL } from "@/lib/site";

import { IntervalsApiError } from "./api-client";
import { redactSecrets } from "./auth";

const AUTHORIZE_URL = "https://intervals.icu/oauth/authorize";
const TOKEN_URL = "https://intervals.icu/api/oauth/token";

/**
 * Права, которые просим.
 *
 * ИМЕНА БЕЗ СУФФИКСОВ, И ЭТО НЕ КОСМЕТИКА [14.09.2026]. Раньше здесь стояли
 * ACTIVITY:READ и ACTIVITY:WRITE, и подключение падало на стороне провайдера
 * с «Duplicate scope ACTIVITY»: у Intervals права называются ACTIVITY,
 * CALENDAR, WELLNESS, SETTINGS, CHATS — без :READ и :WRITE. Два наших значения
 * сходились в одно имя, и это читалось как дубль. Право даёт и чтение, и
 * запись сразу; разделения на уровне scope у них нет.
 *
 * ACTIVITY  — сами тренировки и их ряды, ради этого всё и затевается; сюда же
 *             входит запись, чтобы позже класть разбор комментарием.
 * WELLNESS  — пульс покоя, сон, вес: контекст «почему далось тяжело».
 * CALENDAR  — план в календаре ученика (следующий шаг, но права просим сразу:
 *             повторное согласие — это ещё один экран, на котором человек
 *             отваливается).
 *
 * SETTINGS НЕ ПРОСИМ, и это проверено, а не «на всякий случай»: ни одна строка
 * кода не читает у Intervals ни зоны, ни пороги. api-client.ts ходит ровно в
 * три места — список тренировок, тренировка, ряды тренировки. Пороги мы
 * считаем сами из истории. Появится чтение зон — добавим вместе с ним, а не
 * раньше: каждая лишняя строчка в окне согласия это повод не нажать
 * «Разрешить».
 */
export const INTERVALS_SCOPES = ["ACTIVITY", "CALENDAR", "WELLNESS"] as const;

export type IntervalsOauthConfig = { clientId: string; clientSecret: string };

/**
 * Ключи приложения. Читаются ТОЛЬКО из окружения; наружу отдаётся факт наличия,
 * не значение.
 */
export function readOauthConfig(): IntervalsOauthConfig | null {
  const clientId = process.env.INTERVALS_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.INTERVALS_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function oauthConfigMissing(): string[] {
  const missing: string[] = [];
  if (!process.env.INTERVALS_CLIENT_ID?.trim()) missing.push("INTERVALS_CLIENT_ID");
  if (!process.env.INTERVALS_CLIENT_SECRET?.trim()) missing.push("INTERVALS_CLIENT_SECRET");
  return missing;
}

/**
 * Адрес возврата. Обязан совпадать с указанным при регистрации приложения.
 *
 * Берётся из SITE_URL в lib/site — единственного места, где записан адрес
 * сайта. Своя переменная окружения здесь завела бы вторую правду: при смене
 * домена одна половина приложения переехала бы, а вторая нет.
 */
export function redirectUri(): string {
  return `${SITE_URL.replace(/\/+$/, "")}/api/intervals/oauth/callback`;
}

export function buildAuthorizeUrl(input: { clientId: string; state: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  // Пробелов в разделителе нет: провайдер в своих примерах перечисляет права
  // через запятую, и лишний пробел уезжает в подпись ссылки.
  url.searchParams.set("scope", INTERVALS_SCOPES.join(","));
  url.searchParams.set("state", input.state);
  return url.toString();
}

/**
 * Идентификатор атлета в форме, которую понимает путь API.
 *
 * ПОЧЕМУ ЭТО ВООБЩЕ НУЖНО. Обмен кода возвращает athlete.id ЧИСЛОМ-СТРОКОЙ
 * («2049151»), а путь запроса у них — /api/v1/athlete/i2049151/activities, с
 * буквой. Ключи, заведённые руками, тренер клал уже с буквой («i38500»).
 * Приводим к одному виду здесь, в одном месте: разъехавшиеся формы дали бы 404
 * на ровном месте, причём только у части учеников.
 */
export function normaliseAthleteId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Провайдер не вернул идентификатор атлета");
  return /^i/i.test(trimmed) ? trimmed : `i${trimmed}`;
}

export type TokenExchangeResult = {
  accessToken: string;
  tokenType: string;
  scope: string | null;
  athleteId: string;
  athleteName: string | null;
};

export type TokenExchangeOutcome =
  | { ok: true; token: TokenExchangeResult }
  | { ok: false; reason: string };

/**
 * Обмен одноразового кода на токен.
 *
 * СЕКРЕТЫ НЕ ПОПАДАЮТ НИ В ОДНУ СТРОКУ, которая может уйти в лог или на экран:
 * тело ответа прогоняется через redactSecrets, а сам токен возвращается только
 * вызывающему, который сразу кладёт его в базу.
 */
export async function exchangeCodeForToken(input: {
  config: IntervalsOauthConfig;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenExchangeOutcome> {
  const body = new URLSearchParams({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    code: input.code,
    // redirect_uri провайдер в списке обязательных не называет, но присылаем:
    // сервера OAuth часто сверяют его с тем, что было в авторизации, и
    // несовпадение выглядит как «код недействителен».
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });

  const doFetch = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch (error) {
    return { ok: false, reason: `запрос токена не дошёл: ${redactSecrets(String(error))}` };
  }

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      reason: `провайдер отказал: HTTP ${response.status} ${redactSecrets(text).slice(0, 300)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "ответ провайдера не разобрался как JSON" };
  }

  const payload = parsed as {
    access_token?: unknown;
    token_type?: unknown;
    scope?: unknown;
    athlete?: { id?: unknown; name?: unknown };
  };

  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) return { ok: false, reason: "в ответе нет access_token" };

  const rawAthleteId =
    typeof payload.athlete?.id === "string"
      ? payload.athlete.id
      : typeof payload.athlete?.id === "number"
        ? String(payload.athlete.id)
        : "";
  if (!rawAthleteId) return { ok: false, reason: "в ответе нет идентификатора атлета" };

  return {
    ok: true,
    token: {
      accessToken,
      tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
      scope: typeof payload.scope === "string" ? payload.scope : null,
      athleteId: normaliseAthleteId(rawAthleteId),
      athleteName: typeof payload.athlete?.name === "string" ? payload.athlete.name : null,
    },
  };
}

/**
 * Перестал ли провайдер принимать наш доступ.
 *
 * 401 и 403 — единственные два ответа, после которых повторять запрос
 * бессмысленно: доступ отозван или замещён. Всё остальное (429, 5xx, обрыв
 * сети) — временное, и записывать это как «подключение отвалилось» значило бы
 * гонять человека переподключаться из-за чужого сбоя.
 */
export function isAuthFailure(error: unknown): boolean {
  return error instanceof IntervalsApiError && (error.status === 401 || error.status === 403);
}

/** Что показать человеку, когда доступ перестал работать. */
export const AUTH_FAILURE_MESSAGE_RU =
  "Intervals.icu перестал принимать доступ. Так бывает, если вы отозвали его в настройках " +
  "или подключили приложение заново в другом месте. Нажмите «Подключить часы» ещё раз.";
