import assert from "node:assert/strict";

import {
  formatGroupWorkoutReportReviewCardText,
  getGroupWorkoutReportReviewCardMarkup,
  parseGroupWorkoutReportReviewCallback,
  TP_GWR_CALLBACK_EDIT_PREFIX,
  TP_GWR_CALLBACK_REGENERATE_PREFIX,
  TP_GWR_CALLBACK_SEND_PREFIX,
  TP_GWR_CALLBACK_SKIP_PREFIX,
} from "@/features/trainingpeaks/group-workout-report-review-card";
import {
  buildGroupWorkoutReportReviewCardForDraft,
  clearPendingGroupWorkoutReportStateForTest,
  handleGroupWorkoutReportReviewCallback,
  isTrainingPeaksGroupWorkoutReportGenerateEnabled,
  isTrainingPeaksGroupWorkoutReportReviewEnabled,
  isTrainingPeaksGroupWorkoutReportSendEnabled,
  notifyCoachGroupWorkoutReportDraft,
  sendGroupWorkoutReportDraftToGroup,
  setPendingGroupWorkoutReportEditForTest,
  tryHandleGroupWorkoutReportCoachEditMessage,
} from "@/features/trainingpeaks/group-workout-report-review-flow";
import type {
  TrainingPeaksReplyDraft,
  TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";

const DRAFT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const DRAFT_SHORT = DRAFT_ID.slice(0, 8);

function makeDraft(overrides: Partial<TrainingPeaksReplyDraft> = {}): TrainingPeaksReplyDraft {
  return {
    id: DRAFT_ID,
    studentId: "student-1",
    caseId: null,
    source: "group_workout_report",
    actorTelegramChatId: "-1001234567890",
    aiModel: "test-model",
    promptContextSha256: "abc",
    studentMessageSha256: "def",
    studentMessagePreview: "Пробежал сегодня",
    draftSha256: "ghi",
    draftText: "Нормально отработал, темп ровный.",
    draftPreview: "Нормально отработал",
    draftCharCount: 30,
    outcome: "generated",
    outcomeRecordedAt: null,
    coachNotePreview: null,
    coachNoteSha256: null,
    metadata: {
      allowed_claims: ["duration", "average pace"],
      forbidden_claims: ["laps", "splits", "interval actuals"],
      workout_title: "Easy run",
      workout_date: "2026-06-07",
      prompt_context: "prompt",
      student_message: "Пробежал сегодня, в целом нормально",
    },
    createdAt: "2026-06-08T10:00:00.000Z",
    sourceChatId: "-1001234567890",
    sourceMessageId: "12345",
    sourceMessageTimestamp: "2026-06-08T10:00:00.000Z",
    sourceTelegramUserId: "999",
    groupWorkoutReportIntakeId: "intake-1",
    workoutMatchStatus: "matched",
    workoutMatchConfidence: "high",
    plannedWorkoutCacheId: null,
    completedWorkoutCacheId: null,
    workoutAnalysisJson: {
      summaryForCoach: "Execution is close to plan.",
      planActualBullets: ["Planned duration: 45 min.", "Completed duration: 44 min."],
      riskFlags: [],
      workoutType: "easy",
      workoutDate: "2026-06-07",
      workoutTitle: "Easy run",
    },
    ...overrides,
  };
}

function makeStudent(): TrainingPeaksStudent {
  return {
    id: "student-1",
    studentId: "student-1",
    studentName: "Test Student",
    trainingPeaksAthleteUrl: "https://app.trainingpeaks.com/#calendar/athletes/10101",
    telegramChatId: "777001",
    telegramUsername: "test_student",
    telegramFormality: "ty",
    telegramContextNotes: null,
    telegramDeliveryEnabled: true,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    weeklyReportsEnabled: true,
    telegramLinkedAt: null,
    telegramLinkCode: null,
    telegramLinkCodeExpiresAt: null,
    billingClientId: null,
    nutritionTargetsJson: null,
    coachNotesJson: {},
    metadata: {},
  };
}

async function run(): Promise<void> {
  const previousReview = process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_REVIEW_ENABLED;
  const previousGenerate = process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_GENERATE_ENABLED;
  const previousSend = process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_SEND_ENABLED;

  try {
    {
      const draft = makeDraft();
      const card = buildGroupWorkoutReportReviewCardForDraft(draft, "Test Student");
      assert.match(card.text, /Ученик: Test Student/u);
      assert.match(card.text, /Источник: общий чат/u);
      assert.match(card.text, /Черновик:/u);
      assert.match(card.text, /Match: matched\/high/u);
      assert.match(card.text, /Короткий анализ:/u);
      assert.ok(card.text.includes(`#${DRAFT_SHORT}`));
      assert.equal(card.markup.inline_keyboard.length, 3);
      const buttonTexts = card.markup.inline_keyboard.flat().map((button) => button.text);
      assert.deepEqual(buttonTexts, ["✅ Отправить", "✏️ Редактировать", "🔁 Пересобрать", "🙈 Пропустить"]);
    }

    {
      const sendCallback = parseGroupWorkoutReportReviewCallback(`${TP_GWR_CALLBACK_SEND_PREFIX}${DRAFT_SHORT}`);
      const editCallback = parseGroupWorkoutReportReviewCallback(`${TP_GWR_CALLBACK_EDIT_PREFIX}${DRAFT_SHORT}`);
      const regenCallback = parseGroupWorkoutReportReviewCallback(
        `${TP_GWR_CALLBACK_REGENERATE_PREFIX}${DRAFT_SHORT}`
      );
      const skipCallback = parseGroupWorkoutReportReviewCallback(`${TP_GWR_CALLBACK_SKIP_PREFIX}${DRAFT_SHORT}`);
      assert.equal(sendCallback?.kind, "send");
      assert.equal(editCallback?.kind, "edit");
      assert.equal(regenCallback?.kind, "regenerate");
      assert.equal(skipCallback?.kind, "skip");
    }

    {
      process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_REVIEW_ENABLED = "false";
      assert.equal(isTrainingPeaksGroupWorkoutReportReviewEnabled(), false);
      const coachSends: string[] = [];
      const result = await notifyCoachGroupWorkoutReportDraft({
        draft: makeDraft(),
        studentName: "Test Student",
        deps: {
          getCoachChatIds: () => ["507447935"],
          sendCoachMessage: async () => {
            coachSends.push("should-not-send");
            return { messageId: 1 };
          },
          mergeDraftMetadata: async (draftId, patch) =>
            makeDraft({ id: draftId, metadata: { ...makeDraft().metadata, ...patch } }),
        },
      });
      assert.equal(result.status, "review_disabled");
      assert.equal(coachSends.length, 0);
    }

    {
      process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_GENERATE_ENABLED = "false";
      assert.equal(isTrainingPeaksGroupWorkoutReportGenerateEnabled(), false);
    }

    {
      process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_SEND_ENABLED = "false";
      assert.equal(isTrainingPeaksGroupWorkoutReportSendEnabled(), false);
      const answers: string[] = [];
      const groupSends: Array<{ groupChatId: string; replyToMessageId: number; text: string }> = [];
      await handleGroupWorkoutReportReviewCallback({
        callback: { kind: "send", draftIdPrefix: DRAFT_SHORT },
        coachChatId: "507447935",
        coachMessageId: 100,
        callbackQueryId: "cb-1",
        deps: {
          getDraftByIdPrefix: async () => makeDraft(),
          getStudentById: async () => makeStudent(),
          answerCallback: async (_id, text) => {
            if (text) {
              answers.push(text);
            }
          },
          sendGroupReply: async (input) => {
            groupSends.push(input);
            return { messageId: 200 };
          },
        },
      });
      assert.match(answers.join(" "), /отключена флагом безопасности/u);
      assert.equal(groupSends.length, 0);
    }

    {
      process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_SEND_ENABLED = "true";
      const groupSends: Array<{ groupChatId: string; replyToMessageId: number; text: string }> = [];
      const dmAttempts: string[] = [];
      await handleGroupWorkoutReportReviewCallback({
        callback: { kind: "send", draftIdPrefix: DRAFT_SHORT },
        coachChatId: "507447935",
        coachMessageId: 101,
        callbackQueryId: "cb-2",
        deps: {
          getDraftByIdPrefix: async () => makeDraft(),
          getStudentById: async () => makeStudent(),
          sendGroupReply: async (input) => {
            groupSends.push(input);
            return { messageId: 201 };
          },
          updateDraftOutcome: async ({ draftId, outcome }) => makeDraft({ id: draftId, outcome }),
          mergeDraftMetadata: async (draftId, patch) =>
            makeDraft({ id: draftId, metadata: { ...makeDraft().metadata, ...patch } }),
          recordCoachAction: async () => undefined,
          editCoachMessage: async () => undefined,
          answerCallback: async () => undefined,
        },
      });
      assert.equal(groupSends.length, 1);
      assert.equal(groupSends[0]?.groupChatId, "-1001234567890");
      assert.equal(groupSends[0]?.replyToMessageId, 12345);
      assert.notEqual(groupSends[0]?.groupChatId, makeStudent().telegramChatId);
      dmAttempts.push(groupSends[0]?.groupChatId ?? "");
      assert.ok(!dmAttempts.includes(makeStudent().telegramChatId ?? ""));

      const directSend = await sendGroupWorkoutReportDraftToGroup({
        draftIdPrefix: DRAFT_SHORT,
        actorTelegramChatId: "507447935",
        deps: {
          getDraftByIdPrefix: async () =>
            makeDraft({ sourceChatId: makeStudent().telegramChatId ?? "777001" }),
          getStudentById: async () => makeStudent(),
        },
      });
      assert.equal(directSend.status, "delivery_failed");
    }

    {
      clearPendingGroupWorkoutReportStateForTest();
      const metadataPatches: Array<Record<string, unknown>> = [];
      await handleGroupWorkoutReportReviewCallback({
        callback: { kind: "edit", draftIdPrefix: DRAFT_SHORT },
        coachChatId: "507447935",
        coachMessageId: 102,
        callbackQueryId: "cb-3",
        deps: {
          getDraftByIdPrefix: async () => makeDraft(),
          getStudentById: async () => makeStudent(),
          mergeDraftMetadata: async (_draftId, patch) => {
            metadataPatches.push(patch);
            return makeDraft();
          },
          sendCoachMessage: async () => ({ messageId: 103 }),
          answerCallback: async () => undefined,
        },
      });
      assert.equal(metadataPatches[0]?.review_status, "awaiting_edit");
    }

    {
      clearPendingGroupWorkoutReportStateForTest();
      setPendingGroupWorkoutReportEditForTest("507447935", DRAFT_SHORT, Date.now() + 60_000);
      let updatedText: string | null = null;
      const handled = await tryHandleGroupWorkoutReportCoachEditMessage({
        coachChatId: "507447935",
        text: "Обновлённый ответ для группы.",
        deps: {
          getDraftByIdPrefix: async () => makeDraft(),
          getStudentById: async () => makeStudent(),
          updateDraftContent: async ({ draftText }) => {
            updatedText = draftText;
            return makeDraft({ draftText });
          },
          editCoachMessage: async () => undefined,
          sendCoachMessage: async () => ({ messageId: 104 }),
        },
      });
      assert.equal(handled, "handled");
      assert.equal(updatedText, "Обновлённый ответ для группы.");
    }

    {
      clearPendingGroupWorkoutReportStateForTest();
      process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_GENERATE_ENABLED = "true";
      let regeneratedText: string | null = null;
      await handleGroupWorkoutReportReviewCallback({
        callback: { kind: "regenerate", draftIdPrefix: DRAFT_SHORT },
        coachChatId: "507447935",
        coachMessageId: 105,
        callbackQueryId: "cb-4",
        deps: {
          getDraftByIdPrefix: async () => makeDraft(),
          getStudentById: async () => makeStudent(),
          generateDraft: async () => ({
            status: "generated",
            draftText: "Новый пересобранный ответ.",
            model: "test-model",
            warnings: [],
          }),
          updateDraftContent: async ({ draftText, metadataPatch }) => {
            regeneratedText = draftText;
            return makeDraft({
              draftText,
              metadata: { ...makeDraft().metadata, ...metadataPatch },
            });
          },
          editCoachMessage: async () => undefined,
          answerCallback: async () => undefined,
        },
      });
      assert.equal(regeneratedText, "Новый пересобранный ответ.");
    }

    {
      let ignored = false;
      await handleGroupWorkoutReportReviewCallback({
        callback: { kind: "skip", draftIdPrefix: DRAFT_SHORT },
        coachChatId: "507447935",
        coachMessageId: 106,
        callbackQueryId: "cb-5",
        deps: {
          getDraftByIdPrefix: async () => makeDraft(),
          getStudentById: async () => makeStudent(),
          updateDraftOutcome: async ({ outcome }) => {
            ignored = outcome === "ignored";
            return makeDraft({ outcome });
          },
          mergeDraftMetadata: async (draftId, patch) =>
            makeDraft({ id: draftId, metadata: { ...makeDraft().metadata, ...patch } }),
          recordCoachAction: async () => undefined,
          editCoachMessage: async () => undefined,
          answerCallback: async () => undefined,
        },
      });
      assert.equal(ignored, true);
    }

    {
      process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_REVIEW_ENABLED = "true";
      const coachSendCount = { value: 0 };
      const first = await notifyCoachGroupWorkoutReportDraft({
        draft: makeDraft(),
        studentName: "Test Student",
        deps: {
          getCoachChatIds: () => ["507447935"],
          sendCoachMessage: async () => {
            coachSendCount.value += 1;
            return { messageId: 300 };
          },
          mergeDraftMetadata: async (draftId, patch) =>
            makeDraft({
              id: draftId,
              metadata: {
                ...makeDraft().metadata,
                ...patch,
                coach_review_message_id: 300,
                review_status: "coach_notified",
              },
            }),
        },
      });
      assert.equal(first.status, "sent");
      const second = await notifyCoachGroupWorkoutReportDraft({
        draft: makeDraft({
          metadata: {
            ...makeDraft().metadata,
            review_status: "coach_notified",
            coach_review_message_id: 300,
          },
        }),
        studentName: "Test Student",
        deps: {
          getCoachChatIds: () => ["507447935"],
          sendCoachMessage: async () => {
            coachSendCount.value += 1;
            return { messageId: 301 };
          },
        },
      });
      assert.equal(second.status, "duplicate");
      assert.equal(coachSendCount.value, 1);
    }

    {
      const healthDraft = makeDraft({
        draftText: "Понял, без резких ускорений сегодня.",
        workoutAnalysisJson: {
          summaryForCoach: "Health signal requires caution.",
          planActualBullets: ["Completed duration: 40 min."],
          riskFlags: ["pain_or_health_signal_in_report"],
          workoutType: "easy",
          workoutDate: "2026-06-07",
        },
        metadata: {
          ...makeDraft().metadata,
          generation_warnings: ["health/pain signal: cautious tone applied"],
        },
      });
      const text = formatGroupWorkoutReportReviewCardText({
        studentName: "Test Student",
        workoutTitle: "Easy run",
        workoutDate: "2026-06-07",
        workoutType: "easy",
        matchStatus: "matched",
        matchConfidence: "high",
        draftText: healthDraft.draftText,
        draftShortId: DRAFT_SHORT,
        analysis: {
          planActualBullets: ["Completed duration: 40 min."],
          summaryForCoach: "Health signal requires caution.",
          riskFlags: ["pain_or_health_signal_in_report"],
          allowedClaims: ["duration"],
          forbiddenClaims: ["laps", "splits"],
        },
        generationWarnings: ["health/pain signal: cautious tone applied"],
      });
      assert.match(text, /Осторожно/u);
      assert.match(text, /самочувств/i);
      assert.match(text, /Нельзя упоминать/u);
      assert.match(text, /splits/u);
    }

    {
      const markup = getGroupWorkoutReportReviewCardMarkup(DRAFT_SHORT);
      const callbackData = markup.inline_keyboard.flat().map((button) => button.callback_data);
      assert.ok(callbackData.every((value) => value.includes(DRAFT_SHORT)));
    }

    console.log("[check-group-workout-report-review-card-ux] PASS");
  } finally {
    process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_REVIEW_ENABLED = previousReview;
    process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_GENERATE_ENABLED = previousGenerate;
    process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_SEND_ENABLED = previousSend;
    clearPendingGroupWorkoutReportStateForTest();
  }
}

run().catch((error) => {
  console.error("[check-group-workout-report-review-card-ux] FAIL", error);
  process.exitCode = 1;
});
