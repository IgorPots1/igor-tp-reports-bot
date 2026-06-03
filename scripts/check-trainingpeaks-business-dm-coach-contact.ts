import process from "node:process";

import {
  isAthleteIncomingBusinessDmMessage,
  isCoachOutgoingBusinessDmMessage,
  recordCoachOutgoingBusinessDmContactIfSafe,
} from "@/features/trainingpeaks/telegram-context";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(): Promise<void> {
  const athleteIncomingMessage = {
    message_id: 101,
    chat: { id: 777_001 },
    from: { id: 777_001 },
    text: "Привет",
    date: 1_717_000_000,
  };
  assert(
    isAthleteIncomingBusinessDmMessage(athleteIncomingMessage),
    "Incoming athlete business DM must still be recognized as athlete message."
  );

  const outgoingCoachMessage = {
    message_id: 102,
    chat: { id: 777_001 },
    from: { id: 555_111, is_bot: false },
    text: "Ответил вручную",
    business_connection_id: "bc-1",
    date: 1_717_000_123,
  };
  assert(
    isCoachOutgoingBusinessDmMessage({
      message: outgoingCoachMessage,
      isCoachTelegramId: (value) => value === 555_111,
    }),
    "Outgoing coach business DM should be recognized as coach contact candidate."
  );

  const contactWrites: Array<Record<string, unknown>> = [];
  const mappedResult = await recordCoachOutgoingBusinessDmContactIfSafe({
    message: outgoingCoachMessage,
    isCoachTelegramId: (value) => value === 555_111,
    listStudentsByTelegramChatId: async (chatId) => (chatId === "777001" ? [{ id: "student-a" }] : []),
    listRecentContactEvents: async () => [],
    recordContactEvent: async (payload) => {
      contactWrites.push(payload);
    },
  });
  assert(mappedResult.kind === "recorded", "Mapped outgoing coach DM should be recorded as contact.");
  assert(contactWrites.length === 1, "Expected one contact write for mapped outgoing coach DM.");
  assert(
    contactWrites[0]?.eventType === "coach_message" && contactWrites[0]?.source === "telegram_business_dm",
    "Recorded contact must be coach_message from telegram_business_dm."
  );
  const metadata = (contactWrites[0]?.metadata ?? {}) as Record<string, unknown>;
  assert(
    metadata.direction === "coach_outgoing_manual" && metadata.chat_id === "777001",
    "Outgoing coach DM metadata must include safe direction and chat_id."
  );
  assert(metadata.message_text === undefined, "Outgoing coach DM metadata must not store raw text.");

  const noMatchResult = await recordCoachOutgoingBusinessDmContactIfSafe({
    message: outgoingCoachMessage,
    isCoachTelegramId: (value) => value === 555_111,
    listStudentsByTelegramChatId: async () => [],
    listRecentContactEvents: async () => [],
    recordContactEvent: async () => {
      throw new Error("Should not write contact when student mapping is missing.");
    },
  });
  assert(noMatchResult.kind === "ignored_no_student_match", "Unmapped outgoing DM must be ignored.");

  const ambiguousResult = await recordCoachOutgoingBusinessDmContactIfSafe({
    message: outgoingCoachMessage,
    isCoachTelegramId: (value) => value === 555_111,
    listStudentsByTelegramChatId: async () => [{ id: "student-a" }, { id: "student-b" }],
    listRecentContactEvents: async () => [],
    recordContactEvent: async () => {
      throw new Error("Should not write contact on ambiguous mapping.");
    },
  });
  assert(
    ambiguousResult.kind === "ignored_ambiguous_student_match",
    "Ambiguous outgoing DM mapping must be ignored."
  );

  const commandMessage = {
    ...outgoingCoachMessage,
    message_id: 103,
    text: "/tp_attention",
  };
  const commandResult = await recordCoachOutgoingBusinessDmContactIfSafe({
    message: commandMessage,
    isCoachTelegramId: (value) => value === 555_111,
    listStudentsByTelegramChatId: async () => [{ id: "student-a" }],
    listRecentContactEvents: async () => [],
    recordContactEvent: async () => {
      throw new Error("Coach command message must not produce contact event.");
    },
  });
  assert(
    commandResult.kind === "ignored_not_outgoing_coach_dm",
    "Outgoing coach command business DM must be ignored."
  );

  const duplicateResult = await recordCoachOutgoingBusinessDmContactIfSafe({
    message: outgoingCoachMessage,
    isCoachTelegramId: (value) => value === 555_111,
    listStudentsByTelegramChatId: async () => [{ id: "student-a" }],
    listRecentContactEvents: async () => [
      {
        eventType: "coach_message",
        source: "telegram_business_dm",
        referenceId: "102",
        metadata: {
          chat_id: "777001",
          message_id: 102,
        },
      },
    ],
    recordContactEvent: async () => {
      throw new Error("Duplicate outgoing DM must not write a second contact event.");
    },
  });
  assert(duplicateResult.kind === "ignored_duplicate", "Duplicate outgoing DM must be deduplicated.");

  const incomingShouldNotBeOutgoing = await recordCoachOutgoingBusinessDmContactIfSafe({
    message: athleteIncomingMessage,
    isCoachTelegramId: (value) => value === 555_111,
    listStudentsByTelegramChatId: async () => [{ id: "student-a" }],
    listRecentContactEvents: async () => [],
    recordContactEvent: async () => {
      throw new Error("Incoming athlete message must not be treated as outgoing coach contact.");
    },
  });
  assert(
    incomingShouldNotBeOutgoing.kind === "ignored_not_outgoing_coach_dm",
    "Incoming athlete business DM must never be treated as coach outgoing contact."
  );

  console.log("[check-trainingpeaks-business-dm-coach-contact] PASS");
}

run().catch((error) => {
  console.error("[check-trainingpeaks-business-dm-coach-contact] FAIL");
  console.error((error as Error).message);
  process.exit(1);
});
