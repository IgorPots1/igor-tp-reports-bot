/**
 * Очередь уведомлений ученицам (intervals_notify_outbox) — оркестратор.
 *
 * Чистый: всё, что ходит в базу и в Telegram, приходит зависимостями. Его
 * гоняет check:notify-outbox на подделках, раннер — на настоящих (deliver.ts).
 *
 * ПРАВИЛА [решение Игоря, 26.10.2026]:
 * - флаг выключен — очередь не трогаем вовсе: строки лежат pending;
 * - не больше DAILY_LIMIT отправок одной ученице за скользящие 24 часа;
 *   сверх лимита строка ждёт pending, не пропадает;
 * - строку сначала ЗАБИРАЕМ (условный update по attempts): два пересёкшихся
 *   запуска раннера не отправят её дважды;
 * - отправка — теми же функциями, что кнопки админки, исход их же словами.
 */

export const DAILY_LIMIT = 5;

export type OutboxKind = "plan_ready" | "week_updated" | "coach_reply";

export type OutboxRow = {
  id: string;
  sourceId: string;
  kind: OutboxKind;
  planWeekId: string | null;
  coachMessageId: string | null;
  requestedAt: string;
  attempts: number;
};

export type Outcome = { status: "sent" | "failed" | "skipped"; reason: string | null };

export type OutboxDeps = {
  enabled: boolean;
  now: Date;
  listPending(): Promise<OutboxRow[]>;
  /** Сколько строк этой ученицы ушло (sent) после указанного момента. */
  countSentSince(sourceId: string, sinceIso: string): Promise<number>;
  /** Забрать строку: true — она наша, false — её уже взял другой запуск. */
  claim(row: OutboxRow): Promise<boolean>;
  send(row: OutboxRow): Promise<Outcome>;
  finish(row: OutboxRow, outcome: Outcome): Promise<void>;
  log?(line: string): void;
};

export type OutboxSummary = { enabled: boolean; pending: number; sent: number; skipped: number; failed: number; waitingLimit: number; lostClaim: number };

export async function processOutbox(deps: OutboxDeps): Promise<OutboxSummary> {
  const summary: OutboxSummary = { enabled: deps.enabled, pending: 0, sent: 0, skipped: 0, failed: 0, waitingLimit: 0, lostClaim: 0 };
  if (!deps.enabled) {
    deps.log?.("INTERVALS_NOTIFY_OUTBOX_ENABLED выключен — очередь не трогаем");
    return summary;
  }
  const rows = [...(await deps.listPending())].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  summary.pending = rows.length;
  const since = new Date(deps.now.getTime() - 24 * 3600 * 1000).toISOString();
  const sentBySource = new Map<string, number>();

  for (const row of rows) {
    if (!sentBySource.has(row.sourceId)) sentBySource.set(row.sourceId, await deps.countSentSince(row.sourceId, since));
    if ((sentBySource.get(row.sourceId) ?? 0) >= DAILY_LIMIT) {
      summary.waitingLimit += 1;
      deps.log?.(`${row.id} ${row.kind}: ждёт — лимит ${DAILY_LIMIT} за сутки`);
      continue;
    }
    if (!(await deps.claim(row))) {
      summary.lostClaim += 1;
      continue;
    }
    let outcome: Outcome;
    try {
      outcome = await deps.send(row);
    } catch (error) {
      outcome = { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
    await deps.finish(row, outcome);
    summary[outcome.status] += 1;
    if (outcome.status === "sent") sentBySource.set(row.sourceId, (sentBySource.get(row.sourceId) ?? 0) + 1);
    deps.log?.(`${row.id} ${row.kind}: ${outcome.status}${outcome.reason ? ` — ${outcome.reason}` : ""}`);
  }
  return summary;
}

/**
 * Исход общей функции отправки (CoachSendResult) → статус строки очереди.
 * «prepared» значит «наружу не ушло» (выключена отправка, сегодня уже
 * уведомляли) — это skipped, а не sent: тренер должен видеть, что не дошло.
 */
export function outcomeOf(result:
  | { kind: "sent"; chatId: string }
  | { kind: "prepared"; reason: string }
  | { kind: "refused"; code: string; messageRu: string }): Outcome {
  if (result.kind === "sent") return { status: "sent", reason: null };
  if (result.kind === "prepared") return { status: "skipped", reason: result.reason };
  if (result.code === "failed" || result.code === "empty_body") return { status: "failed", reason: result.messageRu };
  return { status: "skipped", reason: result.messageRu };
}
