// Presentational view model for the Mini App «Отчёты» tab. PURE and
// JSON-serializable (it crosses the API→client boundary): turns a feedback-queue
// job into a review card, and builds the transparency panel — WHY the system
// wrote this draft — from the frozen context_packet (observations + comparison),
// glossed into human words. Never invents; only maps stored fields.

import { GLOSS } from "./feedback-corpus.ts";
import { scoreFeedbackSignificance, type FeedbackSignificanceBadge } from "./feedback-significance.ts";
import type { AdviceKey } from "./advice-keys.ts";
import type { FeedbackContextPacket } from "./context-packet.ts";
import type { FeedbackJobStatus, TrainingPeaksFeedbackJob } from "./feedback-queue.ts";

// How Igor can reach this student, decided from their Telegram wiring:
//   dm    → 1:1 Business DM — the bot can deliver server-side (auto-send path).
//   group → only a linked group/topic — Business API can't post there; Igor shares
//           it from his own account via the client, so it's marked 'shared' not 'sent'.
//   none  → no reachable channel — nothing to send.
export type ReportChannel = "dm" | "group" | "none";

// A line in the "почему так" panel. `kind` drives the coloured tag in the UI.
export type ReportTransparencyItem = {
  kind: "arc" | "praise" | "correction" | "care" | "question" | "comparison" | "signal";
  text: string;
};

export type ReportCardView = {
  id: string;
  studentName: string;
  telegramUsername: string | null;
  workoutDate: string | null; // ISO 'YYYY-MM-DD' or null (blocked job with empty packet)
  dateLabel: string;
  sessionTypeLabel: string;
  status: FeedbackJobStatus;
  // Text to show / edit: Igor's edit wins over the machine draft.
  draftText: string | null;
  coachEdited: boolean;
  transparency: ReportTransparencyItem[];
  // blocked/failed only — the coach-facing "разберись" reason; no student text.
  attentionReason: string | null;
  // «Новые» (pending/generating) only — how much there is to discuss, for sorting +
  // a card badge. null for already-generated cards.
  significanceBadge: FeedbackSignificanceBadge | null;
  // How Igor sends this one (drives which button shows on a 'done' card).
  channel: ReportChannel;
  // Group share prefix so the student gets a mention notification ('@username' when
  // known, else the plain name). null for dm/none.
  mention: string | null;
};

export type ReportsView = {
  queue: ReportCardView[]; // 'pending' + 'generating' — cards WITHOUT text, awaiting Igor's «Сгенерить»
  review: ReportCardView[]; // status 'done' — actionable (send / edit / skip)
  attention: ReportCardView[]; // 'blocked' + 'failed' — coach signal, no student draft
  history: ReportCardView[]; // 'sent' + 'shared' + 'dismissed' — badge only
  sendEnabled: boolean; // FEEDBACK_SEND_ENABLED — false ⇒ Send is prepare-only
  counts: { queue: number; review: number; attention: number; history: number };
};

export type StudentChannelInfo = {
  name: string;
  telegramUsername: string | null;
  // 1:1 Business DM reachable (chat linked + delivery on) — server can auto-send.
  dmCapable?: boolean;
  // A linked group/topic exists — share-only channel.
  hasGroupThread?: boolean;
};

export type StudentLookup = (studentId: string) => StudentChannelInfo | undefined;

const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatRuDate(iso: string | null | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!m) return "";
  const day = Number.parseInt(m[3], 10);
  const month = RU_MONTHS[Number.parseInt(m[2], 10) - 1] ?? "";
  return `${day} ${month}`;
}

function sessionTypeLabel(sessionType: FeedbackContextPacket["sessionType"] | undefined): string {
  if (sessionType === "interval") return "Интервалы";
  if (sessionType === "long_tempo") return "Длительная / темп";
  if (sessionType === "easy") return "Лёгкая";
  return "Тренировка";
}

// Strip the model-facing tail from a comparison block so the coach sees only the
// human meaning: drop a trailing "(Эту цифру…)" note and any "— назови словами…" hint.
function cleanComparison(block: string): string {
  return block
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*—\s*назови[^.]*\.?\s*$/iu, "")
    .trim();
}

function transparencyKindFor(type: string, adviceKey: string): ReportTransparencyItem["kind"] {
  if (type === "praise") return "praise";
  if (type === "question") return "question";
  if (type === "coach_signal") return "signal";
  if (type === "correction") return adviceKey.startsWith("cause") ? "care" : "correction";
  return "correction";
}

function glossOf(adviceKey: string, reason: string): string {
  return GLOSS[adviceKey as AdviceKey] ?? reason;
}

