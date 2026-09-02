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

async function notifyTelegram(params: {
  fullName: string;
  city: string | null;
  goal: string | null;
  screenshotCount: number;
  seatsLeft: number;
  isWaitlist: boolean;
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
  const message = [
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
  const fullName = text(form, "full_name", 200);
  if (!fullName) {
    return json({ ok: false, error: "Укажи имя и фамилию" }, 422);
  }

  const disclaimer = form.get("health_disclaimer_accepted");
  if (disclaimer !== "true") {
    return json(
      { ok: false, error: "Без подтверждения об отсутствии противопоказаний записать не могу" },
      422
    );
  }

  // ── Места. Отказа здесь НЕТ и быть не должно. Раньше при нуле мест роут
  // возвращал 409 ДО вставки, и анкета исчезала без единого следа: ни строки в
  // таблице, ни файлов в bucket, ни уведомления тренеру, ни записи в логе.
  // Теперь мест нет → анкета всё равно сохраняется, но со статусом waitlist;
  // кого пустить в поток, решает тренер в админке.
  const flow = await getFlowConfig();
  const seatsBefore = await getSeatsLeft(flow);
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
      flowNumber: String(flow.number),
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
      maxDistance: text(form, "max_distance", 50),
      pr5k: text(form, "pr_5k", 20),
      pr10k: text(form, "pr_10k", 20),
      pr21k: text(form, "pr_21k", 20),
      pr42k: text(form, "pr_42k", 20),
      currentTraining: text(form, "current_training"),
      otherSports: text(form, "other_sports"),
      goal: text(form, "goal"),
      racesThisYear: text(form, "races_this_year"),
      whyIntensive: text(form, "why_intensive"),
      availableDays: list(form, "available_days"),
      sessionDuration: text(form, "session_duration", 50),
      surfaces: list(form, "surfaces"),
      gadgets: list(form, "gadgets"),
      shoes: text(form, "shoes", 200),
      strength: text(form, "strength", 20),
      screenshots: [],
    }, status);
  } catch (error) {
    console.error("[intensive-apply] insert failed:", error);
    return json({ ok: false, error: "Не удалось сохранить анкету. Попробуй ещё раз." }, 500);
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
  const seatsLeft = await getSeatsLeft(flow);
  try {
    await notifyTelegram({
      fullName,
      city: text(form, "city", 120),
      goal: text(form, "goal"),
      screenshotCount: uploaded.length,
      seatsLeft,
      isWaitlist: status === "waitlist",
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
