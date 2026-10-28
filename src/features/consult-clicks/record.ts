/* Клик «Записаться на консультацию» → строка consult_clicks + адрес перехода в Telegram.
 * Чистые функции: роут /go/consult только склеивает их с базой.
 *
 * Зачем: раньше кнопка под инструментами вела прямо в t.me, и связь «какой лид-магнит
 * привёл на консультацию» нигде не сохранялась (26.10.2026). */

import { isBotUserAgent } from "@/features/page-views/paths";

export const CONSULT_TG = "https://t.me/IgorPotseluev";
export const CONSULT_WA = "https://wa.me/79157317090";
export const CONSULT_PREFILL_DEFAULT = "Здравствуйте! Хочу на бесплатную консультацию по бегу";
export const CONSULT_PREFILL_DEFAULT_EN = "Hi Igor! I'd like a free consultation";

/** Известные инструменты. Всё остальное пишется как "other", чтобы мусор из адреса не плодил строк. */
export const CONSULT_TOOLS = [
  "plan",
  "dress",
  "shoes",
  "marathon",
  "raskladka",
  "calendar",
  "nutrition",
  // Пробная неделя в основном боте (вход из рилсов): кнопки «Написать Игорю» и «Хочу в Базу».
  "trial",
  // Английские инструменты /tools/en/*: ведут в WhatsApp, а не в Telegram.
  "en-plan",
  "en-dress",
  "en-marathon",
  "en-calendar",
  "en-nutrition",
] as const;
export type ConsultTool = (typeof CONSULT_TOOLS)[number] | "other";

const TEXT_MAX = 300;
const REFERRER_MAX = 500;
const USER_AGENT_MAX = 500;

export function normalizeConsultTool(value: string | null): ConsultTool {
  const v = (value ?? "").trim().toLowerCase();
  return (CONSULT_TOOLS as readonly string[]).includes(v) ? (v as ConsultTool) : "other";
}

export function isEnglishConsultTool(tool: ConsultTool): boolean {
  return tool.startsWith("en-");
}

/** Куда отправить человека. Получатель зашит: русские инструменты ведут в Telegram тренера,
 * английские (en-*) в его WhatsApp. Никуда больше переходник не ведёт. */
export function consultTarget(text: string | null, tool: ConsultTool = "other"): string {
  const trimmed = (text ?? "").trim().slice(0, TEXT_MAX);
  if (isEnglishConsultTool(tool)) {
    return `${CONSULT_WA}?text=${encodeURIComponent(trimmed || CONSULT_PREFILL_DEFAULT_EN)}`;
  }
  return `${CONSULT_TG}?text=${encodeURIComponent(trimmed || CONSULT_PREFILL_DEFAULT)}`;
}

export type ConsultClickRow = {
  tool: ConsultTool;
  referrer: string | null;
  user_agent: string | null;
  country: string | null;
};

function clip(value: string | null, max: number): string | null {
  const v = (value ?? "").trim();
  return v ? v.slice(0, max) : null;
}

/** null — не писать (бот или превью ссылки). Переход при этом всё равно делаем. */
export function buildConsultClickRow(
  tool: ConsultTool,
  meta: { referrer: string | null; userAgent: string | null; country: string | null },
): ConsultClickRow | null {
  if (isBotUserAgent(meta.userAgent)) return null;
  const country = meta.country && /^[A-Za-z]{2}$/u.test(meta.country) ? meta.country.toUpperCase() : null;
  return {
    tool,
    referrer: clip(meta.referrer, REFERRER_MAX),
    user_agent: clip(meta.userAgent, USER_AGENT_MAX),
    country,
  };
}