// Build the "почему так" panel from the frozen packet. Focused observations are the
// drivers of the draft (shown first); a comparison-progress observation adds the
// delta line; coach_signal items (withheld from the student) are noted last.
function buildTransparency(packet: FeedbackContextPacket | undefined): ReportTransparencyItem[] {
  if (!packet || !Array.isArray(packet.observations)) return [];
  const items: ReportTransparencyItem[] = [];

  const isArc = typeof packet.observationsBlock === "string" && packet.observationsBlock.startsWith("Разбери ДУГОЙ");
  if (isArc) {
    items.push({ kind: "arc", text: "Разобрано дугой тренировки: начало → где переломилось → вывод/совет" });
  }

  const studentFacing = packet.observations.filter((o) => o.type !== "coach_signal");
  const drivers = studentFacing.filter((o) => o.focused);
  const shown = drivers.length > 0 ? drivers : studentFacing;
  for (const o of shown) {
    if (o.adviceKey === "praise_comparison_progress") continue; // rendered as the comparison line below
    items.push({ kind: transparencyKindFor(o.type, o.adviceKey), text: glossOf(o.adviceKey, o.reason) });
  }

  const hasComparison = packet.observations.some((o) => o.adviceKey === "praise_comparison_progress");
  if (hasComparison && typeof packet.comparisonBlock === "string") {
    const text = cleanComparison(packet.comparisonBlock);
    if (text) items.push({ kind: "comparison", text });
    // Coach-only raw baseline so Igor can verify the delta (never shown to the student).
    if (typeof packet.comparisonBaseline === "string" && packet.comparisonBaseline) {
      items.push({ kind: "signal", text: `сверка: ${packet.comparisonBaseline}` });
    }
  }

  for (const o of packet.observations.filter((o) => o.type === "coach_signal")) {
    items.push({ kind: "signal", text: `тренеру (не ученику): ${glossOf(o.adviceKey, o.reason)}` });
  }

  return items;
}

// Decide the send channel + mention from the student's Telegram wiring. DM wins when
// available (server can deliver); otherwise a group thread means share-only.
function resolveChannel(opts: { dmCapable?: boolean; hasGroupThread?: boolean; telegramUsername: string | null; studentName: string }): {
  channel: ReportChannel;
  mention: string | null;
} {
  if (opts.dmCapable) return { channel: "dm", mention: null };
  if (opts.hasGroupThread) {
    const mention = opts.telegramUsername ? `@${opts.telegramUsername.replace(/^@/u, "")}` : opts.studentName;
    return { channel: "group", mention };
  }
  return { channel: "none", mention: null };
}

export function buildReportCardView(
  job: TrainingPeaksFeedbackJob,
  studentName: string,
  telegramUsername: string | null,
  opts?: { dmCapable?: boolean; hasGroupThread?: boolean }
): ReportCardView {
  const packet = job.contextPacket as FeedbackContextPacket | undefined;
  const workoutDate = packet?.workoutDate ?? null;
  const isAttention = job.status === "blocked" || job.status === "failed";
  const isQueue = job.status === "pending" || job.status === "generating";
  const { channel, mention } = resolveChannel({
    dmCapable: opts?.dmCapable,
    hasGroupThread: opts?.hasGroupThread,
    telegramUsername,
    studentName,
  });
  return {
    id: job.id,
    studentName,
    telegramUsername,
    workoutDate,
    dateLabel: formatRuDate(workoutDate),
    sessionTypeLabel: sessionTypeLabel(packet?.sessionType),
    status: job.status,
    draftText: job.coachEditedText ?? job.draftText,
    coachEdited: job.coachEditedText !== null,
    // Queue cards show the "суть" (transparency) too — it's the only thing on a
    // card without a draft; attention cards stay text-free (coach signal only).
    transparency: isAttention ? [] : buildTransparency(packet),
    attentionReason: isAttention ? (job.blockedReason ?? job.errorReason ?? "нужно разобраться") : null,
    significanceBadge: isQueue ? scoreFeedbackSignificance(packet).badge : null,
    channel,
    mention,
  };
}

const QUEUE_STATUSES = new Set<FeedbackJobStatus>(["pending", "generating"]);
const ATTENTION_STATUSES = new Set<FeedbackJobStatus>(["blocked", "failed"]);
const HISTORY_STATUSES = new Set<FeedbackJobStatus>(["sent", "shared", "dismissed"]);

/**
 * Group jobs into the three tab sections. `jobs` should arrive newest-first (the
 * queue lists by created_at desc); that order is preserved within each section.
 * A job whose student is unknown falls back to a readable placeholder rather than
 * being dropped — the coach still sees the signal.
 */
export function buildReportsView(jobs: TrainingPeaksFeedbackJob[], lookup: StudentLookup, sendEnabled: boolean): ReportsView {
  const queue: Array<{ card: ReportCardView; score: number; date: string }> = [];
  const review: ReportCardView[] = [];
  const attention: ReportCardView[] = [];
  const history: ReportCardView[] = [];

  for (const job of jobs) {
    const student = lookup(job.studentId);
    const card = buildReportCardView(job, student?.name ?? "Ученик", student?.telegramUsername ?? null, {
      dmCapable: student?.dmCapable,
      hasGroupThread: student?.hasGroupThread,
    });
    if (QUEUE_STATUSES.has(job.status)) {
      const packet = job.contextPacket as FeedbackContextPacket | undefined;
      queue.push({ card, score: scoreFeedbackSignificance(packet).score, date: packet?.workoutDate ?? "" });
    } else if (job.status === "done") review.push(card);
    else if (ATTENTION_STATUSES.has(job.status)) attention.push(card);
    else if (HISTORY_STATUSES.has(job.status)) history.push(card);
  }

  // «Новые»: most to discuss on top; ties broken by freshest workout — so the eye
  // lands on the workouts that actually need a reply, not merely the newest.
  queue.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  const queueCards = queue.map((q) => q.card);

  return {
    queue: queueCards,
    review,
    attention,
    history,
    sendEnabled,
    counts: { queue: queueCards.length, review: review.length, attention: attention.length, history: history.length },
  };
}
