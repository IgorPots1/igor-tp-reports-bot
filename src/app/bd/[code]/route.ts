/* igorp.run/bd/<код>: короткая ссылка на разбор Strava. Код — 6 случайных a-z0-9 из
 * bd_uploads.code (ставит scripts/bd-upload.py), по нику его не угадать. Каждый переход
 * подписывает свежую ссылку на ig-reels/breakdowns/<name> на 1 час и отдаёт 302 на неё:
 * сама ссылка в сообщении не протухает, а утёкшая подписанная живёт час.
 * Нет строки (или код не того вида) — 404. */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_RE = /^[a-z0-9]{6}$/;
const SIGN_SECONDS = 3600;
const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

const notFound = () => new Response("Not found", { status: 404, headers: noStore });

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return notFound();

  const supabase = createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("bd_uploads")
    .select("name")
    .eq("code", code)
    .eq("status", "done")
    .maybeSingle();
  if (error) {
    console.error(`[bd] ${code}: ${describeSupabaseError(error)}`);
    return new Response("Temporarily unavailable", { status: 503, headers: noStore });
  }
  if (!row) return notFound();

  const { data: signed, error: signError } = await supabase.storage
    .from("ig-reels")
    .createSignedUrl(`breakdowns/${row.name}`, SIGN_SECONDS);
  if (signError || !signed?.signedUrl) {
    // Строка есть, а объекта в Storage нет — для человека это тот же «не найдено».
    console.error(`[bd] ${code}: sign failed: ${describeSupabaseError(signError)}`);
    return notFound();
  }

  return new Response(null, { status: 302, headers: { ...noStore, Location: signed.signedUrl } });
}
