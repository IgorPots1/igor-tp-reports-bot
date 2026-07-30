/**
 * Coverage probe for club avatars (naryad §2): how many LINKED club students actually yield a
 * Telegram photo via getUserProfilePhotos (the Bot API source — works for anyone who started the
 * bot). READ-ONLY: it only queries the roster and asks Telegram; it writes NOTHING. Run it to decide
 * whether getUserProfilePhotos coverage is enough, or whether the initData photo_url source is worth
 * adding.
 *
 * NOTE on the two sources: getUserProfilePhotos (measured here) is batch-probeable. The other source
 * — photo_url in a student's initData — is only present when THAT student opens the mini-app, so its
 * coverage cannot be measured in batch; it is a per-session bonus on top of this number.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-avatar-coverage.ts
 */
import { createSupabaseServerClient } from "@/features/supabase/server";
import { getTelegramUserProfilePhotoFileId } from "@/features/telegram/telegram-client";

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_access_requests")
    .select("student_id, telegram_user_id, telegram_username")
    .not("student_id", "is", null)
    .not("telegram_user_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load linked students failed: ${error.message}`);
  const rows = (data as Array<{ student_id: string; telegram_user_id: number; telegram_username: string | null }> | null) ?? [];

  // One entry per student (a student may have several access requests over time).
  const byStudent = new Map<string, { userId: number; username: string | null }>();
  for (const r of rows) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, { userId: Number(r.telegram_user_id), username: r.telegram_username });
  }

  let withPhoto = 0;
  let without = 0;
  const missing: string[] = [];
  for (const [sid, { userId, username }] of byStudent) {
    const fileId = await getTelegramUserProfilePhotoFileId(userId);
    if (fileId) {
      withPhoto += 1;
    } else {
      without += 1;
      missing.push(username ? `@${username}` : sid.slice(0, 8));
    }
  }

  console.log(`Привязано учеников (student_id + telegram_user_id): ${byStudent.size}`);
  console.log(`Фото доступно через getUserProfilePhotos: ${withPhoto}`);
  console.log(`Без фото / не запускали бота / приватность: ${without}`);
  if (missing.length > 0) console.log(`  без фото: ${missing.join(", ")}`);
  console.log("");
  console.log("initData photo_url — второй источник, покрытие батчем не измеряется (только при открытии");
  console.log("мини-аппа конкретным учеником). Число выше — база от getUserProfilePhotos.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
