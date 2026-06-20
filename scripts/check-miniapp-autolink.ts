/**
 * Unit tests for mini-app student auto-linking:
 *  - linkTelegramUserIdToStudent (atomic, collision-safe) via an in-memory
 *    fake Supabase client — no live DB required.
 *  - resolveMiniAppStudent end-to-end: valid sid+sig links on first open,
 *    forged sig is rejected with a coach notification, a user.id already bound
 *    to another student collides without overwrite, and a re-open is idempotent.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  linkTelegramUserIdToStudent,
  type SupabaseServerClientLike,
} from "../src/features/trainingpeaks/repository";
import { resolveMiniAppStudent } from "../src/features/telegram/miniapp-student-resolver";
import { signStudentLinkWithToken } from "../src/features/telegram/validate-init-data";

const TEST_TOKEN = "1234567890:ABCDEFGhijklmnopqrstuvwxyz_test_token";
process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;

// --- in-memory fake Supabase client ---

type Row = Record<string, unknown>;

function makeRow(overrides: Partial<Row> & { student_id: string }): Row {
  return {
    id: `id-${overrides.student_id}`,
    student_id: overrides.student_id,
    student_name: `Name ${overrides.student_id}`,
    trainingpeaks_athlete_url: "https://tp/x",
    is_active: true,
    weekly_report_enabled: true,
    archived_at: null,
    telegram_chat_id: "100",
    telegram_user_id: null,
    telegram_username: null,
    telegram_profile_url: null,
    telegram_delivery_enabled: true,
    telegram_formality: "unknown",
    telegram_context_notes: null,
    data_quality_status: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFakeClient(rows: Row[]): SupabaseServerClientLike {
  function makeBuilder() {
    let mode: "select" | "update" = "select";
    let patch: Row | null = null;
    const filters: { col: string; val: unknown; op: "eq" | "is" }[] = [];

    const builder = {
      select() {
        if (mode !== "update") mode = "select";
        return builder;
      },
      update(p: Row) {
        mode = "update";
        patch = p;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val, op: "eq" });
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push({ col, val, op: "is" });
        return builder;
      },
      async maybeSingle() {
        const matches = (r: Row) =>
          filters.every((f) =>
            f.op === "is" ? (r[f.col] ?? null) === f.val : r[f.col] === f.val
          );
        const matched = rows.filter(matches);
        if (mode === "update" && patch) {
          for (const r of matched) Object.assign(r, patch);
        }
        return { data: matched[0] ?? null, error: null };
      },
    };
    return builder;
  }

  return {
    from() {
      return makeBuilder();
    },
  } as unknown as SupabaseServerClientLike;
}

/** Build a valid Telegram initData string for the test token. */
function buildValidInitData(userId: number, firstName = "Мария"): string {
  const params = new URLSearchParams({
    auth_date: "1700000000",
    user: JSON.stringify({ id: userId, first_name: firstName }),
  });
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(TEST_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

async function main() {
// --- 1. linkTelegramUserIdToStudent: empty target → linked ---

{
  const rows = [makeRow({ student_id: "S1", telegram_user_id: null })];
  const client = makeFakeClient(rows);
  const r = await linkTelegramUserIdToStudent("S1", 555, client);
  assert.equal(r.status, "linked", "empty target must link");
  assert.equal(rows[0].telegram_user_id, 555, "user.id must be written to the row");
}

// --- 2. repeat link (same pair) → idempotent, not overwritten ---

{
  const rows = [makeRow({ student_id: "S1", telegram_user_id: 555 })];
  const client = makeFakeClient(rows);
  const r = await linkTelegramUserIdToStudent("S1", 555, client);
  assert.equal(r.status, "already_linked_same", "same pair must be idempotent");
  assert.equal(rows[0].telegram_user_id, 555, "value unchanged");
}

// --- 3. user.id already at ANOTHER student → collision_user_taken, no overwrite ---

{
  const rows = [
    makeRow({ student_id: "A", telegram_user_id: 777 }),
    makeRow({ student_id: "B", telegram_user_id: null }),
  ];
  const client = makeFakeClient(rows);
  const r = await linkTelegramUserIdToStudent("B", 777, client);
  assert.equal(r.status, "collision_user_taken", "user.id taken elsewhere must collide");
  assert.equal(rows[1].telegram_user_id, null, "B must NOT be overwritten");
}

// --- 4. target already has a DIFFERENT user.id → collision_student_taken ---

{
  const rows = [makeRow({ student_id: "C", telegram_user_id: 888 })];
  const client = makeFakeClient(rows);
  const r = await linkTelegramUserIdToStudent("C", 999, client);
  assert.equal(r.status, "collision_student_taken", "different user.id on target must collide");
  assert.equal(rows[0].telegram_user_id, 888, "C must NOT be overwritten");
}

// --- 5. unknown student → student_not_found ---

{
  const client = makeFakeClient([]);
  const r = await linkTelegramUserIdToStudent("nope", 111, client);
  assert.equal(r.status, "student_not_found", "unknown student");
}

// --- 6. resolver: valid sid+sig, empty user_id → auto-link, no coach notify ---

{
  const rows = [makeRow({ student_id: "S1", telegram_user_id: null })];
  const client = makeFakeClient(rows);
  const notices: string[] = [];
  const sig = signStudentLinkWithToken("S1", TEST_TOKEN);
  const res = await resolveMiniAppStudent(
    { initData: buildValidInitData(555), sid: "S1", sig },
    { client, notifyCoach: async (d) => void notices.push(d) }
  );
  assert.ok(res.ok, "valid link must succeed");
  if (res.ok) {
    assert.equal(res.justLinked, true, "first open must auto-link");
    assert.equal(res.student.studentId, "S1");
  }
  assert.equal(rows[0].telegram_user_id, 555, "user.id written");
  assert.equal(notices.length, 0, "no coach notification on success");
}

// --- 7. resolver: forged sig → invalid_signature + coach notify ---

{
  const rows = [makeRow({ student_id: "S1", telegram_user_id: null })];
  const client = makeFakeClient(rows);
  const notices: string[] = [];
  const res = await resolveMiniAppStudent(
    { initData: buildValidInitData(555), sid: "S1", sig: "deadbeefdeadbeefdeadbeefdeadbeef" },
    { client, notifyCoach: async (d) => void notices.push(d) }
  );
  assert.ok(!res.ok, "forged sig must fail");
  if (!res.ok) assert.equal(res.code, "invalid_signature");
  assert.equal(rows[0].telegram_user_id, null, "nothing written on forged sig");
  assert.equal(notices.length, 1, "coach notified about forged sig");
}

// --- 8. resolver: user.id belongs to another (inactive) student → collision + notify ---

{
  // A is inactive so the active-only step-1 lookup misses it, but the link-time
  // collision check (no active filter) catches the conflict.
  const rows = [
    makeRow({ student_id: "A", telegram_user_id: 777, is_active: false }),
    makeRow({ student_id: "B", telegram_user_id: null }),
  ];
  const client = makeFakeClient(rows);
  const notices: string[] = [];
  const sig = signStudentLinkWithToken("B", TEST_TOKEN);
  const res = await resolveMiniAppStudent(
    { initData: buildValidInitData(777), sid: "B", sig },
    { client, notifyCoach: async (d) => void notices.push(d) }
  );
  assert.ok(!res.ok, "collision must fail");
  if (!res.ok) assert.equal(res.code, "collision");
  assert.equal(rows[1].telegram_user_id, null, "B must NOT be overwritten");
  assert.equal(notices.length, 1, "coach notified about collision");
}

// --- 9. resolver: already linked → idempotent resolve, no sid needed ---

{
  const rows = [makeRow({ student_id: "S1", telegram_user_id: 555 })];
  const client = makeFakeClient(rows);
  const notices: string[] = [];
  const res = await resolveMiniAppStudent(
    { initData: buildValidInitData(555), sid: null, sig: null },
    { client, notifyCoach: async (d) => void notices.push(d) }
  );
  assert.ok(res.ok, "already-linked must resolve");
  if (res.ok) assert.equal(res.justLinked, false, "re-open is not a fresh link");
  assert.equal(notices.length, 0, "no notification on normal resolve");
}

console.log("PASS check-miniapp-autolink");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
