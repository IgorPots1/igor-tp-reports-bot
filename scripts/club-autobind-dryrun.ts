/**
 * Club auto-bind DRY-RUN. READ-ONLY — writes NOTHING to the DB. Prints, per unbound
 * active student, the telegram_user_id we could bind and the source/confidence, plus
 * a summary. To actually apply, run with `--apply` (guarded; Igor runs it, not me).
 *
 * Source: for a Telegram private 1:1 chat, chat.id == user.id. Verified on this data:
 * all 17 already-bound students have telegram_chat_id == telegram_user_id (17/17). So
 * an unbound student whose telegram_chat_id is a positive numeric (private chat) can
 * be bound as telegram_user_id = telegram_chat_id with high confidence.
 *
 * Safety: skips a chat_id that already belongs to another binding (collision) or is
 * shared by two students. Only unambiguous matches are proposed.
 *
 * Run (dry-run): node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *   --env-file=.env.local scripts/club-autobind-dryrun.ts
 */

import { createSupabaseServerClient } from "@/features/supabase/server";
import { fetchAllRows } from "@/features/supabase/paginate";

type Student = {
  id: string;
  student_name: string;
  telegram_user_id: number | null;
  telegram_chat_id: string | null;
  is_active: boolean | null;
  is_service_account: boolean | null;
};

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const rows = await fetchAllRows<Student>(
    (from, to) =>
      supabase
        .from("trainingpeaks_students")
        .select("id, student_name, telegram_user_id, telegram_chat_id, is_active, is_service_account")
        .order("id", { ascending: true })
        .range(from, to),
    { label: "students" }
  );

  const active = rows.filter((r) => r.is_active !== false && r.is_service_account !== true);
  const boundUserIds = new Set(active.filter((r) => r.telegram_user_id != null).map((r) => String(r.telegram_user_id)));
  const chatIdCounts = new Map<string, number>();
  for (const r of active) {
    if (r.telegram_chat_id) chatIdCounts.set(r.telegram_chat_id, (chatIdCounts.get(r.telegram_chat_id) ?? 0) + 1);
  }

  const unbound = active.filter((r) => r.telegram_user_id == null);
  const autobind: Array<{ name: string; tgId: string }> = [];
  const manual: Array<{ name: string; reason: string }> = [];

  for (const s of unbound) {
    const chat = s.telegram_chat_id ?? "";
    if (!/^[0-9]+$/.test(chat)) {
      manual.push({ name: s.student_name, reason: "нет приватного numeric telegram_chat_id" });
      continue;
    }
    if (boundUserIds.has(chat)) {
      manual.push({ name: s.student_name, reason: `chat_id ${chat} уже привязан к другому — коллизия` });
      continue;
    }
    if ((chatIdCounts.get(chat) ?? 0) > 1) {
      manual.push({ name: s.student_name, reason: `chat_id ${chat} делят несколько строк — спор` });
      continue;
    }
    autobind.push({ name: s.student_name, tgId: chat });
  }

  console.log("== Club auto-bind DRY-RUN (ничего не записано) ==");
  console.log(`активных: ${active.length}, привязано: ${active.length - unbound.length}, непривязано: ${unbound.length}`);
  console.log(`→ автопривязка (однозначно): ${autobind.length}`);
  console.log(`→ на ручное решение: ${manual.length}`);
  console.log("");
  console.log("ученик | telegram_id | источник | уверенность");
  for (const a of autobind) console.log(`  ${a.name} | ${a.tgId} | private chat_id (== user_id) | высокая`);
  console.log("");
  console.log("НА РУЧНОЕ:");
  for (const m of manual) console.log(`  ${m.name} — ${m.reason}`);

  if (!APPLY) {
    console.log("\n(dry-run: запусти с --apply, чтобы применить. Записывает telegram_user_id = telegram_chat_id только по однозначным.)");
    return;
  }

  // --apply: bind unambiguous matches. Idempotent-ish: only sets where currently null.
  let done = 0;
  for (const a of autobind) {
    const { error } = await supabase
      .from("trainingpeaks_students")
      .update({ telegram_user_id: Number(a.tgId) })
      .eq("telegram_chat_id", a.tgId)
      .is("telegram_user_id", null);
    if (!error) done += 1;
    else console.error(`  FAIL ${a.name}: ${error.message}`);
  }
  console.log(`\n[APPLY] привязано: ${done}/${autobind.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
