import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decideFeedbackSend } from "./feedback-send-decision.ts";
import { buildReportCardView, buildReportsView } from "./feedback-review-view.ts";
import { scoreFeedbackSignificance } from "./feedback-significance.ts";
import type { FeedbackContextPacket } from "./context-packet.ts";
import type { FeedbackJobStatus, TrainingPeaksFeedbackJob } from "./feedback-queue.ts";
import { stripLongDash } from "./draft-text.ts";

// ── fixtures ──
function packet(overrides: Partial<FeedbackContextPacket> = {}): FeedbackContextPacket {
  return {
    workoutId: 1,
    workoutDate: "2026-07-14",
    title: "Running",
    sessionType: "easy",
    sex: "female",
    register: "ty",
    hrTrusted: true,
    workoutHeader: "Тип: лёгкая.",
    observationsBlock: "Тут не богато — скажи коротко:\n- [ПОХВАЛА] прогресс",
    comparisonBlock: "Прогресс относительно прошлых таких же тренировок (аэробно чище/ровнее, чем раньше) — назови словами, без цифры.",
    fewshotsText: "- Молодец 👍",
    fewshotsUsed: ["A×4"],
    allowedNumbers: [],
    comparisonBaseline: null,
    studentWords: [],
    observations: [{ type: "praise", adviceKey: "praise_comparison_progress", focused: true, reason: "comparison base progress" }],
    ...overrides,
  };
}

function makeJob(overrides: Partial<TrainingPeaksFeedbackJob> = {}): TrainingPeaksFeedbackJob {
  return {
    id: "job-1",
    workoutCacheId: "wc-1",
    studentId: "stu-1",
    contextPacket: packet(),
    status: "done",
    draftText: "Молодец 👍 пробежала ровно",
    generatorBackend: "cowork",
    attempts: 1,
    errorReason: null,
    blockedReason: null,
    coachEditedText: null,
    sentText: null,
    sentAt: null,
    dismissedAt: null,
    reviewedByChatId: null,
    createdAt: "2026-07-14T10:00:00Z",
    claimedAt: null,
    generatedAt: "2026-07-14T10:01:00Z",
    updatedAt: "2026-07-14T10:01:00Z",
    ...overrides,
  };
}

const activeStudent = { isActive: true, telegramChatId: "555", telegramDeliveryEnabled: true };

// ── the safety invariant: prepare-only never delivers ──
describe("decideFeedbackSend — kill-switch", () => {
  test("done + valid student + sendEnabled=false → prepare (NOT deliver)", () => {
    const d = decideFeedbackSend({ sendEnabled: false, job: makeJob(), student: activeStudent });
    assert.equal(d.action, "prepare");
    assert.equal(d.action === "prepare" && d.finalText, "Молодец 👍 пробежала ровно");
  });

  test("done + valid student + sendEnabled=true → deliver", () => {
    const d = decideFeedbackSend({ sendEnabled: true, job: makeJob(), student: activeStudent });
    assert.equal(d.action, "deliver");
  });

  test("blocked job never delivers, even with sendEnabled=true", () => {
    const d = decideFeedbackSend({ sendEnabled: true, job: makeJob({ status: "blocked" }), student: activeStudent });
    assert.equal(d.action, "refuse");
    assert.equal(d.action === "refuse" && d.kind, "blocked");
  });

  test("coach edit wins over machine draft in finalText", () => {
    const d = decideFeedbackSend({ sendEnabled: true, job: makeJob({ coachEditedText: "Отлично 👍 моя правка" }), student: activeStudent });
    assert.equal(d.action === "deliver" && d.finalText, "Отлично 👍 моя правка");
  });
});

describe("decideFeedbackSend — refusals", () => {
  test("null job → not_found", () => {
    assert.equal(decideFeedbackSend({ sendEnabled: true, job: null, student: null }).action, "refuse");
    assert.equal((decideFeedbackSend({ sendEnabled: true, job: null, student: null }) as { kind: string }).kind, "not_found");
  });
  test("already sent → not_reviewable", () => {
    const d = decideFeedbackSend({ sendEnabled: true, job: makeJob({ status: "sent" }), student: activeStudent });
    assert.equal(d.action === "refuse" && d.kind, "not_reviewable");
  });
  test("empty text → missing_draft_text", () => {
    const d = decideFeedbackSend({ sendEnabled: false, job: makeJob({ draftText: "   ", coachEditedText: null }), student: activeStudent });
    assert.equal(d.action === "refuse" && d.kind, "missing_draft_text");
  });
  test("student missing → student_missing", () => {
    const d = decideFeedbackSend({ sendEnabled: false, job: makeJob(), student: null });
    assert.equal(d.action === "refuse" && d.kind, "student_missing");
  });
  test("inactive student → student_inactive", () => {
    const d = decideFeedbackSend({ sendEnabled: false, job: makeJob(), student: { ...activeStudent, isActive: false } });
    assert.equal(d.action === "refuse" && d.kind, "student_inactive");
  });
  test("no telegram chat → telegram_not_linked", () => {
    const d = decideFeedbackSend({ sendEnabled: false, job: makeJob(), student: { ...activeStudent, telegramChatId: null } });
    assert.equal(d.action === "refuse" && d.kind, "telegram_not_linked");
  });
  test("delivery disabled → delivery_disabled", () => {
    const d = decideFeedbackSend({ sendEnabled: false, job: makeJob(), student: { ...activeStudent, telegramDeliveryEnabled: false } });
    assert.equal(d.action === "refuse" && d.kind, "delivery_disabled");
  });
});

