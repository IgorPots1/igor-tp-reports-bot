/**
 * Очередь уведомлений ученицам (intervals_notify_outbox) [решение Игоря, 26.10.2026].
 * Без базы и Telegram: оркестратор на подделках + форма миграции.
 *
 * ЧТО СТЕРЕЖЁТ:
 * - флаг выключен — ни одна строка не тронута, ничего не уходит, всё pending;
 * - не больше 5 отправок одной ученице за скользящие сутки, сверх — ждёт;
 * - строку, которую забрал другой запуск, второй раз не шлём;
 * - дубль: «один объект — один раз» держат уникальные индексы (plan_ready и
 *   coach_reply — строго, week_updated — раз в сутки), и только по
 *   pending/sent, чтобы failed/skipped можно было поставить заново;
 * - исход общей функции отправки честно ложится в статус: prepared — не sent.
 *
 *   npm run check:notify-outbox
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DAILY_LIMIT, outcomeOf, processOutbox, type OutboxDeps, type OutboxRow, type Outcome } from "@/features/intervals/notify-outbox/process";

type Row = OutboxRow & { status: "pending" | Outcome["status"]; processedAt: string | null };

function fakeDb(rows: Row[], opts: { sendResult?: (r: Row) => Outcome; enabled?: boolean; now?: Date } = {}) {
  const sent: string[] = [];
  const now = opts.now ?? new Date("2026-10-26T18:00:00Z");
  const deps: OutboxDeps = {
    enabled: opts.enabled ?? true,
    now,
    async listPending() {
      return rows.filter((r) => r.status === "pending").map((r) => ({ ...r }));
    },
    async countSentSince(sourceId, sinceIso) {
      return rows.filter((r) => r.sourceId === sourceId && r.status === "sent" && (r.processedAt ?? "") >= sinceIso).length;
    },
    async claim(row) {
      const r = rows.find((x) => x.id === row.id)!;
      if (r.status !== "pending" || r.attempts !== row.attempts) return false;
      r.attempts += 1;
      return true;
    },
    async send(row) {
      sent.push(row.id);
      return opts.sendResult ? opts.sendResult(rows.find((x) => x.id === row.id)!) : { status: "sent", reason: null };
    },
    async finish(row, outcome) {
      const r = rows.find((x) => x.id === row.id)!;
      if (r.status !== "pending") return;
      r.status = outcome.status;
      r.processedAt = now.toISOString();
    },
  };
  return { deps, sent, rows };
}

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id, sourceId: "valentina", kind: "plan_ready", planWeekId: `w-${id}`, coachMessageId: null,
  requestedAt: `2026-10-26T17:${id.padStart(2, "0")}:00Z`, attempts: 0, status: "pending", processedAt: null, ...over,
});

// ── Флаг выключен: ничего не уходит, всё лежит pending ───────────────────────
{
  const db = fakeDb([row("1"), row("2", { kind: "coach_reply", planWeekId: null, coachMessageId: "m2" })], { enabled: false });
  const s = await processOutbox(db.deps);
  assert.equal(db.sent.length, 0, "при выключенном флаге не уходит ничего");
  assert.ok(db.rows.every((r) => r.status === "pending" && r.attempts === 0), "строки лежат pending и даже не забраны");
  assert.equal(s.enabled, false);
}

// ── Лимит 5 за скользящие сутки, сверх — ждёт pending ────────────────────────
{
  const old = Array.from({ length: 3 }, (_, i) => row(`o${i}`, { status: "sent", processedAt: "2026-10-26T10:00:00Z" }));
  const stale = row("x", { status: "sent", processedAt: "2026-10-25T17:00:00Z" }); // 25 часов назад — уже не в окне
  const fresh = Array.from({ length: 4 }, (_, i) => row(String(i + 10)));
  const other = row("20", { sourceId: "другая" });
  const db = fakeDb([...old, stale, ...fresh, other]);
  const s = await processOutbox(db.deps);
  assert.equal(db.rows.filter((r) => r.sourceId === "valentina" && r.status === "sent").length - 1, DAILY_LIMIT, `ей ушло ровно до ${DAILY_LIMIT} за сутки (старая за окном не в счёт)`);
  assert.equal(db.rows.filter((r) => r.sourceId === "valentina" && r.status === "pending").length, 2, "сверх лимита — ждут pending, не пропадают");
  assert.equal(s.waitingLimit, 2);
  assert.ok(db.rows.find((r) => r.id === "20")?.status === "sent", "лимит одной ученицы не держит другую");
}

// ── Забрал другой запуск — второй раз не шлём ────────────────────────────────
{
  const db = fakeDb([row("1")]);
  const realClaim = db.deps.claim;
  db.deps.claim = async (r) => {
    db.rows[0].attempts += 1; // другой запуск успел раньше
    return realClaim(r);
  };
  const s = await processOutbox(db.deps);
  assert.equal(db.sent.length, 0, "строку, забранную другим запуском, не отправляем");
  assert.equal(s.lostClaim, 1);
}

// ── Повторный проход: отправленное второй раз не уходит ──────────────────────
{
  const db = fakeDb([row("1"), row("2")]);
  await processOutbox(db.deps);
  await processOutbox(db.deps);
  assert.deepEqual(db.sent, ["1", "2"], "второй проход раннера ничего не шлёт повторно");
}

// ── Исход общей функции → статус строки ──────────────────────────────────────
assert.deepEqual(outcomeOf({ kind: "sent", chatId: "1" }), { status: "sent", reason: null });
assert.equal(outcomeOf({ kind: "prepared", reason: "INTERVALS_COACH_SEND_ENABLED выключен" }).status, "skipped", "«подготовлено, наружу не ушло» — не sent");
assert.equal(outcomeOf({ kind: "prepared", reason: "сегодня уже уведомляли этим видом" }).status, "skipped");
assert.equal(outcomeOf({ kind: "refused", code: "paused", messageRu: "На паузе" }).status, "skipped", "пауза — skipped с причиной");
assert.equal(outcomeOf({ kind: "refused", code: "delivery_disabled", messageRu: "выкл" }).status, "skipped");
assert.equal(outcomeOf({ kind: "refused", code: "failed", messageRu: "Telegram не принял" }).status, "failed");
{
  const db = fakeDb([row("1")], { sendResult: () => { throw new Error("сеть"); } });
  await processOutbox(db.deps);
  assert.equal(db.rows[0].status, "failed", "исключение при отправке — failed, раннер не падает");
}

// ── Дубль держит база: форма уникальных индексов ─────────────────────────────
const sql = readFileSync("supabase/migrations/20261113000000_intervals_notify_outbox.sql", "utf8").replace(/\s+/g, " ");
assert.ok(/unique index[^;]*on public\.intervals_notify_outbox\(plan_week_id\) where kind = 'plan_ready' and status in \('pending', 'sent'\)/.test(sql), "plan_ready — строго один раз на неделю");
assert.ok(/unique index[^;]*on public\.intervals_notify_outbox\(plan_week_id, request_day\) where kind = 'week_updated' and status in \('pending', 'sent'\)/.test(sql), "week_updated — раз в сутки на неделю");
assert.ok(/unique index[^;]*on public\.intervals_notify_outbox\(coach_message_id\) where kind = 'coach_reply' and status in \('pending', 'sent'\)/.test(sql), "coach_reply — строго один раз");
assert.ok(sql.includes("enable row level security") && sql.includes("revoke all on public.intervals_notify_outbox from anon, authenticated"), "RLS и закрытый доступ, как у intervals_*");

// ── Пауза — в общих функциях, их соблюдают и кнопки админки ──────────────────
const coach = readFileSync("src/features/intervals/loop/coach-message.ts", "utf8");
assert.ok((coach.match(/pauseRefusal\(input\.sourceId, input\.todayIso\)/g) ?? []).length === 2, "пауза проверяется и в notifyWeekReleased, и в deliverCoachMessage");
const admin = readFileSync("src/app/admin/coach-os/beginner/actions.ts", "utf8");
assert.ok(/deliverCoachMessage\(\{[\s\S]*?sourceId,[\s\S]*?todayIso:/.test(admin), "кнопка «Ответить» передаёт, чья и какой сегодня день — пауза у неё работает");

console.log("check:notify-outbox — все проверки пройдены");
