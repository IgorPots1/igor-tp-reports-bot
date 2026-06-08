import assert from "node:assert/strict";

import {
  decideTrainingPeaksGroupWorkoutReportIntake,
  getTrainingPeaksGroupWorkoutReportChatAllowlist,
  isTrainingPeaksGroupWorkoutReportChatAllowed,
  isTrainingPeaksGroupWorkoutReportIntakeEnabled,
  type ResolveGroupWorkoutReportSenderResult,
} from "@/features/trainingpeaks/group-workout-report-intake";
import { classifyTelegramContextLabels } from "@/features/trainingpeaks/telegram-context";
import type { TrainingPeaksStudent } from "@/features/trainingpeaks/repository";
import type { TelegramMessage } from "@/features/telegram/types";

function buildStudent(input: {
  id: string;
  studentId?: string;
  studentName?: string;
  isActive?: boolean;
  trainingPeaksAthleteUrl?: string;
  telegramChatId?: string | null;
  telegramUsername?: string | null;
}): TrainingPeaksStudent {
  return {
    id: input.id,
    studentId: input.studentId ?? `student-${input.id}`,
    studentName: input.studentName ?? `Student ${input.id}`,
    trainingPeaksAthleteUrl: input.trainingPeaksAthleteUrl ?? "https://www.trainingpeaks.com/athlete/athletes/12345",
    isActive: input.isActive ?? true,
    weeklyReportEnabled: true,
    archivedAt: null,
    telegramChatId: input.telegramChatId ?? "1001",
    telegramUsername: input.telegramUsername ?? "runner_one",
    telegramProfileUrl: null,
    telegramDeliveryEnabled: true,
    telegramFormality: "unknown",
    telegramContextNotes: null,
    dataQualityStatus: null,
    notes: null,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
  };
}

function buildMessage(input: {
  chatId?: number;
  messageId?: number;
  fromId?: number;
  username?: string;
  firstName?: string;
  text?: string;
  isBot?: boolean;
  chatTitle?: string;
  date?: number;
  withServicePayload?: boolean;
}): TelegramMessage {
  const message = {
    message_id: input.messageId ?? 501,
    chat: {
      id: input.chatId ?? -1001234567890,
      type: "supergroup",
      title: input.chatTitle ?? "Coach Group",
    },
    from: {
      id: input.fromId ?? 90001,
      username: input.username,
      first_name: input.firstName ?? "Runner",
      ...(input.isBot ? ({ is_bot: true } as { is_bot: boolean }) : {}),
    },
    text: input.text ?? "",
    date: input.date ?? 1_717_842_400,
  } as TelegramMessage & Record<string, unknown>;

  if (input.withServicePayload) {
    message.new_chat_title = "Updated title";
  }

  return message as TelegramMessage;
}

async function runDecision(input: {
  message: TelegramMessage;
  featureEnabled?: boolean;
  allowedChatIds?: Set<string>;
  isCoachTelegramId?: (value: number | undefined) => boolean;
  resolveSender?: (
    fromUserId: number | undefined,
    fromUsername: string | undefined
  ) => Promise<ResolveGroupWorkoutReportSenderResult>;
  hasExistingBySourceMessage?: (sourceChatId: string, sourceMessageId: string) => Promise<boolean>;
}) {
  return decideTrainingPeaksGroupWorkoutReportIntake({
    message: input.message,
    featureEnabled: input.featureEnabled ?? true,
    allowedChatIds: input.allowedChatIds ?? new Set([String(input.message.chat.id)]),
    isCoachTelegramId: input.isCoachTelegramId ?? (() => false),
    resolveSender: input.resolveSender ?? (async () => ({ student: null, matchMethod: null })),
    hasExistingBySourceMessage: input.hasExistingBySourceMessage ?? (async () => false),
  });
}