// ── view mapping ──
describe("buildReportCardView", () => {
  test("done job → draft + transparency (gloss + comparison), no attention", () => {
    const card = buildReportCardView(makeJob(), "Мария", "masha");
    assert.equal(card.status, "done");
    assert.equal(card.draftText, "Молодец 👍 пробежала ровно");
    assert.equal(card.dateLabel, "14 июля");
    assert.equal(card.sessionTypeLabel, "Лёгкая");
    assert.equal(card.attentionReason, null);
    // comparison observation → a comparison transparency line (cleaned of the model note)
    const cmp = card.transparency.find((t) => t.kind === "comparison");
    assert.ok(cmp, "expected a comparison line");
    assert.ok(!cmp!.text.includes("назови словами"), "comparison line should be cleaned");
  });

  test("coach edit becomes the shown text + coachEdited flag", () => {
    const card = buildReportCardView(makeJob({ coachEditedText: "Моя правка" }), "Мария", null);
    assert.equal(card.draftText, "Моя правка");
    assert.equal(card.coachEdited, true);
  });

  test("blocked job → attentionReason, NO draft text leaked, NO transparency", () => {
    const card = buildReportCardView(makeJob({ status: "blocked", draftText: null, blockedReason: "нет FIT-файла", contextPacket: {} as FeedbackContextPacket }), "Оля", null);
    assert.equal(card.draftText, null);
    assert.equal(card.attentionReason, "нет FIT-файла");
    assert.equal(card.transparency.length, 0);
  });

  test("focused praise observation is glossed to human words", () => {
    const job = makeJob({
      contextPacket: packet({
        observations: [{ type: "praise", adviceKey: "praise_even_pace", focused: true, reason: "low cv" }],
        comparisonBlock: "Сравнения с прошлым нет — пиши только качественные наблюдения, без цифр.",
      }),
    });
    const card = buildReportCardView(job, "Дима", null);
    const praise = card.transparency.find((t) => t.kind === "praise");
    assert.ok(praise);
    assert.match(praise!.text, /ровно/);
  });

  test("coach_signal observation is noted as coach-only, last", () => {
    const job = makeJob({
      contextPacket: packet({
        observations: [
          { type: "praise", adviceKey: "praise_even_pace", focused: true, reason: "cv" },
          { type: "coach_signal", adviceKey: "question_high_pulse_unknown", focused: false, reason: "hr high" },
        ],
        comparisonBlock: "Сравнения с прошлым нет — пиши только качественные наблюдения, без цифр.",
      }),
    });
    const card = buildReportCardView(job, "Дима", null);
    const sig = card.transparency.find((t) => t.kind === "signal");
    assert.ok(sig);
    assert.match(sig!.text, /тренеру/);
  });
});

describe("buildReportsView — grouping", () => {
  const statuses: FeedbackJobStatus[] = ["done", "blocked", "failed", "sent", "dismissed"];
  const jobs = statuses.map((s, i) =>
    makeJob({ id: `job-${s}`, status: s, studentId: `stu-${i}`, draftText: s === "blocked" ? null : "текст", blockedReason: s === "blocked" ? "нет FIT" : null, errorReason: s === "failed" ? "факт-чек: число" : null })
  );
  const lookup = (id: string) => ({ name: `Ученик ${id}`, telegramUsername: null });

  test("done→review, blocked/failed→attention, sent→history; dismissed dropped", () => {
    const v = buildReportsView(jobs, lookup, false);
    assert.deepEqual(v.review.map((c) => c.status), ["done"]);
    assert.deepEqual(v.attention.map((c) => c.status).sort(), ["blocked", "failed"]);
    // Only sent reaches history (verified DM). dismissed is excluded (a cleared card is handled,
    // not history) → it lands in no bucket. shared_confirmed would join history; plain shared does not.
    assert.deepEqual(v.history.map((c) => c.status).sort(), ["sent"]);
    assert.equal(v.sendEnabled, false);
    assert.deepEqual(v.counts, { queue: 0, review: 1, attention: 2, history: 1 });
  });

  test("sendEnabled flag is carried through", () => {
    assert.equal(buildReportsView(jobs, lookup, true).sendEnabled, true);
  });

  test("unknown student falls back to a placeholder, not dropped", () => {
    const v = buildReportsView([makeJob()], () => undefined, false);
    assert.equal(v.review.length, 1);
    assert.equal(v.review[0].studentName, "Ученик");
  });

  test("shared (unconfirmed) STAYS in review — not buried in history", () => {
    const v = buildReportsView([makeJob({ status: "shared", id: "sh" })], lookup, false);
    assert.deepEqual(v.review.map((c) => c.status), ["shared"]);
    assert.equal(v.history.length, 0);
  });

  test("shared_confirmed (Igor tapped «Готово») → history, terminal", () => {
    const v = buildReportsView([makeJob({ status: "shared_confirmed", id: "shc" })], lookup, false);
    assert.deepEqual(v.history.map((c) => c.status), ["shared_confirmed"]);
    assert.equal(v.review.length, 0);
  });
});

