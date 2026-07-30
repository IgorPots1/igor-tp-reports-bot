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
  // The link lives on trainingpeaks_students.telegram_user_id (set by auto-linking), NOT on
  // club_access_requests. ~112 rows → well under the 1000-row cap, no pagination needed.
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, telegram_user_id")
    .not("telegram_user_id", "is", null);
  if (error) throw new Error(`load linked students failed: ${error.message}`);
  const rows = (data as Array<{ id: string; student_name: string | null; telegram_user_id: number }> | null) ?? [];

  const byStudent = new Map<string, { userId: number; name: string | null }>();
  for (const r of rows) {
    if (!byStudent.has(r.id)) byStudent.set(r.id, { userId: Number(r.telegram_user_id), name: r.student_name });
  }

  let withPhoto = 0;
  let without = 0;
  const missing: string[] = [];
  for (const [sid, { userId, name }] of byStudent) {
    const fileId = await getTelegramUserProfilePhotoFileId(userId);
    if (fileId) {
      withPhoto += 1;
    } else {
      without += 1;
      missing.push(name ? name : sid.slice(0, 8));
    }
  }

  console.log(`Привязано учеников (trainingpeaks_students.telegram_user_id): ${byStudent.size}`);
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
