/**
 * Read-only club adoption stats → printed for docs/club-adoption.md. No writes.
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local scripts/club-adoption-stats.ts
 */
import { createSupabaseServerClient } from "@/features/supabase/server";

function weekAgoIso(): string {
  // fixed-window: 7 days before the DB's now(); computed in SQL below, this is a fallback label
  return "";
}

async function main(): Promise<void> {
  const s = createSupabaseServerClient();

  // 1) active non-service students
  const { data: studs } = await s
    .from("trainingpeaks_students")
    .select("id, student_name, is_active, is_service_account, archived_at, telegram_user_id, telegram_chat_id, telegram_delivery_enabled")
    .eq("is_active", true)
    .eq("is_service_account", false)
    .is("archived_at", null);
  const students = (studs as Array<Record<string, unknown>>) ?? [];
  const total = students.length;
  const withUserId = students.filter((r) => r.telegram_user_id != null);
  const withChat = students.filter((r) => r.telegram_chat_id != null);
  const sendable = students.filter((r) => r.telegram_chat_id != null && r.telegram_delivery_enabled === true);
  const noUserId = students.filter((r) => r.telegram_user_id == null);

  console.log(`ВСЕГО активных (не сервисных, не архив): ${total}`);
  console.log(`  с telegram_user_id (бот знает / привязаны к клубу): ${withUserId.length}`);
  console.log(`  с telegram_chat_id (есть DM-цель): ${withChat.length}`);
  console.log(`  можно РЕАЛЬНО отправить (chat_id + delivery_enabled): ${sendable.length}`);
  console.log(`  БЕЗ telegram_user_id: ${noUserId.length}`);

  // 2) link events (bind attempts) — proxy for "opened + acted"
  const { data: le } = await s.from("club_link_events").select("telegram_user_id, result, created_at");
  const linkEvents = (le as Array<Record<string, unknown>>) ?? [];
  const confirmed = linkEvents.filter((e) => e.result === "confirmed");
  const confirmedUsers = new Set(confirmed.map((e) => String(e.telegram_user_id)));

  // 3) access requests (general-link queue)
  const { data: ar } = await s.from("club_access_requests").select("telegram_user_id, status, created_at, student_id");
  const requests = (ar as Array<Record<string, unknown>>) ?? [];
  const pending = requests.filter((r) => r.status === "pending");
  const approved = requests.filter((r) => r.status === "approved");
  const requestUsers = new Set(requests.map((r) => String(r.telegram_user_id)));

  // opened-at-least-once proxy = union of confirmed-bind users + access-request users
  const openedUsers = new Set<string>([...confirmedUsers, ...requestUsers]);

  // last-week activity: now minus 7d, compare created_at
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const openedLastWeek = new Set<string>([
    ...confirmed.filter((e) => String(e.created_at) >= cutoff).map((e) => String(e.telegram_user_id)),
    ...requests.filter((r) => String(r.created_at) >= cutoff).map((r) => String(r.telegram_user_id)),
  ]);

  console.log(`\nОткрывали клуб (ПРОКСИ = привязка-подтверждение ∪ заявка): ${openedUsers.size}`);
  console.log(`  из них за последние 7 дней (по created_at событий): ${openedLastWeek.size}`);
  console.log(`\nПривязка сами через «Это я» (confirm-токен): ${confirmedUsers.size} уникальных`);
  console.log(`Одобрено заявок (general-link, тренер подтвердил): ${approved.length}`);
  console.log(`(автопривязки в клубе НЕТ — только confirm-токен или одобрение заявки)`);
  console.log(`\nВисит неразобранных заявок (status=pending): ${pending.length}`);

  console.log(`\n=== БЕЗ telegram_user_id (${noUserId.length}) — кому рассылка НЕ дойдёт как привязанным ===`);
  for (const r of noUserId.sort((a, b) => String(a.student_name).localeCompare(String(b.student_name)))) {
    console.log(`  ${r.student_name}  (chat_id=${r.telegram_chat_id ?? "нет"}, delivery=${r.telegram_delivery_enabled})`);
  }
  void weekAgoIso;
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
