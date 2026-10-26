import { NextRequest } from "next/server";

import {
  createIntensiveApplication,
  getFlowConfig,
  setApplicationScreenshots,
  uploadScreenshot,
  type ApplicationStatus,
  type Screenshot,
} from "@/features/intensive/repository";
import { PRIVACY_EN_PATH, PRIVACY_EN_VERSION } from "@/lib/privacy-en";

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
 * getFlowConfig для них не вызываются. Колонка flow_number —
 * text, так что миграция не нужна; в админке метка видна в фильтре потоков.
 */
const TRIAL_EN_SOURCE = "trial-en";

/**
 * Согласие на обработку данных (английские анкеты, решение Игоря 19.10.2026).
 * Чекбокс обязателен на /coaching/start и /trial/apply, сервер проверяет его
 * заново. Отдельной колонки нет, поэтому флаг, время (серверное, не из
 * браузера) и версия текста /privacy/en идут строкой в шапку why_intensive.
 */
function privacyConsentLine(consentedAt: string): string {
  return `Privacy consent: yes · ${consentedAt} · notice ${PRIVACY_EN_VERSION} (${PRIVACY_EN_PATH})`;
}

/**
 * Контакты английской анкеты (Instagram обязателен, email и Strava нет).
 * Отдельных колонок под них нет, поэтому они идут блоком в начало
 * why_intensive — свободного текстового поля, которое тренер и так читает.
 */
function trialEnContactBlock(form: FormData, consentedAt: string): string {
  const lines = [
    `[${TRIAL_EN_SOURCE}] 7 days · 10 EUR`,
    `Instagram: @${text(form, "instagram", 100) ?? ""}`,
    `WhatsApp: ${text(form, "whatsapp", 40) ?? ""}`,
    privacyConsentLine(consentedAt),
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
 * flow_number пишется эта строка, места и getFlowConfig не
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

/**
 * id чата из ссылки /coaching/start?c=<id> (как у /breakdown): Игорь шлёт
 * ссылку в директ, и по c анкета сопоставляется с перепиской. Контактов в
 * анкете больше нет: клиент и так известен тренеру. Чистим так же, как клиент.
 */
function coachingChatId(form: FormData): string | null {
  const raw = text(form, "c", 200);
  const clean = (raw ?? "").replace(/[^\w-]/gu, "").slice(0, 64);
  return clean || null;
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
 * Скрининг сердца клиента 1:1 (сердечный диагноз, боль в груди, головокружение
 * или обмороки на нагрузке). Обязательный yes/no; отдельной колонки нет, идёт
 * строкой в шапку why_intensive, а "yes" ещё и предупреждением в Telegram.
 */
function coachingHeartScreen(form: FormData): "yes" | "no" | null {
  const value = text(form, "heart_screen", 5);
  return value === "yes" || value === "no" ? value : null;
}

/**
 * Читаемый блок анкеты клиента 1:1 для why_intensive: id чата (если был),
 * согласие на обработку данных и все ответы, у которых нет своей колонки.
 * Пустые строки пропускаются.
 */
function coachingEnBlock(form: FormData, consentedAt: string): string {
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
  add("Chat id (c)", coachingChatId(form));
  add("Time zone", text(form, "timezone", 80));
  lines.push(privacyConsentLine(consentedAt));
  add("Heart/chest/dizziness screen", coachingHeartScreen(form));

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
  /** Английская пробная неделя: Instagram для ссылки на оплату, без счётчика мест. */
  trialEnInstagram?: string | null;
  /** Английская пробная неделя: WhatsApp, где идёт сама неделя 1:1. */
  trialEnWhatsapp?: string | null;
  /** Новый клиент 1:1: виды спорта и id чата из ссылки (?c=), если был. */
  coachingEn?: { chatId: string | null; sports: string; heartScreenYes: boolean };
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
        ...(params.coachingEn.heartScreenYes ? ["⚠️ heart screen: yes"] : []),
        "📋 Новая анкета клиента 1:1 (/coaching/start)",
        `Имя: ${params.fullName}`,
        `Город: ${params.city ?? "—"}`,
        `Спорт: ${params.coachingEn.sports || "—"}`,
        `Цель: ${goalShort}`,
        ...(params.coachingEn.chatId ? [`Чат (c): ${params.coachingEn.chatId}`] : []),
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
        "📋 Новая анкета на интенсив",
        `Имя: ${params.fullName}`,
        `Город: ${params.city ?? "—"}`,
        `Цель: ${goalShort}`,
        `Скриншотов: ${params.screenshotCount}`,
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

  // Английские анкеты: явное согласие на обработку данных, включая здоровье
  // (/privacy/en). Без него анкету не принимаем.
  if (isEnglish && form.get("privacy_consent") !== "true") {
    return json(
      {
        ok: false,
        error:
          "Please tick the box to agree to the processing of your data (Privacy notice)",
      },
      422
    );
  }
  const consentedAt = new Date().toISOString();

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

  // Клиенту 1:1 контакты не нужны: ссылку он получает от Игоря в директе.
  // Обязательны только цель, вид спорта и ответы о здоровье (имя проверено выше).
  if (isCoachingEn) {
    if (!text(form, "goal")) {
      return json({ ok: false, error: "Please add your main goal" }, 422);
    }
    if (coachingSports(form).length === 0) {
      return json({ ok: false, error: "Please choose at least one sport" }, 422);
    }
    if (!text(form, "health_injuries") || !text(form, "health_chronic")) {
      return json({ ok: false, error: "Please answer the health questions" }, 422);
    }
    if (!coachingHeartScreen(form)) {
      return json(
        { ok: false, error: "Please answer the heart, chest pain and dizziness question" },
        422
      );
    }
  }

  // ── Мест и листа ожидания больше НЕТ (решение Игоря, 26.10.2026). Интенсив
  // стал индивидуальным и бессрочным: старт в любой день, без потоков. Раньше
  // анкета при нуле свободных мест молча уходила в waitlist, а тренер получал
  // «ЛИСТ ОЖИДАНИЯ», хотя ждать было нечего: конфиг потока остался от старого
  // формата (поток 31, 6 мест), и все новые анкеты после 6-й падали в очередь.
  // Теперь любая анкета получает статус new.
  //
  // Номер потока по-прежнему пишется в flow_number для истории и фильтров
  // админки. Английская пробная неделя к русскому потоку не привязана.
  const flow = isEnglish ? null : await getFlowConfig();
  const status: ApplicationStatus = "new";

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
        ? coachingEnBlock(form, consentedAt)
        : isTrialEn
          ? trialEnContactBlock(form, consentedAt)
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
  try {
    await notifyTelegram({
      fullName,
      city: text(form, "city", 120),
      goal: text(form, "goal"),
      screenshotCount: uploaded.length,
      ...(isTrialEn ? { trialEnInstagram, trialEnWhatsapp } : {}),
      ...(isCoachingEn
        ? {
            coachingEn: {
              chatId: coachingChatId(form),
              sports: coachingSports(form)
                .map((code) => coachingSportLabel(form, code))
                .join(", "),
              heartScreenYes: coachingHeartScreen(form) === "yes",
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