function testFlagAndAllowlistParsing(): void {
  const previousEnabled = process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_INTAKE_ENABLED;
  const previousAllowlist = process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_CHAT_ALLOWLIST;

  process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_INTAKE_ENABLED = "false";
  assert.equal(isTrainingPeaksGroupWorkoutReportIntakeEnabled(), false);
  process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_INTAKE_ENABLED = "true";
  assert.equal(isTrainingPeaksGroupWorkoutReportIntakeEnabled(), true);

  process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_CHAT_ALLOWLIST = " -1001, x, -1002, 333, ";
  const allowlist = getTrainingPeaksGroupWorkoutReportChatAllowlist();
  assert.equal(allowlist.has("-1001"), true);
  assert.equal(allowlist.has("-1002"), true);
  assert.equal(allowlist.has("333"), true);
  assert.equal(allowlist.has("x"), false);
  assert.equal(isTrainingPeaksGroupWorkoutReportChatAllowed(-1001, allowlist), true);
  assert.equal(isTrainingPeaksGroupWorkoutReportChatAllowed(99, allowlist), false);

  process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_INTAKE_ENABLED = previousEnabled;
  process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_CHAT_ALLOWLIST = previousAllowlist;
}

async function run(): Promise<void> {
  testFlagAndAllowlistParsing();

  const knownById = buildStudent({
    id: "student-1",
    studentName: "Maria",
    trainingPeaksAthleteUrl: "https://www.trainingpeaks.com/athlete/athletes/10101",
    telegramChatId: "90001",
  });
  const knownByUsername = buildStudent({
    id: "student-2",
    studentName: "Daria",
    trainingPeaksAthleteUrl: "https://www.trainingpeaks.com/athlete/athletes/20202",
    telegramUsername: "daria_runner",
  });
  const inactive = buildStudent({
    id: "student-3",
    isActive: false,
    trainingPeaksAthleteUrl: "https://www.trainingpeaks.com/athlete/athletes/30303",
  });
  const missingTpLink = buildStudent({
    id: "student-4",
    trainingPeaksAthleteUrl: "",
  });

  {
    const decision = await runDecision({
      message: buildMessage({ text: "пробежала 8 км спокойно, пульс ровный" }),
      featureEnabled: false,
    });
    assert.equal(decision.intakeStatus, "skipped_feature_disabled");
    assert.equal(decision.shouldPersist, false);
  }

  {
    const decision = await runDecision({
      message: buildMessage({ text: "пробежала 8 км спокойно, пульс ровный", chatId: -1009 }),
      allowedChatIds: new Set(["-1001234567890"]),
    });
    assert.equal(decision.intakeStatus, "skipped_group_not_allowed");
    assert.equal(decision.shouldPersist, false);
  }

  {
    const botDecision = await runDecision({
      message: buildMessage({ text: "пробежала 8 км спокойно", isBot: true }),
    });
    assert.equal(botDecision.intakeStatus, "skipped_bot_or_service");
    assert.equal(botDecision.shouldPersist, false);

    const serviceDecision = await runDecision({
      message: buildMessage({ text: "пробежала 8 км спокойно", withServicePayload: true }),
    });
    assert.equal(serviceDecision.intakeStatus, "skipped_bot_or_service");
    assert.equal(serviceDecision.shouldPersist, false);
  }

  {
    const decision = await runDecision({
      message: buildMessage({ text: "пробежала 8 км спокойно", fromId: 111 }),
      isCoachTelegramId: (value) => value === 111,
    });
    assert.equal(decision.intakeStatus, "skipped_coach_message");
    assert.equal(decision.shouldPersist, false);
  }

  {
    const decision = await runDecision({
      message: buildMessage({
        text: "пробежала 8 км спокойно, потом ускорения по самочувствию",
        fromId: 90001,
      }),
      resolveSender: async (fromUserId) =>
        fromUserId === 90001
          ? { student: knownById, matchMethod: "telegram_chat_id" }
          : { student: null, matchMethod: null },
    });
    assert.equal(decision.intakeStatus, "candidate_stored");
    assert.equal(decision.shouldPersist, true);
    assert.equal(decision.student?.id, knownById.id);
  }

  {
    const decision = await runDecision({
      message: buildMessage({
        text: "бежал 45 минут, в начале тяжело, дальше ровно",
        fromId: 77777,
        username: "daria_runner",
      }),
      resolveSender: async (_fromUserId, fromUsername) =>
        fromUsername === "daria_runner"
          ? { student: knownByUsername, matchMethod: "telegram_username" }
          : { student: null, matchMethod: null },
    });
    assert.equal(decision.intakeStatus, "candidate_stored");
    assert.equal(decision.shouldPersist, true);
    assert.equal(decision.senderMatchMethod, "telegram_username");
  }

  {
    const decision = await runDecision({
      message: buildMessage({
        text: "пробежала 10 км с ускорениями, в конце тяжело",
        fromId: 50005,
      }),
      resolveSender: async () => ({ student: null, matchMethod: null }),
    });
    assert.equal(decision.intakeStatus, "skipped_unknown_student");
    assert.equal(decision.shouldPersist, true);
    assert.equal(decision.student, null);
  }

  {
    const decision = await runDecision({
      message: buildMessage({ text: "пробежала 10 км, пульс высокий", fromId: 50006 }),
      resolveSender: async () => ({ student: inactive, matchMethod: "telegram_chat_id" }),
    });
    assert.equal(decision.intakeStatus, "skipped_inactive_student");
    assert.equal(decision.shouldPersist, true);
  }

  {
    const decision = await runDecision({
      message: buildMessage({ text: "пробежала 10 км, ноги забиты", fromId: 50007 }),
      resolveSender: async () => ({ student: missingTpLink, matchMethod: "telegram_chat_id" }),
    });
    assert.equal(decision.intakeStatus, "skipped_missing_tp_link");
    assert.equal(decision.shouldPersist, true);
  }

  {
    const decision = await runDecision({
      message: buildMessage({ text: "можно перенести тренировку с чт на пт?" }),
      resolveSender: async () => ({ student: knownById, matchMethod: "telegram_chat_id" }),
    });
    assert.equal(decision.intakeStatus, "skipped_not_report_like");
    assert.equal(decision.shouldPersist, false);
  }

  {
    const decision = await runDecision({
      message: buildMessage({ text: "ок" }),
      resolveSender: async () => ({ student: knownById, matchMethod: "telegram_chat_id" }),
    });
    assert.equal(decision.intakeStatus, "skipped_not_report_like");
    assert.equal(decision.shouldPersist, false);
  }

  {
    const decision = await runDecision({
      message: buildMessage({
        text: "пробежала 8 км спокойно, но ахилл тянет после 5-го километра",
      }),
      resolveSender: async () => ({ student: knownById, matchMethod: "telegram_chat_id" }),
    });
    assert.equal(decision.intakeStatus, "candidate_stored");
    assert.equal(decision.shouldPersist, true);
    assert.equal(decision.detectedLabels.includes("pain_or_health"), true);
  }

  {
    const decision = await runDecision({
      message: buildMessage({
        text: "пробежала 8 км спокойно, дыхание ровное и техника стабильная",
        messageId: 777,
      }),
      resolveSender: async () => ({ student: knownById, matchMethod: "telegram_chat_id" }),
      hasExistingBySourceMessage: async (chatId, messageId) =>
        chatId === "-1001234567890" && messageId === "777",
    });
    assert.equal(decision.intakeStatus, "duplicate_source_message");
    assert.equal(decision.shouldPersist, false);
  }

  assert.equal(
    classifyTelegramContextLabels("пробежала 8 км спокойно, самочувствие отличное").includes("report_like"),
    true
  );
  assert.equal(
    classifyTelegramContextLabels("бежал 45 минут, в начале тяжело").includes("report_like"),
    true
  );
  assert.equal(
    classifyTelegramContextLabels("сделала тренировку, пульс нормальный").includes("report_like"),
    true
  );
  assert.equal(classifyTelegramContextLabels("сделал фото для отчета").includes("report_like"), false);
  assert.equal(classifyTelegramContextLabels("сделал оплату за май").includes("report_like"), false);

  console.log("[check-group-workout-report-intake] PASS");
}

run().catch((error) => {
  console.error("[check-group-workout-report-intake] FAIL");
  console.error(error);
  process.exitCode = 1;
});
