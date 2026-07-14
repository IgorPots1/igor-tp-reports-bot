/**
 * Safety rules that apply to move requests coming from a GROUP chat, and nowhere else.
 *
 * In a Business DM the requester IS the subject, by construction: one chat, one person, no ambiguity
 * about whose workout is being moved. A group breaks that guarantee in two ways that have no DM
 * equivalent, and both of them end the same way — the wrong student's workout gets moved:
 *
 *   1. The sender may not be who we think. Matching by `telegram_chat_id` is sound (chat.id === from.id
 *      in a private chat, and the column carries a unique index). Matching by `telegram_username` is
 *      NOT — usernames are mutable, and the repo already says so out loud in topic-auto-link.ts:
 *      "Telegram usernames are mutable, so username-only matches still need coach confirmation."
 *      Good enough for a coach case a human reads. Not good enough to create an action.
 *
 *   2. The sender may not be the subject. "@Игорь, а Тане можешь перенести субботнюю на воскресенье?"
 *      resolves the SENDER, while the request is about Tanya. Nothing in the strict intent gate has
 *      any notion of a third-party object, and in a DM it simply cannot happen.
 *
 * Both are handled by refusing, not by guessing. A false refusal costs Igor one manual look; a false
 * acceptance moves a real athlete's real training. The asymmetry is not close.
 */

import type { TelegramMessage } from "@/features/telegram/types";

export type GroupSenderMatchMethod = "telegram_chat_id" | "telegram_username" | string;

/**
 * Telegram group and supergroup chat ids are negative; private chat ids are positive. This is the
 * cheapest reliable way to answer "is this a group?" from a bare chat id, with no message in hand.
 */
export function isTelegramGroupChatId(chatId: string | number | null | undefined): boolean {
  if (chatId === null || chatId === undefined) {
    return false;
  }
  return String(chatId).trim().startsWith("-");
}

/**
 * The ONLY identification strong enough to create an action from a group message.
 *
 * `telegram_chat_id` holds the student's private-chat id, which for a private chat equals their
 * Telegram user id — so it matches a group message's `from.id` exactly, and a unique index
 * guarantees it maps to at most one student. Username matches (and matches against archived
 * students) stay allowed for coach CASES, which a human reads, but never for actions.
 */
export function isTrustedGroupSenderMatchMethod(
  matchMethod: GroupSenderMatchMethod | null | undefined
): boolean {
  return matchMethod === "telegram_chat_id";
}

// ── Chat allowlist ────────────────────────────────────────────────────────────────────────────────

export const GROUP_MOVE_CHAT_ALLOWLIST_ENV = "TRAININGPEAKS_GROUP_MOVE_CHAT_ALLOWLIST";

/**
 * Fail-closed, same shape as the workout-report intake allowlist: an unset or empty list allows
 * NOTHING. This gates action creation only — coach cases keep flowing from any group, because a case
 * is an observation a human reads, not a mutation.
 */
export function getTrainingPeaksGroupMoveChatAllowlist(): Set<string> {
  const raw = process.env[GROUP_MOVE_CHAT_ALLOWLIST_ENV]?.trim();
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^-?\d+$/.test(value))
  );
}

export function isTrainingPeaksGroupMoveChatAllowed(
  chatId: string | number | null | undefined,
  allowlist: Set<string> = getTrainingPeaksGroupMoveChatAllowlist()
): boolean {
  if (chatId === null || chatId === undefined) {
    return false;
  }
  return allowlist.has(String(chatId));
}

// ── Third-party subject detection ─────────────────────────────────────────────────────────────────

export type ThirdPartySubjectDetection = {
  suspected: boolean;
  /** Machine-readable signal that fired, for the coach case metadata. */
  reason: string | null;
  /** What tripped it, shown to the coach verbatim. */
  evidence: string | null;
};

const NOT_SUSPECTED: ThirdPartySubjectDetection = { suspected: false, reason: null, evidence: null };

