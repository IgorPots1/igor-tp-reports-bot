/**
 * Страница плана ученицы (igorp.run/plan/<slug>/<token>) — чистая часть, без
 * базы и без сети: адреса, токены, первая строка ответа, очередь уведомлений.
 *
 * Страница заменяет мини-апп /m/run для тех, кому тренер выпустил ссылку.
 * Данные у неё те же (intervals_*), отдельного плана нет.
 */
import { randomBytes } from "node:crypto";

import { SITE_URL } from "@/lib/site";

/**
 * ОДИН ФЛАГ НА ВСЁ НОВОЕ [решение Игоря, 21.10.2026]. Включён — у учениц с
 * живой ссылкой бот ведёт на страницу, мини-апп показывает «План переехал».
 * Выключен — всё как было, все ведут в /m/run. Это и есть откат.
 */
export function isPlanPageEnabled(): boolean {
  return process.env.INTERVALS_PLAN_PAGE_ENABLED === "true";
}

export const PLAN_TOKEN_RE = /^[a-f0-9]{32,64}$/;
export const PLAN_SLUG_RE = /^[a-z0-9-]{2,40}$/;

export function newPlanToken(): string {
  return randomBytes(24).toString("hex");
}

/** «valentina-0798» → «valentina». Только для читаемости адреса: доступ даёт токен. */
export function slugFromStudentId(studentId: string): string {
  const head = studentId.toLowerCase().split("-")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  return PLAN_SLUG_RE.test(head) ? head : "plan";
}

export type PlanLinkRef = { slug: string; token: string };

/**
 * Куда ведёт кнопка. Каждое сообщение бота открывает НУЖНОЕ место страницы, а
 * не главную: человек нажал «Тренер ответил» — он хочет увидеть ответ, а не
 * искать его по неделям.
 */
export type PlanTarget =
  | { kind: "week"; weekStart: string }
  | { kind: "session"; sessionId: string }
  | { kind: "coach" }
  | { kind: "home" };

export function planPageUrl(link: PlanLinkRef, target: PlanTarget = { kind: "home" }): string {
  const base = `${SITE_URL.replace(/\/+$/, "")}/plan/${link.slug}/${link.token}`;
  switch (target.kind) {
    case "week":
      return `${base}?w=${target.weekStart}`;
    case "session":
      return `${base}?s=${target.sessionId}`;
    case "coach":
      return `${base}?tab=coach`;
    default:
      return base;
  }
}

/**
 * ПЕРВАЯ СОДЕРЖАТЕЛЬНАЯ СТРОКА ОТВЕТА [решение Игоря, 21.10.2026].
 *
 * В уведомлении «Тренер ответил» не весь текст, а одна строка — та, по
 * которой понятно, о чём ответ. Приветствие («Добрый день.», «Валентина,
 * здравствуйте!») содержательной строкой не считается: в уведомлении оно
 * занимает всё место и ничего не говорит.
 *
 * Приветствие узнаётся только как ОТДЕЛЬНАЯ короткая строка или первое
 * предложение строки. «Добрый день. Разбор недели…» → «Разбор недели…».
 */
const GREETING_RE =
  /^(?:[А-ЯЁ][а-яё]+,\s*)?(?:добрый\s+(?:день|вечер|утро)|доброе\s+утро|здравствуйте|привет|приветствую|hello|hi)(?:,\s*[А-ЯЁ][а-яё]+)?\s*[.!,]?$/iu;
const NAME_ONLY_RE = /^[А-ЯЁ][а-яё]+[.!,]?$/u;
const NOTICE_LINE_MAX = 160;

function isGreeting(sentence: string): boolean {
  const s = sentence.trim();
  return s.length > 0 && s.length <= 50 && (GREETING_RE.test(s) || NAME_ONLY_RE.test(s));
}

