/**
 * "Лучше не сделать, чем перенести чужую тренировку." — Igor.
 *
 * A group chat breaks the one guarantee a Business DM gives for free: that the person asking IS the
 * person whose workout moves. These checks pin the three refusals that stand between a group message
 * and a wrong athlete's calendar.
 *
 * The false-positive side is deliberately cheap here: an over-eager refusal costs one manual look.
 * That is why several fixtures assert we refuse on a *maybe*.
 *
 * Offline: pure functions, no DB, no network.
 */
import {
  detectThirdPartySubjectMention,
  isTelegramGroupChatId,
  isTrainingPeaksGroupMoveChatAllowed,
  isTrustedGroupSenderMatchMethod,
} from "@/features/trainingpeaks/group-move-safety";

let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`ok: ${name}`);
    return;
  }
  failed += 1;
  console.log(`FAIL: ${name}${detail ? `\n  ${detail}` : ""}`);
}

console.log("── 1. sender identity: only telegram_chat_id is strong enough for an action ──");
check("telegram_chat_id is trusted", isTrustedGroupSenderMatchMethod("telegram_chat_id"));
check(
  "telegram_username is NOT trusted (usernames are mutable — the repo's own auto-link policy refuses it too)",
  !isTrustedGroupSenderMatchMethod("telegram_username")
);
check("null match method is not trusted", !isTrustedGroupSenderMatchMethod(null));
check("an unknown match method is not trusted", !isTrustedGroupSenderMatchMethod("vibes"));

console.log("\n── 2. group chat detection (guards the multi-message splicing invariant) ──");
check("supergroup id is a group", isTelegramGroupChatId("-1001234567890"));
check("legacy group id is a group", isTelegramGroupChatId(-987654321));
check("private chat id is NOT a group", !isTelegramGroupChatId("5289930041"));
check("null is not a group", !isTelegramGroupChatId(null));

console.log("\n── 3. chat allowlist: fail-closed ──");
check(
  "empty allowlist allows NOTHING (an unset env must not silently permit every group)",
  !isTrainingPeaksGroupMoveChatAllowed("-1001234567890", new Set())
);
check(
  "allowlisted chat is allowed",
  isTrainingPeaksGroupMoveChatAllowed("-1001234567890", new Set(["-1001234567890"]))
);
check(
  "a different chat is not allowed",
  !isTrainingPeaksGroupMoveChatAllowed("-1009999999999", new Set(["-1001234567890"]))
);

console.log("\n── 4. third-party subject: the incident this whole task exists to prevent ──");

const SENDER = { from: { id: 5289930041 } };
const COACH_IDS = ["111222333"];

// The exact sentence from the recon. Resolving the SENDER here would move Demian's workout, not Tanya's.
const tanya = detectThirdPartySubjectMention({
  rawText: "@IgorPotseluev, а Тане можешь перенести субботнюю на воскресенье?",
  message: SENDER,
  coachUserIds: COACH_IDS,
});
check("«а Тане перенеси…» → refuse", tanya.suspected, `reason=${tanya.reason}`);

const pronoun = detectThirdPartySubjectMention({
  rawText: "Игорь, перенеси ей интервальную на четверг пожалуйста",
  message: SENDER,
  coachUserIds: COACH_IDS,
});
check("third-person pronoun «перенеси ЕЙ…» → refuse", pronoun.suspected, `reason=${pronoun.reason}`);

const twoMentions = detectThirdPartySubjectMention({
  rawText: "@igor @masha перенесите тренировку на завтра",
  message: SENDER,
  coachUserIds: COACH_IDS,
});
check(
  "two @mentions → refuse (one is the coach; the second names somebody else)",
  twoMentions.suspected && twoMentions.reason === "multiple_mentions"
);

const replyToOther = detectThirdPartySubjectMention({
  rawText: "перенесите тренировку на завтра",
  message: { from: { id: 5289930041 }, reply_to_message: { message_id: 1, chat: { id: -100 }, from: { id: 777888999 } } },
  coachUserIds: COACH_IDS,
});
check(
  "replying to ANOTHER student's message → refuse (the request is about that message)",
  replyToOther.suspected && replyToOther.reason === "reply_to_third_party"
);

console.log("\n── 5. …but a plain first-person request from the group must still go through ──");

const ownRequest = detectThirdPartySubjectMention({
  rawText: "@IgorPotseluev, перенесите пожалуйста мою интервальную на четверг",
  message: SENDER,
  coachUserIds: COACH_IDS,
});
check("«перенесите МОЮ интервальную» → not third-party", !ownRequest.suspected, `reason=${ownRequest.reason}`);

const plainRequest = detectThirdPartySubjectMention({
  rawText: "@IgorPotseluev перенесите тренировку с понедельника на вторник",
  message: SENDER,
  coachUserIds: COACH_IDS,
});
check("plain single-mention request → not third-party", !plainRequest.suspected, `reason=${plainRequest.reason}`);

const replyToCoach = detectThirdPartySubjectMention({
  rawText: "да, перенесите на среду пожалуйста",
  message: { from: { id: 5289930041 }, reply_to_message: { message_id: 1, chat: { id: -100 }, from: { id: 111222333 } } },
  coachUserIds: COACH_IDS,
});
check("replying to the COACH is not a third-party subject", !replyToCoach.suspected, `reason=${replyToCoach.reason}`);

const replyToSelf = detectThirdPartySubjectMention({
  rawText: "перенесите на среду пожалуйста",
  message: { from: { id: 5289930041 }, reply_to_message: { message_id: 1, chat: { id: -100 }, from: { id: 5289930041 } } },
  coachUserIds: COACH_IDS,
});
check("replying to your own message is not a third-party subject", !replyToSelf.suspected);

if (failed > 0) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}

console.log("\nAll group move safety checks passed.");