/**
 * Third-person markers: the request is about someone who is not the person typing.
 * Deliberately narrow — these are dative/accusative/genitive forms that only appear when the subject
 * is a third party ("перенеси ЕЙ", "у НЕЁ завтра", "за НЕГО"). First person ("мне", "у меня") is
 * absent on purpose: that is the normal, safe case.
 */
const THIRD_PERSON_MARKER_PATTERN =
  /(?:^|[\s,.!?;:()"'«»])(?:ей|ему|её|ее|его|них|им|у\s+не[ёе]|у\s+него|за\s+не[ёе]|за\s+него|ребят[ае]?)(?:$|[\s,.!?;:()"'«»])/u;

/**
 * A capitalised Cyrillic name in an oblique case — "Тане", "Машу", "Оли", "для Ани".
 * Only fires when preceded by a space (so it never matches the first word of a sentence) and the
 * ending is oblique — a nominative "Таня" reads as address, not as a third-party object.
 *
 * Student names in the DB are Latin ("Nadezhda Semeshina") while the group speaks Russian ("Тане"),
 * so matching against the roster is not viable. This is shape-based on purpose.
 */
const OBLIQUE_CYRILLIC_NAME_PATTERN = /\s[А-ЯЁ][а-яё]{2,}(?:е|у|ю|ой|ей|и|ы)(?=$|[\s,.!?;:()"'«»])/u;

function countMentions(rawText: string): number {
  return rawText.match(/@\w+/gu)?.length ?? 0;
}

/**
 * Does this group message ask about SOMEONE ELSE'S workout?
 *
 * Conservative by design: any hit means "do not create an action, ask the coach". A false positive
 * costs one manual look. A false negative moves a real athlete's real training.
 */
export function detectThirdPartySubjectMention(input: {
  rawText: string;
  message?: Pick<TelegramMessage, "from" | "reply_to_message"> | null;
  /** Coach Telegram user ids — a reply to the coach is not a third-party subject. */
  coachUserIds?: readonly string[];
}): ThirdPartySubjectDetection {
  const rawText = input.rawText?.trim() ?? "";
  if (!rawText) {
    return NOT_SUSPECTED;
  }

  // 1. Two or more @mentions. One is presumed to be the coach; a second names somebody else.
  const mentionCount = countMentions(rawText);
  if (mentionCount >= 2) {
    return {
      suspected: true,
      reason: "multiple_mentions",
      evidence: (rawText.match(/@\w+/gu) ?? []).join(", "),
    };
  }

  // 2. Replying to a third person's message — the request is about THAT message, not the sender.
  const replyAuthorId = input.message?.reply_to_message?.from?.id;
  const senderId = input.message?.from?.id;
  if (replyAuthorId !== undefined && replyAuthorId !== senderId) {
    const coachUserIds = new Set(input.coachUserIds ?? []);
    const replyingToCoach = coachUserIds.has(String(replyAuthorId));
    const replyingToSelf = String(replyAuthorId) === String(senderId);
    if (!replyingToCoach && !replyingToSelf) {
      return {
        suspected: true,
        reason: "reply_to_third_party",
        evidence: `ответ на сообщение пользователя ${replyAuthorId}`,
      };
    }
  }

  // 3. Third-person pronouns — "перенеси ЕЙ интервальную".
  const thirdPersonMatch = rawText.match(THIRD_PERSON_MARKER_PATTERN);
  if (thirdPersonMatch) {
    return {
      suspected: true,
      reason: "third_person_marker",
      evidence: thirdPersonMatch[0].trim(),
    };
  }

  // 4. A name in an oblique case — "а Тане перенеси субботнюю".
  const nameMatch = rawText.match(OBLIQUE_CYRILLIC_NAME_PATTERN);
  if (nameMatch) {
    return {
      suspected: true,
      reason: "oblique_name_mention",
      evidence: nameMatch[0].trim(),
    };
  }

  return NOT_SUSPECTED;
}
