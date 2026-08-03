/**
 * One-off: re-encode avatars ALREADY sitting in the club-avatars bucket.
 *
 * From 2026-08-03 new avatars are cover-cropped to 128px and re-encoded on upload
 * (features/club/avatars.ts -> resizeAvatarBytes). Everything captured BEFORE that is still the
 * original straight off the Telegram CDN (40-80 KB where ~6-10 KB would do), and those old objects
 * keep costing full-size egress on every cache miss until they are rewritten. This script rewrites
 * them in place, through the SAME resizeAvatarBytes, so there is one implementation of the resize
 * and the backfill can never drift from the live path.
 *
 * Safe by construction:
 *   - DRY RUN by default. Nothing is written without --apply.
 *   - Reads and rewrites ONLY the club-avatars bucket. Never touches trainingpeaks_students rows,
 *     never re-fetches from Telegram, never changes club_avatar_checked_at (so it does not disturb
 *     the weekly refresh schedule) and never changes club_avatar_visible.
 *   - Skips any object where the re-encode is not strictly smaller — resizeAvatarBytes returns the
 *     original on any decode failure, so an unreadable image is left exactly as it was.
 *   - Object path and content type are unchanged (`<studentId>.jpg`, image/jpeg), so every signed
 *     URL already in flight keeps working.
 *
 * Run (from the repo root):
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-avatars-reencode.ts            # dry run
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-avatars-reencode.ts --apply    # rewrite
 *
 * Flags:
 *   --apply          actually upload the re-encoded bytes (default: report only)
 *   --limit=N        process at most N avatars (default: all)
 *   --students=a,b   restrict to these student row ids
 */

import { createSupabaseServerClient } from "@/features/supabase/server";
import { resizeAvatarBytes } from "@/features/club/avatars";

const CLUB_AVATARS_BUCKET = "club-avatars";

type Args = { apply: boolean; limit: number | null; students: string[] | null };

function parseArgs(argv: string[]): Args {
  const apply = argv.includes("--apply");
  const limitRaw = argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
  const limit = limitRaw && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : null;
  const studentsRaw = argv.find((a) => a.startsWith("--students="))?.split("=")[1];
  const students = studentsRaw
    ? studentsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  return { apply, limit, students };
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createSupabaseServerClient();

  let query = supabase
    .from("trainingpeaks_students")
    .select("id, student_name, club_avatar_path")
    .not("club_avatar_path", "is", null)
    .order("student_name", { ascending: true });

  if (args.students) query = query.in("id", args.students);

  const { data, error } = await query;
  if (error) {
    console.error(`Не смог прочитать список учеников: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const rows = ((data as Array<{ id: string; student_name: string; club_avatar_path: string }> | null) ?? []).slice(
    0,
    args.limit ?? undefined
  );

  console.log(
    `${args.apply ? "ПРИМЕНЯЮ" : "DRY RUN (ничего не пишу)"} — аватаров к обработке: ${rows.length}\n`
  );

  let before = 0;
  let after = 0;
  let rewritten = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const path = row.club_avatar_path;
    const dl = await supabase.storage.from(CLUB_AVATARS_BUCKET).download(path);
    if (dl.error || !dl.data) {
      failed += 1;
      console.log(`  ✗ ${row.student_name} (${path}): не скачался — ${dl.error?.message ?? "нет данных"}`);
      continue;
    }

    const original = await dl.data.arrayBuffer();
    const resized = await resizeAvatarBytes(original);
    before += original.byteLength;

    // resizeAvatarBytes returns the ORIGINAL object when it could not improve it (decode failure or
    // re-encode not smaller). Identity means "leave this one alone".
    if (resized === original || resized.byteLength >= original.byteLength) {
      after += original.byteLength;
      skipped += 1;
      console.log(`  · ${row.student_name}: ${kb(original.byteLength)} — уже мелкий, пропускаю`);
      continue;
    }

    after += resized.byteLength;

    if (!args.apply) {
      rewritten += 1;
      console.log(
        `  → ${row.student_name}: ${kb(original.byteLength)} → ${kb(resized.byteLength)} (записал бы)`
      );
      continue;
    }

    const up = await supabase.storage
      .from(CLUB_AVATARS_BUCKET)
      .upload(path, resized, { upsert: true, contentType: "image/jpeg" });
    if (up.error) {
      failed += 1;
      console.log(`  ✗ ${row.student_name}: запись не удалась — ${up.error.message}`);
      continue;
    }

    rewritten += 1;
    console.log(`  ✓ ${row.student_name}: ${kb(original.byteLength)} → ${kb(resized.byteLength)}`);
  }

  const saved = before - after;
  console.log(
    `\nИтог: ${args.apply ? "переписано" : "переписалось бы"} ${rewritten}, пропущено ${skipped}, ошибок ${failed}.`
  );
  console.log(
    `Объём бакета: ${kb(before)} → ${kb(after)} (экономия ${kb(saved)}, ` +
      `${before > 0 ? Math.round((saved / before) * 100) : 0} %).`
  );
  if (!args.apply) console.log("Это был dry run. Для записи добавь --apply.");
}

void main();
