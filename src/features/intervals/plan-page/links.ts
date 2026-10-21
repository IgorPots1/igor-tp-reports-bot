/**
 * Ссылки на страницу плана: выпуск, отзыв, разрешение по токену.
 *
 * Роль у ссылки одна — ученица. Тренер отвечает из админки, своей ссылки на
 * эту страницу у него нет. slug в пути только для читаемости и обязан совпасть
 * со строкой токена, иначе 404.
 */
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { SITE_URL } from "@/lib/site";

import {
  PLAN_SLUG_RE,
  PLAN_TOKEN_RE,
  isPlanPageEnabled,
  newPlanToken,
  planPageUrl,
  slugFromStudentId,
  type PlanLinkRef,
  type PlanTarget,
} from "./core";

export type PlanLinkAccess = {
  linkId: string;
  sourceId: string;
  studentUuid: string;
  studentName: string;
  timezone: string | null;
  link: PlanLinkRef;
};

/**
 * Открывает ли строка ссылки страницу по этому адресу. Чистая: её гоняет
 * check:plan-page. Отозванная — нет. Чужое имя в адресе при верном токене —
 * нет: адрес с подставленным именем не должен открывать чужую страницу.
 */
export function linkOpens(row: { slug: string; revoked_at: string | null }, slug: string): boolean {
  return row.revoked_at === null && row.slug === slug;
}

/** По адресу страницы. null — нет такой живой ссылки (или имя не то), это 404. */
export async function resolvePlanLink(slug: string, token: string): Promise<PlanLinkAccess | null> {
  if (!PLAN_SLUG_RE.test(slug) || !PLAN_TOKEN_RE.test(token)) return null;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_plan_links")
    .select("id, source_id, slug, token, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(`intervals_plan_links: ${describeSupabaseError(error)}`);
  const row = data as { id: string; source_id: string; slug: string; token: string; revoked_at: string | null } | null;
  if (!row || !linkOpens(row, slug)) return null;

  const { data: src, error: srcError } = await supabase
    .from("student_data_sources")
    .select("student_id, is_active, trainingpeaks_students(student_name, timezone, is_active, archived_at)")
    .eq("id", row.source_id)
    .maybeSingle();
  if (srcError) throw new Error(`student_data_sources: ${describeSupabaseError(srcError)}`);
  const source = src as {
    student_id: string;
    is_active: boolean;
    trainingpeaks_students: { student_name: string; timezone: string | null; is_active: boolean; archived_at: string | null } | null;
  } | null;
  const student = source?.trainingpeaks_students ?? null;
  if (!source || !student || !student.is_active || student.archived_at) return null;

  return {
    linkId: row.id,
    sourceId: row.source_id,
    studentUuid: source.student_id,
    studentName: student.student_name,
    timezone: student.timezone,
    link: { slug: row.slug, token: row.token },
  };
}

export async function getLivePlanLink(sourceId: string): Promise<PlanLinkRef | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_plan_links")
    .select("slug, token")
    .eq("source_id", sourceId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(`intervals_plan_links: ${describeSupabaseError(error)}`);
  return (data as PlanLinkRef | null) ?? null;
}

/**
 * Куда вести эту ученицу из бота: адрес страницы или null — «как раньше, в
 * мини-апп». Новый путь только при включённом флаге И живой ссылке.
 *
 * НИКОГДА НЕ БРОСАЕТ. Сбой чтения ссылки не должен ронять отправку
 * сообщения: человек получит старую кнопку в мини-апп, и это не тупик —
 * мини-апп сам покажет «План переехал».
 */
export async function planPageEntry(sourceId: string | null): Promise<((target?: PlanTarget) => string) | null> {
  if (!sourceId || !isPlanPageEnabled()) return null;
  try {
    const link = await getLivePlanLink(sourceId);
    return link ? (target?: PlanTarget) => planPageUrl(link, target) : null;
  } catch (error) {
    console.warn("[plan-page] ссылка не прочиталась, ведём по-старому", {
      sourceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Выпустить новую ссылку. Живая прежняя отзывается в ТОМ ЖЕ шаге: две живые
 * держать нельзя (это бережёт и уникальный индекс в базе), а «старая
 * перестаёт работать» — ровно то, зачем выпуск нужен.
 */
export async function issuePlanLink(input: { sourceId: string; by: string }): Promise<PlanLinkRef> {
  const supabase = createSupabaseServerClient();
  const { data: src, error: srcError } = await supabase
    .from("student_data_sources")
    .select("trainingpeaks_students(student_id)")
    .eq("id", input.sourceId)
    .maybeSingle();
  if (srcError) throw new Error(`student_data_sources: ${describeSupabaseError(srcError)}`);
  const studentId =
    (src as { trainingpeaks_students: { student_id: string } | null } | null)?.trainingpeaks_students?.student_id ?? "";

  const now = new Date().toISOString();
  const { error: revokeError } = await supabase
    .from("intervals_plan_links")
    .update({ revoked_at: now, revoked_by: input.by })
    .eq("source_id", input.sourceId)
    .is("revoked_at", null);
  if (revokeError) throw new Error(`отзыв прежней ссылки: ${describeSupabaseError(revokeError)}`);

  const link: PlanLinkRef = { slug: slugFromStudentId(studentId), token: newPlanToken() };
  const { error } = await supabase.from("intervals_plan_links").insert({
    source_id: input.sourceId,
    slug: link.slug,
    token: link.token,
    created_by: input.by,
  });
  if (error) throw new Error(`выпуск ссылки: ${describeSupabaseError(error)}`);
  return link;
}

export async function revokePlanLink(input: { sourceId: string; by: string }): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("intervals_plan_links")
    .update({ revoked_at: new Date().toISOString(), revoked_by: input.by })
    .eq("source_id", input.sourceId)
    .is("revoked_at", null);
  if (error) throw new Error(`отзыв ссылки: ${describeSupabaseError(error)}`);
}

/**
 * Личная кнопка меню в её чате с ботом. Ставится при выпуске и отзыве ссылки:
 * /start она второй раз не нажмёт, а кнопка должна вести туда, где план.
 * Выпущена и флаг включён — «Мой план» на страницу; иначе — в мини-апп.
 * НИКОГДА НЕ БРОСАЕТ: кнопка меню вторична, ссылку тренер отправит сам.
 */
export async function syncPlanMenuButton(sourceId: string): Promise<"page" | "miniapp" | "skipped"> {
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("student_data_sources")
      .select("trainingpeaks_students(telegram_chat_id)")
      .eq("id", sourceId)
      .maybeSingle();
    const chatId = (data as { trainingpeaks_students: { telegram_chat_id: string | null } | null } | null)?.trainingpeaks_students
      ?.telegram_chat_id;
    if (!chatId) return "skipped";
    const { setTelegramChatMenuButtonWebApp } = await import("@/features/telegram/telegram-client");
    const page = await planPageEntry(sourceId);
    const url = page ? page() : `${SITE_URL.replace(/\/+$/, "")}/m/run`;
    await setTelegramChatMenuButtonWebApp({ chatId, text: "Мой план", url });
    return page ? "page" : "miniapp";
  } catch (error) {
    console.warn("[plan-page] кнопка меню не переставилась", {
      sourceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "skipped";
  }
}
