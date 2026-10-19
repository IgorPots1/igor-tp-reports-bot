import { NextRequest } from "next/server";

import {
  createIntensiveApplication,
  getFlowConfig,
  getSeatsLeft,
  setApplicationScreenshots,
  uploadScreenshot,
  type ApplicationStatus,
  type Screenshot,
} from "@/features/intensive/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonHeaders = { "Content-Type": "application/json" };

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function text(form: FormData, key: string, limit = 2000): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, limit);
  return trimmed || null;
}

function list(form: FormData, key: string): string[] {
  return form
    .getAll(key)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function intOrNull(form: FormData, key: string, min: number, max: number): number | null {
  const raw = text(form, key, 10);
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return Math.round(parsed);
}

function numberOrNull(form: FormData, key: string, min: number, max: number): number | null {
  const raw = text(form, key, 10);
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

/** ISO-дата или null. Мусор в date-колонку не пускаем — Postgres на нём падает. */
function dateOrNull(form: FormData, key: string): string | null {
  const raw = text(form, key, 10);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return null;
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

/**
 * Метка английской пробной недели (/trial/apply, решение Игоря 19.10.2026).
 * Такие анкеты НЕ относятся к русскому потоку: в flow_number пишется эта
 * строка вместо номера потока, места русского набора они не занимают и
 * getFlowConfig/getSeatsLeft для них не вызываются. Колонка flow_number —
 * text, так что миграция не нужна; в админке метка видна в фильтре потоков.
 */
const TRIAL_EN_SOURCE = "trial-en";

/**
 * Контакты английской анкеты (Instagram обязателен, email и Strava нет).
 * Отдельных колонок под них нет, поэтому они идут блоком в начало
 * why_intensive — свободного текстового поля, которое тренер и так читает.
 */
function trialEnContactBlock(form: FormData): string {
  const lines = [
    `[${TRIAL_EN_SOURCE}] 7 days · 10 EUR`,
    `Instagram: @${text(form, "instagram", 100) ?? ""}`,
    `WhatsApp: ${text(form, "whatsapp", 40) ?? ""}`,
  ];
  const email = text(form, "email", 200);
  if (email) lines.push(`Email: ${email}`);
  const strava = text(form, "strava_url", 300);
  if (strava) lines.push(`Strava: ${strava}`);
  const note = text(form, "why_intensive");
  return note ? `${lines.join("\n")}\n\n${note}` : lines.join("\n");
}

/**
 * Метка анкеты нового клиента 1:1 (/coaching/start, 60 EUR/месяц, английский
 * аккаунт @runnigor). Как и trial-en, к русскому потоку не относится: в
 * flow_number пишется эта строка, места и getFlowConfig/getSeatsLeft не
 * трогаются. Миграции нет: ответы, у которых есть колонка, идут в неё, а
 * остальное читаемым блоком в why_intensive.
 */
const COACHING_EN_SOURCE = "coaching-en";

const COACHING_SPORTS: Record<string, string> = {
  run: "Run",
  bike: "Bike",
  swim: "Swim",
  gym: "Gym",
  other: "Other",
};

type CoachingContact = { channel: "WhatsApp" | "Telegram"; value: string };

/** Предпочитаемый канал клиента 1:1 и номер/username. null, если не заполнено. */
function coachingContact(form: FormData): CoachingContact | null {
  const channel = text(form, "preferred_contact", 20);
  const raw = text(form, "contact_handle", 100);
  if (!raw) return null;
  if (channel === "whatsapp") {
    return raw.replace(/\D/gu, "").length >= 7 ? { channel: "WhatsApp", value: raw } : null;
  }
  if (channel === "telegram") {
    const handle = raw.replace(/^@+/u, "");
    return handle ? { channel: "Telegram", value: `@${handle}` } : null;
  }
  return null;
}

/** Выбранные виды спорта клиента 1:1 (только известные коды). */
function coachingSports(form: FormData): string[] {
  return list(form, "sports").filter((code) => code in COACHING_SPORTS);
}

/** Название вида спорта; для "other" то, что человек вписал сам. */
function coachingSportLabel(form: FormData, code: string): string {
  if (code === "other") {
    const name = text(form, "other_sport_name", 80);
    return name ? `Other (${name})` : "Other";
  }
  return COACHING_SPORTS[code] ?? code;
}

/** "Run: 4 sessions/week, 5 h/week" по строке на каждый выбранный вид. */
function coachingSportWeek(form: FormData): string | null {
  const lines = coachingSports(form).map((code) => {
    const sessions = text(form, `sessions_${code}`, 20);
    const hours = text(form, `hours_${code}`, 20);
    const parts = [
      sessions ? `${sessions} sessions/week` : null,
      hours ? `${hours} h/week` : null,
    ].filter(Boolean);
    return `${coachingSportLabel(form, code)}: ${parts.length ? parts.join(", ") : "not given"}`;
  });
  return lines.length ? lines.join("\n") : null;
}

/**
 * Читаемый блок анкеты клиента 1:1 для why_intensive: контакты и все ответы,
 * у которых нет своей колонки. Пустые строки пропускаются.
 */
function coachingEnBlock(form: FormData): string {
  const contact = coachingContact(form);
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label}: ${value}`);
  };
  const section = (title: string) => {
    if (lines.length) lines.push("");
    lines.push(`## ${title}`);
  };
  const joined = (key: string) => {
    const values = list(form, key);
    return values.length ? values.join(", ") : null;
  };

  lines.push(`[${COACHING_EN_SOURCE}] new 1:1 client · 60 EUR/month`);
  add("Instagram", `@${text(form, "instagram", 100)?.replace(/^@+/u, "") ?? ""}`);
  add("Preferred contact", contact ? `${contact.channel} ${contact.value}` : null);
  add("Email", text(form, "email", 200));
  add("Time zone", text(form, "timezone", 80));

  section("Goals");
  add("What they want from a coach", text(form, "coach_expectations"));
  add("Coaching experience", text(form, "coaching_experience", 20));

  section("Week now");
  add("Sports", coachingSports(form).map((code) => coachingSportLabel(form, code)).join(", ") || null);
  const week = coachingSportWeek(form);
  if (week) lines.push(week);
  add("Total hours/week available", text(form, "total_hours", 50));
  add("Time of day", joined("time_of_day"));
  add("Long session days", text(form, "long_session_days", 300));
  add("Longest run", text(form, "longest_run", 100));
  add("Longest ride", text(form, "longest_ride", 100));
  add("Longest swim", text(form, "longest_swim", 100));
  add("Recent results / PBs", text(form, "recent_results"));

  section("Tools");
  add("Platforms", joined("platforms"));
  add("Strava", text(form, "strava_url", 300));
  add("HR strap", text(form, "hr_strap", 10));
  add("Power meter", text(form, "power_meter", 10));
  add("Indoor", joined("indoor"));

  section("Health extra");
  add("Sleep (h/night)", text(form, "sleep_hours", 20));
  add("Energy (1-5)", text(form, "energy_level", 5));

  const note = text(form, "why_intensive");
  if (note) {
    section("Anything else");
    lines.push(note);
  }
  return lines.join("\n").slice(0, 8000);
}

async function notifyTelegram(params: {
  fullName: string;
  city: string | null;
  goal: string | null;
  screenshotCount: number;
  seatsLeft: number;
  isWaitlist: boolean;
  /** Английская пробная неделя: Instagram для ссылки на оплату, без счётчика мест. */
  trialEnInstagram?: string | null;
  /** Английская пробная неделя: WhatsApp, где идёт сама неделя 1:1. */
  trialEnWhatsapp?: string | null;
  /** Новый клиент 1:1: Instagram и предпочитаемый канал связи. */
  coachingEn?: { instagram: string | null; contact: CoachingContact | null; sports: string };
}): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const leadsChat = process.env.LEADS_CHAT_ID;

  if (!botToken || !leadsChat) {
    // Не секрет и не значение — только факт, что переменная не выставлена.
    console.error("[intensive-apply] Telegram is not configured, notification skipped");
    return;
  }

  const goalShort = params.goal ? params.goal.slice(0, 100) : "—";
  // Пометка листа ожидания идёт ПЕРВОЙ строкой: в потоке уведомлений разницу
  // надо видеть с первого взгляда, не дочитывая до счётчика мест.
  const isTrialEn = params.trialEnInstagram !== undefined;
  const message = params.coachingEn
    ? [
        "🇬🇧 COACHING EN · new client · 60 EUR/month",
        "📋 Новая анкета клиента 1:1 (/coaching/start)",
        `Имя: ${params.fullName}`,
        `Instagram: @${params.coachingEn.instagram ?? "—"}`,
        `Связь: ${
          params.coachingEn.contact
            ? `${params.coachingEn.contact.channel} ${params.coachingEn.contact.value}`
            : "—"
        }`,
        `Город: ${params.city ?? "—"}`,
        `Спорт: ${params.coachingEn.sports || "—"}`,
        `Цель: ${goalShort}`,
        "Собрать первую неделю и написать клиенту в течение 24 часов",
      ].join("\n")
    : isTrialEn
    ? [
        "🇬🇧 TRIAL EN · 7 дней · 10 EUR",
        "📋 Новая английская анкета (/trial)",
        `Имя: ${params.fullName}`,
        `Instagram: @${params.trialEnInstagram ?? "—"}`,
        `WhatsApp: ${params.trialEnWhatsapp ?? "—"}`,
        `Город: ${params.city ?? "—"}`,
        `Цель: ${goalShort}`,
        "Отправить ссылку на оплату в Instagram DM в течение 24 часов",
      ].join("\n")
    : [
        ...(params.isWaitlist ? ["⏳ ЛИСТ ОЖИДАНИЯ"] : []),
        "📋 Новая анкета на интенсив",
        `Имя: ${params.fullName}`,
        `Город: ${params.city ?? "—"}`,
        `Цель: ${goalShort}`,
        `Скриншотов: ${params.screenshotCount}`,
        `Мест осталось: ${params.seatsLeft}`,
      ].join("\n");

  // Без parse_mode: текст целиком приходит от постороннего человека, и любая
  // разметка в нём — это в лучшем случае сломанное сообщение, в худшем инъекция.
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: leadsChat, text: message }),
  });
  const payload = (await response.json()) as { ok?: boolean; description?: string };
  if (payload.ok !== true) {
    console.error("[intensive-apply] Telegram rejected:", payload.description ?? "unknown");
  }
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: "Не удалось прочитать форму" }, 400);
  }

  // ── Валидация на сервере. Клиентскую проверку обходят, поэтому обязательное
  // здесь проверяется заново, а не «раз дошло — значит валидно».
  const source = text(form, "source", 40);
  const isTrialEn = source === TRIAL_EN_SOURCE;
  const isCoachingEn = source === COACHING_EN_SOURCE;
  const isEnglish = isTrialEn || isCoachingEn;

  const fullName = text(form, "full_name", 200);
  if (!fullName) {
    return json(
      { ok: false, error: isEnglish ? "Please add your name" : "Укажи имя и фамилию" },
      422
    );
  }

  const disclaimer = form.get("health_disclaimer_accepted");
  if (disclaimer !== "true") {
    return json(
      {
        ok: false,
        error: isEnglish
          ? "Please confirm you have no medical reasons not to exercise"
          : "Без подтверждения об отсутствии противопоказаний записать не могу",
      },
      422
    );
  }

  // Английской анкете Instagram обязателен: туда уходит ссылка на оплату.
  const trialEnInstagram = isTrialEn
    ? (text(form, "instagram", 100)?.replace(/^@+/u, "") || null)
    : null;
  if (isTrialEn && !trialEnInstagram) {
    return json({ ok: false, error: "Please add your Instagram handle" }, 422);
  }
  // И WhatsApp: сама неделя идёт 1:1 в WhatsApp.
  const trialEnWhatsapp = isTrialEn ? text(form, "whatsapp", 40) : null;
  if (isTrialEn && (trialEnWhatsapp ?? "").replace(/\D/gu, "").length < 7) {
    return json({ ok: false, error: "Please add your WhatsApp number with country code" }, 422);
  }

  // Клиенту 1:1 обязательны Instagram и канал связи (WhatsApp или Telegram):
  // туда тренер пишет с первой неделей.
  const coachingInstagram = isCoachingEn
    ? (text(form, "instagram", 100)?.replace(/^@+/u, "") || null)
    : null;
  const coachingContactValue = isCoachingEn ? coachingContact(form) : null;
  if (isCoachingEn) {
    if (!coachingInstagram) {
      return json({ ok: false, error: "Please add your Instagram handle" }, 422);
    }
    if (!coachingContactValue) {
      return json(
        { ok: false, error: "Please add your WhatsApp number or Telegram username" },
        422
      );
    }
    if (!text(form, "city", 120)) {
      return json({ ok: false, error: "Please add your city and country" }, 422);
    }
    if (!text(form, "goal")) {
      return json({ ok: false, error: "Please add your main goal" }, 422);
    }
    if (coachingSports(form).length === 0) {
      return json({ ok: false, error: "Please choose at least one sport" }, 422);
    }
    if (!text(form, "health_injuries") || !text(form, "health_chronic")) {
      return json({ ok: false, error: "Please answer the health questions" }, 422);
    }
  }

  // ── Места. Отказа здесь НЕТ и быть не должно. Раньше при нуле мест роут
  // возвращал 409 ДО вставки, и анкета исчезала без единого следа: ни строки в
  // таблице, ни файлов в bucket, ни уведомления тренеру, ни записи в логе.
  // Теперь мест нет → анкета всё равно сохраняется, но со статусом waitlist;
  // кого пустить в поток, решает тренер в админке.
  //
  // Английская пробная неделя к русскому потоку не привязана: ни номер потока,
  // ни счётчик мест её не касаются, статус всегда new.
  const flow = isEnglish ? null : await getFlowConfig();
  const seatsBefore = flow ? await getSeatsLeft(flow) : 1;
  const status: ApplicationStatus = seatsBefore > 0 ? "new" : "waitlist";

  // ── Файлы. Проверяем до вставки, чтобы не плодить анкеты с мусором.
  const files = form
    .getAll("screenshots")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length > MAX_FILES) {
    return json({ ok: false, error: `Не больше ${MAX_FILES} скриншотов` }, 422);
  }
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      return json({ ok: false, error: "Скриншоты — только изображения" }, 422);
    }
    if (file.size > MAX_FILE_BYTES) {
      return json({ ok: false, error: "Каждый файл — до 10 МБ" }, 422);
    }
  }

  let applicationId: string;
  try {
    applicationId = await createIntensiveApplication({
      flowNumber: flow
        ? String(flow.number)
        : isCoachingEn
          ? COACHING_EN_SOURCE
          : TRIAL_EN_SOURCE,
      fullName,
      birthDate: dateOrNull(form, "birth_date"),
      sex: text(form, "sex", 20),
      heightCm: intOrNull(form, "height_cm", 80, 260),
      weightKg: numberOrNull(form, "weight_kg", 25, 250),
      city: text(form, "city", 120),
      healthChronic: text(form, "health_chronic"),
      healthInjuries: text(form, "health_injuries"),
      healthDiscomfort: text(form, "health_discomfort"),
      healthDisclaimerAccepted: true,
      weeklyKm: text(form, "weekly_km", 50),
      maxDistance: isCoachingEn
        ? text(form, "longest_run", 50)
        : text(form, "max_distance", 50),
      pr5k: text(form, "pr_5k", 20),
      pr10k: text(form, "pr_10k", 20),
      pr21k: text(form, "pr_21k", 20),
      pr42k: text(form, "pr_42k", 20),
      currentTraining: isCoachingEn ? coachingSportWeek(form) : text(form, "current_training"),
      otherSports: isCoachingEn
        ? coachingSports(form).map((code) => coachingSportLabel(form, code)).join(", ") || null
        : text(form, "other_sports"),
      goal: text(form, "goal"),
      racesThisYear: text(form, "races_this_year"),
      whyIntensive: isCoachingEn
        ? coachingEnBlock(form)
        : isTrialEn
          ? trialEnContactBlock(form)
          : text(form, "why_intensive"),
      availableDays: list(form, "available_days"),
      sessionDuration: isCoachingEn
        ? (() => {
            const hours = text(form, "total_hours", 40);
            return hours ? `${hours} h/week total` : null;
          })()
        : text(form, "session_duration", 50),
      surfaces: list(form, "surfaces"),
      gadgets: list(form, "gadgets"),
      shoes: text(form, "shoes", 200),
      strength: text(form, "strength", 20),
      screenshots: [],
    }, status);
  } catch (error) {
    console.error("[intensive-apply] insert failed:", error);
    return json(
      {
        ok: false,
        error: isEnglish
          ? "Could not save the form. Please try again."
          : "Не удалось сохранить анкету. Попробуй ещё раз.",
      },
      500
    );
  }

  // ── Файлы кладём ПОСЛЕ вставки: путь в bucket строится от id анкеты.
  // Упавшая загрузка не отменяет анкету — текст важнее картинок, тренер
  // попросит скриншоты отдельно.
  const uploaded: Screenshot[] = [];
  for (const [index, file] of files.entries()) {
    try {
      uploaded.push(await uploadScreenshot(applicationId, index + 1, file));
    } catch (error) {
      console.error("[intensive-apply] upload failed:", error);
    }
  }
  if (uploaded.length > 0) {
    try {
      await setApplicationScreenshots(applicationId, uploaded);
    } catch (error) {
      console.error("[intensive-apply] screenshots write failed:", error);
    }
  }

  // ── Уведомление независимо от базы: анкета уже сохранена, и упавший
  // Telegram не должен превращаться в ошибку для человека.
  const seatsLeft = flow ? await getSeatsLeft(flow) : 0;
  try {
    await notifyTelegram({
      fullName,
      city: text(form, "city", 120),
      goal: text(form, "goal"),
      screenshotCount: uploaded.length,
      seatsLeft,
      isWaitlist: status === "waitlist",
      ...(isTrialEn ? { trialEnInstagram, trialEnWhatsapp } : {}),
      ...(isCoachingEn
        ? {
            coachingEn: {
              instagram: coachingInstagram,
              contact: coachingContactValue,
              sports: coachingSports(form)
                .map((code) => coachingSportLabel(form, code))
                .join(", "),
            },
          }
        : {}),
    });
  } catch (error) {
    console.error("[intensive-apply] Telegram failed:", error);
  }

  // В ответе ТОЛЬКО факт приёма. Признака листа ожидания здесь нет намеренно:
  // ответ виден в devtools, и по флагу человек понял бы, что пришёл сверх
  // лимита. Снаружи все анкеты принимаются одинаково; кто в наборе, а кто в
  // очереди — видно только тренеру в админке и в пометке Telegram.
  return json({ ok: true }, 200);
}
