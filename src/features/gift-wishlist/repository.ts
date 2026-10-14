import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

/* Виш-лист жены (igorp.run/wish/<token>). Доступ без аккаунтов, по двум
 * секретным ссылкам: her_token и his_token живут только в gift_wishlists.
 *
 * Главный инвариант: отметки «Беру» (gift_wish_claims) уходят ТОЛЬКО в ответ
 * по his_token. По her_token отдаются число выбранных и время последнего
 * выбора, без id хотелок. Любая новая выдача обязана держать это правило. */

export const PHOTO_BUCKET = "gift-wish-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;
const TOKEN_RE = /^[a-f0-9]{24,64}$/;

export type WishRole = "her" | "him";

export type WishItem = {
  id: string;
  title: string;
  url: string | null;
  price: string | null;
  note: string | null;
  want: number;
  photoUrl: string | null;
  createdAt: string;
};

export type WishView = {
  role: WishRole;
  title: string;
  items: WishItem[];
  /** Только для него: id хотелок, которые он выбрал. */
  claimedIds?: string[];
  /** Только для неё: сколько выбрано и когда в последний раз. */
  picks?: { count: number; lastPickAt: string | null };
};

export type WishItemInput = {
  id?: string;
  title: string;
  url: string | null;
  price: string | null;
  note: string | null;
  want: number;
  /** undefined = фото не трогать; null = убрать; строка = новое фото (data URL). */
  photo?: string | null;
};

export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export async function resolveWishToken(token: string): Promise<{ listId: string; role: WishRole; title: string } | null> {
  if (!isWellFormedToken(token)) return null;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("gift_wishlists")
    .select("id,title,her_token,his_token")
    .or(`her_token.eq.${token},his_token.eq.${token}`)
    .maybeSingle();
  if (error) throw new Error(`gift_wishlists lookup: ${describeSupabaseError(error)}`);
  if (!data) return null;
  const role: WishRole = data.her_token === token ? "her" : "him";
  return { listId: data.id as string, role, title: data.title as string };
}

export async function loadWishView(listId: string, role: WishRole, title: string): Promise<WishView> {
  const supabase = createSupabaseServerClient();
  const [itemsRes, claimsRes] = await Promise.all([
    supabase
      .from("gift_wish_items")
      .select("id,title,url,price,note,want,photo_path,created_at")
      .eq("list_id", listId),
    supabase.from("gift_wish_claims").select("item_id,claimed_at").eq("list_id", listId),
  ]);
  if (itemsRes.error) throw new Error(`gift_wish_items: ${describeSupabaseError(itemsRes.error)}`);
  if (claimsRes.error) throw new Error(`gift_wish_claims: ${describeSupabaseError(claimsRes.error)}`);

  const rows = itemsRes.data ?? [];
  const paths = rows.map((r) => r.photo_path as string | null).filter((p): p is string => !!p);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }

  const items: WishItem[] = rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    url: (r.url as string | null) ?? null,
    price: (r.price as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    want: Number(r.want) || 2,
    photoUrl: r.photo_path ? signed.get(r.photo_path as string) ?? null : null,
    createdAt: r.created_at as string,
  }));

  const claims = claimsRes.data ?? [];
  if (role === "him") {
    return { role, title, items, claimedIds: claims.map((c) => c.item_id as string) };
  }
  const lastPickAt = claims.reduce<string | null>(
    (max, c) => (!max || (c.claimed_at as string) > max ? (c.claimed_at as string) : max),
    null,
  );
  return { role, title, items, picks: { count: claims.length, lastPickAt } };
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, max);
  return v || null;
}

