/**
 * Club auto-bind DRY-RUN + NAME CROSS-CHECK. READ-ONLY unless `--apply`.
 *
 * For a Telegram private 1:1 chat, chat.id == user.id (verified: 17/17 bound students
 * have telegram_chat_id == telegram_user_id). So an unbound student whose
 * telegram_chat_id is a positive numeric can be bound as telegram_user_id = chat_id.
 *
 * Before applying, this cross-checks the TP student_name against the Telegram name
 * (first+last / username from trainingpeaks_telegram_business_chats), transliterating
 * Cyrillic→Latin, and sorts MOST DISSIMILAR first for eye review. Students with no
 * saved Telegram name are flagged separately. Writes docs/club-autobind-names.md.
 *
 * Run (dry-run): node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *   --env-file=.env.local scripts/club-autobind-dryrun.ts
 * Apply (Igor):  ... scripts/club-autobind-dryrun.ts --apply
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { fetchAllRows } from "@/features/supabase/paginate";

const APPLY = process.argv.includes("--apply");

// --- Cyrillic (RU) → Latin, roughly matching how TP transliterates names. ---
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y",
  ь: "", э: "e", ю: "yu", я: "ya",
};
function translit(s: string): string {
  return s.toLowerCase().split("").map((c) => (c in CYR ? CYR[c] : c)).join("");
}
function norm(s: string | null | undefined): string {
  return translit((s ?? "").toLowerCase()).replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}
function ratio(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}
/** Order-insensitive token similarity (best bipartite match, averaged over smaller set). */
function nameSim(a: string, b: string): number {
  const ta = norm(a).split(" ").filter(Boolean);
  const tb = norm(b).split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let sum = 0;
  for (const t of small) sum += Math.max(...big.map((u) => ratio(t, u)));
  return sum / small.length;
}

type Student = { id: string; student_name: string; telegram_user_id: number | null; telegram_chat_id: string | null; telegram_username: string | null; is_active: boolean | null; is_service_account: boolean | null };
type BizChat = { chat_id: string; username: string | null; first_name: string | null; last_name: string | null };

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const students = await fetchAllRows<Student>(
    (from, to) => supabase.from("trainingpeaks_students").select("id, student_name, telegram_user_id, telegram_chat_id, telegram_username, is_active, is_service_account").order("id", { ascending: true }).range(from, to),
    { label: "students" }
  );
  const chats = await fetchAllRows<BizChat>(
    (from, to) => supabase.from("trainingpeaks_telegram_business_chats").select("chat_id, username, first_name, last_name").order("chat_id", { ascending: true }).range(from, to),
    { label: "business_chats" }
  );
  const chatBy: Record<string, BizChat> = {};
  for (const c of chats) if (c.chat_id) chatBy[c.chat_id] = c;

  const active = students.filter((r) => r.is_active !== false && r.is_service_account !== true);
  const boundUserIds = new Set(active.filter((r) => r.telegram_user_id != null).map((r) => String(r.telegram_user_id)));
  const chatIdCounts = new Map<string, number>();
  for (const r of active) if (r.telegram_chat_id) chatIdCounts.set(r.telegram_chat_id, (chatIdCounts.get(r.telegram_chat_id) ?? 0) + 1);

  type Row = { name: string; tgId: string; tgName: string; tgUser: string; sim: number; noName: boolean };
  const autobind: Row[] = [];
  const manual: Array<{ name: string; reason: string }> = [];

  for (const s of active.filter((r) => r.telegram_user_id == null)) {
    const chat = s.telegram_chat_id ?? "";
    if (!/^[0-9]+$/.test(chat)) { manual.push({ name: s.student_name, reason: "нет приватного numeric telegram_chat_id" }); continue; }
    if (boundUserIds.has(chat)) { manual.push({ name: s.student_name, reason: `chat_id ${chat} уже привязан — коллизия` }); continue; }
    if ((chatIdCounts.get(chat) ?? 0) > 1) { manual.push({ name: s.student_name, reason: `chat_id ${chat} делят несколько строк` }); continue; }
    const bc = chatBy[chat];
    const tgFull = bc ? `${bc.first_name ?? ""} ${bc.last_name ?? ""}`.trim() : "";
    const tgUser = bc?.username ?? s.telegram_username ?? "";
    const sim = Math.max(tgFull ? nameSim(s.student_name, tgFull) : 0, tgUser ? nameSim(s.student_name, tgUser) : 0);
    autobind.push({ name: s.student_name, tgId: chat, tgName: tgFull || "—", tgUser: tgUser || "—", sim, noName: !tgFull && !tgUser });
  }

  autobind.sort((a, b) => a.sim - b.sim); // most dissimilar first

  const lines: string[] = [];
  lines.push("# Автопривязка — сверка имён (read-only, отсортировано: НЕПОХОЖИЕ сверху)");
  lines.push("");
  lines.push(`Кандидатов: ${autobind.length}. Похожесть: 0.00 (непохоже) … 1.00 (совпадает). Cyrillic→Latin транслитерация.`);
  lines.push("Смотри верх списка глазами; низ — явные совпадения.");
  lines.push("");
  lines.push("| похожесть | ученик (TP) | Telegram имя | @username | telegram_id |");
  lines.push("|---|---|---|---|---|");
  for (const r of autobind) lines.push(`| ${r.sim.toFixed(2)}${r.noName ? " ⚠нет имени" : ""} | ${r.name} | ${r.tgName} | ${r.tgUser} | ${r.tgId} |`);
  lines.push("");
  const noName = autobind.filter((r) => r.noName);
  lines.push(`## Без сохранённого Telegram-имени (сверить нечем): ${noName.length}`);
  for (const r of noName) lines.push(`- ${r.name} (${r.tgId})`);
  lines.push("");
  lines.push(`## На ручное решение (не автопривязка): ${manual.length}`);
  for (const m of manual) lines.push(`- ${m.name} — ${m.reason}`);

  const out = resolve(process.cwd(), "docs/club-autobind-names.md");
  writeFileSync(out, lines.join("\n"), "utf8");

  console.log(`== auto-bind name cross-check (dry-run) ==`);
  console.log(`autobind=${autobind.length} manual=${manual.length} no_tg_name=${noName.length}`);
  console.log("Топ-10 самых НЕПОХОЖИХ:");
  for (const r of autobind.slice(0, 10)) console.log(`  ${r.sim.toFixed(2)}  ${r.name}  ←→  ${r.tgName} / @${r.tgUser}`);
  console.log(`wrote ${out}`);

  if (!APPLY) { console.log("\n(dry-run — ничего не записано. --apply привяжет однозначные, где telegram_user_id пуст.)"); return; }
  let done = 0;
  for (const r of autobind) {
    const { error } = await supabase.from("trainingpeaks_students").update({ telegram_user_id: Number(r.tgId) }).eq("telegram_chat_id", r.tgId).is("telegram_user_id", null);
    if (!error) done += 1; else console.error(`  FAIL ${r.name}: ${error.message}`);
  }
  console.log(`\n[APPLY] привязано: ${done}/${autobind.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
