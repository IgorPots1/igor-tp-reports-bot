/* Форма «Добавить старт» на /races: проверка того, что прислал посетитель.
 * Без React и без базы, чтобы держать чеком (npm run check:races-suggest). */

import { createHash } from "node:crypto";

export const SUGGEST_LIMIT_PER_HOUR = 5;

export type SuggestInput = {
  url: string;
  name: string | null;
  city: string | null;
  date_text: string | null;
  contact: string | null;
  is_organizer: boolean;
};

export type SuggestCheck =
  | { kind: "ok"; value: SuggestInput }
  /** Заполнено скрытое поле: бот. Отвечаем «спасибо» и ничего не пишем. */
  | { kind: "bot" }
  | { kind: "invalid"; error: string };

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

export function checkSuggestion(body: unknown): SuggestCheck {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  // Honeypot: поле, которого человек не видит. Заполнил его только бот.
  if (typeof b.website === "string" && b.website.trim() !== "") return { kind: "bot" };

  let url = text(b.url, 500) ?? "";
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".")) {
    return { kind: "invalid", error: "Нужна ссылка на страницу старта: сайт организатора, регистрация или пост в ВК." };
  }
  return {
    kind: "ok",
    value: {
      url: parsed.toString(),
      name: text(b.name, 200),
      city: text(b.city, 120),
      date_text: text(b.date_text, 60),
      contact: text(b.contact, 200),
      is_organizer: b.is_organizer === true,
    },
  };
}

/** Адрес не храним: sha256 от адреса с солью сервера. Хватает, чтобы считать заявки за час. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** Первый адрес из x-forwarded-for: на Vercel это адрес посетителя. */
export function clientIp(forwardedFor: string | null, realIp: string | null): string {
  const first = (forwardedFor || "").split(",")[0]?.trim();
  return first || realIp?.trim() || "unknown";
}
