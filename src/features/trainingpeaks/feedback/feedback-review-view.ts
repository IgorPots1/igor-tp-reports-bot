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
  kind: "arc" | "praise" | "correction" | "care" | "question" | "comparison" | "signal" | "words";
  text: string;
};

export type ReportCardView = {
  id: string;
  studentName: string;
  telegramUsername: string | null;
  workoutDate: string | null; // ISO 'YYYY-MM-DD' or null (blocked job with empty packet)
  dateLabel: string;
  // Non-null when the workout is OLDER than the day the card surfaced (a late-synced report:
  // the student wrote about a past run, so the card appears a day+ after it). «за вчерашний бег» /
  // «за позавчерашний бег» / «бег 24 июля». null for a same-day card. Warns Igor not to read a late
  // card as fresh (Slastnaya: real report, surfaced a day late — legit, just flagged).
  lateSyncLabel: string | null;
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
  // known, else the plain name). Also used for the DM share-fallback. null only for 'none'.
  mention: string | null;
  // Business-DM 24h window for a 'dm' card: true = API can deliver, false = window closed so
  // «Отправить» would fail and the card falls back to share. null for group/none (no API path).
  windowOpen: boolean | null;
};

export type ReportsView = {
  queue: ReportCardView[]; // 'pending' + 'generating' — cards WITHOUT text, awaiting Igor's «Сгенерить»
  review: ReportCardView[]; // status 'done' — actionable (send / edit / skip)
  attention: ReportCardView[]; // 'blocked' + 'failed' — coach signal, no student draft
  history: ReportCardView[]; // 'sent' + 'shared' — badge only ('dismissed' excluded)
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
  // The Business DM 24h window is open (the student's last DM message is ≤24h ago) — the API can
  // deliver now. When closed, a dm card falls back to share.
  dmWindowOpen?: boolean;
  // The student actually converses in the linked group topic (their recent messages come via the
  // group, not the business DM) — treat as 'group' even if a chat_id exists.
  reportsViaGroup?: boolean;
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

// A report can surface a day+ after the run it's about (the student writes late, or the sweep
// matches the report to yesterday's run). When the workout DATE precedes the day the card was
// created, flag it so Igor doesn't mistake a late card for a fresh one. Compares calendar days in
// UTC (both are day-granular anyway); a same-day or future workout returns null (normal fresh card).
function lateSyncLabelFor(workoutDate: string | null, createdAtIso: string | null | undefined): string | null {
  const wm = workoutDate?.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  const cm = createdAtIso?.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!wm || !cm) return null;
  const wd = Date.UTC(Number(wm[1]), Number(wm[2]) - 1, Number(wm[3]));
  const cd = Date.UTC(Number(cm[1]), Number(cm[2]) - 1, Number(cm[3]));
  const diffDays = Math.round((cd - wd) / 86_400_000);
  if (diffDays <= 0) return null; // same day (or clock skew) — a normal fresh card
  if (diffDays === 1) return "за вчерашний бег";
  if (diffDays === 2) return "за позавчерашний бег";
  return `бег ${formatRuDate(workoutDate)}`; // ≥3 days old — name the date outright
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
    .replace(/\s*[—,]\s*назови[^.]*\.?\s*$/iu, "")
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

  // What the student actually wrote around this workout — shown FIRST so Igor sees the
  // context the draft leaned on (his ask). Verbatim; coach-only panel.
  if (Array.isArray(packet.studentWords) && packet.studentWords.length > 0) {
    items.push({ kind: "words", text: `ученик писал: ${packet.studentWords.map((w) => `«${w}»`).join(" · ")}` });
  }

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

  const compObs = packet.observations.find((o) => o.adviceKey === "praise_comparison_progress");
  // #2 — a provisional comparison (n<3) is emitted as a coach_signal: the student got no comparison,
  // so DON'T show the student block here; only the flagged «предварительно» baseline reaches the coach.
  const comparisonProvisional = compObs?.type === "coach_signal";
  if (compObs && typeof packet.comparisonBlock === "string") {
    if (!comparisonProvisional) {
      const text = cleanComparison(packet.comparisonBlock);
      if (text) items.push({ kind: "comparison", text });
    }
    // Coach-only raw baseline so Igor can verify the delta (never shown to the student).
    if (typeof packet.comparisonBaseline === "string" && packet.comparisonBaseline) {
      items.push({ kind: "signal", text: `сверка: ${packet.comparisonBaseline}` });
    }
  }

  // The provisional comparison is already shown via its «сверка» baseline above; skip it here so the
  // coach doesn't see it twice.
  for (const o of packet.observations.filter((o) => o.type === "coach_signal" && o.adviceKey !== "praise_comparison_progress")) {
    items.push({ kind: "signal", text: `тренеру (не ученику): ${glossOf(o.adviceKey, o.reason)}` });
  }

  return items;
}