// ── significance (drives «Новые» order + badge) ──
describe("scoreFeedbackSignificance", () => {
  const correctionPacket = packet({ observations: [{ type: "correction", adviceKey: "pace_control", focused: true, reason: "fast start" }] });
  const cleanPacket = packet({ observations: [{ type: "praise", adviceKey: "praise_even_pace", focused: true, reason: "cv" }] });

  test("correction → 'разбор', outscores plain praise", () => {
    const c = scoreFeedbackSignificance(correctionPacket);
    const p = scoreFeedbackSignificance(cleanPacket);
    assert.equal(c.badge, "разбор");
    assert.equal(p.badge, "чисто");
    assert.ok(c.score > p.score);
  });

  test("comparison-progress praise → 'прогресс'", () => {
    // packet() default carries a praise_comparison_progress observation.
    assert.equal(scoreFeedbackSignificance(packet()).badge, "прогресс");
  });

  test("empty observations → 'чисто', score 0", () => {
    const s = scoreFeedbackSignificance(packet({ observations: [] }));
    assert.equal(s.badge, "чисто");
    assert.equal(s.score, 0);
  });
});

describe("buildReportsView — «Новые» queue", () => {
  const correction = makeJob({ id: "j-corr", status: "pending", studentId: "s-corr", contextPacket: packet({ observations: [{ type: "correction", adviceKey: "pace_control", focused: true, reason: "x" }] }) });
  const clean = makeJob({ id: "j-clean", status: "pending", studentId: "s-clean", contextPacket: packet({ observations: [{ type: "praise", adviceKey: "praise_even_pace", focused: true, reason: "y" }] }) });
  const lookup = (id: string) => ({ name: `Ученик ${id}`, telegramUsername: null });

  test("pending jobs go to queue, most significant first, with a badge", () => {
    const v = buildReportsView([clean, correction], lookup, false);
    assert.deepEqual(v.queue.map((c) => c.id), ["j-corr", "j-clean"]); // разбор before чисто
    assert.equal(v.queue[0].significanceBadge, "разбор");
    assert.equal(v.queue[1].significanceBadge, "чисто");
    assert.equal(v.counts.queue, 2);
  });
});

describe("buildReportCardView — channel", () => {
  test("dm-capable → channel 'dm', no mention", () => {
    const card = buildReportCardView(makeJob(), "Мария", "masha", { dmCapable: true, hasGroupThread: false });
    assert.equal(card.channel, "dm");
    assert.equal(card.mention, null);
  });
  test("group thread only → channel 'group', @username mention", () => {
    const card = buildReportCardView(makeJob(), "Мария", "masha", { dmCapable: false, hasGroupThread: true });
    assert.equal(card.channel, "group");
    assert.equal(card.mention, "@masha");
  });
  test("group thread, no username → mention falls back to name", () => {
    const card = buildReportCardView(makeJob(), "Мария", null, { dmCapable: false, hasGroupThread: true });
    assert.equal(card.mention, "Мария");
  });
  test("no channel → 'none'", () => {
    const card = buildReportCardView(makeJob(), "Мария", null, {});
    assert.equal(card.channel, "none");
  });
});

describe("stripLongDash — the model still slips «—» in despite the prompt ban", () => {
  test("spaced em-dash clause separator → comma", () => {
    assert.equal(stripLongDash("Привет! Хорошо разложил темп — молодец)"), "Привет! Хорошо разложил темп, молодец)");
  });
  test("spaced en-dash → comma too", () => {
    assert.equal(stripLongDash("Держи ровно – не разгоняйся"), "Держи ровно, не разгоняйся");
  });
  test("unspaced numeric range dash → short hyphen, no comma", () => {
    assert.equal(stripLongDash("темп 5:10–5:20"), "темп 5:10-5:20");
  });
  test("dash glued to a word → short hyphen", () => {
    assert.equal(stripLongDash("пульс—ровный"), "пульс-ровный");
  });
  test("never joins across newlines", () => {
    assert.equal(stripLongDash("строка —\nдругая"), "строка -\nдругая");
  });
  test("clean text is untouched", () => {
    const clean = "Привет! Отлично, темп ровный, молодец) 👍";
    assert.equal(stripLongDash(clean), clean);
  });
  test("multiple dashes in one message all handled", () => {
    assert.equal(stripLongDash("Привет! Темп ровный — хорошо, пульс — стабильный)"), "Привет! Темп ровный, хорошо, пульс, стабильный)");
  });
});
