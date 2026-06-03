import process from "node:process";

import {
  isCoachGroupReplyContactCandidate,
  type CoachGroupReplyContactResolverInput,
  resolveCoachGroupReplyContactStudentId,
} from "@/features/trainingpeaks/context-observer";
import type { TelegramMessage } from "@/features/telegram/types";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildBaseGroupMessage(): TelegramMessage {
  return {
    message_id: 1001,
    chat: {
      id: -100123,
      type: "supergroup",
      title: "Coach Group",
    },
    from: {
      id: 555_111,
      username: "coach_igor",
      first_name: "Igor",
    },
    text: "Понял, давай так и сделаем.",
  };
}

function createResolverInput(): CoachGroupReplyContactResolverInput {
  const base = buildBaseGroupMessage();
  return {
    message: {
      ...base,
      is_topic_message: true,
      message_thread_id: 77,
      reply_to_message: {
        message_id: 9001,
        chat: base.chat,
        from: {
          id: 777_333,
          username: "student_a",
          first_name: "Student",
        },
        text: "Можно перенести?",
      },
    },
    listStudentsByTelegramChatId: async (telegramChatId) => {
      if (telegramChatId === "777333") {
        return [{ id: "student-a" }];
      }
      return [];
    },
    getThreadStudentIdByChatThread: async () => null,
  };
}

async function run(): Promise<void> {
  const validCandidate = {
    ...buildBaseGroupMessage(),
    reply_to_message: {
      message_id: 9001,
      chat: {
        id: -100123,
        type: "supergroup",
      },
      from: {
        id: 777_333,
        username: "student_a",
      },
      text: "Как быть?",
    },
  };
  assert(
    isCoachGroupReplyContactCandidate({
      message: validCandidate,
      fromId: 555_111,
      text: validCandidate.text ?? null,
      isCoachTelegramId: (value) => value === 555_111,
      isTelegramBotSender: () => false,
      isTelegramServiceMessage: () => false,
    }),
    "Coach reply to a student message in group should be a valid contact candidate."
  );

  const genericCoachMessage = buildBaseGroupMessage();
  assert(
    !isCoachGroupReplyContactCandidate({
      message: genericCoachMessage,
      fromId: 555_111,
      text: genericCoachMessage.text ?? null,
      isCoachTelegramId: (value) => value === 555_111,
      isTelegramBotSender: () => false,
      isTelegramServiceMessage: () => false,
    }),
    "Generic group message without reply must not count as contact."
  );

  const studentMessage = {
    ...validCandidate,
    from: {
      id: 888_444,
      username: "student_b",
    },
  };
  assert(
    !isCoachGroupReplyContactCandidate({
      message: studentMessage,
      fromId: 888_444,
      text: studentMessage.text ?? null,
      isCoachTelegramId: (value) => value === 555_111,
      isTelegramBotSender: () => false,
      isTelegramServiceMessage: () => false,
    }),
    "Student-authored group message must not count as coach contact."
  );

  const commandReply = {
    ...validCandidate,
    text: "/tp_attention",
  };
  assert(
    !isCoachGroupReplyContactCandidate({
      message: commandReply,
      fromId: 555_111,
      text: commandReply.text ?? null,
      isCoachTelegramId: (value) => value === 555_111,
      isTelegramBotSender: () => false,
      isTelegramServiceMessage: () => false,
    }),
    "Coach command reply must not count as contact."
  );

  const resolvedDirect = await resolveCoachGroupReplyContactStudentId(createResolverInput());
  assert(
    resolvedDirect === "student-a",
    `Expected direct replied sender mapping to resolve student-a, got ${resolvedDirect ?? "null"}.`
  );

  const unresolvedAmbiguous = await resolveCoachGroupReplyContactStudentId({
    ...createResolverInput(),
    listStudentsByTelegramChatId: async () => [{ id: "student-a" }, { id: "student-b" }],
  });
  assert(unresolvedAmbiguous === null, "Ambiguous replied sender mapping must not resolve to a student.");

  const resolvedByThread = await resolveCoachGroupReplyContactStudentId({
    ...createResolverInput(),
    listStudentsByTelegramChatId: async () => [],
    getThreadStudentIdByChatThread: async ({ chatId, messageThreadId }) =>
      chatId === "-100123" && messageThreadId === 77 ? "student-thread" : null,
  });
  assert(
    resolvedByThread === "student-thread",
    `Expected linked topic fallback to resolve student-thread, got ${resolvedByThread ?? "null"}.`
  );

  console.log("[check-trainingpeaks-coach-group-reply-contact] PASS");
}

run().catch((error) => {
  console.error("[check-trainingpeaks-coach-group-reply-contact] FAIL");
  console.error((error as Error).message);
  process.exit(1);
});
