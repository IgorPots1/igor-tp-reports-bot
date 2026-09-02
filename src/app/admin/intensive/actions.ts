"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";
import {
  APPLICATION_STATUSES,
  getActiveFlowConfigRow,
  updateApplication,
  updateFlowConfig,
  type ApplicationStatus,
} from "@/features/intensive/repository";

async function ensureAdminAccess(redirectTarget: string): Promise<void> {
  if (isAdminAccessBypassedForLocalDev()) return;
  const cookieStore = await cookies();
  if (hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value)) return;
  redirect(`/admin/login?next=${encodeURIComponent(normalizeAdminRedirectPath(redirectTarget))}`);
}

function withNotice(pathname: string, key: "notice" | "error", value: string): string {
  const [path, rawQuery = ""] = pathname.split("?");
  const params = new URLSearchParams(rawQuery);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

function req(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing form field: ${key}`);
  }
  return value;
}

/** Целое число из формы в допустимом диапазоне, иначе null — форма не отдаёт мусор в базу. */
function reqInt(formData: FormData, key: string, min: number, max: number): number | null {
  const raw = formData.get(key);
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

/** Дата ГГГГ-ММ-ДД строго по форме, иначе null. Без Date.parse: он и мусор проглотит. */
function reqIsoDate(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return null;
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

/**
 * Меняет статус заявки. Именно статус двигает счётчик мест на публичных
 * страницах: new и confirmed место занимают, cancelled возвращает.
 */
export async function updateIntensiveApplicationStatusAction(formData: FormData) {
  const id = req(formData, "id");
  const rawStatus = req(formData, "status");
  const redirectTo = normalizeAdminRedirectPath(
    typeof formData.get("redirectTo") === "string"
      ? (formData.get("redirectTo") as string)
      : `/admin/intensive/${id}`
  );

  await ensureAdminAccess(redirectTo);

  if (!(APPLICATION_STATUSES as readonly string[]).includes(rawStatus)) {
    redirect(withNotice(redirectTo, "error", "Неизвестный статус"));
  }

  await updateApplication(id, { status: rawStatus as ApplicationStatus });

  revalidatePath("/admin/intensive");
  revalidatePath(`/admin/intensive/${id}`);
  // Счётчик мест на публичных страницах обязан поехать сразу же.
  // Пути — новые: раздел переехал на /camp, хаб стал корнем. Старые адреса
  // отдают 308 и страницами больше не являются, сбрасывать по ним нечего.
  revalidatePath("/camp");
  revalidatePath("/");

  redirect(withNotice(redirectTo, "notice", "Статус обновлён"));
}

export async function updateIntensiveApplicationNoteAction(formData: FormData) {
  const id = req(formData, "id");
  const rawNote = formData.get("admin_note");
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 4000) : "";
  const redirectTo = normalizeAdminRedirectPath(
    typeof formData.get("redirectTo") === "string"
      ? (formData.get("redirectTo") as string)
      : `/admin/intensive/${id}`
  );

  await ensureAdminAccess(redirectTo);

  await updateApplication(id, { adminNote: note || null });

  revalidatePath("/admin/intensive");
  revalidatePath(`/admin/intensive/${id}`);

  redirect(withNotice(redirectTo, "notice", "Заметка сохранена"));
}

const FLOW_CONFIG_REDIRECT = "/admin/intensive";

/**
 * Общая часть «Сохранить» и «Открыть новый поток»: читает и валидирует общие
 * поля формы (дата, места, обе цены), пишет в базу и ревалидирует страницы,
 * где виден номер/дата/счётчик. Разница между двумя действиями — только в
 * том, откуда берётся номер потока, поэтому он передаётся отдельным
 * параметром, а строку конфига (нужен id) читает вызывающая сторона один
 * раз — не задваивать поход в базу ради того же id.
 */
async function applyFlowConfigUpdate(
  formData: FormData,
  configId: string,
  flowNumber: number
): Promise<void> {
  const startDateIso = reqIsoDate(formData, "start_date");
  const seatsTotal = reqInt(formData, "seats_total", 1, 500);
  const priceRub = req(formData, "price_rub").trim().slice(0, 40);
  const priceEur = req(formData, "price_eur").trim().slice(0, 40);

  if (!startDateIso) throw new Error("Некорректная дата старта");
  if (seatsTotal === null) throw new Error("Некорректное число мест");

  await updateFlowConfig(configId, {
    number: flowNumber,
    startDateIso,
    seatsTotal,
    priceRub,
    priceEur,
  });

  revalidatePath("/admin/intensive");
  // Ровно те пути, что и после смены статуса заявки: номер/дата/счётчик
  // видны на хабе и на странице интенсива, старые адреса — 308-редиректы,
  // им ревалидировать нечего.
  revalidatePath("/camp");
  revalidatePath("/");
}

/** «Сохранить»: номер потока берём из самой формы — тренер мог его и не менять. */
export async function saveFlowConfigAction(formData: FormData) {
  await ensureAdminAccess(FLOW_CONFIG_REDIRECT);

  const flowNumber = reqInt(formData, "flow_number", 1, 9999);
  if (flowNumber === null) {
    redirect(withNotice(FLOW_CONFIG_REDIRECT, "error", "Некорректный номер потока"));
  }

  try {
    const current = await getActiveFlowConfigRow();
    if (!current) throw new Error("Нет активной строки настроек потока");
    await applyFlowConfigUpdate(formData, current.id, flowNumber);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить";
    redirect(withNotice(FLOW_CONFIG_REDIRECT, "error", message));
  }

  redirect(withNotice(FLOW_CONFIG_REDIRECT, "notice", "Настройки потока сохранены"));
}

/**
 * «Открыть новый поток»: номер берём НЕ из поля формы, а как текущий+1 —
 * так тренер не может по забывчивости оставить старый номер и получить
 * дублирующий поток. Дату он обязан вписать новую, иначе действие откажет:
 * дата — единственное, что репозиторий не может домыслить сам.
 * Старые заявки эта строка не трогает: у них flow_number уже проставлен на
 * момент подачи и с конфигом никак не связан.
 */
export async function openNewFlowAction(formData: FormData) {
  await ensureAdminAccess(FLOW_CONFIG_REDIRECT);

  try {
    const current = await getActiveFlowConfigRow();
    if (!current) throw new Error("Нет активной строки настроек потока");
    await applyFlowConfigUpdate(formData, current.id, current.number + 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось открыть новый поток";
    redirect(withNotice(FLOW_CONFIG_REDIRECT, "error", message));
  }

  redirect(withNotice(FLOW_CONFIG_REDIRECT, "notice", "Открыт новый поток"));
}