export function firstMeaningfulLine(body: string): string {
  for (const rawLine of body.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    // Отрезаем приветственные предложения в начале строки, по одному.
    for (;;) {
      const m = line.match(/^([^.!?]*[.!?])\s+(.+)$/u);
      if (m && isGreeting(m[1])) {
        line = m[2].trim();
        continue;
      }
      break;
    }
    if (isGreeting(line)) continue;
    return line.length > NOTICE_LINE_MAX ? `${line.slice(0, NOTICE_LINE_MAX - 1).trimEnd()}…` : line;
  }
  return "";
}

/**
 * «Тренер ответил» в бот для ученицы на странице: не весь ответ, а его суть
 * одной строкой. Весь текст — на странице, по кнопке.
 */
export function coachReplyNoticeRu(body: string): string {
  const line = firstMeaningfulLine(body);
  return line ? `Тренер ответил:\n${line}` : "Тренер ответил.";
}

/**
 * Напоминание бота для ученицы на странице [решение Игоря, 21.10.2026].
 *
 * Решение «слать или нет» остаётся за decideReminder — общее для всех. Здесь
 * только то, чем страница отличается:
 * - НЕДЕЛЬНУЮ ФОРМУ НЕ ШЛЁМ ВОВСЕ: на странице её нет, а мини-апп показывает
 *   «План переехал». Её заменяет «Написать тренеру»;
 * - у каждого напоминания кнопка на КАРТОЧКУ ТРЕНИРОВКИ, о которой речь;
 * - «приложение» в тексте заменено: его у неё больше нет.
 */
export type PageReminder =
  | { send: true; textRu: string; target: PlanTarget }
  | { send: false; reason: string };

export function reminderForPage(input: {
  kind: "today_session" | "checkin_nudge" | "missed_nudge" | "weekly_form" | string;
  textRu: string;
  todaySessionId: string | null;
  yesterdaySessionId: string | null;
}): PageReminder {
  if (input.kind === "weekly_form") {
    return { send: false, reason: "недельная форма ей не идёт: на странице плана её нет" };
  }
  const sessionId = input.kind === "missed_nudge" ? input.yesterdaySessionId : input.todaySessionId;
  const textRu = input.textRu
    .replace("прямо в приложении", "прямо в плане: нажмите на дату тренировки")
    .replace(/в приложении/gu, "в плане");
  return {
    send: true,
    textRu,
    target: sessionId ? { kind: "session", sessionId } : { kind: "home" },
  };
}

/**
 * Утренняя очередь уведомлений тренеру [решение Игоря, 21.10.2026].
 *
 * Боль и сообщения ученицы подчиняются тем же тихим часам, что и остальное
 * (inbound-notice.ts): ночью не звоним. Но утром БОЛЬ ИДЁТ ПЕРВОЙ, выше
 * «Написать тренеру»: это то, от чего зависит сегодняшняя тренировка.
 */
export type CoachAlert =
  | { kind: "pain"; at: string; id: string }
  | { kind: "message"; at: string; id: string };

export function orderCoachAlerts<T extends CoachAlert>(alerts: T[]): T[] {
  const rank = (a: CoachAlert) => (a.kind === "pain" ? 0 : 1);
  return [...alerts].sort((a, b) => rank(a) - rank(b) || a.at.localeCompare(b.at));
}

/**
 * Где бегала → что спрашиваем [решение Игоря, 21.10.2026]. Признак тренировки,
 * не человека. Дорожка — скорость с панели (у интервалов работа и
 * восстановление). Улица — дистанция, у интервалов тоже только дистанция.
 */
export type Surface = "street" | "treadmill";
export type ReportAsk = "speed" | "workRestSpeed" | "distance";

export function reportAsks(surface: Surface, isIntervals: boolean): ReportAsk[] {
  if (surface === "street") return ["distance"];
  return isIntervals ? ["workRestSpeed"] : ["speed"];
}

/** Умолчание «где бегала»: из анкеты, если там одна поверхность; иначе дорожка. */
export function defaultSurface(runSurfaces: string[] | null): Surface {
  const list = (runSurfaces ?? []).map((s) => s.toLowerCase());
  const street = list.some((s) => s.includes("улиц") || s.includes("парк") || s.includes("стадион"));
  const tread = list.some((s) => s.includes("дорожк"));
  if (street && !tread) return "street";
  return "treadmill";
}