function cleanUrl(value: unknown): string | null {
  const v = clean(value, 1000);
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function parseItemInput(body: Record<string, unknown>): WishItemInput | { error: string } {
  const title = clean(body.title, 160);
  if (!title) return { error: "Напиши хотя бы название" };
  if (typeof body.url === "string" && body.url.trim() && !cleanUrl(body.url)) {
    return { error: "Ссылка должна начинаться с https://" };
  }
  const wantNum = Number(body.want);
  const want = wantNum === 1 || wantNum === 3 ? wantNum : 2;
  let photo: string | null | undefined;
  if (body.photo === null) photo = null;
  else if (typeof body.photo === "string") photo = body.photo;
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : undefined;
  return {
    id,
    title,
    url: cleanUrl(body.url),
    price: clean(body.price, 60),
    note: clean(body.note, 800),
    want,
    photo,
  };
}

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

async function storePhoto(listId: string, dataUrl: string): Promise<string> {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) throw new WishInputError("Фото должно быть JPG, PNG или WEBP");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_PHOTO_BYTES) throw new WishInputError("Фото слишком большое");
  const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
  const path = `${listId}/${crypto.randomUUID()}.${ext}`;
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: m[1], upsert: false });
  if (error) throw new Error(`photo upload: ${describeSupabaseError(error)}`);
  return path;
}

export class WishInputError extends Error {}

export async function saveWishItem(listId: string, input: WishItemInput): Promise<void> {
  const supabase = createSupabaseServerClient();
  let oldPhoto: string | null = null;
  if (input.id) {
    const { data, error } = await supabase
      .from("gift_wish_items")
      .select("id,photo_path")
      .eq("id", input.id)
      .eq("list_id", listId)
      .maybeSingle();
    if (error) throw new Error(`gift_wish_items read: ${describeSupabaseError(error)}`);
    if (!data) throw new WishInputError("Эта хотелка уже удалена");
    oldPhoto = (data.photo_path as string | null) ?? null;
  }

  let photoPath: string | null | undefined;
  if (typeof input.photo === "string") photoPath = await storePhoto(listId, input.photo);
  else if (input.photo === null) photoPath = null;

  const fields: Record<string, unknown> = {
    title: input.title,
    url: input.url,
    price: input.price,
    note: input.note,
    want: input.want,
    updated_at: new Date().toISOString(),
  };
  if (photoPath !== undefined) fields.photo_path = photoPath;

  if (input.id) {
    const { error } = await supabase.from("gift_wish_items").update(fields).eq("id", input.id).eq("list_id", listId);
    if (error) throw new Error(`gift_wish_items update: ${describeSupabaseError(error)}`);
    if (photoPath !== undefined && oldPhoto && oldPhoto !== photoPath) {
      await supabase.storage.from(PHOTO_BUCKET).remove([oldPhoto]);
    }
  } else {
    const { error } = await supabase.from("gift_wish_items").insert({ ...fields, list_id: listId });
    if (error) throw new Error(`gift_wish_items insert: ${describeSupabaseError(error)}`);
  }
}

export async function deleteWishItem(listId: string, itemId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("gift_wish_items")
    .delete()
    .eq("id", itemId)
    .eq("list_id", listId)
    .select("photo_path");
  if (error) throw new Error(`gift_wish_items delete: ${describeSupabaseError(error)}`);
  const paths = (data ?? []).map((r) => r.photo_path as string | null).filter((p): p is string => !!p);
  if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
}

export async function setWishClaim(listId: string, itemId: string, claimed: boolean): Promise<void> {
  const supabase = createSupabaseServerClient();
  if (claimed) {
    const { data, error: readErr } = await supabase
      .from("gift_wish_items")
      .select("id")
      .eq("id", itemId)
      .eq("list_id", listId)
      .maybeSingle();
    if (readErr) throw new Error(`gift_wish_items read: ${describeSupabaseError(readErr)}`);
    if (!data) throw new WishInputError("Эта хотелка уже удалена");
    const { error } = await supabase
      .from("gift_wish_claims")
      .upsert({ item_id: itemId, list_id: listId, claimed_at: new Date().toISOString() }, { onConflict: "item_id" });
    if (error) throw new Error(`gift_wish_claims upsert: ${describeSupabaseError(error)}`);
  } else {
    const { error } = await supabase.from("gift_wish_claims").delete().eq("item_id", itemId).eq("list_id", listId);
    if (error) throw new Error(`gift_wish_claims delete: ${describeSupabaseError(error)}`);
  }
}