// Decide the send channel + mention + DM-window state from the student's Telegram wiring.
// A student who actually converses in the linked group topic is 'group' even with a chat_id;
// otherwise a DM-capable student is 'dm' (with the 24h-window state, so the UI can fall back to
// share when it's closed); a group thread alone is 'group'; nothing reachable is 'none'.
function resolveChannel(opts: { dmCapable?: boolean; hasGroupThread?: boolean; dmWindowOpen?: boolean; reportsViaGroup?: boolean; telegramUsername: string | null; studentName: string }): {
  channel: ReportChannel;
  mention: string | null;
  windowOpen: boolean | null;
} {
  const mention = opts.telegramUsername ? `@${opts.telegramUsername.replace(/^@/u, "")}` : opts.studentName;
  // reportsViaGroup already means "reachable in the group AND their latest message came there", so it
  // no longer requires a threads-table row — a student can report in the group without a linked thread
  // (that table is incomplete). Group send is a manual share sheet, so no thread id is needed to route.
  if (opts.reportsViaGroup) return { channel: "group", mention, windowOpen: null };
  if (opts.dmCapable) return { channel: "dm", mention, windowOpen: opts.dmWindowOpen ?? false };
  if (opts.hasGroupThread) return { channel: "group", mention, windowOpen: null };
  return { channel: "none", mention: null, windowOpen: null };
}

export function buildReportCardView(
  job: TrainingPeaksFeedbackJob,
  studentName: string,
  telegramUsername: string | null,
  opts?: { dmCapable?: boolean; hasGroupThread?: boolean; dmWindowOpen?: boolean; reportsViaGroup?: boolean }
): ReportCardView {
  const packet = job.contextPacket as FeedbackContextPacket | undefined;
  const workoutDate = packet?.workoutDate ?? null;
  const isAttention = job.status === "blocked" || job.status === "failed";
  const isQueue = job.status === "pending" || job.status === "generating";
  const { channel, mention, windowOpen } = resolveChannel({
    dmCapable: opts?.dmCapable,
    hasGroupThread: opts?.hasGroupThread,
    dmWindowOpen: opts?.dmWindowOpen,
    reportsViaGroup: opts?.reportsViaGroup,
    telegramUsername,
    studentName,
  });
  return {
    id: job.id,
    studentName,
    telegramUsername,
    workoutDate,
    dateLabel: formatRuDate(workoutDate),
    lateSyncLabel: lateSyncLabelFor(workoutDate, job.createdAt),
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
    windowOpen,
  };
}

const QUEUE_STATUSES = new Set<FeedbackJobStatus>(["pending", "generating"]);
const ATTENTION_STATUSES = new Set<FeedbackJobStatus>(["blocked", "failed"]);
// History shows only what actually LEFT the review cycle for the student: sent (verified DM) or
// shared_confirmed (Igor confirmed the group share landed). 'shared' is NOT here — an unconfirmed
// group share is unverified, so its card STAYS in review (with «Отправить ещё раз» / «Готово») and
// a wrong-chat pick isn't buried. 'dismissed' is excluded too — a cleared card is handled, not
// history worth showing. The list route also stops fetching dismissed rows.
const HISTORY_STATUSES = new Set<FeedbackJobStatus>(["sent", "shared_confirmed"]);

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
      dmWindowOpen: student?.dmWindowOpen,
      reportsViaGroup: student?.reportsViaGroup,
    });
    if (QUEUE_STATUSES.has(job.status)) {
      const packet = job.contextPacket as FeedbackContextPacket | undefined;
      queue.push({ card, score: scoreFeedbackSignificance(packet).score, date: packet?.workoutDate ?? "" });
    } else if (job.status === "done" || job.status === "shared") review.push(card); // 'shared' stays actionable (resend / confirm)
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
