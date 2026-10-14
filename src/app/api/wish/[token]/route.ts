import { NextRequest } from "next/server";

import {
  WishInputError,
  deleteWishItem,
  loadWishView,
  parseItemInput,
  resolveWishToken,
  saveWishItem,
  setWishClaim,
} from "@/features/gift-wishlist/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ответы личные и зависят от токена в пути: ни CDN, ни браузер не должны
// отдавать их из кэша (иначе её ответ мог бы прийти ему и наоборот).
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  try {
    const access = await resolveWishToken(token);
    if (!access) return json({ ok: false, error: "Ссылка не найдена" }, 404);
    const view = await loadWishView(access.listId, access.role, access.title);
    return json({ ok: true, view });
  } catch (e) {
    console.error("[wish] GET failed", e);
    return json({ ok: false, error: "Не удалось загрузить список" }, 500);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  try {
    const access = await resolveWishToken(token);
    if (!access) return json({ ok: false, error: "Ссылка не найдена" }, 404);
    const op = body.op;
    const itemId = typeof body.itemId === "string" && /^[0-9a-f-]{36}$/.test(body.itemId) ? body.itemId : null;

    // Хотелки ведёт только она; «Беру» ставит только он. Роль берётся из
    // токена, а не из тела запроса.
    if (op === "save") {
      if (access.role !== "her") return json({ ok: false, error: "Хотелки добавляет хозяйка списка" }, 403);
      const input = parseItemInput((body.item ?? {}) as Record<string, unknown>);
      if ("error" in input) return json({ ok: false, error: input.error }, 422);
      await saveWishItem(access.listId, input);
    } else if (op === "delete") {
      if (access.role !== "her") return json({ ok: false, error: "Удаляет хозяйка списка" }, 403);
      if (!itemId) return json({ ok: false, error: "itemId required" }, 422);
      await deleteWishItem(access.listId, itemId);
    } else if (op === "claim") {
      if (access.role !== "him") return json({ ok: false, error: "Not allowed" }, 403);
      if (!itemId) return json({ ok: false, error: "itemId required" }, 422);
      await setWishClaim(access.listId, itemId, body.claimed === true);
    } else {
      return json({ ok: false, error: "Unknown op" }, 422);
    }

    const view = await loadWishView(access.listId, access.role, access.title);
    return json({ ok: true, view });
  } catch (e) {
    if (e instanceof WishInputError) return json({ ok: false, error: e.message }, 422);
    console.error("[wish] POST failed", e);
    return json({ ok: false, error: "Не сохранилось, попробуй ещё раз" }, 500);
  }
}
