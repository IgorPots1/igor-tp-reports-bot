"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";
import { DRAFT_FIELDS, type CoachDraft, type DraftFieldKey } from "@/features/shoes/coach-drafts";
import { decideDraftField } from "@/features/shoes/coach-drafts-repository";

async function ensureAdminAccess(redirectTarget: string): Promise<void> {
  if (isAdminAccessBypassedForLocalDev()) return;
  const cookieStore = await cookies();
  if (hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value)) return;
  redirect(`/admin/login?next=${encodeURIComponent(normalizeAdminRedirectPath(redirectTarget))}`);
}

const FIELD_KEYS = new Set<string>([...DRAFT_FIELDS.map((f) => f.key), "model"]);

/**
 * Решение по полю черновика: «верно», «поправить», «не знаю». Возвращает
 * обновлённую модель — экран заменяет её у себя без перезагрузки страницы.
 */
export async function decideShoeDraftField(input: {
  id: string;
  field: DraftFieldKey | "model";
  action: "confirm" | "correct" | "unknown";
  value?: unknown;
}): Promise<{ ok: true; draft: CoachDraft } | { ok: false; error: string }> {
  await ensureAdminAccess("/admin/shoes-review");
  if (!FIELD_KEYS.has(input.field) || !["confirm", "correct", "unknown"].includes(input.action)) {
    return { ok: false, error: "неизвестное поле или действие" };
  }
  try {
    const draft = await decideDraftField({ ...input, value: input.value ?? null });
    return { ok: true, draft };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
