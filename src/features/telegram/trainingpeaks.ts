import { randomUUID } from "node:crypto";

import type {
  ParsedTelegramCallbackUpdate,
  ParsedTelegramMessageUpdate,
  ParsedTelegramUpdate,
} from "@/features/telegram/parser";
import {
  INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU,
  isEligibleForCoachSourceDateConfirmation,
  isCoachConfirmedSourceDateManualExecuteReady,
  validateDryRunLogReadiness,
} from "@/features/trainingpeaks/move-source-policy";
import { formatTrainingPeaksExecuteQueuedMessage } from "@/features/trainingpeaks/action-execute-telegram-copy";
import {
  buildCoachActionsListText,
  COACH_REPLY_BUTTON_SIGNALS,
  formatCoachActionReasonForDisplay,
  formatCoachActionRunSummary,
  listCoachActionListActiveActions,
  translateCoachActionTechnicalReason,
} from "@/features/trainingpeaks/action-list-telegram-copy";
import {
  expandCoachRunSummaryForDetail,
  formatTelegramLabeledBlock,
} from "@/features/trainingpeaks/telegram-visual-ux";
import {
  addTrainingPeaksStudentFromCommand,
  approveTrainingPeaksAction,
  cancelTrainingPeaksActionExecution,
  cancelTrainingPeaksWeeklyRun,
  consumeTrainingPeaksStudentTelegramLinkCode,
  createTrainingPeaksActionsFromGroupMoveCase,
  createTrainingPeaksMoveWorkoutActionFromTelegram,
  confirmTrainingPeaksActionSourceDate,
  createTrainingPeaksStudentTelegramLinkCode,
  dismissTrainingPeaksCoachCase,
  disableTrainingPeaksStudent,
  disableTrainingPeaksStudentByInternalId,
  enableTrainingPeaksStudent,
  enableTrainingPeaksStudentByInternalId,
  findTrainingPeaksBusinessChatsByUsername,
  getTrainingPeaksAttentionSnapshot,
  getTrainingPeaksHealthSnapshot,
  getTrainingPeaksOperationalSignalsSnapshot,
  getTrainingPeaksJobsStatus,
  getTrainingPeaksBusinessChatByInternalId,
  getTrainingPeaksLatestReportSnapshotByInternalId,
  getTrainingPeaksReportSnapshot,
  getTrainingPeaksStatusOverview,
  getTrainingPeaksStudentCard,
  getTrainingPeaksStudentCardByInternalId,
  getTrainingPeaksStudentById,
  getTrainingPeaksBusinessChatByChatId,
  getTrainingPeaksCoachCaseByShortId,
  getTrainingPeaksDefaultVisibleCoachCaseKinds,
  getTrainingPeaksStudentsRegistryWithLatestReportStatus,
  getTrainingPeaksThreadInfo,
  isTrainingPeaksCoachCaseVisibleByDefault,
  getTrainingPeaksWeeklyReportByInternalId,
  linkTrainingPeaksStudentThread,
  linkTrainingPeaksStudentToBusinessChat,
  listRecentTrainingPeaksBusinessChats,
  listTrainingPeaksCoachCases,
  rejectTrainingPeaksAction,
  resolveTrainingPeaksCoachCase,
  requestTrainingPeaksActionExecution,
  requestTrainingPeaksActionDryRunRecheck,
  validateTrainingPeaksGroupMovePairsPreview,
  TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE,
  type RequestTrainingPeaksWeeklyRunResult,
  type RequestTrainingPeaksRaceScanResult,
  listTrainingPeaksWeeklyReportEligibleStudents,
  parseTrainingPeaksWeeklyRunWeekInput,
  requestTrainingPeaksWeeklyRun,
  requestTrainingPeaksWeeklyRunForStudent,
  requestTrainingPeaksWeeklyRunForStudentByInternalId,
  requestTrainingPeaksRaceScan,
  requestTrainingPeaksRaceResultsProbeJob,
  recordTrainingPeaksCoachCaseAndSnapshot,
  type TrainingPeaksRegistryStudentSnapshot,
  type RequestTrainingPeaksWeeklyRunForStudentResult,
  unlinkTrainingPeaksStudentThread,
  updateTrainingPeaksWeeklyReportStateByInternalId,
  updateTrainingPeaksStudentTelegramContact,
  upsertTrainingPeaksBusinessChatFromMessage,
  formatTrainingPeaksMoveWorkoutActionSummary,
  listRecentTrainingPeaksActionsWithLatestRunContext,
  getTrainingPeaksActionWithStudentById,
  getTrainingPeaksActionWithStudentAndLatestRunContextById,
  insertTrainingPeaksReplyDraft,
  recordTrainingPeaksReplyDraftFeedback,
  type TrainingPeaksOperationalSignalsScope,
  formatTrainingPeaksOperationalSignalsForTelegramMultiMessage,
} from "@/features/trainingpeaks/service";
import {
  hasTrainingPeaksAttentionDigestSentForBelgradeDate,
  runTrainingPeaksAttentionDigest,
} from "@/features/trainingpeaks/attention-digest-run";
import {
  TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT,
  buildTrainingPeaksAttentionDigestMessages,
  getTrainingPeaksCoachChatIds,
} from "@/features/trainingpeaks/attention-telegram";
import { sendTrainingPeaksWeeklyReportToStudent } from "@/features/trainingpeaks/report-delivery";
import { sendTrainingPeaksReplyDraftToStudent } from "@/features/trainingpeaks/reply-draft-delivery";
import { parseGroupWorkoutReportReviewCallback } from "@/features/trainingpeaks/group-workout-report-review-card";
import {
  handleGroupWorkoutReportReviewCallback,
  tryHandleGroupWorkoutReportCoachEditMessage,
} from "@/features/trainingpeaks/group-workout-report-review-flow";
import {
  isTrainingPeaksTelegramBusinessPeerMissingError,
  shortenTrainingPeaksTelegramDeliveryError,
} from "@/features/trainingpeaks/telegram-business";
import { buildTrainingPeaksReplyDraftContext } from "@/features/trainingpeaks/reply-draft-context";
import {
  formatTrainingPeaksReplyDraftTelegramMessage,
  generateTrainingPeaksReplyDraft,
  getTrainingPeaksReplyDraftModel,
} from "@/features/trainingpeaks/reply-draft-generator";
import {
  buildTelegramContextTextPreview,
  classifyTelegramContextLabels,
  isAthleteIncomingBusinessDmMessage,
  recordCoachOutgoingBusinessDmContactIfSafe,
  recordTrainingPeaksTelegramBusinessContextObservation,
  sha256TelegramContextText,
} from "@/features/trainingpeaks/telegram-context";
import { persistOperationalSignalsForObservation } from "@/features/trainingpeaks/operational-signals-inline";
import {
  extractStudentMessagesFromVoiceTranscriptDetailed,
  type ExtractedVoiceStudentMessage,
} from "@/features/telegram/voice-command-extraction";
import { matchStudentByIdentity } from "@/features/trainingpeaks/student-identity-match";
import {
  hasTrainingPeaksMessageIntentLoggingRelevance,
  logTrainingPeaksBusinessMessageIntentDecision,
  resolveTrainingPeaksMessageIntentLogStatus,
} from "@/features/trainingpeaks/message-intent-log";
import {
  formatTrainingPeaksMessageIntentLogsTriageTelegram,
  parseTrainingPeaksIntentsCommandArgs,
} from "@/features/trainingpeaks/message-intent-log-triage";
import {
  getTrainingPeaksReplyDraftByIdPrefix,
  getLatestTrainingPeaksCronRunLog,
  getTrainingPeaksMessageIntentLogByTelegramMessage,
  getTrainingPeaksStudentByTelegramChatId,
  listActiveTrainingPeaksStudentMemoryItems,
  listRecentTrainingPeaksStudentContactEvents,
  listTrainingPeaksStudentsByTelegramChatId,
  listTrainingPeaksMessageIntentLogsForTriage,
  listTrainingPeaksCronRunLogs,
  TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
  recordTrainingPeaksStudentContactEvent,
  type TrainingPeaksStudentMemoryItem,
  type TrainingPeaksStudentMemoryType,
  type TrainingPeaksCronRunLog,
  type TrainingPeaksMessageIntentLogStatus,
  updateTrainingPeaksReplyDraftOutcome,
} from "@/features/trainingpeaks/repository";
import { isTrainingPeaksContextObserverEnabled } from "@/features/trainingpeaks/context-observer";
import {
  getPreviousTrainingPeaksWeek,
  resolveTrainingPeaksWeekKeyword,
} from "@/features/trainingpeaks/week";
import {
  answerTelegramCallbackQuery,
  downloadTelegramFile,
  editTelegramMessageText,
  editTelegramMessageTextStrict,
  isTelegramMessageTooLongError,
  sendTelegramMessage,
  sendTelegramMessageStrict,
} from "@/features/telegram/telegram-client";
import { transcribeTelegramVoiceMessage } from "@/features/telegram/voice-transcription";
import type {
  TelegramChatType,
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
  TelegramReplyKeyboardMarkup,
} from "@/features/telegram/types";

const COACH_ONLY_MESSAGE = "⛔ Эта команда доступна только тренеру.";
const VOICE_COMMANDS_DISABLED_MESSAGE = "Голосовые команды пока выключены.";
const VOICE_TRANSCRIPTION_IN_PROGRESS_MESSAGE = "🎤 Распознаю голосовое сообщение…";
const VOICE_TRANSCRIPTION_FAILED_MESSAGE =
  "Не удалось распознать голосовое сообщение. Попробуй ещё раз или напиши текстом.";
const VOICE_EXTRACTION_FAILED_MESSAGE =
  "Расшифровал голосовое, но не смог разобрать команды для учеников. Попробуй переформулировать.";
const TP_WEEKLY_DISABLED_MESSAGE =
  "⚙️ /tp_weekly отключён. Для отчётов используй «📊 Отчёты», а запуск workflow оставлен через явные preview/confirm-кнопки.";
const TP_UNKNOWN_COMMAND_MESSAGE = "Не поняла команду. Используй кнопки внизу или отправь /start.";
const TELEGRAM_MESSAGE_LIMIT = 4000;
const TELEGRAM_SAFE_MESSAGE_LIMIT = TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT;
const TP_ATTENTION_FALLBACK_TOO_LONG_MESSAGE =
  "«Сегодня» получился слишком длинным.\nПоказываю короткую версию. Откройте /tp_actions или /tp_signals для деталей.";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STUDENTS_PAGE_SIZE = 8;
const TP_CALLBACK_PREFIX = "tp:";
const TP_CALLBACK_MAIN_MENU = "tp:m";
const TP_CALLBACK_WEEK_MENU = "tp:w";
const TP_CALLBACK_WEEK_LAST = "tp:wl";
const TP_CALLBACK_WEEK_CURRENT = "tp:wc";
const TP_CALLBACK_RACES_MENU = "tp:races";
const TP_CALLBACK_RACES_NEXT_WEEK = "tp:races:nw";
const TP_CALLBACK_RACES_7_DAYS = "tp:races:7d";
const TP_CALLBACK_RACES_30_DAYS = "tp:races:30d";
const TP_CALLBACK_RACES_TO_AUGUST = "tp:races:aug1";
const TP_CALLBACK_JOBS = "tp:j";
const TP_CALLBACK_CASES_RECENT = "tp:cases:recent";
const TP_CALLBACK_CASES_PAGE_PREFIX = "tp:cases:page:";
const TP_CALLBACK_WEEK_RUN_CONFIRM = "tp:wr:confirm";
const TP_CALLBACK_WEEK_RUN_CANCEL = "tp:wr:cancel";
const TP_CALLBACK_JOB_CANCEL_PREFIX = "tp:jc:";
const TP_CALLBACK_HELP = "tp:h";
const TP_CALLBACK_REPORTS_MENU = "tp:menu:reports";
const TP_CALLBACK_REPORTS_STATUS_LAST = "tp:reports:status_last";
const TP_CALLBACK_REPORTS_FROM_STUDENT = "tp:reports:from_student";
const TP_CALLBACK_REPORTS_ELIGIBLE = "tp:reports:eligible";
const TP_REPLY_BUTTON_TELEGRAM_USERNAME_LEGACY = "🔎 Найти username";
const TP_CALLBACK_MORE_MENU = "tp:menu:more";
const TP_CALLBACK_ATTENTION = "tp:attention";
const TP_CALLBACK_SIGNALS = "tp:signals";
const TP_CALLBACK_REPLY_DRAFT_HINT = "tp:reply_draft:hint";
const TP_CALLBACK_BILLING_HINT = "tp:billing:hint";
const TP_CALLBACK_HEALTH = "tp:health";
const TP_CALLBACK_CRON_STATUS = "tp:cron_status";
const TP_CALLBACK_INTENTS = "tp:intents";
const TP_CALLBACK_TELEGRAM_LINKS_HINT = "tp:telegram_links:hint";
const TP_CALLBACK_VOICE_DRAFTS_CLOSE = "tp:voice_drafts:close";
const TP_CALLBACK_VOICE_PICK_PREFIX = "tp:voice_pick:";
const TP_CALLBACK_VOICE_PICK_NONE_PREFIX = "tp:voice_pick_none:";
const TP_CALLBACK_REPLY_DRAFT_SEND_PREFIX = "tp:rd:s:";
const TP_CALLBACK_REPLY_DRAFT_CANCEL_PREFIX = "tp:rd:x:";
const TP_CALLBACK_REPLY_DRAFT_CLOSE = "tp:rd:close";
const TP_CALLBACK_STUDENT_WEEKLY_HINT_PREFIX = "tp:student:weekly_hint:";
const TP_CALLBACK_STUDENT_RUN_PREFIX = "tp:run:";
const TP_ALL_ENABLED_WEEKLY_PREVIEW_NAME_LIMIT = 10;
const TP_PENDING_ALL_ENABLED_WEEKLY_RUN_TTL_MS = 30 * 60 * 1000;
const TP_PENDING_VOICE_PICK_TTL_MS = 30 * 60 * 1000;
const TP_CALLBACK_REPORTS = "tp:reports";
const TP_CALLBACK_REPORT_SEND_PREFIX = "tp:rs:";
const TP_CALLBACK_REPORT_SKIP_PREFIX = "tp:rk:";
const TP_CALLBACK_STUDENT_LINK_PREFIX = "tp:sl:";
const TP_CALLBACK_STUDENT_USERNAME_PREFIX = "tp:su:";
const TP_CALLBACK_STUDENT_LINK_CODE_PREFIX = "tp:sk:";
const TP_CALLBACK_STUDENT_SELECT_CHAT_PREFIX = "tp:sc:";
const TP_CALLBACK_STUDENT_TEST_PREFIX = "tp:st:";
const TP_CALLBACK_STUDENT_TOOLS_PREFIX = "tp:stools:";
const TP_CALLBACK_STUDENT_RACE_RESULTS_PROBE_PREFIX = "tp:sprobe:race:";
const TP_CALLBACK_STUDENT_CONTEXT_PREFIX = "tp:ctx:";
const TP_CALLBACK_ACTION_APPROVE_PREFIX = "tp:ta:a:";
const TP_CALLBACK_ACTION_REJECT_PREFIX = "tp:ta:r:";
const TP_CALLBACK_ACTION_EXECUTE_PREFIX = "tp:ta:x:";
const TP_CALLBACK_ACTION_RECHECK_DRY_RUN_PREFIX = "tp:ta:rd:";
const TP_CALLBACK_ACTION_CANCEL_PREFIX = "tp:ta:c:";
const TP_CALLBACK_ACTION_LIST_CANCEL_PREFIX = "tp:ta:lc:";
const TP_CALLBACK_ACTION_DETAIL_PREFIX = "tp:ta:d:";
const TP_CALLBACK_ACTION_DETAIL_CANCEL_PREFIX = "tp:ta:dc:";
const TP_CALLBACK_ACTION_CONFIRM_SOURCE_PREFIX = "tp:ta:cs:";
const TP_CALLBACK_ACTION_DETAIL_BACK = "tp:ta:back";
const TP_CALLBACK_CASE_RESOLVE_PREFIX = "tp:case:r:";
const TP_CALLBACK_CASE_DISMISS_PREFIX = "tp:case:d:";
const TP_CALLBACK_CASE_PROPOSE_PREFIX = "tp:case:p:";
const TP_REPLY_BUTTON_MENU = "🏠 Меню";
const TP_REPLY_BUTTON_TODAY = "🌅 Сегодня";
const TP_REPLY_BUTTON_SIGNALS = COACH_REPLY_BUTTON_SIGNALS;
const TP_REPLY_BUTTON_STUDENTS = "👥 Ученики";
const TP_REPLY_BUTTON_ADD = "➕ Добавить";
const TP_REPLY_BUTTON_REPORTS = "📊 Отчёты";
const TP_REPLY_BUTTON_RACES = "🏁 Забеги";
const TP_REPLY_BUTTON_JOBS = "🧾 Задачи";
const TP_REPLY_BUTTON_CASES = "🧩 Кейсы";
const TP_REPLY_BUTTON_ACTIONS = "📋 Заявки";
const TP_REPLY_BUTTON_PAYMENTS = "💳 Оплаты";
const TP_REPLY_BUTTON_SERVICE = "⚙️ Служебное";
const TP_REPLY_BUTTON_BACK = "⬅️ Назад";
const TP_REPLY_BUTTON_STUDENTS_BACK = "⬅️ Ученики";
const TP_REPLY_BUTTON_WEEK_LAST = "Прошлая неделя";
const TP_REPLY_BUTTON_WEEK_CURRENT = "Текущая неделя";
const TP_REPLY_BUTTON_RACES_NEXT_WEEK = "🗓 Следующая неделя";
const TP_REPLY_BUTTON_RACES_7_DAYS = "7 дней";
const TP_REPLY_BUTTON_RACES_30_DAYS = "30 дней";
const TP_REPLY_BUTTON_RACES_TO_AUGUST = "До 1 августа";
const TP_REPLY_BUTTON_JOBS_REFRESH = "🔄 Обновить задачи";
const TP_REPLY_BUTTON_CANCEL_JOB = "❌ Отменить задачу";
const TP_REPLY_BUTTON_REPORT = "📄 Отчёт";
const TP_REPLY_BUTTON_TELEGRAM_LINK = "🔗 Привязать Telegram";
const TP_REPLY_BUTTON_TELEGRAM_USERNAME = "🔎 Найти по username";
const TP_REPLY_BUTTON_TELEGRAM_CODE = "🔗 Код привязки";
const TP_REPLY_BUTTON_TELEGRAM_TEST = "📨 Отправить тест";
const TP_REPLY_BUTTON_DISABLE = "⛔ Отключить";
const TP_REPLY_BUTTON_ENABLE = "✅ Включить";
const TP_CHAT_CONTEXT_TTL_MS = 30 * 60 * 1000;
const TP_ADD_STUDENT_WAITING_TTL_MS = 10 * 60 * 1000;
const TP_TELEGRAM_LINK_OPTIONS_TTL_MS = 10 * 60 * 1000;
const TP_TELEGRAM_USERNAME_WAITING_TTL_MS = 10 * 60 * 1000;
const TP_ADD_STUDENT_DEPRECATED_MESSAGE = "Добавление учеников теперь выполняется в админке.";
const TP_ADD_STUDENT_EXAMPLE =
  "Valentin https://app.trainingpeaks.com/#calendar/athletes/5673496";
const TP_TRAININGPEAKS_URL_PATTERN = /\bhttps?:\/\/\S*trainingpeaks\.com\S*/i;

const TP_MAIN_COMMAND_PATTERN = /^\/tp(?:@\w+)?(?:\s+|$)/;
const TP_STATUS_COMMAND_PATTERN = /^\/tp_status(?:@\w+)?(?:\s+|$)/;
const TP_STUDENTS_COMMAND_PATTERN = /^\/tp_students(?:@\w+)?(?:\s+|$)/;
const TP_STUDENT_COMMAND_PATTERN = /^\/tp_student(?:@\w+)?(?:\s+|$)/;
const TP_DISABLE_STUDENT_COMMAND_PATTERN = /^\/tp_disable_student(?:@\w+)?(?:\s+|$)/;
const TP_ENABLE_STUDENT_COMMAND_PATTERN = /^\/tp_enable_student(?:@\w+)?(?:\s+|$)/;
const TP_ADD_COMMAND_PATTERN = /^\/tp_add(?:@\w+)?(?:\s+|$)/;
const TP_ADD_STUDENT_COMMAND_PATTERN = /^\/tp_add_student(?:@\w+)?(?:\s+|$)/;
const TP_REPORT_COMMAND_PATTERN = /^\/tp_report(?:@\w+)?(?:\s+|$)/;
const TP_WEEK_COMMAND_PATTERN = /^\/tp_week(?:@\w+)?(?:\s+|$)/;
const TP_RUN_COMMAND_PATTERN = /^\/tp_run(?:@\w+)?(?:\s+|$)/;
const TP_RUN_STUDENT_COMMAND_PATTERN = /^\/tp_run_student(?:@\w+)?(?:\s+|$)/;
const TP_RUN_WEEK_COMMAND_PATTERN = /^\/tp_run_week(?:@\w+)?(?:\s+|$)/;
const TP_START_COMMAND_PATTERN = /^\/tp_start(?:@\w+)?(?:\s+|$)/;
const TP_RACES_COMMAND_PATTERN = /^\/tp_races(?:@\w+)?(?:\s+|$)/;
const TP_JOBS_COMMAND_PATTERN = /^\/tp_jobs(?:@\w+)?(?:\s+|$)/;
const TP_ATTENTION_COMMAND_PATTERN = /^\/tp_attention(?:@\w+)?(?:\s+|$)/;
const TP_SIGNALS_COMMAND_PATTERN = /^\/tp_signals(?:@\w+)?(?:\s+|$)/;
const TP_CASES_RECENT_COMMAND_PATTERN = /^\/tp_cases_recent(?:@\w+)?(?:\s+|$)/;
const TP_CASES_COMMAND_PATTERN = /^\/tp_cases(?:@\w+)?(?:\s+|$)/;
const TP_CASE_COMMAND_PATTERN = /^\/tp_case(?:@\w+)?(?:\s+|$)/;
const TP_CASE_RESOLVE_COMMAND_PATTERN = /^\/tp_case_resolve(?:@\w+)?(?:\s+|$)/;
const TP_CASE_DISMISS_COMMAND_PATTERN = /^\/tp_case_dismiss(?:@\w+)?(?:\s+|$)/;
const TP_RESOLVE_CASE_COMMAND_PATTERN = /^\/tp_resolve_case(?:@\w+)?(?:\s+|$)/;
const TP_DISMISS_CASE_COMMAND_PATTERN = /^\/tp_dismiss_case(?:@\w+)?(?:\s+|$)/;
const TP_CASE_RESOLVE_V2_COMMAND_PATTERN = /^\/tp(?:@\w+)?\s+case\s+resolve(?:\s+|$)/i;
const TP_CASE_DISMISS_V2_COMMAND_PATTERN = /^\/tp(?:@\w+)?\s+case\s+dismiss(?:\s+|$)/i;
const TP_HEALTH_COMMAND_PATTERN = /^\/tp_health(?:@\w+)?(?:\s+|$)/;
const TP_CRON_STATUS_COMMAND_PATTERN = /^\/tp_cron_status(?:@\w+)?(?:\s+|$)/;
const TP_DIGEST_NOW_COMMAND_PATTERN = /^\/tp_digest_now(?:@\w+)?(?:\s+|$)/;
const TP_WEEKLY_COMMAND_PATTERN = /^\/tp_weekly(?:@\w+)?(?:\s+|$)/;
const TP_BUSINESS_TEST_COMMAND_PATTERN = /^\/tp_business_test(?:@\w+)?(?:\s+|$)/;
const TP_GROUP_TEST_COMMAND_PATTERN = /^\/tp_group_test(?:@\w+)?(?:\s+|$)/;
const TP_SET_TELEGRAM_COMMAND_PATTERN = /^\/tp_set_telegram(?:@\w+)?(?:\s+|$)/;
const TP_BIND_COMMAND_PATTERN = /^\/tp_bind(?:@\w+)?(?:\s+|$)/;
const TP_ACTIONS_COMMAND_PATTERN = /^\/tp_actions(?:@\w+)?(?:\s+|$)/;
const TP_CONTEXT_COMMAND_PATTERN = /^\/tp_context(?:@\w+)?(?:\s+|$)/;
const TP_INTENTS_COMMAND_PATTERN = /^\/tp_intents(?:@\w+)?(?:\s+|$)/;
const TP_INTENT_LOGS_COMMAND_PATTERN = /^\/tp_intent_logs(?:@\w+)?(?:\s+|$)/;
const TP_UNKNOWN_INTENTS_COMMAND_PATTERN = /^\/tp_unknown(?:@\w+)?(?:\s+|$)/;
const TP_AI_INTENTS_COMMAND_PATTERN = /^\/tp_ai_intents(?:@\w+)?(?:\s+|$)/;
const TP_REPLY_DRAFT_COMMAND_PATTERN = /^\/tp_reply_draft(?:@\w+)?(?:\s+|$)/;
const TP_DRAFT_FEEDBACK_COMMAND_PATTERN = /^\/tp_draft_feedback(?:@\w+)?(?:\s+|$)/;
const TP_LINK_THREAD_COMMAND_PATTERN = /^\/tp_link_thread(?:@\w+)?(?:\s+|$)/;
const TP_THREAD_INFO_COMMAND_PATTERN = /^\/tp_thread_info(?:@\w+)?(?:\s+|$)/;
const TP_UNLINK_THREAD_COMMAND_PATTERN = /^\/tp_unlink_thread(?:@\w+)?(?:\s+|$)/;
const TP_COMMAND_PATTERN = /^\/tp(?:_[a-z0-9_]+)?(?:@\w+)?(?:\s+|$)/;
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const TP_RACES_TIMEZONE = "Europe/Belgrade";
const ISO_YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type TrainingPeaksCommand =
  | "tp"
  | "tp_start"
  | "tp_status"
  | "tp_students"
  | "tp_student"
  | "tp_disable_student"
  | "tp_enable_student"
  | "tp_add"
  | "tp_add_student"
  | "tp_report"
  | "tp_week"
  | "tp_run"
  | "tp_run_student"
  | "tp_run_week"
  | "tp_races"
  | "tp_jobs"
  | "tp_attention"
  | "tp_signals"
  | "tp_cases_recent"
  | "tp_cases"
  | "tp_case"
  | "tp_case_resolve"
  | "tp_case_dismiss"
  | "tp_health"
  | "tp_cron_status"
  | "tp_digest_now"
  | "tp_weekly"
  | "tp_business_test"
  | "tp_group_test"
  | "tp_set_telegram"
  | "tp_bind"
  | "tp_actions"
  | "tp_context"
  | "tp_intents"
  | "tp_reply_draft"
  | "tp_draft_feedback"
  | "tp_link_thread"
  | "tp_thread_info"
  | "tp_unlink_thread"
  | "unknown";

type TrainingPeaksWeek = {
  weekFrom: string;
  weekTo: string;
};

type TrainingPeaksMenuButton = {
  text: string;
  callback_data: string;
};

type ParsedTrainingPeaksCallback =
  | { kind: "main_menu" }
  | { kind: "students_page"; page: number }
  | { kind: "student_card"; studentId: string }
  | { kind: "student_report"; studentId: string }
  | { kind: "student_disable"; studentId: string }
  | { kind: "student_enable"; studentId: string }
  | { kind: "student_link"; studentId: string }
  | { kind: "student_username_prompt"; studentId: string }
  | { kind: "student_link_code"; studentId: string }
  | { kind: "student_choose_chat"; studentId: string; chatKey: string }
  | { kind: "student_test"; studentId: string }
  | { kind: "student_tools_menu"; studentId: string }
  | { kind: "student_race_results_probe"; studentId: string }
  | { kind: "student_context"; studentId: string }
  | { kind: "report_send"; reportId: string }
  | { kind: "report_skip"; reportId: string }
  | { kind: "action_approve"; actionId: string }
  | { kind: "action_reject"; actionId: string }
  | { kind: "action_execute_request"; actionId: string }
  | { kind: "action_recheck_dry_run"; actionId: string }
  | { kind: "action_execute_cancel"; actionId: string }
  | { kind: "action_list_cancel"; actionId: string }
  | { kind: "action_detail"; actionId: string }
  | { kind: "action_detail_cancel"; actionId: string }
  | { kind: "action_confirm_source_date"; actionId: string }
  | { kind: "action_detail_back" }
  | { kind: "case_resolve"; shortId: string }
  | { kind: "case_dismiss"; shortId: string }
  | { kind: "case_create_proposals"; shortId: string }
  | { kind: "cases_page"; offset: number; query: string | null }
  | { kind: "actions_list" }
  | { kind: "signals_list" }
  | { kind: "week_menu" }
  | { kind: "week_last" }
  | { kind: "week_current" }
  | { kind: "races_menu" }
  | { kind: "races_next_week" }
  | { kind: "races_7_days" }
  | { kind: "races_30_days" }
  | { kind: "races_to_august" }
  | { kind: "races_custom" }
  | { kind: "jobs" }
  | { kind: "cases_recent" }
  | { kind: "week_run_confirm" }
  | { kind: "week_run_cancel" }
  | { kind: "job_cancel"; jobId: string }
  | { kind: "help" }
  | { kind: "reports_menu" }
  | { kind: "reports_status_last" }
  | { kind: "reports_from_student" }
  | { kind: "reports_eligible" }
  | { kind: "more_menu" }
  | { kind: "attention" }
  | { kind: "reply_draft_hint" }
  | { kind: "reply_draft_send"; draftIdPrefix: string }
  | { kind: "reply_draft_cancel"; draftIdPrefix: string }
  | { kind: "reply_draft_close" }
  | { kind: "billing_hint" }
  | { kind: "health" }
  | { kind: "cron_status" }
  | { kind: "intents" }
  | { kind: "telegram_links_hint" }
  | { kind: "voice_drafts_close" }
  | { kind: "voice_pick"; key: string; candidateIndex: number }
  | { kind: "voice_pick_none"; key: string }
  | { kind: "student_weekly_hint"; studentId: string }
  | { kind: "student_weekly_run"; studentId: string; weekKeyword: "last" | "current" };

type PendingAllEnabledWeeklyRunContext = {
  weekFrom: string;
  weekTo: string;
  previewCount: number;
  expiresAt: number;
};

type PendingVoicePickContext = {
  chatId: string;
  recipientQuery: string;
  messageText: string;
  confidence: number;
  extractionModel: string;
  promptContextSha256: string;
  transcriptPreview: string;
  voiceCommandMessageId: string | null;
  candidateStudentIds: string[];
  expiresAt: number;
};

type VoiceStudentMatchResult = {
  extracted: ExtractedVoiceStudentMessage;
  status: "matched" | "ambiguous" | "unmatched";
  student: TrainingPeaksRegistryStudentSnapshot | null;
  candidates: Array<{
    id: string;
    studentId: string;
    studentName: string;
    score: number;
    matchedBy: string;
    matchedValuePreview: string;
  }>;
};

type VoiceDraftCreationResult = {
  studentName: string;
  draftPreview: string;
  draftIdShort: string;
  hasDraftText: boolean;
};

async function createVoiceDraftFromMatch(input: {
  parsedMessage: ParsedTelegramMessageUpdate | ParsedTelegramCallbackUpdate;
  student: TrainingPeaksRegistryStudentSnapshot;
  extracted: ExtractedVoiceStudentMessage;
  promptContextSha256: string;
  transcriptPreview: string;
  extractionModel: string;
  batchKey: string;
  batchIndex: number;
  batchTotal: number;
  selectedFromAmbiguity: boolean;
  voiceCommandMessageId: string | null;
}): Promise<VoiceDraftCreationResult | null> {
  const studentMessageSha256 = sha256TelegramContextText(input.extracted.messageText);
  const draftSha256 = sha256TelegramContextText(input.extracted.messageText);
  if (!input.promptContextSha256 || !studentMessageSha256 || !draftSha256) {
    return null;
  }

  const savedDraft = await insertTrainingPeaksReplyDraft({
    studentId: input.student.id,
    caseId: null,
    source: "telegram_command",
    actorTelegramChatId: String(input.parsedMessage.chatId),
    aiModel: input.extractionModel,
    promptContextSha256: input.promptContextSha256,
    studentMessageSha256,
    studentMessagePreview: input.transcriptPreview,
    draftSha256,
    draftText: input.extracted.messageText,
    draftPreview: buildTelegramContextTextPreview(input.extracted.messageText),
    draftCharCount: input.extracted.messageText.length,
    metadata: {
      origin: "voice",
      voice_transcript_preview: input.transcriptPreview,
      voice_command_message_id: input.voiceCommandMessageId,
      voice_batch_key: input.batchKey,
      batch_index: input.batchIndex,
      batch_total: input.batchTotal,
      recipient_query: input.extracted.recipientQuery,
      extraction_confidence: input.extracted.confidence,
      extraction_model: input.extractionModel,
      selected_from_ambiguity: input.selectedFromAmbiguity,
    },
  });

  return {
    studentName: input.student.studentName,
    draftPreview: input.extracted.messageText,
    draftIdShort: savedDraft.id.slice(0, 8),
    hasDraftText: Boolean(savedDraft.draftText?.trim()),
  };
}

type TrainingPeaksScreen =
  | "main_menu"
  | "students"
  | "student_actions"
  | "student_username_waiting"
  | "week"
  | "jobs"
  | "add_student_waiting"
  | "races";

type TrainingPeaksChatContext = {
  selectedStudentId: string | null;
  selectedStudentName: string | null;
  cancellableWeeklyJob:
    | {
        jobId: string;
        weekFrom: string;
        weekTo: string;
      }
    | null;
  screen: TrainingPeaksScreen;
  expiresAt: number;
};

type ParsedTrainingPeaksAddStudentInput = {
  studentName: string;
  trainingPeaksAthleteUrl: string;
};

type TrainingPeaksTelegramLinkContext = {
  studentId: string;
  optionsByKey: Record<string, string>;
  expiresAt: number;
};

type TrainingPeaksReplyKeyboardAction =
  | "main_menu"
  | "today"
  | "students"
  | "add_student_help"
  | "reports_menu"
  | "week_menu"
  | "races_menu"
  | "jobs"
  | "cases_recent"
  | "more_menu"
  | "back"
  | "students_back"
  | "week_last"
  | "week_current"
  | "races_next_week"
  | "races_7_days"
  | "races_30_days"
  | "races_to_august"
  | "jobs_refresh"
  | "cancel_job"
  | "actions"
  | "signals"
  | "billing_hint"
  | "student_report"
  | "student_link"
  | "student_username"
  | "student_link_code"
  | "student_test"
  | "student_disable"
  | "student_enable";

type TrainingPeaksCaseListItem = Awaited<ReturnType<typeof listTrainingPeaksCoachCases>>["items"][number];

const trainingPeaksChatContextByChatId = new Map<string, TrainingPeaksChatContext>();
const trainingPeaksTelegramLinkContextByChatId = new Map<string, TrainingPeaksTelegramLinkContext>();
const pendingAllEnabledWeeklyRunByChatId = new Map<string, PendingAllEnabledWeeklyRunContext>();
const pendingVoicePickByKey = new Map<string, PendingVoicePickContext>();

function getTrainingPeaksCommand(text: string): TrainingPeaksCommand | null {
  if (TP_CASE_RESOLVE_V2_COMMAND_PATTERN.test(text)) {
    return "tp_case_resolve";
  }

  if (TP_CASE_DISMISS_V2_COMMAND_PATTERN.test(text)) {
    return "tp_case_dismiss";
  }

  if (TP_MAIN_COMMAND_PATTERN.test(text)) {
    return "tp";
  }

  if (TP_START_COMMAND_PATTERN.test(text)) {
    return "tp_start";
  }

  if (TP_STATUS_COMMAND_PATTERN.test(text)) {
    return "tp_status";
  }

  if (TP_STUDENTS_COMMAND_PATTERN.test(text)) {
    return "tp_students";
  }

  if (TP_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_student";
  }

  if (TP_DISABLE_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_disable_student";
  }

  if (TP_ENABLE_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_enable_student";
  }

  if (TP_ADD_COMMAND_PATTERN.test(text)) {
    return "tp_add";
  }

  if (TP_ADD_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_add_student";
  }

  if (TP_REPORT_COMMAND_PATTERN.test(text)) {
    return "tp_report";
  }

  if (TP_WEEK_COMMAND_PATTERN.test(text)) {
    return "tp_week";
  }

  if (TP_RUN_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_run_student";
  }

  if (TP_RUN_COMMAND_PATTERN.test(text)) {
    return "tp_run";
  }

  if (TP_RUN_WEEK_COMMAND_PATTERN.test(text)) {
    return "tp_run_week";
  }

  if (TP_RACES_COMMAND_PATTERN.test(text)) {
    return "tp_races";
  }

  if (TP_JOBS_COMMAND_PATTERN.test(text)) {
    return "tp_jobs";
  }

  if (TP_ATTENTION_COMMAND_PATTERN.test(text)) {
    return "tp_attention";
  }

  if (TP_SIGNALS_COMMAND_PATTERN.test(text)) {
    return "tp_signals";
  }

  if (TP_CASES_RECENT_COMMAND_PATTERN.test(text)) {
    return "tp_cases_recent";
  }

  if (TP_CASES_COMMAND_PATTERN.test(text)) {
    return "tp_cases";
  }

  if (TP_CASE_COMMAND_PATTERN.test(text)) {
    return "tp_case";
  }

  if (TP_CASE_RESOLVE_COMMAND_PATTERN.test(text) || TP_RESOLVE_CASE_COMMAND_PATTERN.test(text)) {
    return "tp_case_resolve";
  }

  if (TP_CASE_DISMISS_COMMAND_PATTERN.test(text) || TP_DISMISS_CASE_COMMAND_PATTERN.test(text)) {
    return "tp_case_dismiss";
  }

  if (TP_HEALTH_COMMAND_PATTERN.test(text)) {
    return "tp_health";
  }

  if (TP_CRON_STATUS_COMMAND_PATTERN.test(text)) {
    return "tp_cron_status";
  }

  if (TP_DIGEST_NOW_COMMAND_PATTERN.test(text)) {
    return "tp_digest_now";
  }

  if (TP_WEEKLY_COMMAND_PATTERN.test(text)) {
    return "tp_weekly";
  }

  if (TP_BUSINESS_TEST_COMMAND_PATTERN.test(text)) {
    return "tp_business_test";
  }

  if (TP_GROUP_TEST_COMMAND_PATTERN.test(text)) {
    return "tp_group_test";
  }

  if (TP_SET_TELEGRAM_COMMAND_PATTERN.test(text)) {
    return "tp_set_telegram";
  }

  if (TP_BIND_COMMAND_PATTERN.test(text)) {
    return "tp_bind";
  }

  if (TP_ACTIONS_COMMAND_PATTERN.test(text)) {
    return "tp_actions";
  }

  if (TP_CONTEXT_COMMAND_PATTERN.test(text)) {
    return "tp_context";
  }

  if (
    TP_INTENTS_COMMAND_PATTERN.test(text) ||
    TP_INTENT_LOGS_COMMAND_PATTERN.test(text) ||
    TP_UNKNOWN_INTENTS_COMMAND_PATTERN.test(text) ||
    TP_AI_INTENTS_COMMAND_PATTERN.test(text)
  ) {
    return "tp_intents";
  }

  if (TP_REPLY_DRAFT_COMMAND_PATTERN.test(text)) {
    return "tp_reply_draft";
  }

  if (TP_DRAFT_FEEDBACK_COMMAND_PATTERN.test(text)) {
    return "tp_draft_feedback";
  }

  if (TP_LINK_THREAD_COMMAND_PATTERN.test(text)) {
    return "tp_link_thread";
  }

  if (TP_THREAD_INFO_COMMAND_PATTERN.test(text)) {
    return "tp_thread_info";
  }

  if (TP_UNLINK_THREAD_COMMAND_PATTERN.test(text)) {
    return "tp_unlink_thread";
  }

  if (TP_COMMAND_PATTERN.test(text)) {
    return "unknown";
  }

  return null;
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatWeek(week: TrainingPeaksWeek): string {
  return `${formatShortDate(week.weekFrom)} — ${formatShortDate(week.weekTo)}`;
}

function formatWeekIso(week: TrainingPeaksWeek): string {
  return `${week.weekFrom} — ${week.weekTo}`;
}

function formatShortDate(value: string): string {
  return SHORT_DATE_FORMATTER.format(new Date(`${value}T00:00:00Z`)).replace(/\.$/, "");
}

function formatLongDate(value: string): string {
  return LONG_DATE_FORMATTER.format(new Date(`${value}T00:00:00Z`)).replace(/\.$/, "");
}

function getBelgradeDateParts(value: Date): { year: number; month: number; day: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TP_RACES_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "");
  const weekdayRaw = (parts.find((part) => part.type === "weekday")?.value ?? "").toLowerCase();
  const weekdayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const weekday = weekdayMap[weekdayRaw];
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || weekday === undefined) {
    throw new Error(`Unable to derive Belgrade date parts for ${value.toISOString()}`);
  }
  return { year, month, day, weekday };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addBelgradeDaysIso(isoDate: string, days: number): string {
  const match = isoDate.match(ISO_YMD_PATTERN);
  if (!match) {
    return isoDate;
  }
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  const parts = getBelgradeDateParts(shifted);
  return toIsoDate(parts.year, parts.month, parts.day);
}

function getBelgradeTodayIso(): string {
  const parts = getBelgradeDateParts(new Date());
  return toIsoDate(parts.year, parts.month, parts.day);
}

function getStatusLabel(status: string): string {
  if (status === "ready") {
    return "готов";
  }

  if (status === "parsed_only") {
    return "только данные";
  }

  return "нет данных";
}

function getStatusEmoji(status: string): string {
  if (status === "ready") {
    return "✅";
  }

  if (status === "parsed_only") {
    return "⚠️";
  }

  return "❌";
}

function getStatusDetails(status: string): string {
  if (status === "ready") {
    return " (отчёт есть)";
  }

  if (status === "parsed_only") {
    return " (нет отчёта)";
  }

  return "";
}

function splitTelegramMessage(text: string): string[] {
  const normalizedText = text.trim();

  if (normalizedText.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [normalizedText];
  }

  const chunks: string[] = [];
  let rest = normalizedText;

  while (rest.length > 0) {
    if (rest.length <= TELEGRAM_MESSAGE_LIMIT) {
      chunks.push(rest);
      break;
    }

    let boundary = rest.lastIndexOf("\n\n", TELEGRAM_MESSAGE_LIMIT);
    if (boundary < Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5)) {
      boundary = rest.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    }
    if (boundary < Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5)) {
      boundary = rest.lastIndexOf(" ", TELEGRAM_MESSAGE_LIMIT);
    }
    if (boundary <= 0) {
      boundary = TELEGRAM_MESSAGE_LIMIT;
    }

    chunks.push(rest.slice(0, boundary).trimEnd());
    rest = rest.slice(boundary).trimStart();
  }

  return chunks.filter(Boolean);
}

function getTrainingPeaksChatContext(chatId: number | string): TrainingPeaksChatContext | null {
  const state = getTrainingPeaksChatContextState(chatId);
  return state.kind === "active" ? state.context : null;
}

function getTrainingPeaksChatContextState(
  chatId: number | string
):
  | { kind: "missing" }
  | { kind: "active"; context: TrainingPeaksChatContext }
  | { kind: "expired"; context: TrainingPeaksChatContext } {
  const context = trainingPeaksChatContextByChatId.get(String(chatId));

  if (!context) {
    return { kind: "missing" };
  }

  if (context.expiresAt <= Date.now()) {
    trainingPeaksChatContextByChatId.delete(String(chatId));
    return { kind: "expired", context };
  }

  return { kind: "active", context };
}

function clearTrainingPeaksChatContext(chatId: number | string): void {
  trainingPeaksChatContextByChatId.delete(String(chatId));
}

function getTrainingPeaksTelegramLinkContext(
  chatId: number | string
): TrainingPeaksTelegramLinkContext | null {
  const context = trainingPeaksTelegramLinkContextByChatId.get(String(chatId));

  if (!context) {
    return null;
  }

  if (context.expiresAt <= Date.now()) {
    trainingPeaksTelegramLinkContextByChatId.delete(String(chatId));
    return null;
  }

  return context;
}

function setTrainingPeaksTelegramLinkContext(
  chatId: number | string,
  studentId: string,
  optionsByKey: Record<string, string>
): void {
  trainingPeaksTelegramLinkContextByChatId.set(String(chatId), {
    studentId,
    optionsByKey,
    expiresAt: Date.now() + TP_TELEGRAM_LINK_OPTIONS_TTL_MS,
  });
}

function clearTrainingPeaksTelegramLinkContext(chatId: number | string): void {
  trainingPeaksTelegramLinkContextByChatId.delete(String(chatId));
}

function setTrainingPeaksChatContextWithTtl(
  chatId: number | string,
  context: Omit<TrainingPeaksChatContext, "expiresAt">,
  expiresInMs: number
): void {
  trainingPeaksChatContextByChatId.set(String(chatId), {
    ...context,
    expiresAt: Date.now() + expiresInMs,
  });
}

function setTrainingPeaksChatContext(
  chatId: number | string,
  context: Omit<TrainingPeaksChatContext, "expiresAt">
): void {
  setTrainingPeaksChatContextWithTtl(chatId, context, TP_CHAT_CONTEXT_TTL_MS);
}

function setTrainingPeaksAddStudentWaitingContext(chatId: number | string): void {
  setTrainingPeaksChatContextWithTtl(
    chatId,
    {
      selectedStudentId: null,
      selectedStudentName: null,
      cancellableWeeklyJob: null,
      screen: "add_student_waiting",
    },
    TP_ADD_STUDENT_WAITING_TTL_MS
  );
}

function setTrainingPeaksUsernameWaitingContext(
  chatId: number | string,
  studentId: string,
  studentName: string
): void {
  setTrainingPeaksChatContextWithTtl(
    chatId,
    {
      selectedStudentId: studentId,
      selectedStudentName: studentName,
      cancellableWeeklyJob: null,
      screen: "student_username_waiting",
    },
    TP_TELEGRAM_USERNAME_WAITING_TTL_MS
  );
}

function setTrainingPeaksScreenContext(
  chatId: number | string,
  screen: TrainingPeaksScreen,
  options?: {
    selectedStudentId?: string | null;
    selectedStudentName?: string | null;
  }
): void {
  const currentContext = getTrainingPeaksChatContext(chatId);

  setTrainingPeaksChatContext(chatId, {
    selectedStudentId:
      options && "selectedStudentId" in options
        ? options.selectedStudentId ?? null
        : currentContext?.selectedStudentId ?? null,
    selectedStudentName:
      options && "selectedStudentName" in options
        ? options.selectedStudentName ?? null
        : currentContext?.selectedStudentName ?? null,
    cancellableWeeklyJob: currentContext?.cancellableWeeklyJob ?? null,
    screen,
  });
}

function clearTrainingPeaksSelectedStudent(chatId: number | string, screen: TrainingPeaksScreen): void {
  setTrainingPeaksChatContext(chatId, {
    selectedStudentId: null,
    selectedStudentName: null,
    cancellableWeeklyJob: null,
    screen,
  });
}

function setTrainingPeaksCancellableWeeklyJobContext(
  chatId: number | string,
  job: {
    jobId: string;
    weekFrom: string;
    weekTo: string;
  }
): void {
  const currentContext = getTrainingPeaksChatContext(chatId);
  setTrainingPeaksChatContext(chatId, {
    selectedStudentId: currentContext?.selectedStudentId ?? null,
    selectedStudentName: currentContext?.selectedStudentName ?? null,
    cancellableWeeklyJob: job,
    screen: currentContext?.screen ?? "week",
  });
}

function clearTrainingPeaksCancellableWeeklyJobContext(chatId: number | string): void {
  const currentContext = getTrainingPeaksChatContext(chatId);

  if (!currentContext) {
    return;
  }

  setTrainingPeaksChatContext(chatId, {
    selectedStudentId: currentContext.selectedStudentId,
    selectedStudentName: currentContext.selectedStudentName,
    cancellableWeeklyJob: null,
    screen: currentContext.screen,
  });
}

function getTrainingPeaksCancellableWeeklyJobContext(chatId: number | string): {
  jobId: string;
  weekFrom: string;
  weekTo: string;
} | null {
  return getTrainingPeaksChatContext(chatId)?.cancellableWeeklyJob ?? null;
}

function setPendingAllEnabledWeeklyRunContext(
  chatId: number | string,
  context: Omit<PendingAllEnabledWeeklyRunContext, "expiresAt">
): void {
  pendingAllEnabledWeeklyRunByChatId.set(String(chatId), {
    ...context,
    expiresAt: Date.now() + TP_PENDING_ALL_ENABLED_WEEKLY_RUN_TTL_MS,
  });
}

function getPendingAllEnabledWeeklyRunContext(
  chatId: number | string
): PendingAllEnabledWeeklyRunContext | null {
  const context = pendingAllEnabledWeeklyRunByChatId.get(String(chatId));

  if (!context) {
    return null;
  }

  if (context.expiresAt <= Date.now()) {
    pendingAllEnabledWeeklyRunByChatId.delete(String(chatId));
    return null;
  }

  return context;
}

function clearPendingAllEnabledWeeklyRunContext(chatId: number | string): void {
  pendingAllEnabledWeeklyRunByChatId.delete(String(chatId));
}

function setPendingVoicePickContext(
  key: string,
  context: Omit<PendingVoicePickContext, "expiresAt">
): void {
  pendingVoicePickByKey.set(key, {
    ...context,
    expiresAt: Date.now() + TP_PENDING_VOICE_PICK_TTL_MS,
  });
}

function getPendingVoicePickContext(key: string): PendingVoicePickContext | null {
  const context = pendingVoicePickByKey.get(key) ?? null;
  if (!context) {
    return null;
  }
  if (context.expiresAt <= Date.now()) {
    pendingVoicePickByKey.delete(key);
    return null;
  }
  return context;
}

function clearPendingVoicePickContext(key: string): void {
  pendingVoicePickByKey.delete(key);
}

async function sendTrainingPeaksMessage(
  chatId: number | string,
  text: string,
  options?: {
    replyMarkup?: TelegramReplyKeyboardMarkup | TelegramInlineKeyboardMarkup;
    messageThreadId?: number;
  }
): Promise<void> {
  const chunks = splitTelegramMessage(text);

  for (const [index, chunk] of chunks.entries()) {
    await sendTelegramMessage(chatId, chunk, {
      replyMarkup: index === chunks.length - 1 ? options?.replyMarkup : undefined,
      messageThreadId: options?.messageThreadId,
    });
  }
}

function buildTrainingPeaksAttentionMessages(
  snapshot: Awaited<ReturnType<typeof getTrainingPeaksAttentionSnapshot>>
): string[] {
  return buildTrainingPeaksAttentionDigestMessages(
    snapshot,
    "🌅 Внимание на сегодня",
    TELEGRAM_SAFE_MESSAGE_LIMIT,
    { htmlSafe: true }
  );
}

async function sendTrainingPeaksAttentionMessages(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  messages: string[],
  markup: TelegramInlineKeyboardMarkup
): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  if (parsedMessage.kind === "callback_query") {
    await editTelegramMessageTextStrict(parsedMessage.chatId, parsedMessage.messageId, messages[0], {
      replyMarkup: markup,
      parseMode: "HTML",
    });

    for (const message of messages.slice(1)) {
      await sendTelegramMessageStrict(parsedMessage.chatId, message, {
        parseMode: "HTML",
      });
    }
    return;
  }

  for (const [index, message] of messages.entries()) {
    await sendTelegramMessageStrict(parsedMessage.chatId, message, {
      replyMarkup: index === messages.length - 1 ? markup : undefined,
      parseMode: "HTML",
    });
  }
}

async function sendTrainingPeaksAttentionLengthFallback(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  markup: TelegramInlineKeyboardMarkup
): Promise<void> {
  try {
    if (parsedMessage.kind === "callback_query") {
      await editTelegramMessageTextStrict(
        parsedMessage.chatId,
        parsedMessage.messageId,
        TP_ATTENTION_FALLBACK_TOO_LONG_MESSAGE,
        {
          replyMarkup: markup,
        }
      );
      return;
    }

    await sendTelegramMessageStrict(parsedMessage.chatId, TP_ATTENTION_FALLBACK_TOO_LONG_MESSAGE);
  } catch (fallbackError) {
    console.error("trainingpeaks_attention_too_long_fallback_failed", {
      error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      updateKind: parsedMessage.kind,
      chatId: parsedMessage.chatId,
    });
  }
}

function createMenuButton(text: string, callbackData: string): TrainingPeaksMenuButton {
  return {
    text,
    callback_data: callbackData,
  };
}

function createInlineKeyboardMarkup(
  rows: TrainingPeaksMenuButton[][]
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: rows,
  };
}

function createSafeVoicePickKey(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function createVoicePickCallbackData(key: string, candidateIndex: number): string {
  return `${TP_CALLBACK_VOICE_PICK_PREFIX}${key}:${candidateIndex}`;
}

function createReplyKeyboardMarkup(rows: string[][]): TelegramReplyKeyboardMarkup {
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text }))),
    resize_keyboard: true,
    is_persistent: true,
  };
}

function matchVoiceRecipientToStudent(
  extracted: ExtractedVoiceStudentMessage,
  students: TrainingPeaksRegistryStudentSnapshot[]
): VoiceStudentMatchResult {
  const matched = matchStudentByIdentity({
    query: extracted.recipientQuery,
    students,
    forceAmbiguousForFirstNameOnly: true,
    buildIdentities: (student) => [
      {
        value: student.studentName,
        kind: "trainingpeaks_name",
        weight: 1,
      },
      {
        value: student.studentId,
        kind: "trainingpeaks_id",
        weight: 1,
      },
      {
        value: student.telegramUsername,
        kind: "telegram_username",
        weight: 1.1,
      },
      // TODO: TrainingPeaksRegistryStudentSnapshot currently does not expose Telegram Business display name.
      // Add a safe identity aggregator source before using telegram_display_name here.
    ],
  });

  const toCandidateView = (
    candidates: Array<{
      student: TrainingPeaksRegistryStudentSnapshot;
      score: number;
      matchedBy: string;
      matchedValuePreview: string;
    }>
  ) =>
    candidates.map((candidate) => ({
      id: candidate.student.id,
      studentId: candidate.student.studentId,
      studentName: candidate.student.studentName,
      score: candidate.score,
      matchedBy: candidate.matchedBy,
      matchedValuePreview: candidate.matchedValuePreview,
    }));

  if (matched.status === "unmatched") {
    return {
      extracted,
      status: "unmatched",
      student: null,
      candidates: toCandidateView(matched.candidates),
    };
  }

  if (matched.status === "ambiguous") {
    return {
      extracted,
      status: "ambiguous",
      student: null,
      candidates: toCandidateView(matched.candidates),
    };
  }

  return {
    extracted,
    status: "matched",
    student: matched.student,
    candidates: [
      {
        id: matched.student.id,
        studentId: matched.student.studentId,
        studentName: matched.student.studentName,
        score: matched.score,
        matchedBy: matched.matchedBy,
        matchedValuePreview: matched.matchedValuePreview,
      },
    ],
  };
}

function getVoiceAmbiguousPickMarkup(input: {
  key: string;
  candidates: Array<{ id: string; studentName: string; studentId: string }>;
}): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = input.candidates.slice(0, 4).map((candidate, index) => [
    createMenuButton(
      truncateTelegramLabel(`${candidate.studentName} (${candidate.studentId})`, 64),
      createVoicePickCallbackData(input.key, index)
    ),
  ]);
  rows.push([createMenuButton("Никого из них", `${TP_CALLBACK_VOICE_PICK_NONE_PREFIX}${input.key}`)]);
  rows.push([createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]);
  return createInlineKeyboardMarkup(rows);
}

function getVoiceDraftPreviewMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
    [createMenuButton("✉️ Черновики", TP_CALLBACK_REPLY_DRAFT_HINT)],
    [createMenuButton("❌ Закрыть", TP_CALLBACK_VOICE_DRAFTS_CLOSE)],
  ]);
}

function getReplyDraftPreviewMarkup(draftIdShort: string, includeSend: boolean): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = [];
  if (includeSend) {
    rows.push([createMenuButton("✅ Отправить", `${TP_CALLBACK_REPLY_DRAFT_SEND_PREFIX}${draftIdShort}`)]);
  }
  rows.push([createMenuButton("❌ Отменить", `${TP_CALLBACK_REPLY_DRAFT_CANCEL_PREFIX}${draftIdShort}`)]);
  rows.push([createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]);
  return createInlineKeyboardMarkup(rows);
}

function getReplyDraftFinalMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getVoicePickNoneMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
    [createMenuButton("❌ Закрыть", TP_CALLBACK_VOICE_DRAFTS_CLOSE)],
  ]);
}

function formatVoiceExtractionNoMessagesText(transcript: string): string {
  return [
    "Я расшифровал голосовое, но не нашёл понятных сообщений ученикам.",
    "",
    "Расшифровка:",
    `«${transcript}»`,
    "",
    "Скажи, например: “Напиши Маше: ...”",
  ].join("\n");
}

function formatVoiceMatchIssuesText(matchResults: VoiceStudentMatchResult[]): string {
  const issueLines = matchResults
    .filter((item) => item.status !== "matched")
    .map((item) => {
      if (item.status === "ambiguous") {
        const candidatesText = item.candidates
          .slice(0, 4)
          .map(
            (candidate) =>
              `${candidate.studentName} (${candidate.studentId}; ${candidate.matchedBy}; ${candidate.matchedValuePreview})`
          )
          .join(", ");
        return `- «${item.extracted.recipientQuery}» — найдено несколько: ${candidatesText}`;
      }
      if (item.candidates.length > 0) {
        const weakCandidates = item.candidates
          .slice(0, 3)
          .map(
            (candidate) =>
              `${candidate.studentName} (${candidate.studentId}; ${candidate.matchedBy}; ${candidate.matchedValuePreview})`
          )
          .join(", ");
        return `- «${item.extracted.recipientQuery}» — ученик не найден (слабые совпадения: ${weakCandidates})`;
      }
      return `- «${item.extracted.recipientQuery}» — ученик не найден`;
    });

  if (issueLines.length === 0) {
    return "";
  }

  return [
    "Не смог уверенно сопоставить:",
    ...issueLines,
    "",
    "Черновики созданы только для уверенно найденных учеников.",
  ].join("\n");
}

function formatVoiceDraftsCreatedText(input: {
  createdDrafts: VoiceDraftCreationResult[];
  transcript: string;
}): string {
  const draftItems = input.createdDrafts.map((item, index) =>
    [`${index + 1}. ${item.studentName}`, `«${item.draftPreview}»`].join("\n")
  );

  return [
    "🎤 Голосовая команда разобрана.",
    "",
    "Расшифровка:",
    `«${input.transcript}»`,
    "",
    `Создано черновиков: ${input.createdDrafts.length}`,
    "",
    ...draftItems.flatMap((item, index) => (index === 0 ? [item] : ["", item])),
    "",
    "Пока я ничего не отправляю ученикам без явного подтверждения.",
  ].join("\n");
}

function getTrainingPeaksMainReplyKeyboardMarkup(): TelegramReplyKeyboardMarkup {
  return createReplyKeyboardMarkup([
    [TP_REPLY_BUTTON_TODAY, TP_REPLY_BUTTON_SIGNALS],
    [TP_REPLY_BUTTON_CASES, TP_REPLY_BUTTON_ACTIONS],
    [TP_REPLY_BUTTON_REPORTS, TP_REPLY_BUTTON_STUDENTS],
    [TP_REPLY_BUTTON_PAYMENTS, TP_REPLY_BUTTON_SERVICE],
  ]);
}

async function sendTrainingPeaksReplyScreen(
  chatId: number | string,
  text: string,
  replyMarkup: TelegramReplyKeyboardMarkup
): Promise<void> {
  await sendTrainingPeaksMessage(chatId, text, {
    replyMarkup,
  });
}

function isVoiceCommandsEnabled(): boolean {
  return process.env.VOICE_COMMANDS_ENABLED === "true";
}

function isPrivateTelegramChat(parsedMessage: ParsedTelegramMessageUpdate): boolean {
  return parsedMessage.userId !== null && String(parsedMessage.chatId) === String(parsedMessage.userId);
}

async function handleTrainingPeaksCoachVoiceTranscription(
  parsedMessage: ParsedTelegramMessageUpdate
): Promise<"handled" | "ignored"> {
  if (!parsedMessage.voiceFileId) {
    return "ignored";
  }

  if (!isCoachChat(parsedMessage.chatId) || !isPrivateTelegramChat(parsedMessage)) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return "handled";
  }

  if (!isVoiceCommandsEnabled()) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, VOICE_COMMANDS_DISABLED_MESSAGE);
    return "handled";
  }

  try {
    await sendTrainingPeaksMessage(parsedMessage.chatId, VOICE_TRANSCRIPTION_IN_PROGRESS_MESSAGE);

    const audioBuffer = await downloadTelegramFile(parsedMessage.voiceFileId);
    const transcript = await transcribeTelegramVoiceMessage({
      audioBuffer,
      mimeType: parsedMessage.voiceMimeType,
      fileName: parsedMessage.voiceKind === "audio" ? "audio-message" : "voice-message",
    });
    const extractionResult = await extractStudentMessagesFromVoiceTranscriptDetailed({
      transcript,
    });

    if (extractionResult.messages.length === 0) {
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        formatVoiceExtractionNoMessagesText(transcript),
        {
          replyMarkup: getVoiceDraftPreviewMarkup(),
        }
      );
      return "handled";
    }

    const studentsRegistry = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
    const activeStudents = studentsRegistry.filter((student) => student.isActive);
    if (activeStudents.length === 0) {
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        [
          "Расшифровал голосовое, но сейчас нет активных учеников для сопоставления.",
          "",
          "Ничего не отправлено и черновики не созданы.",
        ].join("\n"),
        {
          replyMarkup: getVoiceDraftPreviewMarkup(),
        }
      );
      return "handled";
    }

    const matchResults = extractionResult.messages.map((message) =>
      matchVoiceRecipientToStudent(message, activeStudents)
    );
    const matchedResults = matchResults.filter((item) => item.status === "matched" && item.student);

    const batchKey = randomUUID().slice(0, 8);
    const transcriptPreview = buildTelegramContextTextPreview(transcript) ?? transcript.slice(0, 120);
    const promptContextSha256 = sha256TelegramContextText(transcript);
    if (!promptContextSha256) {
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        "Не удалось подготовить безопасный контекст для черновика. Повтори команду.",
        {
          replyMarkup: getVoiceDraftPreviewMarkup(),
        }
      );
      return "handled";
    }
    const batchTotal = matchedResults.length;
    const createdDrafts: VoiceDraftCreationResult[] = [];

    let draftInsertFailed = false;
    for (const [index, match] of matchedResults.entries()) {
      const student = match.student;
      if (!student) {
        continue;
      }
      try {
        const created = await createVoiceDraftFromMatch({
          parsedMessage,
          student,
          extracted: match.extracted,
          promptContextSha256,
          transcriptPreview,
          extractionModel: extractionResult.model,
          batchKey,
          batchIndex: index + 1,
          batchTotal,
          selectedFromAmbiguity: false,
          voiceCommandMessageId:
            parsedMessage.messageId !== null && parsedMessage.messageId !== undefined
              ? String(parsedMessage.messageId)
              : null,
        });
        if (created) {
          createdDrafts.push(created);
        }
      } catch {
        draftInsertFailed = true;
      }
    }

    const ambiguousResults = matchResults.filter((item) => item.status === "ambiguous");
    const voiceCommandMessageId =
      parsedMessage.messageId !== null && parsedMessage.messageId !== undefined
        ? String(parsedMessage.messageId)
        : null;
    for (const ambiguous of ambiguousResults) {
      const key = createSafeVoicePickKey();
      setPendingVoicePickContext(key, {
        chatId: String(parsedMessage.chatId),
        recipientQuery: ambiguous.extracted.recipientQuery,
        messageText: ambiguous.extracted.messageText,
        confidence: ambiguous.extracted.confidence,
        extractionModel: extractionResult.model,
        promptContextSha256,
        transcriptPreview,
        voiceCommandMessageId,
        candidateStudentIds: ambiguous.candidates.map((candidate) => candidate.id).slice(0, 4),
      });
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        `Кого ты имел в виду под «${ambiguous.extracted.recipientQuery}»?`,
        {
          replyMarkup: getVoiceAmbiguousPickMarkup({
            key,
            candidates: ambiguous.candidates.map((candidate) => ({
              id: candidate.id,
              studentName: candidate.studentName,
              studentId: candidate.studentId,
            })),
          }),
        }
      );
    }

    const hasOnlyAmbiguousResults = ambiguousResults.length > 0 && matchResults.every((item) => item.status === "ambiguous");
    if (createdDrafts.length === 0) {
      if (hasOnlyAmbiguousResults) {
        await sendTrainingPeaksMessage(
          parsedMessage.chatId,
          [
            "Нужно уточнение, чтобы создать черновик.",
            "Выбери ученика кнопкой ниже.",
            "",
            "Ничего не отправлено ученикам.",
          ].join("\n"),
          {
            replyMarkup: getVoiceDraftPreviewMarkup(),
          }
        );
        return "handled";
      }
      const issuesText = formatVoiceMatchIssuesText(matchResults);
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        [
          "Расшифровал голосовое, но не смог создать черновики.",
          issuesText,
          "",
          "Ничего не отправлено ученикам.",
        ]
          .filter((line) => line !== "")
          .join("\n"),
        {
          replyMarkup: getVoiceDraftPreviewMarkup(),
        }
      );
      return "handled";
    }

    const previewParts: string[] = [formatVoiceDraftsCreatedText({ createdDrafts, transcript })];
    const issuesText = formatVoiceMatchIssuesText(matchResults);
    if (issuesText) {
      previewParts.push("", issuesText);
    }
    if (draftInsertFailed) {
      previewParts.push(
        "",
        "⚠️ Для части сообщений черновики не сохранились. Повтори голосовую команду или используй /tp_reply_draft."
      );
    }

    await sendTrainingPeaksMessage(parsedMessage.chatId, previewParts.join("\n"), {
      replyMarkup: getVoiceDraftPreviewMarkup(),
    });
  } catch (error) {
    const isExtractionError =
      error instanceof Error &&
      (error.message.includes("Voice command extraction") ||
        error.message.includes("Voice extraction payload") ||
        error.message.includes("OPENAI_API_KEY"));

    console.warn("TrainingPeaks voice transcription failed", {
      chatId: parsedMessage.chatId,
      messageId: parsedMessage.messageId,
      voiceKind: parsedMessage.voiceKind,
      voiceDuration: parsedMessage.voiceDuration,
      stage: isExtractionError ? "voice_extraction" : "voice_transcription",
      error: error instanceof Error ? error.message : "Unknown voice transcription error",
    });
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      isExtractionError ? VOICE_EXTRACTION_FAILED_MESSAGE : VOICE_TRANSCRIPTION_FAILED_MESSAGE,
      {
        replyMarkup: getVoiceDraftPreviewMarkup(),
      }
    );
  }

  return "handled";
}

async function sendTrainingPeaksMenuMessage(
  chatId: number | string,
  text: string,
  replyMarkup: TelegramInlineKeyboardMarkup
): Promise<void> {
  await sendTelegramMessage(chatId, text, {
    replyMarkup,
  });
}

async function editTrainingPeaksMenuMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup: TelegramInlineKeyboardMarkup
): Promise<void> {
  await editTelegramMessageText(chatId, messageId, text, {
    replyMarkup,
  });
}

async function showTrainingPeaksMenuScreen(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  text: string,
  replyMarkup: TelegramInlineKeyboardMarkup
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, replyMarkup);
    return;
  }

  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, text, replyMarkup);
}

function parseWeekArgs(
  tokens: string[],
  usageExample: string
): { week: TrainingPeaksWeek | null; error: string | null } {
  if (tokens.length === 0) {
    return { week: null, error: null };
  }

  if (tokens.length !== 2) {
    return {
      week: null,
      error: `Напиши так: ${usageExample}`,
    };
  }

  const [weekFrom, weekTo] = tokens;

  if (!isIsoDate(weekFrom) || !isIsoDate(weekTo)) {
    return {
      week: null,
      error: "Неделю нужно передать в формате YYYY-MM-DD YYYY-MM-DD.",
    };
  }

  if (weekFrom > weekTo) {
    return {
      week: null,
      error: "Дата начала недели не может быть позже даты окончания.",
    };
  }

  return {
    week: { weekFrom, weekTo },
    error: null,
  };
}

function parseStatusCommandWeek(text: string): { week: TrainingPeaksWeek | null; error: string | null } {
  const args = text.replace(TP_STATUS_COMMAND_PATTERN, "").trim();
  return parseWeekArgs(args ? args.split(/\s+/) : [], "/tp_status 2026-04-27 2026-05-03");
}

function parseRacesCommandPeriod(text: string): {
  fromDate: string | null;
  toDate: string | null;
  error: string | null;
} {
  const args = text.replace(TP_RACES_COMMAND_PATTERN, "").trim();
  if (!args) {
    return { fromDate: null, toDate: null, error: null };
  }
  const tokens = args.split(/\s+/);
  if (tokens.length !== 2) {
    return {
      fromDate: null,
      toDate: null,
      error: "Напиши так: /tp_races 2026-05-17 2026-08-01",
    };
  }
  const [fromDate, toDate] = tokens;
  if (!isIsoDate(fromDate) || !isIsoDate(toDate)) {
    return {
      fromDate: null,
      toDate: null,
      error: "Период нужно передать в формате YYYY-MM-DD YYYY-MM-DD.",
    };
  }
  if (fromDate > toDate) {
    return {
      fromDate: null,
      toDate: null,
      error: "Дата начала периода не может быть позже даты окончания.",
    };
  }
  return { fromDate, toDate, error: null };
}

function parseReportCommand(text: string): {
  studentQuery: string | null;
  week: TrainingPeaksWeek | null;
  error: string | null;
} {
  const args = text.replace(TP_REPORT_COMMAND_PATTERN, "").trim();

  if (!args) {
    return {
      studentQuery: null,
      week: null,
      error: "Напиши так: /tp_report Olga, /tp_report Olga last или /tp_report Olga 2026-04-27 2026-05-03",
    };
  }

  const tokens = args.split(/\s+/);
  const lastToken = tokens[tokens.length - 1] ?? "";
  const beforeLastToken = tokens[tokens.length - 2] ?? "";

  if (tokens.length >= 3 && isIsoDate(beforeLastToken) && isIsoDate(lastToken)) {
    const studentQuery = tokens.slice(0, -2).join(" ").trim();
    const { week, error } = parseWeekArgs(
      [beforeLastToken, lastToken],
      "/tp_report Olga 2026-04-27 2026-05-03"
    );

    if (!studentQuery) {
      return {
        studentQuery: null,
        week: null,
        error: "После /tp_report нужно указать ученика.",
      };
    }

    return {
      studentQuery,
      week,
      error,
    };
  }

  if (tokens.length >= 2) {
    const resolvedWeek = resolveTrainingPeaksWeekKeyword(lastToken);

    if (resolvedWeek) {
      const studentQuery = tokens.slice(0, -1).join(" ").trim();

      if (!studentQuery) {
        return {
          studentQuery: null,
          week: null,
          error: "После /tp_report нужно указать ученика.",
        };
      }

      return {
        studentQuery,
        week: resolvedWeek,
        error: null,
      };
    }
  }

  return {
    studentQuery: args,
    week: null,
    error: null,
  };
}

function parseAddStudentCommand(text: string): string {
  if (TP_ADD_COMMAND_PATTERN.test(text)) {
    return text.replace(TP_ADD_COMMAND_PATTERN, "").trim();
  }

  return text.replace(TP_ADD_STUDENT_COMMAND_PATTERN, "").trim();
}

function parseTrainingPeaksAddStudentInput(rawInput: string): ParsedTrainingPeaksAddStudentInput {
  const normalizedInput = parseAddStudentCommand(rawInput);
  const urlMatch = normalizedInput.match(TP_TRAININGPEAKS_URL_PATTERN);

  if (!urlMatch || typeof urlMatch.index !== "number") {
    return {
      studentName: normalizedInput.replace(/\|\s*$/, "").trim(),
      trainingPeaksAthleteUrl: "",
    };
  }

  return {
    studentName: normalizedInput
      .slice(0, urlMatch.index)
      .replace(/\|\s*$/, "")
      .trim(),
    trainingPeaksAthleteUrl: urlMatch[0].trim(),
  };
}

function normalizeTrainingPeaksAddStudentInput(rawInput: string): string {
  const parsedInput = parseTrainingPeaksAddStudentInput(rawInput);
  return `${parsedInput.studentName} | ${parsedInput.trainingPeaksAthleteUrl}`;
}

function getTpAddStudentNamePreview(rawInput: string): string {
  return parseTrainingPeaksAddStudentInput(rawInput).studentName;
}

function getAddStudentMissingUrlMessage(): string {
  return [
    TP_ADD_STUDENT_DEPRECATED_MESSAGE,
    "",
    "Не вижу ссылку TrainingPeaks.",
    "",
    "Legacy fallback:",
    `/tp_add_student ${TP_ADD_STUDENT_EXAMPLE}`,
  ].join("\n");
}

function getAddStudentMissingNameMessage(): string {
  return [
    TP_ADD_STUDENT_DEPRECATED_MESSAGE,
    "",
    "Не вижу имя ученика.",
    "",
    "Legacy fallback:",
    `/tp_add_student ${TP_ADD_STUDENT_EXAMPLE}`,
  ].join("\n");
}

function getAddStudentExpiredMessage(): string {
  return `${TP_ADD_STUDENT_DEPRECATED_MESSAGE}\n\nОткрой Web Admin или повтори legacy-команду /tp_add_student.`;
}

function normalizeTpRunCommand(text: string): string {
  const args = text.replace(TP_RUN_COMMAND_PATTERN, "").trim();
  return args ? `/tp_run_week ${args}` : "/tp_run_week";
}

function parseTpBusinessTestChatId(text: string): string | null {
  const args = text.replace(TP_BUSINESS_TEST_COMMAND_PATTERN, "").trim();

  if (!args) {
    return null;
  }

  const tokens = args.split(/\s+/);

  if (tokens.length !== 1) {
    return null;
  }

  return /^-?\d+$/.test(tokens[0] ?? "") ? tokens[0]! : null;
}

function parseTpSetTelegramCommand(text: string): {
  studentId: string | null;
  chatId: string | null;
  username: string | null;
} {
  const args = text.replace(TP_SET_TELEGRAM_COMMAND_PATTERN, "").trim();

  if (!args) {
    return {
      studentId: null,
      chatId: null,
      username: null,
    };
  }

  const tokens = args.split(/\s+/);

  if (tokens.length < 2 || tokens.length > 3) {
    return {
      studentId: null,
      chatId: null,
      username: null,
    };
  }

  const studentId = tokens[0]?.trim() || null;
  const chatId = tokens[1]?.trim() || null;
  const rawUsername = tokens[2]?.trim() || null;
  const username = rawUsername ? rawUsername.replace(/^@/, "") || null : null;

  return {
    studentId,
    chatId,
    username,
  };
}

function parseTpBindCommand(text: string): {
  studentQuery: string | null;
  username: string | null;
} {
  const args = text.replace(TP_BIND_COMMAND_PATTERN, "").trim();

  if (!args) {
    return {
      studentQuery: null,
      username: null,
    };
  }

  const tokens = args.split(/\s+/);
  const rawUsername = tokens[tokens.length - 1]?.trim() ?? "";
  const studentQuery = tokens.slice(0, -1).join(" ").trim() || null;
  const username = normalizeTelegramUsernameLookup(rawUsername);

  return {
    studentQuery,
    username,
  };
}

function parseTpLinkThreadCommand(text: string): string | null {
  const args = text.replace(TP_LINK_THREAD_COMMAND_PATTERN, "").trim();
  return args || null;
}

function formatTpRunAliasMessage(message: string): string {
  return message.replaceAll("/tp_run_week", "/tp_run");
}

function formatStatusMessage(
  week: TrainingPeaksWeek,
  students: {
    studentName: string;
    status: string;
    hasReport: boolean;
  }[]
): string {
  return [
    `📊 Отчёты за ${formatWeek(week)}`,
    "",
    ...students.map(
      (student) =>
        `${student.studentName} — ${getStatusEmoji(student.status)} ${getStatusLabel(student.status)}${getStatusDetails(student.status)}`
    ),
  ].join("\n");
}

function parseStudentCommand(text: string): string {
  return text.replace(TP_STUDENT_COMMAND_PATTERN, "").trim();
}

function parseTpContextCommand(text: string): string {
  return text.replace(TP_CONTEXT_COMMAND_PATTERN, "").trim();
}

function parseDisableStudentCommand(text: string): string {
  return text.replace(TP_DISABLE_STUDENT_COMMAND_PATTERN, "").trim();
}

function parseEnableStudentCommand(text: string): string {
  return text.replace(TP_ENABLE_STUDENT_COMMAND_PATTERN, "").trim();
}

function parseReplyDraftCommand(text: string): {
  studentQuery: string | null;
  studentMessage: string | null;
} {
  const rawBody = text.replace(/^\/tp_reply_draft(?:@\w+)?\s*/i, "");
  const body = rawBody.trim();

  if (!body) {
    return { studentQuery: null, studentMessage: null };
  }

  const lines = body.split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? "";
  const remainingLines = lines.slice(1);
  const firstLineTokens = firstLine.split(/\s+/).filter(Boolean);
  const studentQuery = firstLineTokens[0] ?? null;

  if (!studentQuery) {
    return { studentQuery: null, studentMessage: null };
  }

  const firstLineRemainder = firstLine.slice(studentQuery.length).trim();
  const studentMessage = [firstLineRemainder, ...remainingLines].join("\n").trim();

  return {
    studentQuery,
    studentMessage: studentMessage || null,
  };
}

function getReplyDraftUsageMessage(): string {
  return [
    "Использование /tp_reply_draft:",
    "",
    "A) /tp_reply_draft",
    "alena-grill",
    "Можно сегодня перенести тренировку на пятницу?",
    "",
    "B) /tp_reply_draft alena-grill",
    "Можно сегодня перенести тренировку на пятницу?",
    "",
    "C) /tp_reply_draft alena-grill Можно сегодня перенести тренировку на пятницу?",
  ].join("\n");
}

function getReplyDraftFeedbackUsageMessage(): string {
  return [
    "Используй:",
    "/tp_draft_feedback <draft_id> used",
    "/tp_draft_feedback <draft_id> edited [заметка]",
    "/tp_draft_feedback <draft_id> ignored [заметка]",
  ].join("\n");
}

function parseReplyDraftFeedbackCommand(text: string): {
  draftIdOrPrefix: string | null;
  outcome: "used" | "edited" | "ignored" | null;
  note: string | null;
} {
  const body = text.replace(/^\/tp_draft_feedback(?:@\w+)?\s*/i, "").trim();
  if (!body) {
    return {
      draftIdOrPrefix: null,
      outcome: null,
      note: null,
    };
  }

  const [draftIdOrPrefixRaw, outcomeRaw, ...noteParts] = body.split(/\s+/);
  const normalizedOutcome = outcomeRaw?.trim().toLowerCase();
  const outcome =
    normalizedOutcome === "used" || normalizedOutcome === "edited" || normalizedOutcome === "ignored"
      ? normalizedOutcome
      : null;

  return {
    draftIdOrPrefix: draftIdOrPrefixRaw?.trim() || null,
    outcome,
    note: noteParts.join(" ").trim() || null,
  };
}

function parseTrainingPeaksCoachCaseCommand(text: string): { caseId: string | null; note: string | null } {
  const body = text
    .replace(/^\/tp(?:@\w+)?\s+case\s+(?:resolve|dismiss)\s*/i, "")
    .replace(/^\/tp_(?:case_(?:resolve|dismiss)|(?:resolve|dismiss)_case)(?:@\w+)?\s*/i, "")
    .trim();
  if (!body) {
    return { caseId: null, note: null };
  }

  const [caseIdToken, ...noteParts] = body.split(/\s+/);
  return {
    caseId: caseIdToken?.trim() || null,
    note: noteParts.join(" ").trim() || null,
  };
}

type TrainingPeaksStartPayload =
  | { kind: "case"; shortId: string }
  | { kind: "action"; actionIdOrPrefix: string }
  | { kind: "student"; studentId: string };

function parseTrainingPeaksStartPayload(text: string): TrainingPeaksStartPayload | null {
  const body = text.replace(TP_START_COMMAND_PATTERN, "").trim();
  if (!body) {
    return null;
  }

  if (body.startsWith("case_")) {
    const shortId = body.slice("case_".length).trim();
    return shortId ? { kind: "case", shortId } : null;
  }

  if (body.startsWith("action_")) {
    const actionIdOrPrefix = body.slice("action_".length).trim();
    return actionIdOrPrefix ? { kind: "action", actionIdOrPrefix } : null;
  }

  if (body.startsWith("student_")) {
    const studentId = body.slice("student_".length).trim();
    return studentId ? { kind: "student", studentId } : null;
  }

  return null;
}

type TrainingPeaksCasesQueryFilters = {
  normalizedQuery: string;
  studentQuery: string | null;
  includeNoisyKinds: boolean;
  caseKindFilter: Array<
    | "move_workout_requested"
    | "move_workout_needs_review"
    | "question_to_coach"
    | "pain_or_health_signal"
    | "unrecognized_intent"
  >;
};

const TP_CASES_ACTIVE_STATUSES = ["logged", "open", "needs_review"] as const;
const TP_CASES_PAGE_LIMIT = 5;

function parseTrainingPeaksCasesCommandQuery(text: string): string {
  return text.replace(/^\/tp_cases(?:@\w+)?\s*/i, "").trim();
}

function parseTrainingPeaksCaseCommandId(text: string): string {
  return text.replace(/^\/tp_case(?:@\w+)?\s*/i, "").trim();
}

function deriveTrainingPeaksCasesFilters(rawQuery: string): TrainingPeaksCasesQueryFilters {
  const normalizedQuery = rawQuery
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalizedQuery.length > 0 ? normalizedQuery.split(" ") : [];

  const hasMove = tokens.some((token) => token === "move" || token.startsWith("перенос"));
  const hasQuestion = tokens.some(
    (token) => token === "question" || token === "questions" || token.startsWith("вопрос")
  );
  const hasHealth = tokens.some(
    (token) => token === "health" || token.startsWith("бол") || token.startsWith("здоров")
  );
  const hasUnrecognized = tokens.some(
    (token) => token === "unrecognized" || token.startsWith("неразоб") || token.startsWith("непонят")
  );
  const includeNoisyKinds = tokens.some((token) => token === "all" || token === "debug" || token === "все");

  const caseKindFilter: TrainingPeaksCasesQueryFilters["caseKindFilter"] = [];
  if (hasMove) {
    caseKindFilter.push("move_workout_needs_review", "move_workout_requested");
  }
  if (hasQuestion) {
    caseKindFilter.push("question_to_coach");
  }
  if (hasHealth) {
    caseKindFilter.push("pain_or_health_signal");
  }
  if (hasUnrecognized) {
    caseKindFilter.push("unrecognized_intent");
  }

  const keywordRegex =
    /^(move|questions?|health|unrecognized|all|debug|перенос\p{L}*|вопрос\p{L}*|бол\p{L}*|здоров\p{L}*|неразоб\p{L}*|непонят\p{L}*|все)$/u;
  const studentTokens = tokens.filter((token) => !keywordRegex.test(token));
  const studentQuery = studentTokens.length > 0 ? studentTokens.join(" ") : null;

  return {
    normalizedQuery,
    studentQuery,
    includeNoisyKinds,
    caseKindFilter: [...new Set(caseKindFilter)],
  };
}

function getTrainingPeaksCoachCaseKindLabel(
  caseKind: TrainingPeaksCaseListItem["caseKind"]
): string {
  switch (caseKind) {
    case "question_to_coach":
      return "Вопрос тренеру";
    case "pain_or_health_signal":
      return "Самочувствие / боль";
    case "move_workout_needs_review":
      return "Перенос требует проверки";
    case "move_workout_requested":
      return "Запрос на перенос";
    case "unrecognized_intent":
      return "Нераспознанное сообщение";
    case "observation_only":
      return "Наблюдение";
    default:
      return caseKind;
  }
}

function getTrainingPeaksCoachCaseStatusLabel(
  status: TrainingPeaksCaseListItem["status"]
): string {
  switch (status) {
    case "logged":
      return "новый";
    case "open":
      return "открыт";
    case "needs_review":
      return "нужна проверка";
    default:
      return status;
  }
}

function formatTrainingPeaksCoachCaseCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function getTrainingPeaksCoachCasePreviewText(previewText: string | null): string {
  return previewText?.trim() || "без текстового превью";
}

function shouldShowCreateActionProposalsButton(
  item: TrainingPeaksCaseListItem
): boolean {
  if (item.caseKind !== "move_workout_needs_review") {
    return false;
  }
  const sourceType = typeof item.coachNotesJson.source_type === "string" ? item.coachNotesJson.source_type : null;
  if (sourceType !== "group_topic" && sourceType !== "group_general") {
    return false;
  }
  const validatedPairs = validateTrainingPeaksGroupMovePairsPreview(item.coachNotesJson.move_pairs_preview);
  if (!validatedPairs.isSafe) {
    return false;
  }
  return item.coachNotesJson.action_proposals_created !== true;
}

function formatTrainingPeaksCoachCaseCard(
  item: TrainingPeaksCaseListItem
): string {
  const lines = [
    item.studentName ?? "Без имени",
    "",
    `тип: ${getTrainingPeaksCoachCaseKindLabel(item.caseKind)}`,
    `статус: ${getTrainingPeaksCoachCaseStatusLabel(item.status)}`,
    `создано: ${formatTrainingPeaksCoachCaseCreatedAt(item.createdAt)}`,
    "",
    `Контекст:`,
    getTrainingPeaksCoachCasePreviewText(item.previewText),
  ];

  if (item.caseKind === "move_workout_needs_review") {
    const sourceType = typeof item.coachNotesJson.source_type === "string" ? item.coachNotesJson.source_type : null;
    const sourceGroupTitle =
      typeof item.coachNotesJson.group_title === "string" ? item.coachNotesJson.group_title.trim() : "";
    const sourceTopicId =
      typeof item.coachNotesJson.message_thread_id === "number" ? String(item.coachNotesJson.message_thread_id) : null;
    const sourceLabel = sourceType === "group_topic" ? "group topic" : sourceType === "group_general" ? "group" : null;
    if (sourceLabel) {
      const groupPart = sourceGroupTitle.length > 0 ? sourceGroupTitle : "без названия";
      const topicPart = sourceType === "group_topic" ? ` / topic ${sourceTopicId ?? "?"}` : "";
      lines.push(`Источник: ${sourceLabel} (${groupPart}${topicPart})`);
    }

    const multiMovePossible = item.coachNotesJson.multi_move_possible === true;
    const validatedPairs = validateTrainingPeaksGroupMovePairsPreview(item.coachNotesJson.move_pairs_preview);
    const pairs = validatedPairs.pairs.map(
      (pair) => `${formatCompactDateShort(pair.source)} → ${formatCompactDateShort(pair.target)}`
    );
    if (multiMovePossible && pairs.length > 0) {
      lines.push("", "переносы:", pairs.join("; "));
    } else if (pairs.length > 0) {
      lines.push("", "перенос:", pairs[0] ?? "—");
    }
    if (!validatedPairs.isSafe) {
      lines.push("Пары переноса разобраны неуверенно — нужна ручная проверка");
    }

    const createdActionIds = Array.isArray(item.coachNotesJson.created_action_ids)
      ? item.coachNotesJson.created_action_ids.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    if (createdActionIds.length > 0 || item.coachNotesJson.action_proposals_created === true) {
      lines.push("", "Заявки уже созданы — проверь /tp_actions");
    }
  }

  lines.push("", `#${item.shortId}`);
  return lines.join("\n");
}

function buildTrainingPeaksCasesPageCallbackData(offset: number, query: string | null): string {
  const safeOffset = Math.max(0, Math.trunc(offset));
  const normalizedQuery = query?.trim() ?? "";
  const queryPart = normalizedQuery.length > 0 ? encodeURIComponent(normalizedQuery) : "-";
  return `${TP_CALLBACK_CASES_PAGE_PREFIX}${safeOffset}:${queryPart}`;
}

function parseTrainingPeaksCasesPageCallbackData(data: string): { offset: number; query: string | null } | null {
  const rest = data.slice(TP_CALLBACK_CASES_PAGE_PREFIX.length).trim();
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex < 1) {
    return null;
  }
  const offsetPart = rest.slice(0, separatorIndex).trim();
  const rawQueryPart = rest.slice(separatorIndex + 1).trim();
  const offset = Number.parseInt(offsetPart, 10);
  if (!Number.isInteger(offset) || offset < 0) {
    return null;
  }
  if (!rawQueryPart || rawQueryPart === "-") {
    return { offset, query: null };
  }
  try {
    const query = decodeURIComponent(rawQueryPart).trim();
    return { offset, query: query.length > 0 ? query : null };
  } catch {
    return null;
  }
}

function getTrainingPeaksCasesPaginationMarkup(input: {
  offset: number;
  limit: number;
  total: number;
  query: string | null;
}): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = [];
  const navRow: TrainingPeaksMenuButton[] = [];
  if (input.offset > 0) {
    navRow.push(
      createMenuButton(
        "⬅️ Назад",
        buildTrainingPeaksCasesPageCallbackData(Math.max(0, input.offset - input.limit), input.query)
      )
    );
  }
  if (input.offset + input.limit < input.total) {
    navRow.push(
      createMenuButton("➡️ Ещё", buildTrainingPeaksCasesPageCallbackData(input.offset + input.limit, input.query))
    );
  }
  if (navRow.length > 0) {
    rows.push(navRow);
  }
  return createInlineKeyboardMarkup(rows);
}

function getTrainingPeaksCoachCaseInlineMarkup(
  item: TrainingPeaksCaseListItem
): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = [];
  if (shouldShowCreateActionProposalsButton(item)) {
    rows.push([createMenuButton("🧩 Создать заявки", `${TP_CALLBACK_CASE_PROPOSE_PREFIX}${item.shortId}`)]);
  }
  rows.push([
    createMenuButton("✅ Закрыть", `${TP_CALLBACK_CASE_RESOLVE_PREFIX}${item.shortId}`),
    createMenuButton("🙈 Скрыть", `${TP_CALLBACK_CASE_DISMISS_PREFIX}${item.shortId}`),
  ]);
  return createInlineKeyboardMarkup(rows);
}

function getTrainingPeaksCoachCaseResolvedMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([]);
}

function getTrainingPeaksCoachCasePostProposalMarkup(shortId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[
    createMenuButton("✅ Закрыть", `${TP_CALLBACK_CASE_RESOLVE_PREFIX}${shortId}`),
    createMenuButton("🙈 Скрыть", `${TP_CALLBACK_CASE_DISMISS_PREFIX}${shortId}`),
  ]]);
}

function appendTrainingPeaksCoachCaseFinalState(
  messageText: string | null,
  finalStateLine: "✓ Закрыто" | "🙈 Скрыто",
  shortId: string
): string {
  const baseText = (messageText ?? `#${shortId}`).trim();
  const lines = baseText
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && line !== "✓ Закрыто" && line !== "🙈 Скрыто");
  return [...lines, finalStateLine].join("\n");
}

async function handleTrainingPeaksCasesList(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  input?: { query?: string | null; offset?: number }
): Promise<void> {
  const rawQuery = input?.query?.trim() ?? "";
  const offset = Math.max(0, Math.trunc(input?.offset ?? 0));
  const filters = deriveTrainingPeaksCasesFilters(rawQuery);
  const hasExplicitCaseKindFilter = filters.caseKindFilter.length > 0;
  const defaultVisibleKindSet = new Set(getTrainingPeaksDefaultVisibleCoachCaseKinds());
  defaultVisibleKindSet.add("question_to_coach");
  const listCaseKindFilter = hasExplicitCaseKindFilter
    ? filters.caseKindFilter
    : filters.includeNoisyKinds
      ? undefined
      : [...defaultVisibleKindSet];
  const listResult = await listTrainingPeaksCoachCases({
    limit: TP_CASES_PAGE_LIMIT,
    offset,
    statusFilter: TP_CASES_ACTIVE_STATUSES,
    caseKindFilter: listCaseKindFilter,
    studentQuery: filters.studentQuery,
  });
  const visibleItems = hasExplicitCaseKindFilter || filters.includeNoisyKinds
    ? listResult.items
    : listResult.items.filter((item) =>
        isTrainingPeaksCoachCaseVisibleByDefault({
          caseKind: item.caseKind,
          coachNotesJson: item.coachNotesJson,
        })
      );
  const title =
    rawQuery.length > 0 ? `TP-кейсы по запросу: "${rawQuery}"` : "Последние TP-кейсы";

  if (visibleItems.length === 0) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `${title}\nПоказано 0 из ${listResult.total} активных кейсов.`
    );
    return;
  }

  const shownTo = Math.min(offset + visibleItems.length, listResult.total);
  await showTrainingPeaksMenuScreen(
    parsedMessage,
    `${title}\nПоказано ${offset + 1}-${shownTo} из ${listResult.total} активных кейсов.`,
    getTrainingPeaksCasesPaginationMarkup({
      offset,
      limit: TP_CASES_PAGE_LIMIT,
      total: listResult.total,
      query: rawQuery.length > 0 ? rawQuery : null,
    })
  );

  for (const item of visibleItems) {
    await sendTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      formatTrainingPeaksCoachCaseCard(item),
      getTrainingPeaksCoachCaseInlineMarkup(item)
    );
  }
}

async function handleTrainingPeaksRecentCoachCases(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await handleTrainingPeaksCasesList(parsedMessage, { query: null, offset: 0 });
}

async function handleTrainingPeaksCasesCommand(parsedMessage: ParsedTelegramUpdate, text: string): Promise<void> {
  const query = parseTrainingPeaksCasesCommandQuery(text);
  await handleTrainingPeaksCasesList(parsedMessage, {
    query: query.length > 0 ? query : null,
    offset: 0,
  });
}

async function handleTrainingPeaksCaseCommand(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  text: string
): Promise<void> {
  const caseIdPrefix = parseTrainingPeaksCaseCommandId(text);
  if (!caseIdPrefix) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Usage: /tp_case <short_id>");
    return;
  }

  const lookup = await getTrainingPeaksCoachCaseByShortId({ prefix: caseIdPrefix });
  if (lookup.kind === "invalid_prefix") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Некорректный ID кейса.");
    return;
  }
  if (lookup.kind === "not_found") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, `Кейс ${caseIdPrefix} не найден.`);
    return;
  }
  if (lookup.kind === "ambiguous") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Префикс ${caseIdPrefix} неоднозначен, укажи больше символов.`
    );
    return;
  }

  const item: TrainingPeaksCaseListItem = {
    id: lookup.case.id,
    shortId: lookup.case.id.slice(0, 8),
    studentId: lookup.case.studentId,
    studentName: null,
    caseKind: lookup.case.caseKind,
    status: lookup.case.status,
    createdAt: lookup.case.createdAt,
    previewText:
      typeof lookup.case.coachNotesJson.text_preview === "string" ? lookup.case.coachNotesJson.text_preview : null,
    coachNotesJson: lookup.case.coachNotesJson,
  };
  if (item.studentId) {
    const student = await getTrainingPeaksStudentById(item.studentId);
    item.studentName = student?.studentName ?? null;
  }

  await sendTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    formatTrainingPeaksCoachCaseCard(item),
    getTrainingPeaksCoachCaseInlineMarkup(item)
  );
}

async function handleTrainingPeaksCoachCaseResolveOrDismiss(
  parsedMessage: ParsedTelegramUpdate,
  text: string,
  action: "resolve" | "dismiss"
): Promise<void> {
  const parsed = parseTrainingPeaksCoachCaseCommand(text);
  if (!parsed.caseId) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      action === "resolve"
        ? "Usage: /tp case resolve <case_id>"
        : "Usage: /tp case dismiss <case_id>"
    );
    return;
  }

  const result =
    action === "resolve"
      ? await resolveTrainingPeaksCoachCase({
          caseId: parsed.caseId,
          actorTelegramChatId: String(parsedMessage.chatId),
          note: parsed.note,
        })
      : await dismissTrainingPeaksCoachCase({
          caseId: parsed.caseId,
          actorTelegramChatId: String(parsedMessage.chatId),
          note: parsed.note,
        });

  if (result.kind === "resolved" || result.kind === "dismissed") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      action === "resolve"
        ? `✓ Case ${result.shortId} resolved.`
        : `✓ Case ${result.shortId} dismissed.`
    );
    return;
  }

  if (result.kind === "invalid_prefix") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Invalid case ID.");
    return;
  }

  if (result.kind === "not_found") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Case not found.");
    return;
  }

  if (result.kind === "ambiguous") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Ambiguous case ID, use more characters.");
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    action === "resolve" ? "Error resolving case, try again." : "Error dismissing case, try again."
  );
}

async function handleTrainingPeaksCoachCaseCreateProposalsCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  shortId: string
): Promise<void> {
  const result = await createTrainingPeaksActionsFromGroupMoveCase({
    caseId: shortId,
    coachChatId: String(parsedMessage.chatId),
    coachUserId: parsedMessage.userId !== null ? String(parsedMessage.userId) : null,
  });

  if (result.kind === "created") {
    await answerTelegramCallbackQuery(
      parsedMessage.callbackQueryId,
      `✅ Созданы заявки на перенос: ${result.createdCount}. Проверь их в /tp_actions.`
    );
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      `${parsedMessage.messageText ?? `#${shortId}`}\n🧩 Заявки созданы: ${result.createdCount}`,
      getTrainingPeaksCoachCasePostProposalMarkup(shortId)
    );
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      [`✅ Созданы заявки на перенос: ${result.createdCount}. Проверь их в /tp_actions.`, ...result.summaries].join("\n")
    );
    return;
  }

  if (result.kind === "duplicate") {
    await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Заявки уже созданы. Проверь /tp_actions.");
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Заявки уже созданы. Проверь /tp_actions.");
    return;
  }

  if (result.kind === "needs_manual_review") {
    await answerTelegramCallbackQuery(
      parsedMessage.callbackQueryId,
      "Не удалось безопасно разобрать переносы. Проверь кейс вручную."
    );
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Не удалось безопасно разобрать переносы. Проверь кейс вручную.");
    return;
  }

  if (result.kind === "not_found") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, `Кейс ${shortId} не найден.`);
    return;
  }

  if (result.kind === "ambiguous_case_id") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, `Неоднозначный ID кейса ${shortId}, укажи больше символов.`);
    return;
  }

  if (result.kind === "invalid_case_id") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, `Некорректный ID кейса ${shortId}.`);
    return;
  }

  if (result.kind === "invalid_case_kind") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Для этого кейса создание заявок недоступно.");
    return;
  }

  if (result.kind === "missing_student") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "У кейса нет привязанного ученика.");
    return;
  }

  if (result.kind === "case_closed") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Кейс уже закрыт.");
    return;
  }

  if (result.kind === "failed") {
    const message = `Не удалось создать заявки: ${result.humanMessage}`;
    await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, message);
    await sendTrainingPeaksMessage(parsedMessage.chatId, message);
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, "Не удалось создать заявки. Проверь кейс вручную.");
}

async function resolveTrainingPeaksActionIdFromStartPayload(
  actionIdOrPrefix: string
): Promise<string | null> {
  const normalized = actionIdOrPrefix.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length >= 16) {
    return normalized;
  }

  const actions = await listRecentTrainingPeaksActionsWithLatestRunContext(100);
  const matches = actions.filter((action) => action.id.startsWith(normalized));
  if (matches.length === 1) {
    return matches[0].id;
  }

  return null;
}

async function showTpActionDetailFromMessage(
  parsedMessage: ParsedTelegramMessageUpdate,
  actionId: string
): Promise<void> {
  const action = await getTrainingPeaksActionWithStudentAndLatestRunContextById(actionId);
  if (!action) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Заявка не найдена.");
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, getTpActionDetailText(action, { includeFreshness: true }), {
    replyMarkup: createInlineKeyboardMarkup([
      [createMenuButton("🔄 Обновить", `${TP_CALLBACK_ACTION_DETAIL_PREFIX}${action.id}`)],
      [createMenuButton("📋 К заявкам", "tp:actions:list")],
      [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
    ]),
  });
}

async function handleTrainingPeaksStartPayload(
  parsedMessage: ParsedTelegramMessageUpdate,
  text: string
): Promise<void> {
  const payload = parseTrainingPeaksStartPayload(text);
  if (!payload) {
    await handleTrainingPeaksMain(parsedMessage);
    return;
  }

  if (payload.kind === "case") {
    await handleTrainingPeaksCaseCommand(parsedMessage, `/tp_case ${payload.shortId}`);
    return;
  }

  if (payload.kind === "action") {
    const actionId = await resolveTrainingPeaksActionIdFromStartPayload(payload.actionIdOrPrefix);
    if (!actionId) {
      await showTrainingPeaksMenuScreen(
        parsedMessage,
        "Заявка не найдена или ID неоднозначный. Открой /tp_actions или меню ниже.",
        getStartDeepLinkFallbackMarkup()
      );
      return;
    }

    await showTpActionDetailFromMessage(parsedMessage, actionId);
    return;
  }

  const student = await getTrainingPeaksStudentById(payload.studentId);
  if (!student) {
    await showTrainingPeaksMenuScreen(
      parsedMessage,
      "Ученик не найден. Открой список через /tp_students или меню ниже.",
      getStartDeepLinkFallbackMarkup()
    );
    return;
  }

  await showTrainingPeaksStudentCardMenu(parsedMessage, payload.studentId);
}

function isParsedTelegramMessageUpdate(
  parsedMessage: ParsedTelegramUpdate
): parsedMessage is ParsedTelegramMessageUpdate {
  return parsedMessage.kind === "message";
}

function getStudentCardReportStatusLabel(status: string): string {
  if (status === "ready") {
    return "готов";
  }

  if (status === "data_loaded") {
    return "данные загружены";
  }

  return "нет отчёта";
}

function getStudentCardStatusLabel(isActive: boolean): string {
  return isActive ? "активен" : "отключен";
}

function truncateTelegramLabel(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function getTelegramBusinessChatDisplayName(chat: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  chatId: string;
}): string {
  const fullName = [chat.firstName, chat.lastName].filter(Boolean).join(" ").trim();

  if (fullName && chat.username) {
    return `${fullName} @${chat.username}`;
  }

  if (fullName) {
    return fullName;
  }

  if (chat.username) {
    return `@${chat.username}`;
  }

  return `chat ${chat.chatId}`;
}

function normalizeTelegramUsernameLookup(value: string): string | null {
  const normalized = value.trim().replace(/^@+/, "").replace(/\s+/g, "");
  return normalized ? normalized.toLocaleLowerCase("en-US") : null;
}

function formatTelegramUsername(username: string | null): string {
  return username ? `@${username}` : "без username";
}

function formatLinkCodeExpiresAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

function getStudentTelegramStatusLabel(student: {
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramDeliveryEnabled: boolean;
}): string {
  if (!student.telegramChatId) {
    return ["Статус: не привязан", "Доставка: выключена"].join("\n");
  }

  return [
    `Статус: привязан${student.telegramUsername ? ` ${formatTelegramUsername(student.telegramUsername)}` : ""}`,
    `Доставка: ${student.telegramDeliveryEnabled ? "включена" : "выключена"}`,
    `chat_id: ${student.telegramChatId}`,
  ].join("\n");
}

function getStudentCardHint(student: {
  isActive: boolean;
  latestReportStatus: string;
  weeklyReportEnabled: boolean;
}): string | null {
  if (!student.isActive) {
    return "Ученик отключён.";
  }

  if (!student.weeklyReportEnabled) {
    return "Недельные отчёты выключены.";
  }

  if (student.latestReportStatus === "no_data") {
    return "Запусти `/tp_run last`, чтобы загрузить свежую неделю.";
  }

  return null;
}

function getStudentCardMessageLines(student: {
  studentName: string;
  isActive: boolean;
  trainingPeaksAthleteUrl: string;
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramDeliveryEnabled: boolean;
  latestWeekFrom: string | null;
  latestWeekTo: string | null;
  latestReportStatus: string;
  weeklyReportEnabled: boolean;
}): string[] {
  const hint = getStudentCardHint(student);
  const weekLabel =
    student.latestWeekFrom && student.latestWeekTo
      ? `${student.latestWeekFrom} — ${student.latestWeekTo}`
      : "ещё нет";

  return [
    `👤 ${student.studentName}`,
    `Статус: ${getStudentCardStatusLabel(student.isActive)}`,
    "TrainingPeaks:",
    student.trainingPeaksAthleteUrl,
    "",
    "Telegram:",
    getStudentTelegramStatusLabel(student),
    "",
    "Последний отчёт:",
    getStudentCardReportStatusLabel(student.latestReportStatus),
    "",
    "Неделя:",
    weekLabel,
    ...(hint ? ["", `Подсказка: ${hint}`] : []),
  ];
}

function formatStudentAmbiguityMessage(
  matches: {
    studentId: string;
    studentName: string;
  }[]
): string {
  const visibleMatches = matches.slice(0, 5).map((student) => {
    const label =
      student.studentId !== student.studentName
        ? `${student.studentName} (${student.studentId})`
        : student.studentName;
    return `• ${label}`;
  });
  const hiddenMatchesCount = Math.max(0, matches.length - visibleMatches.length);

  return [
    "Нашлось несколько учеников:",
    ...visibleMatches,
    ...(hiddenMatchesCount > 0 ? [`• ... и ещё ${hiddenMatchesCount}`] : []),
    "Уточни имя точнее.",
    "Полный список: /tp_students",
  ].join("\n");
}

function formatTpContextStudentLabel(student: { studentName: string; studentId: string }): string {
  return student.studentId !== student.studentName
    ? `${student.studentName} (${student.studentId})`
    : student.studentName;
}

function formatTpContextAmbiguousMessage(
  matches: {
    studentId: string;
    studentName: string;
  }[]
): string {
  const visible = matches.slice(0, 5).map((student) => `• ${formatTpContextStudentLabel(student)}`);
  const hiddenCount = Math.max(0, matches.length - visible.length);
  return [
    "Нашлось несколько учеников:",
    ...visible,
    ...(hiddenCount > 0 ? [`• ... и ещё ${hiddenCount}`] : []),
    "Уточни имя.",
  ].join("\n");
}

function resolveTpContextStudentByPrefix(
  students: TrainingPeaksRegistryStudentSnapshot[],
  query: string
): TrainingPeaksRegistryStudentSnapshot | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const matches = students.filter((student) => student.id.toLowerCase().startsWith(normalized));
  if (matches.length !== 1) {
    return null;
  }

  return matches[0] ?? null;
}

function getTpContextStudentLookupResult(
  students: TrainingPeaksRegistryStudentSnapshot[],
  query: string
):
  | { kind: "not_found" }
  | { kind: "ambiguous"; matches: { studentId: string; studentName: string }[] }
  | { kind: "student"; student: TrainingPeaksRegistryStudentSnapshot } {
  const normalized = query.trim();
  if (!normalized) {
    return { kind: "not_found" };
  }

  const normalizedLower = normalized.toLowerCase();
  const exactByInternalId = students.find((student) => student.id.toLowerCase() === normalizedLower);
  if (exactByInternalId) {
    return { kind: "student", student: exactByInternalId };
  }

  if (/^[0-9a-f-]{6,}$/i.test(normalized)) {
    const byInternalIdPrefix = students.filter((student) =>
      student.id.toLowerCase().startsWith(normalizedLower)
    );
    if (byInternalIdPrefix.length === 1) {
      return { kind: "student", student: byInternalIdPrefix[0]! };
    }
    if (byInternalIdPrefix.length > 1) {
      return {
        kind: "ambiguous",
        matches: byInternalIdPrefix.map((student) => ({
          studentId: student.studentId,
          studentName: student.studentName,
        })),
      };
    }
  }

  const exactBySlug = students.find((student) => student.studentId.toLowerCase() === normalizedLower);
  if (exactBySlug) {
    return { kind: "student", student: exactBySlug };
  }

  const prefixBySlug = students.filter((student) => student.studentId.toLowerCase().startsWith(normalizedLower));
  if (prefixBySlug.length === 1) {
    return { kind: "student", student: prefixBySlug[0]! };
  }
  if (prefixBySlug.length > 1) {
    return {
      kind: "ambiguous",
      matches: prefixBySlug.map((student) => ({
        studentId: student.studentId,
        studentName: student.studentName,
      })),
    };
  }

  const identityMatch = matchStudentByIdentity({
    query: normalized,
    students,
    forceAmbiguousForFirstNameOnly: true,
    buildIdentities: (student) => [
      { value: student.studentName, kind: "trainingpeaks_name", weight: 1 },
      { value: student.studentId, kind: "trainingpeaks_id", weight: 1 },
      { value: student.telegramUsername, kind: "telegram_username", weight: 1.1 },
    ],
  });

  if (identityMatch.status === "matched") {
    return { kind: "student", student: identityMatch.student };
  }

  if (identityMatch.status === "ambiguous") {
    return {
      kind: "ambiguous",
      matches: identityMatch.candidates.map((candidate) => ({
        studentId: candidate.student.studentId,
        studentName: candidate.student.studentName,
      })),
    };
  }

  return { kind: "not_found" };
}

function getTpContextGroupLabel(memoryType: TrainingPeaksStudentMemoryType): string {
  if (memoryType === "communication_style") {
    return "Стиль общения";
  }

  if (
    memoryType === "schedule_constraint" ||
    memoryType === "availability_preference" ||
    memoryType === "planning_preference" ||
    memoryType === "travel_or_life_event"
  ) {
    return "Расписание / планирование";
  }

  if (memoryType === "pain_or_injury" || memoryType === "health_status") {
    return "Здоровье / травмы";
  }

  if (memoryType === "emotional_state" || memoryType === "load_tolerance") {
    return "Эмоции / нагрузка";
  }

  if (memoryType === "race_or_goal") {
    return "Цели / старты";
  }

  return "Экипировка";
}

function formatTpContextValidUntil(validUntil: string | null): string | null {
  const normalized = validUntil?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  return normalized.length >= 10 ? normalized.slice(0, 10) : normalized;
}

function getTpContextBulletText(item: TrainingPeaksStudentMemoryItem): string {
  const summary = item.summaryText.replace(/\s+/g, " ").trim();
  const suffixes: string[] = [];
  const validUntil = formatTpContextValidUntil(item.validUntil);
  if (validUntil) {
    suffixes.push(`до ${validUntil}`);
  }
  if (item.confidence !== null && item.confidence < 0.7) {
    suffixes.push("низкая уверенность");
  }

  if (suffixes.length === 0) {
    return `• ${summary}`;
  }

  return `• ${summary} (${suffixes.join(", ")})`;
}

function formatTrainingPeaksContextCardText(
  student: { studentName: string },
  items: TrainingPeaksStudentMemoryItem[]
): string {
  const lines: string[] = [`🧠 Память: ${student.studentName}`];

  if (items.length === 0) {
    lines.push("Пока активных заметок нет.");
    return lines.join("\n");
  }

  const sectionOrder = [
    "Стиль общения",
    "Расписание / планирование",
    "Здоровье / травмы",
    "Эмоции / нагрузка",
    "Цели / старты",
    "Экипировка",
  ] as const;
  const grouped = new Map<string, string[]>();
  for (const item of items) {
    const section = getTpContextGroupLabel(item.memoryType);
    const current = grouped.get(section) ?? [];
    current.push(getTpContextBulletText(item));
    grouped.set(section, current);
  }

  for (const section of sectionOrder) {
    const bullets = grouped.get(section);
    if (!bullets || bullets.length === 0) {
      continue;
    }
    lines.push("", `${section}:`, ...bullets);
  }

  return lines.join("\n");
}

function getTrainingPeaksStudentContextMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("👤 Ученик", `tp:i:${studentId}`)],
    [createMenuButton("🔄 Обновить", `${TP_CALLBACK_STUDENT_CONTEXT_PREFIX}${studentId.slice(0, 12)}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

async function showTrainingPeaksStudentContext(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  student: TrainingPeaksRegistryStudentSnapshot
): Promise<void> {
  const items = await listActiveTrainingPeaksStudentMemoryItems(student.id);
  const text = formatTrainingPeaksContextCardText(student, items);
  const markup = getTrainingPeaksStudentContextMarkup(student.id);
  await showTrainingPeaksMenuScreen(parsedMessage, text, markup);
}

function shortenJobError(errorMessage: string | null): string | null {
  const normalized = errorMessage?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

async function sendTelegramBusinessMessage(
  chatId: string,
  text: string,
  businessConnectionId: string
): Promise<number> {
  const chunks = splitTelegramMessage(text);

  for (const [index, chunk] of chunks.entries()) {
    try {
      await sendTelegramMessageStrict(chatId, chunk, {
        businessConnectionId,
      });
    } catch (error) {
      throw new Error(
        `Не удалось отправить часть ${index + 1} из ${chunks.length}: ${shortenTrainingPeaksTelegramDeliveryError(error)}`
      );
    }
  }

  return chunks.length;
}

async function notifyCoachReportAction(
  chatId: number | string,
  text: string
): Promise<void> {
  await sendTelegramMessage(chatId, text);
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getMissingStudents(resultJson: unknown): { studentId: string | null; studentName: string | null }[] {
  if (!resultJson || typeof resultJson !== "object") {
    return [];
  }

  const rawMissingStudents = (resultJson as { missing_students?: unknown }).missing_students;
  if (!Array.isArray(rawMissingStudents)) {
    return [];
  }

  return rawMissingStudents.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const studentId =
      typeof (entry as { student_id?: unknown }).student_id === "string"
        ? (entry as { student_id: string }).student_id.trim()
        : "";
    const studentName =
      typeof (entry as { student_name?: unknown }).student_name === "string"
        ? (entry as { student_name: string }).student_name.trim()
        : "";

    if (!studentId && !studentName) {
      return [];
    }

    return [
      {
        studentId: studentId || null,
        studentName: studentName || null,
      },
    ];
  });
}

function formatMissingStudentsSummary(resultJson: unknown): string | null {
  const labels = getMissingStudents(resultJson).map(
    (student) => student.studentName ?? student.studentId ?? "Unknown"
  );

  if (labels.length === 0) {
    return null;
  }

  if (labels.length <= 3) {
    return labels.join(", ");
  }

  return `${labels.slice(0, 3).join(", ")} и ещё ${labels.length - 3}`;
}

function jobHasWarnings(resultJson: unknown): boolean {
  if (!resultJson || typeof resultJson !== "object") {
    return false;
  }

  return (
    getBoolean((resultJson as { has_warnings?: unknown }).has_warnings) === true ||
    getMissingStudents(resultJson).length > 0
  );
}

function getJobCountsSummary(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== "object") {
    return null;
  }

  const studentsExpected = getFiniteNumber((resultJson as { students_expected?: unknown }).students_expected);
  const reportsFound = getFiniteNumber((resultJson as { reports_found?: unknown }).reports_found);
  const reportsSent = getFiniteNumber(
    (resultJson as { reports_sent_to_telegram?: unknown }).reports_sent_to_telegram
  );

  if (reportsFound === null && reportsSent === null) {
    return null;
  }

  const parts: string[] = [];

  if (reportsFound !== null) {
    parts.push(
      studentsExpected !== null ? `отчётов: ${reportsFound}/${studentsExpected}` : `отчётов: ${reportsFound}`
    );
  }

  if (reportsSent !== null) {
    parts.push(`отправлено: ${reportsSent}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function getJobStatusLabel(status: string): string {
  if (status === "queued") {
    return "ожидает запуска на Mac";
  }

  if (status === "running") {
    return "выполняется на Mac";
  }

  if (status === "completed") {
    return "завершена";
  }

  if (status === "failed") {
    return "ошибка";
  }

  return status;
}

function isCancelledTrainingPeaksJob(job: {
  status: string;
  errorMessage: string | null;
}): boolean {
  return (
    job.status === "failed" &&
    job.errorMessage?.trim() === TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE
  );
}

function getTrainingPeaksJobStatusLabel(job: {
  status: string;
  errorMessage: string | null;
}): string {
  if (job.status === "failed" && isCancelledTrainingPeaksJob(job)) {
    return "отменена";
  }

  if (job.status === "failed") {
    return "ошибка";
  }

  return getJobStatusLabel(job.status);
}

function formatJobScopeLabel(job: {
  scope?: string;
  studentId?: string | null;
  status: string;
}): string | null {
  if (job.scope === "single_student" && job.studentId) {
    return `Один ученик: ${job.studentId}`;
  }

  if (job.scope === "all_enabled" && job.status === "running") {
    return "Все weekly-enabled ученики";
  }

  if (job.scope === "all_enabled") {
    return "Все weekly-enabled ученики";
  }

  return null;
}

function getTrainingPeaksJobTypeLabel(jobType: string): string {
  if (jobType === "race_scan_events") {
    return "Скан стартов";
  }

  if (jobType === "race_results_probe") {
    return "Результаты по дистанциям";
  }

  return "Недельный отчёт";
}

function formatJobsMessage(
  jobs: {
    jobType?: string;
    scope?: string;
    studentId?: string | null;
    status: string;
    weekFrom: string;
    weekTo: string;
    resultJson: unknown | null;
    errorMessage: string | null;
  }[]
): string {
  const hasRunningBroadJob = jobs.some(
    (job) => job.scope === "all_enabled" && job.status === "running"
  );

  return [
    "🧾 Задачи TrainingPeaks",
    "",
    ...jobs.flatMap((job) => {
      const shortError = shortenJobError(job.errorMessage);
      const countsSummary = getJobCountsSummary(job.resultJson);
      const hasWarnings = jobHasWarnings(job.resultJson);
      const missingStudentsSummary = formatMissingStudentsSummary(job.resultJson);
      const statusLabel = getTrainingPeaksJobStatusLabel(job);
      const scopeLabel = formatJobScopeLabel(job);
      const jobTypeLabel = getTrainingPeaksJobTypeLabel(job.jobType ?? "weekly_reports");
      const periodLabel =
        job.jobType === "race_scan_events" || job.jobType === "race_results_probe"
          ? "период"
          : "неделя";
      const lines = [
        `• ${jobTypeLabel}`,
        `  ${periodLabel}: ${job.weekFrom} — ${job.weekTo}`,
        `  Статус: ${statusLabel}`,
      ];

      if (scopeLabel) {
        lines.push(`  ${scopeLabel}`);
      }

      if (job.status === "failed" && !isCancelledTrainingPeaksJob(job) && shortError) {
        lines.push(`  Ошибка: ${shortError}`);
        return lines;
      }

      if (job.status === "completed" && countsSummary) {
        lines.push(`  ${countsSummary}${hasWarnings ? " ⚠️" : ""}`);
        if (missingStudentsSummary) {
          lines.push(`  Не готово: ${missingStudentsSummary}`);
        }
        return lines;
      }

      return lines;
    }),
    ...(hasRunningBroadJob
      ? [
          "",
          "⚠️ Сейчас выполняется широкая задача на всех weekly-enabled учеников.",
        ]
      : []),
    ...(jobs.some((job) => job.status === "queued" && job.jobType === "race_results_probe")
      ? [
          "",
          "Для задач по дистанциям запусти локальный runner:",
          "npm run tp-probes-once",
        ]
      : []),
    ...(jobs.some((job) => job.status === "queued" && job.jobType !== "race_results_probe")
      ? [
          "",
          "Чтобы начать обработку, запусти локальный runner:",
          "npm run tp-agent-once",
        ]
      : []),
  ].join("\n");
}

async function handleTrainingPeaksAttention(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  const markup = getTrainingPeaksAttentionDigestMarkup();
  try {
    const snapshot = await getTrainingPeaksAttentionSnapshot();
    const messages = buildTrainingPeaksAttentionMessages(snapshot);
    await sendTrainingPeaksAttentionMessages(parsedMessage, messages, markup);
  } catch (error) {
    if (isTelegramMessageTooLongError(error)) {
      console.warn("trainingpeaks_attention_message_too_long", {
        error: error instanceof Error ? error.message : String(error),
        updateKind: parsedMessage.kind,
        chatId: parsedMessage.chatId,
      });
      await sendTrainingPeaksAttentionLengthFallback(parsedMessage, markup);
      return;
    }

    console.error("trainingpeaks_attention_handler_failed", {
      error: error instanceof Error ? error.message : String(error),
      updateKind: parsedMessage.kind,
      chatId: parsedMessage.chatId,
    });
    const fallbackText =
      "Не удалось загрузить «Сегодня».\nПопробуйте ещё раз через минуту.\nЕсли повторится — проверьте логи.";
    try {
      if (parsedMessage.kind === "callback_query") {
        await editTelegramMessageText(parsedMessage.chatId, parsedMessage.messageId, fallbackText, {
          replyMarkup: markup,
        });
        return;
      }
      await sendTelegramMessage(parsedMessage.chatId, fallbackText);
    } catch (fallbackError) {
      console.error("trainingpeaks_attention_generic_fallback_failed", {
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        updateKind: parsedMessage.kind,
        chatId: parsedMessage.chatId,
      });
    }
  }
}

function parseTpSignalsScopeFromCommand(text: string): TrainingPeaksOperationalSignalsScope {
  const normalized = text.replace(/^\/tp_signals(?:@\w+)?/iu, "").trim().toLowerCase();
  if (normalized === "health") {
    return "health";
  }
  if (normalized === "schedule") {
    return "schedule";
  }
  if (normalized === "move") {
    return "move";
  }
  return "all";
}

async function handleTrainingPeaksOperationalSignalsCommand(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  text: string
): Promise<void> {
  const scope = parseTpSignalsScopeFromCommand(text);
  const snapshot = await getTrainingPeaksOperationalSignalsSnapshot({
    scope,
    limit: 100,
  });
  const messages = formatTrainingPeaksOperationalSignalsForTelegramMultiMessage(snapshot);
  for (const message of messages) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, message);
  }
}

function getTrainingPeaksAttentionDigestMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🔄 Обновить", TP_CALLBACK_ATTENTION)],
    [createMenuButton(TP_REPLY_BUTTON_SIGNALS, TP_CALLBACK_SIGNALS)],
    [
      createMenuButton("🧩 Кейсы", TP_CALLBACK_CASES_RECENT),
      createMenuButton("📋 Заявки", "tp:actions:list"),
    ],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

const TP_CRON_STATUS_BELGRADE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Belgrade",
});

function formatTrainingPeaksCronRunLogBelgradeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${TP_CRON_STATUS_BELGRADE_FORMATTER.format(date)} (Belgrade)`;
}

function shortTrainingPeaksCronUserAgentLabel(userAgent: string | null): string {
  if (!userAgent) {
    return "—";
  }

  const lower = userAgent.toLowerCase();
  if (lower.includes("vercel-cron")) {
    return "vercel-cron";
  }

  if (lower.startsWith("curl/")) {
    return "curl";
  }

  return userAgent.length > 40 ? `${userAgent.slice(0, 37)}...` : userAgent;
}

function formatTrainingPeaksCronRunLogCounts(counts: Record<string, unknown>): string {
  const keys = ["urgent", "today", "observe", "fyi", "sent", "failed"] as const;
  const parts = keys
    .map((key) => {
      const value = counts[key];
      if (typeof value !== "number") {
        return null;
      }

      return `${key}=${value}`;
    })
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(", ") : "—";
}

const TP_CRON_STATUS_SENT_STALE_MS = 26 * 60 * 60 * 1000;
const TP_CRON_STATUS_SCHEDULE_TEXT =
  "09:00 UTC hour / примерно 11:00–11:59 Белград летом на Vercel Hobby";

function formatTrainingPeaksCronAgeMs(ageMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(ageMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  }

  return `${minutes}м`;
}

function formatTrainingPeaksCronRunSummary(log: TrainingPeaksCronRunLog): string {
  const lines = [
    formatTrainingPeaksCronRunLogBelgradeTime(log.startedAt),
    `source: ${log.source}`,
    `status: ${log.status}`,
    `http: ${log.responseStatus ?? "—"}`,
    `counts: ${formatTrainingPeaksCronRunLogCounts(log.counts)}`,
    `ua: ${shortTrainingPeaksCronUserAgentLabel(log.userAgent)}`,
  ];

  if (log.errorMessage) {
    lines.push(`error: ${log.errorMessage}`);
  }

  return lines.join("\n");
}

function formatTrainingPeaksCronRunLogLine(log: TrainingPeaksCronRunLog, index: number): string {
  return [`${index + 1}. ${formatTrainingPeaksCronRunSummary(log)}`].join("\n");
}

function getBelgradeIsoDateFromTimestamp(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = getBelgradeDateParts(date);
  return toIsoDate(parts.year, parts.month, parts.day);
}

function formatTrainingPeaksCronStatusMessage(input: {
  lastAttempt: TrainingPeaksCronRunLog | null;
  lastSent: TrainingPeaksCronRunLog | null;
  recentLogs: TrainingPeaksCronRunLog[];
}): string {
  const { lastAttempt, lastSent, recentLogs } = input;
  const todayIso = getBelgradeTodayIso();
  const lastAttemptDate = lastAttempt ? getBelgradeIsoDateFromTimestamp(lastAttempt.startedAt) : null;
  const noAttemptToday = lastAttemptDate !== todayIso;
  const lines = [
    "Cron status: attention_digest",
    `Расписание: ${TP_CRON_STATUS_SCHEDULE_TEXT}`,
    "",
    "Последняя успешная отправка (sent):",
    lastSent ? formatTrainingPeaksCronRunSummary(lastSent) : "— нет записей",
  ];

  let lastSentAgeMs: number | null = null;
  if (lastSent) {
    lastSentAgeMs = Date.now() - new Date(lastSent.startedAt).getTime();
    lines.push("", `Возраст последней sent: ${formatTrainingPeaksCronAgeMs(lastSentAgeMs)}`);
    if (lastSentAgeMs > TP_CRON_STATUS_SENT_STALE_MS) {
      lines.push("⚠️ Нет успешной отправки attention_digest более 26 часов.");
    }
  } else {
    lines.push("", "⚠️ Успешных отправок (sent) пока не было.");
  }

  if (noAttemptToday && (lastSentAgeMs === null || lastSentAgeMs > TP_CRON_STATUS_SENT_STALE_MS)) {
    lines.push("", "Сегодня cron ещё не вызывался — можно запустить /tp_digest_now.");
  }

  lines.push("", "Последняя попытка (любой status):");
  lines.push(lastAttempt ? formatTrainingPeaksCronRunSummary(lastAttempt) : "— нет записей");

  if (recentLogs.length === 0) {
    lines.push("", "Последние запуски:", "Записей пока нет.");
    return lines.join("\n");
  }

  lines.push("", "Последние 5 запусков:", "");
  lines.push(...recentLogs.map((log, index) => formatTrainingPeaksCronRunLogLine(log, index)));

  return lines.join("\n");
}

async function handleTrainingPeaksHealth(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  const health = await getTrainingPeaksHealthSnapshot();
  const lines = [
    "TP health",
    `webhook secret configured: ${process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ? "yes" : "no"}`,
    `business connection id configured: ${process.env.TELEGRAM_BUSINESS_CONNECTION_ID?.trim() ? "yes" : "no"}`,
    `openai api key configured: ${process.env.OPENAI_API_KEY?.trim() ? "yes" : "no"}`,
    `context observer enabled: ${isTrainingPeaksContextObserverEnabled() ? "yes" : "no"}`,
    `last attention-digest cron status: ${health.lastAttentionDigestCronStatus ?? "none"}`,
    `running jobs > 6h old: ${health.runningJobsOlderThanSixHours}`,
  ];

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(
      parsedMessage,
      lines.join("\n"),
      createInlineKeyboardMarkup([
        [createMenuButton("🔄 Обновить", TP_CALLBACK_HEALTH)],
        [createMenuButton("⬅️ Служебное", TP_CALLBACK_MORE_MENU)],
        [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
      ])
    );
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, lines.join("\n"));
}

async function handleTrainingPeaksCronStatus(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  const [lastAttempt, lastSent, recentLogs] = await Promise.all([
    getLatestTrainingPeaksCronRunLog({
      jobName: TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
    }),
    getLatestTrainingPeaksCronRunLog({
      jobName: TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
      status: "sent",
    }),
    listTrainingPeaksCronRunLogs({
      jobName: TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
      limit: 5,
    }),
  ]);

  const text = formatTrainingPeaksCronStatusMessage({
    lastAttempt,
    lastSent,
    recentLogs,
  });

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(
      parsedMessage,
      text,
      createInlineKeyboardMarkup([
        [createMenuButton("🔄 Обновить", TP_CALLBACK_CRON_STATUS)],
        [createMenuButton("⬅️ Служебное", TP_CALLBACK_MORE_MENU)],
        [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
      ])
    );
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, text);
}

async function handleTrainingPeaksDigestNow(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  const todayIso = getBelgradeTodayIso();
  if (await hasTrainingPeaksAttentionDigestSentForBelgradeDate(todayIso)) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      "Сегодня утренний обзор уже был отправлен. Повторная отправка отключена."
    );
    return;
  }

  const result = await runTrainingPeaksAttentionDigest({
    source: "manual",
    requestPath: "/telegram/tp_digest_now",
    userAgent: "telegram_command/tp_digest_now",
  });

  if (result.ok) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `✅ Утренний обзор отправлен в ${result.counts.sent} coach chat(ов).`
    );
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    `❌ Не удалось отправить утренний обзор: ${result.errorMessage ?? "ошибка"}`
  );
}

function isTelegramGroupChatType(chatType: TelegramChatType | undefined): boolean {
  return chatType === "group" || chatType === "supergroup";
}

function isCoachAuthorizedForTelegramChat(
  parsedMessage: ParsedTelegramUpdate,
  chatType: TelegramChatType | undefined
): boolean {
  if (isTelegramGroupChatType(chatType)) {
    return parsedMessage.userId !== null && isCoachChat(parsedMessage.userId);
  }

  return isCoachChat(parsedMessage.chatId);
}

function formatTelegramTopicFlag(value: boolean | null): string {
  if (value === null) {
    return "null";
  }

  return value ? "yes" : "no";
}

async function handleTrainingPeaksGroupTest(
  parsedMessage: ParsedTelegramUpdate,
  chatType: TelegramChatType | undefined
): Promise<void> {
  const senderIsCoach =
    parsedMessage.userId !== null && isCoachChat(parsedMessage.userId);
  const isTopicMessage =
    parsedMessage.kind === "message" ? parsedMessage.isTopicMessage : null;
  const messageThreadId =
    parsedMessage.kind === "message" ? parsedMessage.messageThreadId : null;

  const lines = [
    "🧪 Group diagnostics",
    "",
    `chat.id: ${parsedMessage.chatId}`,
    `chat.type: ${chatType ?? "unknown"}`,
    `from.id: ${parsedMessage.userId ?? "null"}`,
    `sender is coach: ${senderIsCoach ? "yes" : "no"}`,
    `is_topic_message: ${formatTelegramTopicFlag(isTopicMessage)}`,
    `message_thread_id: ${messageThreadId ?? "null"}`,
    "",
    "Если чат разбит на темы, ответы идут в текущую тему. Закрытая тема может дать TOPIC_CLOSED.",
  ];

  await sendTrainingPeaksMessage(parsedMessage.chatId, lines.join("\n"), {
    messageThreadId: messageThreadId ?? undefined,
  });
}

export function isCoachChat(chatId: number | string): boolean {
  return new Set(getTrainingPeaksCoachChatIds()).has(String(chatId));
}

export function isTrainingPeaksCommand(text: string): boolean {
  return getTrainingPeaksCommand(text) !== null;
}

export function getTrainingPeaksHelpLines(): string[] {
  return [
    "Coach Command Center",
    "",
    "Обычные рабочие сценарии доступны через /tp и кнопки. Команды ниже нужны как быстрые fallback-пути.",
    "",
    "1. Утренний обзор",
    "🌅 /tp_attention — текущий digest внимания",
    "📍 /tp_signals [health|schedule|move] — активные operational signals (read-only)",
    "/tp_digest_now — ручная отправка digest только тренерским чатам, с защитой от повторной отправки за день",
    "",
    "2. Кейсы",
    "🧩 /tp_cases — активные coach cases с фильтром и пагинацией",
    "/tp_case <case_id_prefix> — открыть один кейс по short ID",
    "/tp case resolve <case_id> — закрыть coach case",
    "/tp case dismiss <case_id> — скрыть coach case",
    "",
    "3. Заявки на перенос",
    "📋 /tp_actions — последние заявки на перенос",
    "Approve/reject/execute остаются на существующих кнопках заявки. Реальные изменения TrainingPeaks требуют подтверждения и локального executor.",
    "",
    "4. Отчёты",
    "📊 /tp_report <ученик> [last|даты] — посмотреть отчёт",
    "/tp_run_student <slug> YYYY-MM-DD YYYY-MM-DD — создать черновик отчёта одного ученика",
    "/tp_run_week last|current — preview перед постановкой пачки в очередь",
    "Отчёты ученикам не отправляются автоматически.",
    "",
    "5. Ученики",
    "👥 /tp_students — список учеников",
    "/tp_student <ученик> — карточка ученика",
    "/tp_context <ученик> — активная Coach Memory v1 по ученику (read-only)",
    "Управление учениками и Telegram-привязкой в основном выполняется в Web Admin.",
    "Fallback-инструменты привязки доступны из карточки ученика.",
    "",
    "6. Биллинг",
    "💳 /bill — сводка",
    "/bill_list — список оплат",
    "/bill_paid и /bill_unpaid — ручные write-команды, без автоимпорта и автомэтчинга.",
    "",
    "7. Служебное",
    "⚙️ /tp_health — краткая проверка production-конфига и зависших jobs",
    "/tp_cron_status — статус cron attention_digest",
    "/tp_jobs — последние задачи",
    "/tp_intents — triage непонятых TP-сообщений (read-only)",
    "/tp_races YYYY-MM-DD YYYY-MM-DD — запросить сканирование забегов за период",
    "/tp_link_thread <ученик> — привязать текущую тему к ученику",
    "/tp_thread_info — показать привязку текущей темы",
    "/tp_unlink_thread — отвязать текущую тему",
    "",
    "Черновики ответов",
    "/tp_reply_draft <ученик> <сообщение ученика> — создать черновик ответа без автоотправки",
    "/tp_draft_feedback <draft_id> used|edited|ignored [заметка] — фидбек по черновику",
    "",
    "Скрыто из обычного меню:",
    "/tp_weekly — legacy alias, отключён",
    "/tp_set_telegram и /tp_business_test — service-only fallback/debug",
  ];
}

function getTrainingPeaksReplyKeyboardAction(text: string): TrainingPeaksReplyKeyboardAction | null {
  if (text === TP_REPLY_BUTTON_MENU) {
    return "main_menu";
  }

  if (text === TP_REPLY_BUTTON_TODAY) {
    return "today";
  }

  if (text === TP_REPLY_BUTTON_STUDENTS) {
    return "students";
  }

  if (text === TP_REPLY_BUTTON_ADD) {
    return "add_student_help";
  }

  if (text === TP_REPLY_BUTTON_REPORTS) {
    return "reports_menu";
  }

  if (text === TP_REPLY_BUTTON_RACES) {
    return "races_menu";
  }

  if (text === TP_REPLY_BUTTON_JOBS) {
    return "jobs";
  }

  if (text === TP_REPLY_BUTTON_CASES) {
    return "cases_recent";
  }

  if (text === TP_REPLY_BUTTON_ACTIONS) {
    return "actions";
  }

  if (text === TP_REPLY_BUTTON_SIGNALS) {
    return "signals";
  }

  if (text === TP_REPLY_BUTTON_PAYMENTS) {
    return "billing_hint";
  }

  if (text === TP_REPLY_BUTTON_SERVICE) {
    return "more_menu";
  }

  if (text === TP_REPLY_BUTTON_BACK) {
    return "back";
  }

  if (text === TP_REPLY_BUTTON_STUDENTS_BACK) {
    return "students_back";
  }

  if (text === TP_REPLY_BUTTON_WEEK_LAST) {
    return "week_last";
  }

  if (text === TP_REPLY_BUTTON_WEEK_CURRENT) {
    return "week_current";
  }

  if (text === TP_REPLY_BUTTON_RACES_NEXT_WEEK) {
    return "races_next_week";
  }

  if (text === TP_REPLY_BUTTON_RACES_7_DAYS) {
    return "races_7_days";
  }

  if (text === TP_REPLY_BUTTON_RACES_30_DAYS) {
    return "races_30_days";
  }

  if (text === TP_REPLY_BUTTON_RACES_TO_AUGUST) {
    return "races_to_august";
  }

  if (text === TP_REPLY_BUTTON_JOBS_REFRESH) {
    return "jobs_refresh";
  }

  if (text === TP_REPLY_BUTTON_CANCEL_JOB) {
    return "cancel_job";
  }

  if (text === TP_REPLY_BUTTON_REPORT) {
    return "student_report";
  }

  if (text === TP_REPLY_BUTTON_TELEGRAM_LINK) {
    return "student_link";
  }

  if (text === TP_REPLY_BUTTON_TELEGRAM_USERNAME || text === TP_REPLY_BUTTON_TELEGRAM_USERNAME_LEGACY) {
    return "student_username";
  }

  if (text === TP_REPLY_BUTTON_TELEGRAM_CODE) {
    return "student_link_code";
  }

  if (text === TP_REPLY_BUTTON_TELEGRAM_TEST) {
    return "student_test";
  }

  if (text === TP_REPLY_BUTTON_DISABLE) {
    return "student_disable";
  }

  if (text === TP_REPLY_BUTTON_ENABLE) {
    return "student_enable";
  }

  return null;
}

export function isTrainingPeaksCallback(data: string | null): boolean {
  return Boolean(data?.startsWith(TP_CALLBACK_PREFIX));
}

function parseTrainingPeaksCallback(data: string | null): ParsedTrainingPeaksCallback | null {
  if (!data) {
    return null;
  }

  if (data === TP_CALLBACK_MAIN_MENU) {
    return { kind: "main_menu" };
  }

  if (data === TP_CALLBACK_WEEK_MENU) {
    return { kind: "week_menu" };
  }

  if (data === TP_CALLBACK_RACES_MENU) {
    return { kind: "races_menu" };
  }

  if (data === TP_CALLBACK_WEEK_LAST) {
    return { kind: "week_last" };
  }

  if (data === TP_CALLBACK_WEEK_CURRENT) {
    return { kind: "week_current" };
  }

  if (data === TP_CALLBACK_RACES_NEXT_WEEK) {
    return { kind: "races_next_week" };
  }

  if (data === TP_CALLBACK_RACES_7_DAYS) {
    return { kind: "races_7_days" };
  }

  if (data === TP_CALLBACK_RACES_30_DAYS) {
    return { kind: "races_30_days" };
  }

  if (data === TP_CALLBACK_RACES_TO_AUGUST) {
    return { kind: "races_to_august" };
  }

  if (data === `${TP_CALLBACK_RACES_MENU}:custom`) {
    return { kind: "races_custom" };
  }

  if (data === TP_CALLBACK_JOBS) {
    return { kind: "jobs" };
  }

  if (data === TP_CALLBACK_CASES_RECENT) {
    return { kind: "cases_recent" };
  }

  if (data.startsWith(TP_CALLBACK_CASES_PAGE_PREFIX)) {
    const parsedCasesPage = parseTrainingPeaksCasesPageCallbackData(data);
    return parsedCasesPage ? { kind: "cases_page", ...parsedCasesPage } : null;
  }

  if (data === TP_CALLBACK_WEEK_RUN_CONFIRM) {
    return { kind: "week_run_confirm" };
  }

  if (data === TP_CALLBACK_WEEK_RUN_CANCEL) {
    return { kind: "week_run_cancel" };
  }

  if (data.startsWith(TP_CALLBACK_JOB_CANCEL_PREFIX)) {
    const jobId = data.slice(TP_CALLBACK_JOB_CANCEL_PREFIX.length).trim();
    return jobId ? { kind: "job_cancel", jobId } : null;
  }

  if (data === TP_CALLBACK_HELP) {
    return { kind: "help" };
  }

  if (data === TP_CALLBACK_REPORTS_MENU || data === TP_CALLBACK_REPORTS) {
    return { kind: "reports_menu" };
  }

  if (data === TP_CALLBACK_REPORTS_STATUS_LAST) {
    return { kind: "reports_status_last" };
  }

  if (data === TP_CALLBACK_REPORTS_FROM_STUDENT) {
    return { kind: "reports_from_student" };
  }

  if (data === TP_CALLBACK_REPORTS_ELIGIBLE) {
    return { kind: "reports_eligible" };
  }

  if (data === TP_CALLBACK_MORE_MENU) {
    return { kind: "more_menu" };
  }

  if (data === TP_CALLBACK_ATTENTION) {
    return { kind: "attention" };
  }

  if (data === TP_CALLBACK_REPLY_DRAFT_HINT) {
    return { kind: "reply_draft_hint" };
  }

  if (data === TP_CALLBACK_REPLY_DRAFT_CLOSE) {
    return { kind: "reply_draft_close" };
  }

  if (data.startsWith(TP_CALLBACK_REPLY_DRAFT_SEND_PREFIX)) {
    const draftIdPrefix = data.slice(TP_CALLBACK_REPLY_DRAFT_SEND_PREFIX.length).trim();
    return draftIdPrefix ? { kind: "reply_draft_send", draftIdPrefix } : null;
  }

  if (data.startsWith(TP_CALLBACK_REPLY_DRAFT_CANCEL_PREFIX)) {
    const draftIdPrefix = data.slice(TP_CALLBACK_REPLY_DRAFT_CANCEL_PREFIX.length).trim();
    return draftIdPrefix ? { kind: "reply_draft_cancel", draftIdPrefix } : null;
  }

  if (data === TP_CALLBACK_BILLING_HINT) {
    return { kind: "billing_hint" };
  }

  if (data === TP_CALLBACK_HEALTH) {
    return { kind: "health" };
  }

  if (data === TP_CALLBACK_CRON_STATUS) {
    return { kind: "cron_status" };
  }

  if (data === TP_CALLBACK_INTENTS) {
    return { kind: "intents" };
  }

  if (data === TP_CALLBACK_TELEGRAM_LINKS_HINT) {
    return { kind: "telegram_links_hint" };
  }

  if (data === TP_CALLBACK_VOICE_DRAFTS_CLOSE) {
    return { kind: "voice_drafts_close" };
  }

  if (data.startsWith(TP_CALLBACK_VOICE_PICK_PREFIX)) {
    const rest = data.slice(TP_CALLBACK_VOICE_PICK_PREFIX.length);
    const separator = rest.indexOf(":");
    if (separator <= 0) {
      return null;
    }
    const key = rest.slice(0, separator).trim();
    const candidateIndex = Number.parseInt(rest.slice(separator + 1).trim(), 10);
    if (!key || !Number.isInteger(candidateIndex) || candidateIndex < 0) {
      return null;
    }
    return { kind: "voice_pick", key, candidateIndex };
  }

  if (data.startsWith(TP_CALLBACK_VOICE_PICK_NONE_PREFIX)) {
    const key = data.slice(TP_CALLBACK_VOICE_PICK_NONE_PREFIX.length).trim();
    if (!key) {
      return null;
    }
    return { kind: "voice_pick_none", key };
  }

  if (data.startsWith(TP_CALLBACK_STUDENT_WEEKLY_HINT_PREFIX)) {
    const studentId = data.slice(TP_CALLBACK_STUDENT_WEEKLY_HINT_PREFIX.length).trim();
    return studentId ? { kind: "student_weekly_hint", studentId } : null;
  }

  if (data.startsWith(TP_CALLBACK_STUDENT_RUN_PREFIX)) {
    const rest = data.slice(TP_CALLBACK_STUDENT_RUN_PREFIX.length);
    const weekKeywordSeparatorIndex = rest.lastIndexOf(":");

    if (weekKeywordSeparatorIndex <= 0) {
      return null;
    }

    const studentId = rest.slice(0, weekKeywordSeparatorIndex).trim();
    const weekKeyword = rest.slice(weekKeywordSeparatorIndex + 1).trim();

    if (
      studentId &&
      (weekKeyword === "last" || weekKeyword === "current")
    ) {
      return { kind: "student_weekly_run", studentId, weekKeyword };
    }

    return null;
  }

  if (data === "tp:actions:list") {
    return { kind: "actions_list" };
  }

  if (data === TP_CALLBACK_SIGNALS) {
    return { kind: "signals_list" };
  }

  if (data === TP_CALLBACK_ACTION_DETAIL_BACK) {
    return { kind: "action_detail_back" };
  }

  if (data.startsWith(TP_CALLBACK_CASE_RESOLVE_PREFIX)) {
    const shortId = data.slice(TP_CALLBACK_CASE_RESOLVE_PREFIX.length).trim();
    return shortId ? { kind: "case_resolve", shortId } : null;
  }

  if (data.startsWith(TP_CALLBACK_CASE_DISMISS_PREFIX)) {
    const shortId = data.slice(TP_CALLBACK_CASE_DISMISS_PREFIX.length).trim();
    return shortId ? { kind: "case_dismiss", shortId } : null;
  }

  if (data.startsWith(TP_CALLBACK_CASE_PROPOSE_PREFIX)) {
    const shortId = data.slice(TP_CALLBACK_CASE_PROPOSE_PREFIX.length).trim();
    return shortId ? { kind: "case_create_proposals", shortId } : null;
  }

  if (data.startsWith("tp:s:")) {
    const page = Number.parseInt(data.slice("tp:s:".length), 10);

    if (Number.isInteger(page) && page >= 0) {
      return { kind: "students_page", page };
    }

    return null;
  }

  for (const [prefix, kind] of [
    ["tp:i:", "student_card"],
    ["tp:r:", "student_report"],
    ["tp:d:", "student_disable"],
    ["tp:e:", "student_enable"],
    [TP_CALLBACK_STUDENT_LINK_PREFIX, "student_link"],
    [TP_CALLBACK_STUDENT_USERNAME_PREFIX, "student_username_prompt"],
    [TP_CALLBACK_STUDENT_LINK_CODE_PREFIX, "student_link_code"],
    [TP_CALLBACK_STUDENT_TEST_PREFIX, "student_test"],
    [TP_CALLBACK_STUDENT_TOOLS_PREFIX, "student_tools_menu"],
    [TP_CALLBACK_STUDENT_RACE_RESULTS_PROBE_PREFIX, "student_race_results_probe"],
  ] as const) {
    if (data.startsWith(prefix)) {
      const studentId = data.slice(prefix.length).trim();
      return studentId ? { kind, studentId } : null;
    }
  }

  if (data.startsWith(TP_CALLBACK_STUDENT_CONTEXT_PREFIX)) {
    const studentIdPrefix = data.slice(TP_CALLBACK_STUDENT_CONTEXT_PREFIX.length).trim();
    return studentIdPrefix ? { kind: "student_context", studentId: studentIdPrefix } : null;
  }

  if (data.startsWith(TP_CALLBACK_STUDENT_SELECT_CHAT_PREFIX)) {
    const rest = data.slice(TP_CALLBACK_STUDENT_SELECT_CHAT_PREFIX.length);
    const separatorIndex = rest.lastIndexOf(":");

    if (separatorIndex <= 0) {
      return null;
    }

    const studentId = rest.slice(0, separatorIndex).trim();
    const chatKey = rest.slice(separatorIndex + 1).trim();
    return studentId && chatKey ? { kind: "student_choose_chat", studentId, chatKey } : null;
  }

  for (const [prefix, kind] of [
    [TP_CALLBACK_REPORT_SEND_PREFIX, "report_send"],
    [TP_CALLBACK_REPORT_SKIP_PREFIX, "report_skip"],
    [TP_CALLBACK_ACTION_APPROVE_PREFIX, "action_approve"],
    [TP_CALLBACK_ACTION_REJECT_PREFIX, "action_reject"],
    [TP_CALLBACK_ACTION_EXECUTE_PREFIX, "action_execute_request"],
    [TP_CALLBACK_ACTION_RECHECK_DRY_RUN_PREFIX, "action_recheck_dry_run"],
    [TP_CALLBACK_ACTION_CANCEL_PREFIX, "action_execute_cancel"],
    [TP_CALLBACK_ACTION_LIST_CANCEL_PREFIX, "action_list_cancel"],
    [TP_CALLBACK_ACTION_DETAIL_PREFIX, "action_detail"],
    [TP_CALLBACK_ACTION_DETAIL_CANCEL_PREFIX, "action_detail_cancel"],
    [TP_CALLBACK_ACTION_CONFIRM_SOURCE_PREFIX, "action_confirm_source_date"],
  ] as const) {
    if (data.startsWith(prefix)) {
      const id = data.slice(prefix.length).trim();

      if (!id) {
        return null;
      }

      if (kind === "report_send" || kind === "report_skip") {
        return { kind, reportId: id };
      }

      return { kind, actionId: id };
    }
  }

  return null;
}

function getTrainingPeaksMainMenuText(): string {
  return [
    "🏠 TrainingPeaks Coach Command Center",
    "",
    "Выберите рабочий сценарий. Кнопки ниже ведут в существующие безопасные экраны или показывают команду-fallback.",
  ].join("\n");
}

function getStartDeepLinkFallbackMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getTrainingPeaksMainMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🌅 Утренний обзор", TP_CALLBACK_ATTENTION)],
    [createMenuButton("🧩 Кейсы", TP_CALLBACK_CASES_RECENT)],
    [createMenuButton("📋 Заявки на перенос", "tp:actions:list")],
    [createMenuButton("✉️ Черновики ответов", TP_CALLBACK_REPLY_DRAFT_HINT)],
    [createMenuButton("📊 Отчёты", TP_CALLBACK_REPORTS_MENU)],
    [createMenuButton("👥 Ученики", "tp:s:0")],
    [createMenuButton("💳 Биллинг", TP_CALLBACK_BILLING_HINT)],
    [createMenuButton("⚙️ Служебное", TP_CALLBACK_MORE_MENU)],
  ]);
}

function getStudentsEmptyMenuText(): string {
  return [
    "👥 Ученики",
    "",
    "Ученики TrainingPeaks пока не найдены.",
    "",
    "Добавление учеников теперь выполняется в админке.",
  ].join("\n");
}

function getStudentsEmptyMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getStudentsPageMarkup(
  students: {
    id: string;
    studentName: string;
  }[],
  page: number,
  totalPages: number
): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = students.map((student) => [
    createMenuButton(student.studentName, `tp:i:${student.id}`),
  ]);

  if (totalPages > 1) {
    const paginationRow: TrainingPeaksMenuButton[] = [];

    if (page > 0) {
      paginationRow.push(createMenuButton("◀️", `tp:s:${page - 1}`));
    }

    if (page < totalPages - 1) {
      paginationRow.push(createMenuButton("▶️", `tp:s:${page + 1}`));
    }

    if (paginationRow.length > 0) {
      rows.push(paginationRow);
    }
  }

  rows.push([createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]);

  return createInlineKeyboardMarkup(rows);
}

function getStudentsPageText(
  students: {
    studentName: string;
  }[],
  page: number,
  totalPages: number
): string {
  return [
    "👥 Ученики",
    "",
    getStudentsPageSummary(students, page, totalPages),
  ].join("\n");
}

function getStudentsPageSummary(
  students: {
    studentName: string;
  }[],
  page: number,
  totalPages: number
): string {
  return [
    `Страница ${page + 1} из ${Math.max(totalPages, 1)}`,
    ...students.map((student) => `• ${student.studentName}`),
  ].join("\n");
}

function getStudentCardMenuMarkup(
  student: {
    id: string;
    isActive: boolean;
    telegramChatId: string | null;
    telegramDeliveryEnabled: boolean;
  }
): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = [
    [createMenuButton("📅 Отчёт за прошлую неделю", `${TP_CALLBACK_STUDENT_RUN_PREFIX}${student.id}:last`)],
    [createMenuButton("📅 Отчёт за текущую неделю", `${TP_CALLBACK_STUDENT_RUN_PREFIX}${student.id}:current`)],
    [createMenuButton("📄 Последний отчёт", `tp:r:${student.id}`)],
    [createMenuButton("🔗 Привязать Telegram", `${TP_CALLBACK_STUDENT_LINK_PREFIX}${student.id}`)],
    [createMenuButton("🔎 Найти username", `${TP_CALLBACK_STUDENT_USERNAME_PREFIX}${student.id}`)],
    [createMenuButton("🔗 Код привязки", `${TP_CALLBACK_STUDENT_LINK_CODE_PREFIX}${student.id}`)],
  ];

  if (student.telegramChatId && student.telegramDeliveryEnabled) {
    rows.push([createMenuButton("📨 Отправить тест", `${TP_CALLBACK_STUDENT_TEST_PREFIX}${student.id}`)]);
  }

  rows.push([createMenuButton("🧰 Инструменты", `${TP_CALLBACK_STUDENT_TOOLS_PREFIX}${student.id}`)]);
  rows.push([
    createMenuButton(student.isActive ? "⛔ Отключить" : "✅ Включить", `${student.isActive ? "tp:d" : "tp:e"}:${student.id}`),
  ]);
  rows.push([createMenuButton("👥 К ученикам", "tp:s:0"), createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]);

  return createInlineKeyboardMarkup(rows);
}

function getStudentToolsMenuMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🏁 Результаты по дистанциям", `${TP_CALLBACK_STUDENT_RACE_RESULTS_PROBE_PREFIX}${studentId}`)],
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentToolsMenuText(studentName: string): string {
  return ["🧰 Инструменты", "", `Ученик: ${studentName}`, "", "Выберите действие:"].join("\n");
}

function getStudentNotFoundMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученикам", "tp:s:0")],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentReportMissingMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramLinkEmptyText(): string {
  return [
    "Пока нет входящих Telegram Business чатов.",
    "Пусть ученик сначала напишет тебе любое сообщение.",
  ].join("\n");
}

function getStudentTelegramLinkEmptyMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramUsernamePromptText(studentName: string): string {
  return [
    `🔎 Поиск по username: ${studentName}`,
    "",
    "Отправь username ученика одним сообщением.",
    "Подойдут оба варианта: @username или username.",
  ].join("\n");
}

function getStudentTelegramUsernamePromptMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramUsernameNotFoundText(): string {
  return "Не нашёл этот username среди последних Business-чатов. Попроси ученика написать тебе любое сообщение в Telegram и повтори привязку.";
}

function getStudentTelegramUsernameMatchesText(
  studentName: string,
  username: string,
  chats: {
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    lastText: string | null;
    chatId: string;
  }[]
): string {
  return [
    `🔎 Поиск по username: ${studentName}`,
    "",
    `Нашлось несколько Business-чатов с username ${formatTelegramUsername(username)}.`,
    "Выбери нужный чат:",
    "",
    ...chats.map((chat) => {
      const lastText = chat.lastText ?? "без текста";
      return `• ${getTelegramBusinessChatDisplayName(chat)} — ${lastText}`;
    }),
  ].join("\n");
}

function getStudentTelegramLinkCodeText(
  studentName: string,
  code: string,
  expiresAt: string
): string {
  return [
    `🔗 Код привязки: ${studentName}`,
    "",
    `Код: ${code}`,
    `Действует до: ${formatLinkCodeExpiresAt(expiresAt)}`,
    "",
    "Попроси ученика прислать этот код тебе в Telegram одним сообщением.",
    "Как только код придёт из Business-чата, привязка выполнится автоматически.",
  ].join("\n");
}

function getStudentTelegramLinkCodeMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramLinkMenuText(
  studentName: string,
  chats: {
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    lastText: string | null;
    chatId: string;
  }[]
): string {
  return [
    `🔗 Привязать Telegram: ${studentName}`,
    "",
    "Выбери чат ученика из последних Telegram Business сообщений:",
    "",
    ...chats.map((chat) => {
      const displayName = getTelegramBusinessChatDisplayName(chat);
      const lastText = chat.lastText ?? "без текста";
      return `• ${displayName} — ${lastText}`;
    }),
  ].join("\n");
}

function getStudentTelegramLinkMenuMarkup(
  studentId: string,
  chats: {
    key: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    lastText: string | null;
    chatId: string;
  }[]
): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    ...chats.map((chat) => [
      createMenuButton(
        truncateTelegramLabel(
          `${getTelegramBusinessChatDisplayName(chat)} — ${chat.lastText ?? "без текста"}`,
          64
        ),
        `${TP_CALLBACK_STUDENT_SELECT_CHAT_PREFIX}${studentId}:${chat.key}`
      ),
    ]),
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramLinkSuccessMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("📨 Отправить тест", `${TP_CALLBACK_STUDENT_TEST_PREFIX}${studentId}`)],
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramLinkErrorMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🔗 Привязать Telegram", `${TP_CALLBACK_STUDENT_LINK_PREFIX}${studentId}`)],
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
  ]);
}

async function showTrainingPeaksLinkedStudentCard(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: student.id,
    selectedStudentName: student.studentName,
  });

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentCardMessageLines(student).join("\n"),
      getStudentCardMenuMarkup(student)
    );
    return;
  }

  await showTrainingPeaksMenuScreen(
    parsedMessage,
    getStudentCardMessageLines(student).join("\n"),
    getStudentCardMenuMarkup(student)
  );
}

function getWeekMenuText(): string {
  return ["▶️ Запустить неделю", "Выберите период:"].join("\n");
}

function getWeekMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("Прошлая неделя", TP_CALLBACK_WEEK_LAST)],
    [createMenuButton("Текущая неделя", TP_CALLBACK_WEEK_CURRENT)],
    [createMenuButton("⬅️ Назад", TP_CALLBACK_REPORTS_MENU)],
  ]);
}

function getRacesMenuText(): string {
  return ["🏁 Забеги", "Выберите период или отправьте /tp_races YYYY-MM-DD YYYY-MM-DD."].join("\n");
}

function getRacesMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🗓 Следующая неделя", TP_CALLBACK_RACES_NEXT_WEEK)],
    [
      createMenuButton("7 дней", TP_CALLBACK_RACES_7_DAYS),
      createMenuButton("30 дней", TP_CALLBACK_RACES_30_DAYS),
    ],
    [createMenuButton("До 1 августа", TP_CALLBACK_RACES_TO_AUGUST)],
    [createMenuButton("Свой период", `${TP_CALLBACK_RACES_MENU}:custom`)],
    [createMenuButton("⬅️ Назад", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getJobsMenuMarkup(
  jobs: {
    id: string;
    jobType: string;
    status: string;
    weekFrom: string;
    weekTo: string;
  }[]
): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = [];

  for (const job of jobs) {
    if (job.jobType === "weekly_reports" && job.status === "queued") {
      rows.push([
        createMenuButton(
          `❌ Отменить ${job.weekFrom}`,
          `${TP_CALLBACK_JOB_CANCEL_PREFIX}${job.id}`
        ),
      ]);
    }
  }

  rows.push([createMenuButton("🔄 Обновить задачи", TP_CALLBACK_JOBS)]);
  rows.push([createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]);

  return createInlineKeyboardMarkup(rows);
}

function getReportsMenuText(): string {
  return [
    "📊 Отчёты",
    "",
    "Просмотр и постановка отчётов в очередь. Пачка всегда показывает preview перед confirm, ученикам ничего не отправляется автоматически.",
  ].join("\n");
}

function getReportsMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("👤 Создать одному ученику", TP_CALLBACK_REPORTS_FROM_STUDENT)],
    [createMenuButton("📅 Все за прошлую неделю", TP_CALLBACK_WEEK_LAST)],
    [createMenuButton("📅 Все за текущую неделю", TP_CALLBACK_WEEK_CURRENT)],
    [createMenuButton("🧾 Посмотреть задачи", TP_CALLBACK_JOBS)],
    [createMenuButton("👥 Ученики в генерации", TP_CALLBACK_REPORTS_ELIGIBLE)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getReportsEligibleStudentsText(students: { studentName: string }[]): string {
  if (students.length === 0) {
    return [
      "👥 Ученики в генерации",
      "",
      "Сейчас нет активных учеников с включёнными недельными отчётами.",
    ].join("\n");
  }

  const previewNames = students.slice(0, TP_ALL_ENABLED_WEEKLY_PREVIEW_NAME_LIMIT);
  const remainingCount = Math.max(0, students.length - previewNames.length);

  return [
    "👥 Ученики в генерации",
    "",
    `Учеников: ${students.length}`,
    "",
    ...previewNames.map((student) => `• ${student.studentName}`),
    ...(remainingCount > 0 ? [`… и ещё ${remainingCount}`] : []),
  ].join("\n");
}

function getReportsEligibleStudentsMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К отчётам", TP_CALLBACK_REPORTS_MENU)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getReportsFromStudentText(): string {
  return [
    "👤 Создать одному ученику",
    "",
    "Откройте ученика и нажмите «📅 Отчёт за прошлую неделю» или «📅 Отчёт за текущую неделю»:",
    "👥 Ученики → выберите ученика → 📅 Отчёт",
  ].join("\n");
}

function getReportsFromStudentMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("👥 К ученикам", "tp:s:0")],
    [createMenuButton("⬅️ К отчётам", TP_CALLBACK_REPORTS_MENU)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getMoreMenuText(): string {
  return [
    "⚙️ Служебное",
    "",
    "Редкие и диагностические инструменты. Кнопки ниже не запускают TrainingPeaks execute напрямую.",
  ].join("\n");
}

function getMoreMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🩺 Health", TP_CALLBACK_HEALTH)],
    [createMenuButton("🕓 Cron status", TP_CALLBACK_CRON_STATUS)],
    [createMenuButton("🧾 Очередь задач", TP_CALLBACK_JOBS)],
    [createMenuButton("🧠 Intent logs", TP_CALLBACK_INTENTS)],
    [createMenuButton("🏁 Забеги", TP_CALLBACK_RACES_MENU)],
    [createMenuButton("🔗 Telegram links", TP_CALLBACK_TELEGRAM_LINKS_HINT)],
    [createMenuButton("❓ Помощь", TP_CALLBACK_HELP)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getHelpMenuText(): string {
  return getTrainingPeaksHelpLines().join("\n");
}

function getHelpMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ Служебное", TP_CALLBACK_MORE_MENU)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getReplyDraftHintText(): string {
  return [
    "✉️ Черновики ответов",
    "",
    "Сейчас это command-only workflow, потому что нужен текст сообщения ученика.",
    "",
    "Создать черновик:",
    "/tp_reply_draft <ученик> <сообщение ученика>",
    "",
    "Зафиксировать фидбек:",
    "/tp_draft_feedback <draft_id> used|edited|ignored [заметка]",
    "",
    "Черновик только показывается тренеру. Ученику ничего не отправляется автоматически.",
  ].join("\n");
}

function getReplyDraftHintMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("👥 Ученики", "tp:s:0")],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function formatReplyDraftSendCallbackResultText(input: {
  result: Awaited<ReturnType<typeof sendTrainingPeaksReplyDraftToStudent>>;
}): string {
  const { result } = input;
  if (result.kind === "sent") {
    return ["Отправлено ✅", "", "Ученик:", result.studentName, "", "Ничего больше делать не нужно."].join(
      "\n"
    );
  }

  if (result.kind === "already_final") {
    return "Черновик уже обработан. Повторная отправка недоступна.";
  }
  if (result.kind === "missing_draft_text") {
    return "Черновик нельзя отправить: отсутствует текст.";
  }
  if (result.kind === "student_missing") {
    return "Не удалось отправить: ученик не найден.";
  }
  if (result.kind === "student_inactive") {
    return "Не удалось отправить: ученик неактивен.";
  }
  if (result.kind === "telegram_not_linked") {
    return "Не удалось отправить: Telegram у ученика не привязан.";
  }
  if (result.kind === "delivery_disabled") {
    return "Не удалось отправить: доставка ученику отключена.";
  }
  if (result.kind === "missing_business_connection") {
    return "Не удалось отправить: не настроено подключение Telegram Business.";
  }
  if (result.kind === "peer_usage_missing") {
    return "Telegram Business пока не может написать этому ученику. Попроси его написать в Business-чат и попробуй снова с новым черновиком.";
  }
  if (result.kind === "delivery_failed") {
    return "Не удалось отправить сообщение через Telegram Business.";
  }
  if (result.kind === "state_conflict") {
    return "Черновик сейчас нельзя обработать из-за конфликта состояния. Попробуй позже.";
  }
  return "Черновик не найден.";
}

function getBillingHintText(): string {
  return [
    "💳 Биллинг",
    "",
    "Биллинг живёт в отдельном наборе команд /bill.",
    "",
    "Открыть сводку: /bill",
    "Список оплат: /bill_list",
    "Справка: /bill_help",
    "",
    "Команды отметки оплат остаются ручными:",
    "/bill_paid <name_or_id> [amount]",
    "/bill_unpaid <name_or_id> [YYYY-MM]",
    "",
    "Из этого меню не запускается email import, auto-match или изменение оплат.",
  ].join("\n");
}

function getBillingHintMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getIntentsHintText(): string {
  return [
    "🧠 Intent logs",
    "",
    "Read-only triage непонятых TrainingPeaks сообщений.",
    "",
    "Команда:",
    "/tp_intents",
    "",
    "Фильтры:",
    "/tp_intents unknown",
    "/tp_intents ai",
  ].join("\n");
}

function getIntentsHintMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ Служебное", TP_CALLBACK_MORE_MENU)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getTelegramLinksHintText(): string {
  return [
    "🔗 Telegram links",
    "",
    "Основной путь: Web Admin или карточка ученика.",
    "",
    "В карточке ученика доступны fallback-кнопки:",
    "🔗 Привязать Telegram",
    "🔎 Найти username",
    "🔗 Код привязки",
    "",
    "Топики групп:",
    "/tp_link_thread <ученик>",
    "/tp_thread_info",
    "/tp_unlink_thread",
  ].join("\n");
}

function getTelegramLinksHintMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("👥 Ученики", "tp:s:0")],
    [createMenuButton("⬅️ Служебное", TP_CALLBACK_MORE_MENU)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getAddStudentInstructionsText(): string {
  return [
    TP_ADD_STUDENT_DEPRECATED_MESSAGE,
    "",
    "Основной путь: Web Admin -> Ученики.",
    "",
    "Legacy fallback по команде всё ещё доступен:",
    `/tp_add_student ${TP_ADD_STUDENT_EXAMPLE}`,
  ].join("\n");
}

function getRaceScanQueuedMessage(fromDate: string, toDate: string): string {
  return [
    "Запросил список забегов. Локальный Mac проверит TrainingPeaks и пришлёт результат.",
    "",
    `Период: ${formatLongDate(fromDate)} — ${formatLongDate(toDate)}`,
  ].join("\n");
}

function getRaceScanManualUsageMessage(): string {
  return ["Свой период:", "/tp_races 2026-05-17 2026-08-01"].join("\n");
}

function presentTrainingPeaksRaceScanRequestResult(input: {
  fromDate: string;
  toDate: string;
  result: RequestTrainingPeaksRaceScanResult;
}): string {
  if (input.result.ok) {
    return getRaceScanQueuedMessage(input.fromDate, input.toDate);
  }
  if (input.result.reason === "duplicate" && input.result.activeJob) {
    return [
      "Такой запрос уже в очереди или выполняется на локальном Mac.",
      `Период: ${formatLongDate(input.fromDate)} — ${formatLongDate(input.toDate)}`,
      `Статус: ${getJobStatusLabel(input.result.activeJob.status)}`,
    ].join("\n");
  }
  return input.result.message;
}

function getRacesNextWeekPeriod(): { fromDate: string; toDate: string } {
  const todayIso = getBelgradeTodayIso();
  const todayDate = new Date(`${todayIso}T12:00:00Z`);
  const parts = getBelgradeDateParts(todayDate);
  const daysUntilNextMonday = ((8 - parts.weekday) % 7) || 7;
  const fromDate = addBelgradeDaysIso(todayIso, daysUntilNextMonday);
  const toDate = addBelgradeDaysIso(fromDate, 6);
  return { fromDate, toDate };
}

function getRaces7DaysPeriod(): { fromDate: string; toDate: string } {
  const fromDate = getBelgradeTodayIso();
  return { fromDate, toDate: addBelgradeDaysIso(fromDate, 7) };
}

function getRaces30DaysPeriod(): { fromDate: string; toDate: string } {
  const fromDate = getBelgradeTodayIso();
  return { fromDate, toDate: addBelgradeDaysIso(fromDate, 30) };
}

function getRacesToAugustPeriod(): { fromDate: string; toDate: string } {
  const fromDate = getBelgradeTodayIso();
  const currentYear = Number(fromDate.slice(0, 4));
  return { fromDate, toDate: `${String(currentYear).padStart(4, "0")}-08-01` };
}

function getAddStudentInstructionsMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getCallbackErrorMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getJobsScreenText(
  jobs: {
    scope?: string;
    studentId?: string | null;
    status: string;
    weekFrom: string;
    weekTo: string;
    resultJson: unknown | null;
    errorMessage: string | null;
  }[]
): string {
  return jobs.length === 0 ? "🧾 Задачи TrainingPeaks\n\nПока задач нет." : formatJobsMessage(jobs);
}

function getSelectedStudentMissingText(): string {
  return [
    "Не вижу, для какого ученика открыть действие.",
    "Сначала выберите ученика через «👥 Ученики».",
  ].join("\n");
}

async function findStudentByExactReplyButtonName(text: string): Promise<
  | {
      kind: "student";
      student: Awaited<ReturnType<typeof getTrainingPeaksStudentsRegistryWithLatestReportStatus>>[number];
    }
  | { kind: "ambiguous"; matches: { studentId: string; studentName: string }[] }
  | { kind: "not_found" }
> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
  const matches = students.filter((student) => student.studentName === text);

  if (matches.length === 0) {
    return { kind: "not_found" };
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      matches: matches.map((student) => ({
        studentId: student.studentId,
        studentName: student.studentName,
      })),
    };
  }

  return {
    kind: "student",
    student: matches[0]!,
  };
}

async function showTrainingPeaksSelectedStudentFallback(
  parsedMessage: ParsedTelegramUpdate
): Promise<void> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();

  if (students.length === 0) {
    clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "main_menu");
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getSelectedStudentMissingText(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "students");
  await showTrainingPeaksStudentsPage(parsedMessage, 0);
}

function getSelectedStudentContext(chatId: number | string): {
  selectedStudentId: string;
  selectedStudentName: string;
} | null {
  const context = getTrainingPeaksChatContext(chatId);

  if (!context?.selectedStudentId || !context.selectedStudentName) {
    return null;
  }

  return {
    selectedStudentId: context.selectedStudentId,
    selectedStudentName: context.selectedStudentName,
  };
}

async function showTrainingPeaksMainMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "main_menu");
  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, getTrainingPeaksMainMenuText(), getTrainingPeaksMainMenuMarkup());
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getTrainingPeaksMainMenuText(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function showTrainingPeaksStudentsPage(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  requestedPage: number
): Promise<void> {
  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();

  if (students.length === 0) {
    clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "students");

    if (parsedMessage.kind === "callback_query") {
      await showTrainingPeaksMenuScreen(parsedMessage, getStudentsEmptyMenuText(), getStudentsEmptyMenuMarkup());
      return;
    }

    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getStudentsEmptyMenuText(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "students");

  const totalPages = Math.max(1, Math.ceil(students.length / STUDENTS_PAGE_SIZE));
  const safePage = Math.min(Math.max(requestedPage, 0), totalPages - 1);
  const startIndex = safePage * STUDENTS_PAGE_SIZE;
  const pageStudents = students.slice(startIndex, startIndex + STUDENTS_PAGE_SIZE);
  const text = getStudentsPageText(pageStudents, safePage, totalPages);
  const markup = getStudentsPageMarkup(pageStudents, safePage, totalPages);

  await showTrainingPeaksMenuScreen(parsedMessage, text, markup);
}

async function showTrainingPeaksStudentCardMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    const text = "Ученик больше не найден.";
    const markup = getStudentNotFoundMarkup();

    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, markup);
      return;
    }

    clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "students");
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      text,
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  const text = getStudentCardMessageLines(student).join("\n");
  const markup = getStudentCardMenuMarkup(student);
  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: student.id,
    selectedStudentName: student.studentName,
  });

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, markup);
    return;
  }

  await showTrainingPeaksMenuScreen(parsedMessage, text, markup);
}

async function showTrainingPeaksStudentToolsMenu(
  parsedMessage: ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Ученик больше не найден.",
      getStudentNotFoundMarkup()
    );
    return;
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    getStudentToolsMenuText(student.studentName),
    getStudentToolsMenuMarkup(student.id)
  );
}

async function handleTrainingPeaksStudentRaceResultsProbeCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Ученик больше не найден.",
      getStudentNotFoundMarkup()
    );
    return;
  }

  const result = await requestTrainingPeaksRaceResultsProbeJob(student.id, String(parsedMessage.chatId));

  if (result.ok) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      [
        "🏁 Задача создана. Mac выполнит отчёт по дистанциям и пришлёт результат сюда.",
        "",
        `Ученик: ${student.studentName}`,
      ].join("\n"),
      getStudentToolsMenuMarkup(student.id)
    );
    return;
  }

  if (result.reason === "duplicate") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      ["Такая задача уже в очереди или выполняется.", "", `Ученик: ${student.studentName}`].join("\n"),
      getStudentToolsMenuMarkup(student.id)
    );
    return;
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    [result.message, "", `Ученик: ${student.studentName}`].join("\n"),
    getStudentToolsMenuMarkup(student.id)
  );
}

async function showTrainingPeaksStudentTelegramLinkMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const [student, chats] = await Promise.all([
    getTrainingPeaksStudentCardByInternalId(studentId),
    listRecentTrainingPeaksBusinessChats(10),
  ]);

  if (!student) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  if (chats.length === 0) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentTelegramLinkEmptyText(),
        getStudentTelegramLinkEmptyMarkup(student.id)
      );
      return;
    }

    await sendTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      getStudentTelegramLinkEmptyText(),
      getStudentTelegramLinkEmptyMarkup(student.id)
    );
    return;
  }

  const chatsWithKeys = chats.map((chat, index) => ({
    ...chat,
    key: index.toString(36),
  }));

  setTrainingPeaksTelegramLinkContext(
    parsedMessage.chatId,
    student.id,
    Object.fromEntries(chatsWithKeys.map((chat) => [chat.key, chat.id]))
  );
  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: student.id,
    selectedStudentName: student.studentName,
  });

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentTelegramLinkMenuText(student.studentName, chatsWithKeys),
      getStudentTelegramLinkMenuMarkup(student.id, chatsWithKeys)
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    getStudentTelegramLinkMenuText(student.studentName, chatsWithKeys),
    getStudentTelegramLinkMenuMarkup(student.id, chatsWithKeys)
  );
}

async function promptTrainingPeaksStudentUsernameLookup(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
  setTrainingPeaksUsernameWaitingContext(parsedMessage.chatId, student.id, student.studentName);

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentTelegramUsernamePromptText(student.studentName),
      getStudentTelegramUsernamePromptMarkup(student.id)
    );
    return;
  }

  await showTrainingPeaksMenuScreen(
    parsedMessage,
    getStudentTelegramUsernamePromptText(student.studentName),
    getStudentTelegramUsernamePromptMarkup(student.id)
  );
}

async function handleTrainingPeaksStudentUsernameLookup(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string,
  rawUsername: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  const username = normalizeTelegramUsernameLookup(rawUsername);

  if (!username) {
    setTrainingPeaksUsernameWaitingContext(parsedMessage.chatId, student.id, student.studentName);

    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentTelegramUsernamePromptText(student.studentName),
        getStudentTelegramUsernamePromptMarkup(student.id)
      );
      return;
    }

    await showTrainingPeaksMenuScreen(
      parsedMessage,
      [
        "Не вижу username.",
        "",
        getStudentTelegramUsernamePromptText(student.studentName),
      ].join("\n"),
      getStudentTelegramUsernamePromptMarkup(student.id)
    );
    return;
  }

  const chats = await findTrainingPeaksBusinessChatsByUsername(username, 10);
  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: student.id,
    selectedStudentName: student.studentName,
  });

  if (chats.length === 0) {
    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);

    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentTelegramUsernameNotFoundText(),
        getStudentTelegramLinkErrorMarkup(student.id)
      );
      return;
    }

    await showTrainingPeaksMenuScreen(
      parsedMessage,
      getStudentTelegramUsernameNotFoundText(),
      getStudentTelegramLinkErrorMarkup(student.id)
    );
    return;
  }

  if (chats.length === 1) {
    const linked = await linkTrainingPeaksStudentToBusinessChat(
      student.id,
      chats[0]!.chatId,
      chats[0]!.businessConnectionId
    );

    if (!linked) {
      clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);

      if (parsedMessage.kind === "callback_query") {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Не удалось привязать Telegram. Попробуй ещё раз.",
          getStudentTelegramLinkErrorMarkup(student.id)
        );
        return;
      }

      await showTrainingPeaksMenuScreen(
        parsedMessage,
        "Не удалось привязать Telegram. Попробуй ещё раз.",
        getStudentTelegramLinkErrorMarkup(student.id)
      );
      return;
    }

    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
    await showTrainingPeaksLinkedStudentCard(parsedMessage, linked.student.id);
    return;
  }

  const chatsWithKeys = chats.map((chat, index) => ({
    ...chat,
    key: index.toString(36),
  }));

  setTrainingPeaksTelegramLinkContext(
    parsedMessage.chatId,
    student.id,
    Object.fromEntries(chatsWithKeys.map((chat) => [chat.key, chat.id]))
  );

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentTelegramUsernameMatchesText(student.studentName, username, chatsWithKeys),
      getStudentTelegramLinkMenuMarkup(student.id, chatsWithKeys)
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    getStudentTelegramUsernameMatchesText(student.studentName, username, chatsWithKeys),
    getStudentTelegramLinkMenuMarkup(student.id, chatsWithKeys)
  );
}

async function handleTrainingPeaksStudentLinkCodeRequest(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const result = await createTrainingPeaksStudentTelegramLinkCode(studentId);

  if (!result) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: result.student.id,
    selectedStudentName: result.student.studentName,
  });

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentTelegramLinkCodeText(
        result.student.studentName,
        result.linkCode.code,
        result.linkCode.expiresAt
      ),
      getStudentTelegramLinkCodeMarkup(result.student.id)
    );
    return;
  }

  await showTrainingPeaksMenuScreen(
    parsedMessage,
    getStudentTelegramLinkCodeText(
      result.student.studentName,
      result.linkCode.code,
      result.linkCode.expiresAt
    ),
    getStudentTelegramLinkCodeMarkup(result.student.id)
  );
}

async function notifyCoachChats(text: string): Promise<void> {
  const coachChatIds = getTrainingPeaksCoachChatIds();

  if (coachChatIds.length === 0) {
    return;
  }

  await Promise.allSettled(
    coachChatIds.map(async (chatId) => {
      await sendTelegramMessage(chatId, text);
    })
  );
}

async function notifyCoachChatsWithMarkup(
  text: string,
  replyMarkup: TelegramInlineKeyboardMarkup
): Promise<void> {
  const coachChatIds = getTrainingPeaksCoachChatIds();

  if (coachChatIds.length === 0) {
    return;
  }

  await Promise.allSettled(
    coachChatIds.map(async (chatId) => {
      await sendTelegramMessage(chatId, text, {
        replyMarkup,
      });
    })
  );
}

function getTrainingPeaksActionDecisionMarkup(actionId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("✅ Перенести", `${TP_CALLBACK_ACTION_APPROVE_PREFIX}${actionId}`)],
    [createMenuButton("❌ Отклонить", `${TP_CALLBACK_ACTION_REJECT_PREFIX}${actionId}`)],
  ]);
}

function getTrainingPeaksActionResolvedMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([]);
}

function isMoveActionAutoApprovedForDryRun(parsedPayload: unknown): boolean {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return false;
  }
  const payload = parsedPayload as {
    parsingDiagnostics?: {
      autoApprovedForDryRun?: unknown;
    };
  };
  return payload.parsingDiagnostics?.autoApprovedForDryRun === true;
}

function formatActionCompactDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Belgrade",
  }).format(date);
}

function extractMoveDateRangeFromParsedPayload(
  parsedPayload: unknown
): { sourceDate: string | null; targetDate: string | null } {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return { sourceDate: null, targetDate: null };
  }
  const payload = parsedPayload as {
    source?: { kind?: string; value?: string };
    target?: { kind?: string; value?: string };
    sourceDate?: string;
    source_date?: string;
  };
  const sourceDate =
    payload.sourceDate ??
    payload.source_date ??
    (payload.source?.kind === "date" && typeof payload.source.value === "string" ? payload.source.value : null);
  const targetDate =
    payload.target?.kind === "date" && typeof payload.target.value === "string" ? payload.target.value : null;
  return {
    sourceDate: sourceDate ?? null,
    targetDate: targetDate ?? null,
  };
}

function extractMoveWarningsFromParsedPayload(parsedPayload: unknown): string[] {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return [];
  }
  const payload = parsedPayload as { warnings?: unknown };
  if (!Array.isArray(payload.warnings)) {
    return [];
  }
  return payload.warnings.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatTrainingPeaksMoveActionProcessingMessage(input: {
  studentName: string;
  rawText: string;
  parsedPayload: unknown;
}): string {
  const preview = extractMoveDateRangeFromParsedPayload(input.parsedPayload);
  const previewLine =
    preview.sourceDate || preview.targetDate
      ? `Предварительно: ${formatCompactDateShort(preview.sourceDate)} → ${formatCompactDateShort(preview.targetDate)}`
      : null;

  return [
    "⏳ Заявка на перенос создана. Проверяю в TrainingPeaks...",
    "",
    `Ученик: ${input.studentName}`,
    `Запрос: «${truncateActionMessage(input.rawText, 160)}»`,
    previewLine,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function truncateActionMessage(value: string, maxLength = 90): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function shortenActionId(value: string): string {
  return value.slice(-6);
}

function formatCompactDateShort(value: string | null): string {
  if (!value) {
    return "?";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return "?";
  }
  return `${match[3]}.${match[2]}`;
}

function isActionWaitingDryRunRecheck(action: {
  executionStatus: string;
  executionMode: string | null;
  latestRunContext?: { latestDryRun?: unknown } | null;
}): boolean {
  if (action.executionStatus !== "not_started") {
    return false;
  }
  if (action.executionMode !== "dry_run") {
    return false;
  }
  const latestDryRun = action.latestRunContext?.latestDryRun;
  return Boolean(latestDryRun && typeof latestDryRun === "object");
}

function formatSourcePolicyLabel(policy: string | null | undefined): string {
  if (!policy) {
    return "не указан";
  }
  if (policy === "coach_confirmed_source_date") {
    return "подтверждено тренером";
  }
  if (policy === "explicit_source_date" || policy === "explicit_source_ref") {
    return "явно указан";
  }
  return "определён автоматически";
}

function shouldShowCoachConfirmSourceButton(latestRunContext: unknown): boolean {
  if (!latestRunContext || typeof latestRunContext !== "object") {
    return false;
  }
  const dryRun = (latestRunContext as { latestDryRun?: unknown }).latestDryRun;
  if (!dryRun || typeof dryRun !== "object") {
    return false;
  }
  const run = dryRun as {
    runType?: unknown;
    status?: unknown;
    dryRunResult?: unknown;
    canExecute?: unknown;
    selectedSourceDate?: unknown;
    selectedSourceDatePolicy?: unknown;
    blockedReason?: unknown;
    logJson?: unknown;
  };
  const policy =
    typeof run.selectedSourceDatePolicy === "string" && run.selectedSourceDatePolicy.trim()
      ? run.selectedSourceDatePolicy.trim()
      : null;
  return (
    run.runType === "dry_run" &&
    run.status === "completed" &&
    Boolean(policy) &&
    policy !== "coach_confirmed_source_date" &&
    policy !== "explicit_source_date" &&
    policy !== "explicit_source_ref" &&
    isEligibleForCoachSourceDateConfirmation(run.logJson)
  );
}

function shouldShowActionDryRunRecheckButton(
  action: NonNullable<Awaited<ReturnType<typeof getTrainingPeaksActionWithStudentAndLatestRunContextById>>>
): boolean {
  if (action.actionType !== "move_workout") {
    return false;
  }
  if (action.status === "rejected") {
    return false;
  }
  if (action.executionStatus === "completed" || action.executionStatus === "running_local" || action.executionStatus === "dry_run_running") {
    return false;
  }
  const latestDryRun = action.latestRunContext?.latestDryRun ?? null;
  if (!latestDryRun || latestDryRun.status !== "completed") {
    return false;
  }
  if (latestDryRun.dryRunResult === "not_found" || latestDryRun.dryRunResult === "failed" || latestDryRun.dryRunResult === "ambiguous") {
    return true;
  }
  if (latestDryRun.canExecute === false) {
    return true;
  }
  if (latestDryRun.blockedReason || latestDryRun.failureReason) {
    return true;
  }
  return false;
}

function shouldShowActionExecuteButton(
  action: NonNullable<Awaited<ReturnType<typeof getTrainingPeaksActionWithStudentAndLatestRunContextById>>>
): boolean {
  if (action.actionType !== "move_workout" || action.status !== "approved") {
    return false;
  }
  if (action.executionStatus !== "dry_run_completed") {
    return false;
  }
  const latestDryRun = action.latestRunContext?.latestDryRun ?? null;
  const manualExecuteReady =
    latestDryRun?.status === "completed" &&
    Boolean(latestDryRun.logJson) &&
    validateDryRunLogReadiness(latestDryRun.logJson, action.parsedPayload).ok &&
    isCoachConfirmedSourceDateManualExecuteReady(latestDryRun.logJson, action.parsedPayload);
  return (
    latestDryRun?.status === "completed" &&
    latestDryRun.dryRunResult === "candidate_found" &&
    (latestDryRun.canExecute === true || manualExecuteReady)
  );
}

function formatActionDetailFreshnessLabel(date = new Date()): string {
  return `Проверено: ${date.toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Belgrade",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function stripActionDetailFreshness(text: string | null | undefined): string {
  if (!text) {
    return "";
  }
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("Проверено: "))
    .join("\n")
    .trim();
}

function getTpActionsListText(
  actions: Awaited<ReturnType<typeof listRecentTrainingPeaksActionsWithLatestRunContext>>
): string {
  return buildCoachActionsListText(actions);
}

function getTpActionsListMarkup(
  actions: Awaited<ReturnType<typeof listRecentTrainingPeaksActionsWithLatestRunContext>>
): TelegramInlineKeyboardMarkup {
  const activeActions = listCoachActionListActiveActions(actions);

  const rows: TrainingPeaksMenuButton[][] = [];

  const ROW_SIZE = 3;
  for (let i = 0; i < activeActions.length; i += ROW_SIZE) {
    const chunk = activeActions.slice(i, i + ROW_SIZE);
    rows.push(
      chunk.map((action, j) =>
        createMenuButton(
          `📋 ${i + j + 1}`,
          `${TP_CALLBACK_ACTION_DETAIL_PREFIX}${action.id}`
        )
      )
    );
  }

  rows.push([createMenuButton("🔄 Обновить", "tp:actions:list")]);
  rows.push([createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]);
  return createInlineKeyboardMarkup(rows);
}

async function showTpActionsList(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  const actions = await listRecentTrainingPeaksActionsWithLatestRunContext(15);
  const text = getTpActionsListText(actions);
  const markup = getTpActionsListMarkup(actions);
  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, markup);
    return;
  }
  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, text, markup);
}

async function handleTrainingPeaksIntents(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const parsedArgs = parseTrainingPeaksIntentsCommandArgs(text);
  if ("error" in parsedArgs) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, parsedArgs.error);
    return;
  }

  const logs = await listTrainingPeaksMessageIntentLogsForTriage({
    limit: parsedArgs.limit,
    sinceHours: 24,
    aiMoveOnly: parsedArgs.aiMoveOnly,
    minAiConfidence: parsedArgs.aiMoveOnly ? 0.75 : undefined,
    statuses: parsedArgs.unknownOnly ? ["unrecognized", "parse_failed"] : undefined,
  });

  const uniqueStudentIds = [
    ...new Set(logs.map((log) => log.studentId).filter((studentId): studentId is string => Boolean(studentId))),
  ];
  const studentNames = new Map<string, string>();

  await Promise.all(
    uniqueStudentIds.map(async (studentId) => {
      const student = await getTrainingPeaksStudentById(studentId);
      if (student?.studentName) {
        studentNames.set(studentId, student.studentName);
      }
    })
  );

  const message = formatTrainingPeaksMessageIntentLogsTriageTelegram(logs, {
    limit: parsedArgs.limit,
    studentNames,
  });

  await sendTrainingPeaksMessage(parsedMessage.chatId, message);
}

const ACTION_CANCELLABLE_EXECUTION_STATUSES = new Set([
  "not_started",
  "dry_run_running",
  "dry_run_completed",
  "execute_pending",
  "failed",
]);

function isActionCancellable(
  action: Awaited<ReturnType<typeof getTrainingPeaksActionWithStudentById>>
): boolean {
  if (!action) {
    return false;
  }
  if (action.status === "rejected") {
    return false;
  }
  if (action.executionStatus === "completed" || action.executionStatus === "running_local") {
    return false;
  }
  if (action.status !== "pending_coach" && action.status !== "approved") {
    return false;
  }
  return ACTION_CANCELLABLE_EXECUTION_STATUSES.has(action.executionStatus);
}

function getTrainingPeaksActionExecuteFinalStateMessage(action: {
  status: string;
  executionStatus: string;
}): string {
  if (action.status === "rejected") {
    return "Эта заявка отменена.";
  }
  if (action.executionStatus === "completed") {
    return "Эта заявка уже выполнена.";
  }
  if (action.executionStatus === "running_local") {
    return "Перенос уже выполняется.";
  }
  if (action.executionStatus === "failed") {
    return "Эта заявка уже завершилась ошибкой. Проверьте /tp_actions.";
  }
  return "Эта заявка уже в финальном состоянии.";
}

function formatActionStatusLabel(action: NonNullable<Awaited<ReturnType<typeof getTrainingPeaksActionWithStudentById>>>): string {
  if (action.status === "rejected") {
    return "❌ Отклонено";
  }
  if (action.executionStatus === "completed") {
    return "✅ Выполнено";
  }
  if (action.executionStatus === "running_local") {
    return "🔄 Выполняется сейчас";
  }
  if (action.executionStatus === "failed") {
    return "⚠️ Ошибка";
  }
  if (action.status === "pending_coach") {
    return "⏳ Ожидает решения";
  }
  if (action.executionStatus === "execute_pending") {
    return "🔄 В очереди на выполнение";
  }
  if (action.executionStatus === "dry_run_running") {
    return "🔄 Проверка идёт";
  }
  if (action.executionStatus === "dry_run_completed") {
    return "🔄 Проверка завершена";
  }
  if (action.executionStatus === "not_started") {
    if (isActionWaitingDryRunRecheck(action)) {
      return "🔁 Ожидает повторной проверки";
    }
    return "🔄 Одобрено, не начато";
  }
  return "🔄 Статус обновляется";
}

function getTpActionDetailText(
  action: NonNullable<Awaited<ReturnType<typeof getTrainingPeaksActionWithStudentAndLatestRunContextById>>>,
  options?: { includeFreshness?: boolean; freshnessLabel?: string }
): string {
  const dates = extractMoveDateRangeFromParsedPayload(action.parsedPayload);
  const src = formatCompactDateShort(dates.sourceDate);
  const tgt = formatCompactDateShort(dates.targetDate);
  const warnings = extractMoveWarningsFromParsedPayload(action.parsedPayload);
  const latestDryRun = action.latestRunContext?.latestDryRun ?? null;
  const latestExecute = action.latestRunContext?.latestExecute ?? null;
  const sourceDate = latestDryRun?.selectedSourceDate ?? dates.sourceDate;
  const sourcePolicy = latestDryRun?.selectedSourceDatePolicy ?? null;
  const lines = [
    `📋 Действие #${shortenActionId(action.id)}`,
    "",
    ...formatTelegramLabeledBlock("Ученик:", action.studentName ?? "?"),
    ...formatTelegramLabeledBlock("Запрос:", truncateActionMessage(action.rawText, 120)),
    ...formatTelegramLabeledBlock("Перенос:", `${src} → ${tgt}`),
    ...formatTelegramLabeledBlock("Статус:", formatActionStatusLabel(action)),
    "Проверка:",
    ...expandCoachRunSummaryForDetail(formatCoachActionRunSummary(latestDryRun, "dry_run")),
    "",
    "Выполнение:",
    ...expandCoachRunSummaryForDetail(formatCoachActionRunSummary(latestExecute, "execute")),
    "",
    ...formatTelegramLabeledBlock(
      "Источник:",
      `${formatCompactDateShort(sourceDate)} — ${formatSourcePolicyLabel(sourcePolicy)}`
    ),
    ...formatTelegramLabeledBlock("Комментарий:", formatCoachActionReasonForDisplay(action.latestRunContext)),
    ...formatTelegramLabeledBlock("Создано:", formatActionCompactDate(action.createdAt)),
  ];
  if (warnings.length > 0) {
    lines.push("Предупреждения:");
    for (const warning of warnings.slice(0, 3)) {
      lines.push(`• ${warning}`);
    }
    lines.push("");
  }
  if (action.approvedAt) {
    lines.push(...formatTelegramLabeledBlock("Одобрено:", formatActionCompactDate(action.approvedAt)));
  }
  if (action.rejectedAt) {
    lines.push(...formatTelegramLabeledBlock("Отклонено:", formatActionCompactDate(action.rejectedAt)));
  }
  if (options?.includeFreshness) {
    lines.push("", options.freshnessLabel ?? formatActionDetailFreshnessLabel());
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

function getTpActionDetailMarkup(
  action: NonNullable<Awaited<ReturnType<typeof getTrainingPeaksActionWithStudentAndLatestRunContextById>>>
): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = [];

  if (shouldShowCoachConfirmSourceButton(action.latestRunContext)) {
    const sourceDate =
      action.latestRunContext?.latestDryRun?.selectedSourceDate ??
      extractMoveDateRangeFromParsedPayload(action.parsedPayload).sourceDate;
    rows.push([
      createMenuButton(
        `✅ Подтвердить ${formatCompactDateShort(sourceDate)} как исходную`,
        `${TP_CALLBACK_ACTION_CONFIRM_SOURCE_PREFIX}${action.id}`
      ),
    ]);
  }

  if (shouldShowActionDryRunRecheckButton(action)) {
    rows.push([
      createMenuButton("🔁 Повторить проверку", `${TP_CALLBACK_ACTION_RECHECK_DRY_RUN_PREFIX}${action.id}`),
    ]);
  }

  if (shouldShowActionExecuteButton(action)) {
    rows.push([
      createMenuButton("✅ Выполнить", `${TP_CALLBACK_ACTION_EXECUTE_PREFIX}${action.id}`),
    ]);
  }

  if (isActionCancellable(action)) {
    rows.push([
      createMenuButton("❌ Отменить", `${TP_CALLBACK_ACTION_DETAIL_CANCEL_PREFIX}${action.id}`),
    ]);
  }

  rows.push([
    createMenuButton("◀ Назад", TP_CALLBACK_ACTION_DETAIL_BACK),
    createMenuButton("🔄 Обновить", `${TP_CALLBACK_ACTION_DETAIL_PREFIX}${action.id}`),
  ]);
  return createInlineKeyboardMarkup(rows);
}

async function showTpActionDetail(
  parsedMessage: ParsedTelegramCallbackUpdate,
  actionId: string
): Promise<void> {
  const action = await getTrainingPeaksActionWithStudentAndLatestRunContextById(actionId);
  if (!action) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Заявка не найдена.",
      createInlineKeyboardMarkup([
        [createMenuButton("◀ Назад к списку", "tp:actions:list")],
      ])
    );
    return;
  }
  const detailText = getTpActionDetailText(action, {
    includeFreshness: true,
  });
  const previousText = typeof parsedMessage.messageText === "string" ? parsedMessage.messageText.trim() : null;
  const previousLogicalText = stripActionDetailFreshness(previousText);
  const currentLogicalText = stripActionDetailFreshness(detailText);
  const noNewRunOrStateChange = previousText !== null && previousLogicalText === currentLogicalText;
  if (noNewRunOrStateChange) {
    await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Изменений нет — нового запуска ещё не было.");
  }
  if (previousText && previousText === detailText.trim()) {
    return;
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    detailText,
    getTpActionDetailMarkup(action)
  );
}

async function handleTpActionDetailCancelCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  actionId: string
): Promise<void> {
  const result = await cancelTrainingPeaksActionExecution({
    actionId,
    cancelledByChatId: String(parsedMessage.chatId),
    cancelledByUserId: parsedMessage.userId === null ? null : String(parsedMessage.userId),
    cancelMessageId: String(parsedMessage.messageId),
  });

  let statusText: string;
  if (result.kind === "cancelled" || result.kind === "already_cancelled") {
    statusText = "✅ Заявка отменена. TrainingPeaks не изменён.";
  } else if (result.kind === "not_cancellable") {
    statusText = `⚠️ Отмена недоступна: ${result.reason}`;
  } else if (result.kind === "final_state") {
    statusText = "⚠️ Заявка уже в финальном состоянии, отмена недоступна.";
  } else {
    statusText = "⚠️ Заявка не найдена.";
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    statusText,
    createInlineKeyboardMarkup([
      [createMenuButton("◀ Назад к списку", "tp:actions:list")],
    ])
  );
}

async function handleTpActionsCancelCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  actionId: string
): Promise<void> {
  const result = await cancelTrainingPeaksActionExecution({
    actionId,
    cancelledByChatId: String(parsedMessage.chatId),
    cancelledByUserId: parsedMessage.userId === null ? null : String(parsedMessage.userId),
    cancelMessageId: String(parsedMessage.messageId),
  });

  let statusText = "";
  if (result.kind === "cancelled" || result.kind === "already_cancelled") {
    statusText = "Заявка снята из очереди. TrainingPeaks не изменён.";
  } else if (result.kind === "not_cancellable") {
    statusText = `Отмена недоступна: ${result.reason}`;
  } else if (result.kind === "final_state") {
    statusText = "Заявка уже в финальном состоянии, отмена недоступна.";
  } else {
    statusText = "Заявка не найдена.";
  }

  const actions = await listRecentTrainingPeaksActionsWithLatestRunContext(15);
  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    `${statusText}\n\n${getTpActionsListText(actions)}`,
    getTpActionsListMarkup(actions)
  );
}

async function handleTrainingPeaksActionConfirmSourceDateCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  actionId: string
): Promise<void> {
  const result = await confirmTrainingPeaksActionSourceDate({
    actionId,
    confirmedByChatId: String(parsedMessage.chatId),
    confirmedByUserId: parsedMessage.userId === null ? null : String(parsedMessage.userId),
    confirmationMessageId: String(parsedMessage.messageId),
  });

  if (result.kind === "not_found") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Заявка не найдена или уже недоступна.",
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  if (result.kind === "blocked") {
    const blockedReason = translateCoachActionTechnicalReason(
      result.reason?.trim() ||
        formatCoachActionReasonForDisplay({ latestDryRun: result.latestDryRun })
    );
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      `⚠️ Подтверждение недоступно.\nПричина: ${blockedReason}`,
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  const formattedDate = formatCompactDateShort(result.confirmedSourceDate);
  const rerunLine = result.dryRunRequeueRequested
    ? "Запущен повторный dry-run — кнопка «Выполнить» появится в новом уведомлении после проверки."
    : "Перейди к заявке, чтобы проверить статус.";
  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    `✅ Исходная дата подтверждена: ${formattedDate}.\n${rerunLine}`,
    createInlineKeyboardMarkup([
      [createMenuButton("◀ К заявке", `${TP_CALLBACK_ACTION_DETAIL_PREFIX}${actionId}`)],
      [createMenuButton("📋 К списку заявок", "tp:actions:list")],
    ])
  );
}

function isTrainingPeaksReplyDraftAutoDetectEnabled(): boolean {
  return process.env.TP_REPLY_DRAFT_AUTO_ENABLED?.trim() === "dry_run";
}

function isTrainingPeaksAutoApproveProgressNotificationEnabled(): boolean {
  const value = process.env.TP_AUTO_APPROVE_PROGRESS_NOTIFY?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isTrainingPeaksLinkSuccessNotificationEnabled(): boolean {
  const value = process.env.TP_LINK_SUCCESS_NOTIFY?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export async function handleTrainingPeaksTelegramBusinessMessage(
  message: Pick<
    TelegramMessage,
    "business_connection_id" | "chat" | "text" | "caption" | "message_id" | "from" | "date"
  >
): Promise<void> {
  const persistedChat = await upsertTrainingPeaksBusinessChatFromMessage(message);
  const businessConnectionId = message.business_connection_id?.trim();
  const chatId =
    message.chat?.id === undefined || message.chat?.id === null ? null : String(message.chat.id);
  const messageText = (message.text ?? message.caption ?? "").trim();
  const contextLabels = messageText ? classifyTelegramContextLabels(messageText) : [];
  let contextObsId: string | null = null;

  try {
    await recordCoachOutgoingBusinessDmContactIfSafe({
      message,
      isCoachTelegramId: (value) => (value === undefined ? false : isCoachChat(value)),
      listStudentsByTelegramChatId: async (telegramChatId) =>
        listTrainingPeaksStudentsByTelegramChatId(telegramChatId),
      listRecentContactEvents: async (studentId) =>
        listRecentTrainingPeaksStudentContactEvents({
          studentId,
          limit: 10,
        }),
      recordContactEvent: async (payload) => {
        await recordTrainingPeaksStudentContactEvent(payload);
      },
    });
  } catch (error) {
    console.warn("Failed to record outgoing TrainingPeaks business DM contact event", {
      chatId,
      messageId: message.message_id,
      error,
    });
  }

  if (chatId && messageText && isAthleteIncomingBusinessDmMessage(message)) {
    try {
      const observation = await recordTrainingPeaksTelegramBusinessContextObservation({
        chatId,
        messageId: message.message_id,
        text: messageText,
      });
      contextObsId = observation?.id ?? null;
      if (observation) {
        try {
          await persistOperationalSignalsForObservation({
            observationId: observation.id,
            studentId: observation.studentId,
            sourceType: observation.sourceType,
            textPreview: observation.textPreview,
            labels: observation.labels,
            metadata: observation.metadata,
            observedAt: observation.observedAt,
            telegramChatId: observation.chatId,
            telegramMessageId: observation.messageId,
            telegramMessageThreadId: observation.messageThreadId,
          });
        } catch (signalError) {
          console.warn("Failed to persist inline TrainingPeaks operational signal for business observation", {
            event: "trainingpeaks_inline_operational_signal_persist_failed",
            observationIdPrefix: observation.id.slice(0, 8),
            studentIdPrefix: observation.studentId?.slice(0, 8) ?? null,
            errorClass: signalError instanceof Error ? signalError.name : "UnknownError",
          });
        }
      }
    } catch (error) {
      console.warn("Failed to record TrainingPeaks telegram business context observation", {
        chatId,
        error,
      });
    }

    try {
      const student = await getTrainingPeaksStudentByTelegramChatId(chatId);
      if (student) {
        await recordTrainingPeaksStudentContactEvent({
          studentId: student.id,
          eventType: "athlete_message",
          source: "telegram_business_dm",
          referenceId: String(message.message_id),
          metadata: {
            chat_id: chatId,
            message_id: message.message_id,
            direction: "athlete_incoming",
            has_business_connection_id: Boolean(businessConnectionId),
          },
        });
      }
    } catch (error) {
      console.warn("Failed to record TrainingPeaks business DM contact event", {
        chatId,
        messageId: message.message_id,
        error,
      });
    }
  }

  if (!persistedChat || !businessConnectionId || !chatId || !messageText) {
    return;
  }

  if (!isAthleteIncomingBusinessDmMessage(message)) {
    return;
  }

  const result = await consumeTrainingPeaksStudentTelegramLinkCode(
    messageText,
    businessConnectionId,
    chatId
  );

  if (result.kind === "no_candidate" || result.kind === "no_match") {
    const moveActionResult = await createTrainingPeaksMoveWorkoutActionFromTelegram({
      chatId,
      messageId: String(message.message_id),
      userId: message.from?.id === undefined ? null : String(message.from.id),
      text: messageText,
      messageDateUnix: message.date ?? null,
    });

    try {
      await logTrainingPeaksBusinessMessageIntentDecision({
        chatId,
        messageId: message.message_id,
        userId: message.from?.id === undefined ? null : String(message.from.id),
        businessConnectionId,
        messageText,
        contextLabels,
        moveActionResult,
      });
    } catch (error) {
      console.warn("Failed to log TrainingPeaks business message intent decision", {
        chatId,
        error,
      });
    }

    let intentStatus: TrainingPeaksMessageIntentLogStatus | null = null;
    if (moveActionResult.ok) {
      intentStatus = "action_created";
    } else {
      intentStatus = resolveTrainingPeaksMessageIntentLogStatus({
        reason: moveActionResult.reason,
        hasRelevance: hasTrainingPeaksMessageIntentLoggingRelevance(messageText, contextLabels),
      });
    }

    let intentLogId: string | null = null;
    try {
      const intentLog = await getTrainingPeaksMessageIntentLogByTelegramMessage(
        chatId,
        String(message.message_id)
      );
      intentLogId = intentLog?.id ?? null;
      if (!intentStatus) {
        intentStatus = intentLog?.status ?? null;
      }
    } catch (error) {
      console.warn("Failed to read TrainingPeaks business message intent log row", {
        chatId,
        error,
      });
    }

    const caseInput = {
      studentId: moveActionResult.ok ? moveActionResult.student.id : moveActionResult.student?.id ?? null,
      intentLogId,
      actionId: moveActionResult.ok ? moveActionResult.action.id : null,
      contextObsId,
      telegramChatId: chatId,
      telegramMessageId: message.message_id,
      intentStatus,
      labels: contextLabels,
    } as const;

    if (!moveActionResult.ok) {
      try {
        await recordTrainingPeaksCoachCaseAndSnapshot(caseInput);
      } catch (error) {
        console.warn("Failed to record TrainingPeaks business DM coach case and snapshot", {
          chatId,
          error,
        });
      }

      if (isTrainingPeaksReplyDraftAutoDetectEnabled() && contextLabels.includes("report_like")) {
        console.info("TrainingPeaks reply draft auto [dry-run]: report-like business DM detected", {
          event: "tp_reply_draft_auto_dry_run_triggered",
          chatId,
          messageId: message.message_id,
          studentId: moveActionResult.student?.id ?? null,
          studentName: moveActionResult.student?.studentName ?? null,
          labels: contextLabels,
          note: "Stage 0: detection only. No context built, no draft generated, no coach/student messages sent.",
        });
      }

      return;
    }

    const summary = formatTrainingPeaksMoveWorkoutActionSummary(moveActionResult.parsed);
    if (isMoveActionAutoApprovedForDryRun(moveActionResult.action.parsedPayload)) {
      if (isTrainingPeaksAutoApproveProgressNotificationEnabled()) {
        await notifyCoachChats(
          formatTrainingPeaksMoveActionProcessingMessage({
            studentName: moveActionResult.student.studentName,
            rawText: moveActionResult.action.rawText,
            parsedPayload: moveActionResult.action.parsedPayload,
          })
        );
      }
    } else {
      await notifyCoachChatsWithMarkup(
        [
          "Новая заявка TrainingPeaks",
          `Ученик: ${moveActionResult.student.studentName}`,
          `Сообщение: ${moveActionResult.action.rawText}`,
          `Действие: ${summary}`,
          "Статус: waiting for coach review",
          `Action ID: ${moveActionResult.action.id}`,
        ].join("\n"),
        getTrainingPeaksActionDecisionMarkup(moveActionResult.action.id)
      );
    }
    try {
      await recordTrainingPeaksCoachCaseAndSnapshot(caseInput);
    } catch (error) {
      console.warn("Failed to record TrainingPeaks business DM coach case and snapshot", {
        chatId,
        error,
      });
    }
    return;
  }

  if (result.kind === "linked") {
    if (isTrainingPeaksLinkSuccessNotificationEnabled()) {
      await notifyCoachChats(
        [
          `✅ Telegram привязан по коду ${result.code}.`,
          `Ученик: ${result.student.studentName}`,
          `Чат: ${getTelegramBusinessChatDisplayName(result.chat)}`,
        ].join("\n")
      );
    }
    return;
  }

  if (result.kind === "used") {
    await notifyCoachChats(
      `Код привязки ${result.code} уже использован${result.studentName ? ` для ${result.studentName}` : ""}. Новая привязка не выполнена.`
    );
    return;
  }

  if (result.kind === "expired") {
    await notifyCoachChats(
      `Код привязки ${result.code} истёк${result.studentName ? ` для ${result.studentName}` : ""}. Сгенерируй новый код и попроси ученика отправить его снова.`
    );
    return;
  }

  if (result.kind === "ambiguous") {
    await notifyCoachChats(
      `По коду ${result.code} найдено несколько активных записей (${result.matches}). Автопривязка не выполнена.`
    );
    return;
  }

  await notifyCoachChats(
    `Не удалось завершить привязку по коду ${result.code}${result.studentName ? ` для ${result.studentName}` : ""}.`
  );
}

async function handleTrainingPeaksStudentChooseBusinessChatCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  studentId: string,
  chatKey: string
): Promise<void> {
  const linkContext = getTrainingPeaksTelegramLinkContext(parsedMessage.chatId);

  if (!linkContext || linkContext.studentId !== studentId) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Список чатов устарел. Нажми «Привязать Telegram» ещё раз.",
      getStudentTelegramLinkErrorMarkup(studentId)
    );
    return;
  }

  const businessChatId = linkContext.optionsByKey[chatKey];

  if (!businessChatId) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не вижу выбранный чат. Нажми «Привязать Telegram» ещё раз.",
      getStudentTelegramLinkErrorMarkup(studentId)
    );
    return;
  }

  const [student, businessChat] = await Promise.all([
    getTrainingPeaksStudentCardByInternalId(studentId),
    getTrainingPeaksBusinessChatByInternalId(businessChatId),
  ]);

  if (!student) {
    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Ученик больше не найден.",
      getStudentNotFoundMarkup()
    );
    return;
  }

  if (!businessChat) {
    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Чат больше не найден. Открой список и выбери заново.",
      getStudentTelegramLinkErrorMarkup(student.id)
    );
    return;
  }

  const linked = await linkTrainingPeaksStudentToBusinessChat(
    student.id,
    businessChat.chatId,
    businessChat.businessConnectionId
  );

  if (!linked) {
    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не удалось привязать Telegram. Попробуй выбрать чат ещё раз.",
      getStudentTelegramLinkErrorMarkup(student.id)
    );
    return;
  }

  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
  await showTrainingPeaksLinkedStudentCard(parsedMessage, linked.student.id);
}

async function sendTrainingPeaksStudentTestMessage(
  studentId: string
): Promise<
  | { kind: "not_found" }
  | { kind: "not_configured"; studentId: string }
  | { kind: "missing_business_connection"; studentId: string }
  | { kind: "sent"; studentId: string; studentName: string }
  | { kind: "failed"; studentId: string; errorMessage: string }
> {
  const student = await getTrainingPeaksStudentById(studentId);

  if (!student) {
    return { kind: "not_found" };
  }

  if (!student.telegramChatId || !student.telegramDeliveryEnabled) {
    return { kind: "not_configured", studentId: student.id };
  }

  const businessConnectionId = process.env.TELEGRAM_BUSINESS_CONNECTION_ID?.trim();

  if (!businessConnectionId) {
    return { kind: "missing_business_connection", studentId: student.id };
  }

  try {
    await sendTelegramBusinessMessage(
      student.telegramChatId,
      "Тестовое сообщение от Игоря ✅",
      businessConnectionId
    );
    return {
      kind: "sent",
      studentId: student.id,
      studentName: student.studentName,
    };
  } catch (error) {
    return {
      kind: "failed",
      studentId: student.id,
      errorMessage: shortenTrainingPeaksTelegramDeliveryError(error),
    };
  }
}

async function handleTrainingPeaksStudentTestMessageCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const result = await sendTrainingPeaksStudentTestMessage(studentId);

  if (result.kind === "not_found") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Ученик больше не найден.",
      getStudentNotFoundMarkup()
    );
    return;
  }

  if (result.kind === "not_configured") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не могу отправить тест: у ученика не привязан Telegram или доставка выключена.",
      getStudentTelegramLinkErrorMarkup(result.studentId)
    );
    return;
  }

  if (result.kind === "missing_business_connection") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не могу отправить тест: missing TELEGRAM_BUSINESS_CONNECTION_ID.",
      getStudentTelegramLinkSuccessMarkup(result.studentId)
    );
    return;
  }

  if (result.kind === "sent") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      `✅ Тестовое сообщение отправлено: ${result.studentName}.`,
      getStudentTelegramLinkSuccessMarkup(result.studentId)
    );
    return;
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    `Не удалось отправить тестовое сообщение: ${result.errorMessage}.`,
    getStudentTelegramLinkSuccessMarkup(result.studentId)
  );
}

async function handleTrainingPeaksActionDecisionCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  decision: "approve" | "reject",
  actionId: string
): Promise<void> {
  const decisionResult =
    decision === "approve"
      ? await approveTrainingPeaksAction({
          actionId,
          decidedByChatId: String(parsedMessage.chatId),
          decidedByUserId: parsedMessage.userId === null ? null : String(parsedMessage.userId),
          decisionMessageId: String(parsedMessage.messageId),
        })
      : await rejectTrainingPeaksAction({
          actionId,
          decidedByChatId: String(parsedMessage.chatId),
          decidedByUserId: parsedMessage.userId === null ? null : String(parsedMessage.userId),
          decisionMessageId: String(parsedMessage.messageId),
        });

  if (decisionResult.kind === "not_found") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Заявка не найдена или уже недоступна.",
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  if (decisionResult.kind === "already_decided") {
    const alreadyDecidedText =
      decisionResult.action.status === "approved"
        ? "✅ Одобрено. Сначала запущу безопасную проверку. TrainingPeaks пока не изменён."
        : "Эта заявка уже отклонена. Ничего не изменено в TrainingPeaks.";
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      alreadyDecidedText,
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  const decisionText =
    decision === "approve"
      ? "✅ Одобрено. Сначала запущу безопасную проверку. TrainingPeaks пока не изменён."
      : "Отклонено. Ничего не изменено в TrainingPeaks.";

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    decisionText,
    getTrainingPeaksActionResolvedMarkup()
  );
}

async function handleTrainingPeaksActionExecuteRequestCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  actionId: string
): Promise<void> {
  const result = await requestTrainingPeaksActionExecution({
    actionId,
    requestedByChatId: String(parsedMessage.chatId),
    requestedByUserId: parsedMessage.userId === null ? null : String(parsedMessage.userId),
    requestMessageId: String(parsedMessage.messageId),
  });

  if (result.kind === "not_found") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Заявка не найдена или уже недоступна.",
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  if (result.kind === "queued") {
    const queuedText = formatTrainingPeaksExecuteQueuedMessage({
      studentName: result.queuedDisplay.studentName,
      parsedPayload: result.action.parsedPayload,
      trustedSourceDate: result.queuedDisplay.trustedSourceDate,
      trustedTargetDate: result.queuedDisplay.trustedTargetDate,
    });
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      queuedText,
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  if (result.kind === "already_queued") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Перенос уже стоит в очереди. TrainingPeaks ещё не изменён.",
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  if (result.kind === "final_state") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getTrainingPeaksActionExecuteFinalStateMessage(result.action),
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  const blockedText =
    result.kind === "blocked"
      ? [
          "⚠️ Перенос не выполнен",
          "",
          ...formatTelegramLabeledBlock(
            "Причина:",
            translateCoachActionTechnicalReason(
              result.reason?.trim() || formatCoachActionReasonForDisplay(result.latestRunContext)
            )
          ),
          (() => {
            const selectedSourceDate = result.latestRunContext?.latestDryRun?.selectedSourceDate ?? null;
            const selectedSourcePolicy = result.latestRunContext?.latestDryRun?.selectedSourceDatePolicy ?? null;
            if (!selectedSourceDate && !selectedSourcePolicy) {
              return [];
            }
            return formatTelegramLabeledBlock(
              "Источник:",
              `${formatCompactDateShort(selectedSourceDate)} — ${formatSourcePolicyLabel(selectedSourcePolicy)}`
            );
          })(),
          "Что дальше:",
          "Проверьте заявку вручную в /tp_actions.",
        ]
          .flat()
          .filter((line): line is string => Boolean(line))
          .join("\n")
      : `⚠️ ${INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU}`;

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    blockedText,
    getTrainingPeaksActionResolvedMarkup()
  );
}

async function handleTrainingPeaksActionDryRunRecheckCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  actionId: string
): Promise<void> {
  const result = await requestTrainingPeaksActionDryRunRecheck({
    actionId,
    requestedByChatId: String(parsedMessage.chatId),
  });

  if (result.kind === "not_found") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      result.message,
      createInlineKeyboardMarkup([[createMenuButton("◀ Назад к списку", "tp:actions:list")]])
    );
    return;
  }

  if (result.kind === "blocked") {
    const detailAction = await getTrainingPeaksActionWithStudentAndLatestRunContextById(actionId);
    if (!detailAction) {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        result.message,
        createInlineKeyboardMarkup([[createMenuButton("◀ Назад к списку", "tp:actions:list")]])
      );
      return;
    }
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      `${result.message}\n\n${getTpActionDetailText(detailAction, { includeFreshness: true })}`,
      getTpActionDetailMarkup(detailAction)
    );
    return;
  }

  const refreshedAction = await getTrainingPeaksActionWithStudentAndLatestRunContextById(result.action.id);
  if (!refreshedAction) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      result.message,
      createInlineKeyboardMarkup([[createMenuButton("◀ Назад к списку", "tp:actions:list")]])
    );
    return;
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    `${result.message}\n\n${getTpActionDetailText(refreshedAction, { includeFreshness: true })}`,
    getTpActionDetailMarkup(refreshedAction)
  );
}

async function handleTrainingPeaksActionExecuteCancelCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  actionId: string
): Promise<void> {
  const result = await cancelTrainingPeaksActionExecution({
    actionId,
    cancelledByChatId: String(parsedMessage.chatId),
    cancelledByUserId: parsedMessage.userId === null ? null : String(parsedMessage.userId),
    cancelMessageId: String(parsedMessage.messageId),
  });

  if (result.kind === "not_found") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Заявка не найдена или уже недоступна.",
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  if (result.kind === "cancelled") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Заявка отменена. Ничего не изменено в TrainingPeaks.",
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  if (result.kind === "already_cancelled") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Заявка уже отменена. Ничего не изменено в TrainingPeaks.",
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  if (result.kind === "not_cancellable") {
    let statusText = `Отмена недоступна: ${result.reason}`;
    if (result.action.executionStatus === "completed") {
      statusText = "Эта заявка уже выполнена, отмена недоступна.";
    } else if (result.action.executionStatus === "running_local") {
      statusText = "Перенос уже выполняется, отмена недоступна.";
    } else if (result.action.status === "rejected") {
      statusText = "Заявка уже отменена.";
    }
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      statusText,
      getTrainingPeaksActionResolvedMarkup()
    );
    return;
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    "Заявка уже выполняется или завершена, отмена недоступна.",
    getTrainingPeaksActionResolvedMarkup()
  );
}

async function showTrainingPeaksWeekMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  setTrainingPeaksScreenContext(parsedMessage.chatId, "week");

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, getWeekMenuText(), getWeekMenuMarkup());
    return;
  }

  await showTrainingPeaksMenuScreen(parsedMessage, getWeekMenuText(), getWeekMenuMarkup());
}

async function showTrainingPeaksJobsMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  const jobs = await getTrainingPeaksJobsStatus();
  const text = getJobsScreenText(jobs);
  const markup = getJobsMenuMarkup(jobs);
  setTrainingPeaksScreenContext(parsedMessage.chatId, "jobs");

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, text, markup);
    return;
  }

  await showTrainingPeaksMenuScreen(parsedMessage, text, markup);
}

async function showTrainingPeaksReportsMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, getReportsMenuText(), getReportsMenuMarkup());
    return;
  }

  await showTrainingPeaksMenuScreen(parsedMessage, getReportsMenuText(), getReportsMenuMarkup());
}

async function showTrainingPeaksReportsEligibleStudents(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  const students = await listTrainingPeaksWeeklyReportEligibleStudents();
  const text = getReportsEligibleStudentsText(students);
  const markup = getReportsEligibleStudentsMarkup();

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, text, markup);
    return;
  }

  await showTrainingPeaksMenuScreen(parsedMessage, text, markup);
}

async function showTrainingPeaksReportsFromStudent(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(
      parsedMessage,
      getReportsFromStudentText(),
      getReportsFromStudentMarkup()
    );
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getReportsFromStudentText(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function showTrainingPeaksMoreMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  await showTrainingPeaksMenuScreen(parsedMessage, getMoreMenuText(), getMoreMenuMarkup());
}

async function handleTrainingPeaksReportsStatusLast(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  const week = getPreviousTrainingPeaksWeek();
  const result = await getTrainingPeaksStatusOverview(week);

  if (!result || result.students.length === 0) {
    const emptyText = `За неделю ${formatWeek(week)} данных TrainingPeaks пока нет.`;
    if (parsedMessage.kind === "callback_query") {
      await showTrainingPeaksMenuScreen(parsedMessage, emptyText, getReportsMenuMarkup());
      return;
    }

    await sendTrainingPeaksMessage(parsedMessage.chatId, emptyText);
    return;
  }

  const statusText = formatStatusMessage(result.week, result.students);

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, statusText, getReportsMenuMarkup());
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, statusText);
}

function getStudentWeeklyRunQueuedSuccessMessage(input: {
  studentName: string;
  week: TrainingPeaksWeek;
}): string {
  return [
    "✅ Отчёт поставлен в очередь.",
    `Ученик: ${input.studentName}`,
    `Неделя: ${formatWeekIso(input.week)}`,
    "",
    "Отчёт будет создан локальным Mac-агентом.",
    "Ученику ничего не отправится автоматически.",
  ].join("\n");
}

function getStudentWeeklyRunResultMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🧾 Задачи", TP_CALLBACK_JOBS)],
    [createMenuButton("👤 К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentWeeklyRunDuplicateMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🧾 Задачи", TP_CALLBACK_JOBS)]]);
}

function getStudentWeeklyRunDuplicateMessage(input: {
  studentName: string;
  week: TrainingPeaksWeek;
  status: "queued" | "running";
}): string {
  return input.status === "queued"
    ? [
        "Задача для этого ученика уже ожидает запуска на Mac.",
        `Ученик: ${input.studentName}`,
        `Неделя: ${formatWeekIso(input.week)}`,
      ].join("\n")
    : [
        "Задача для этого ученика уже выполняется на Mac.",
        `Ученик: ${input.studentName}`,
        `Неделя: ${formatWeekIso(input.week)}`,
      ].join("\n");
}

async function handleTrainingPeaksStudentWeeklyRunCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  studentId: string,
  weekKeyword: "last" | "current"
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Ученик больше не найден.",
      getStudentNotFoundMarkup()
    );
    return;
  }

  if (student.archivedAt) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      `Ученик ${student.studentName} в архиве. Восстанови его перед генерацией отчёта.`,
      getStudentWeeklyRunResultMarkup(student.id)
    );
    return;
  }

  if (!student.isActive) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      `Ученик ${student.studentName} неактивен.`,
      getStudentWeeklyRunResultMarkup(student.id)
    );
    return;
  }

  if (!student.trainingPeaksAthleteUrl.trim()) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      `У ученика ${student.studentName} нет ссылки TrainingPeaks athlete.`,
      getStudentWeeklyRunResultMarkup(student.id)
    );
    return;
  }

  const week = resolveTrainingPeaksWeekKeyword(weekKeyword);

  if (!week) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не удалось определить неделю. Попробуй ещё раз.",
      getStudentWeeklyRunResultMarkup(student.id)
    );
    return;
  }

  const result = await requestTrainingPeaksWeeklyRunForStudentByInternalId({
    studentInternalId: student.id,
    weekFrom: week.weekFrom,
    weekTo: week.weekTo,
    requestedByChatId: String(parsedMessage.chatId),
    requestedByUserId: parsedMessage.userId === null ? null : String(parsedMessage.userId),
  });

  await presentTrainingPeaksStudentWeeklyRunEnqueueResult(parsedMessage, student, week, result);
}

async function presentTrainingPeaksStudentWeeklyRunEnqueueResult(
  parsedMessage: ParsedTelegramCallbackUpdate,
  student: { id: string; studentName: string },
  week: TrainingPeaksWeek,
  result: RequestTrainingPeaksWeeklyRunForStudentResult
): Promise<void> {
  if (result.ok) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentWeeklyRunQueuedSuccessMessage({
        studentName: student.studentName,
        week,
      }),
      getStudentWeeklyRunResultMarkup(student.id)
    );
    return;
  }

  if (result.reason === "duplicate" && result.activeJob) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentWeeklyRunDuplicateMessage({
        studentName: student.studentName,
        week: {
          weekFrom: result.activeJob.weekFrom,
          weekTo: result.activeJob.weekTo,
        },
        status: result.activeJob.status === "queued" ? "queued" : "running",
      }),
      getStudentWeeklyRunDuplicateMarkup()
    );
    return;
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    result.message,
    getStudentWeeklyRunResultMarkup(student.id)
  );
}

function getStudentWeeklyReportHintMessage(student: {
  studentId: string;
  studentName: string;
}): string {
  const week = getPreviousTrainingPeaksWeek();

  return [
    `▶️ Недельный отчёт: ${student.studentName}`,
    "",
    "Команда для черновика за прошлую полную неделю:",
    `/tp_run_student ${student.studentId} ${week.weekFrom} ${week.weekTo}`,
    "",
    "Создаёт только черновик в Supabase и не отправляет отчёт ученику автоматически.",
  ].join("\n");
}

function getStudentWeeklyReportHintMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

async function showTrainingPeaksStudentWeeklyReportHint(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await sendTrainingPeaksMessage(parsedMessage.chatId, "Ученик больше не найден.");
    return;
  }

  const text = getStudentWeeklyReportHintMessage(student);
  const markup = getStudentWeeklyReportHintMarkup(student.id);

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, markup);
    return;
  }

  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, text, markup);
}

async function showTrainingPeaksHelpMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, getHelpMenuText(), getHelpMenuMarkup());
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getHelpMenuText(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function showTrainingPeaksAddStudentInstructions(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  setTrainingPeaksAddStudentWaitingContext(parsedMessage.chatId);

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(
      parsedMessage,
      getAddStudentInstructionsText(),
      getAddStudentInstructionsMarkup()
    );
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getAddStudentInstructionsText(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function handleTrainingPeaksAddStudentInput(
  parsedMessage: ParsedTelegramUpdate,
  rawInput: string,
  options?: {
    showStudentsListOnSuccess?: boolean;
  }
): Promise<void> {
  const parsedInput = parseTrainingPeaksAddStudentInput(rawInput);

  if (!parsedInput.trainingPeaksAthleteUrl) {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getAddStudentMissingUrlMessage(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  if (!parsedInput.studentName) {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getAddStudentMissingNameMessage(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  const normalizedInput = normalizeTrainingPeaksAddStudentInput(rawInput);
  const result = await addTrainingPeaksStudentFromCommand(normalizedInput);
  const studentName = getTpAddStudentNamePreview(normalizedInput);

  if (!result.ok) {
    if (result.reason === "empty_name") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        getAddStudentMissingNameMessage(),
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    if (result.reason === "invalid_url") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        [TP_ADD_STUDENT_DEPRECATED_MESSAGE, "", "Ссылка на TrainingPeaks должна начинаться с https://"].join(
          "\n"
        ),
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    if (result.reason === "duplicate_student") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        [TP_ADD_STUDENT_DEPRECATED_MESSAGE, "", `Ученик "${studentName}" уже существует.`].join("\n"),
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    if (result.reason === "duplicate_url") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        [
          TP_ADD_STUDENT_DEPRECATED_MESSAGE,
          "",
          "Этот URL TrainingPeaks уже привязан к другому ученику.",
        ].join("\n"),
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      [TP_ADD_STUDENT_DEPRECATED_MESSAGE, "", "Не смог добавить ученика в Supabase. Попробуй позже."].join(
        "\n"
      ),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  clearTrainingPeaksChatContext(parsedMessage.chatId);

  if (options?.showStudentsListOnSuccess) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      [TP_ADD_STUDENT_DEPRECATED_MESSAGE, "", `✅ Ученик добавлен: ${result.student.studentName}`].join(
        "\n"
      )
    );
    await showTrainingPeaksStudentsPage(parsedMessage, 0);
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    [
      TP_ADD_STUDENT_DEPRECATED_MESSAGE,
      "",
      `✅ Ученик добавлен: ${result.student.studentName}`,
      "",
      "Локальный Mac runner подтянет этого ученика из Supabase при следующем запуске tp-agent-once.",
    ].join("\n"),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

export async function handleTrainingPeaksTelegramHelp(
  parsedMessage: ParsedTelegramMessageUpdate
): Promise<void> {
  await showTrainingPeaksHelpMenu(parsedMessage);
}

export async function handleTrainingPeaksTelegramReplyKeyboardMessage(
  parsedMessage: ParsedTelegramMessageUpdate,
  text: string
): Promise<"handled" | "ignored"> {
  const voiceHandled = await handleTrainingPeaksCoachVoiceTranscription(parsedMessage);
  if (voiceHandled === "handled") {
    return "handled";
  }

  const action = getTrainingPeaksReplyKeyboardAction(text);

  if (!isCoachChat(parsedMessage.chatId)) {
    if (!action) {
      return "ignored";
    }

    await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return "handled";
  }

  try {
    if (!action) {
      if (!isTrainingPeaksCommand(text)) {
        const groupWorkoutReportEditHandled = await tryHandleGroupWorkoutReportCoachEditMessage({
          coachChatId: String(parsedMessage.chatId),
          text,
        });
        if (groupWorkoutReportEditHandled === "handled") {
          return "handled";
        }

        const chatContextState = getTrainingPeaksChatContextState(parsedMessage.chatId);

        if (
          chatContextState.kind === "expired" &&
          chatContextState.context.screen === "add_student_waiting"
        ) {
          await sendTrainingPeaksReplyScreen(
            parsedMessage.chatId,
            getAddStudentExpiredMessage(),
            getTrainingPeaksMainReplyKeyboardMarkup()
          );
          return "handled";
        }

        if (
          chatContextState.kind === "expired" &&
          chatContextState.context.screen === "student_username_waiting"
        ) {
          await sendTrainingPeaksReplyScreen(
            parsedMessage.chatId,
            "Режим поиска по username истёк. Нажми «🔎 Найти по username» ещё раз.",
            getTrainingPeaksMainReplyKeyboardMarkup()
          );
          return "handled";
        }

        if (
          chatContextState.kind === "active" &&
          chatContextState.context.screen === "add_student_waiting"
        ) {
          await handleTrainingPeaksAddStudentInput(parsedMessage, text, {
            showStudentsListOnSuccess: true,
          });
          return "handled";
        }

        if (
          chatContextState.kind === "active" &&
          chatContextState.context.screen === "student_username_waiting" &&
          chatContextState.context.selectedStudentId
        ) {
          await handleTrainingPeaksStudentUsernameLookup(
            parsedMessage,
            chatContextState.context.selectedStudentId,
            text
          );
          return "handled";
        }
      }

      const studentSelection = await findStudentByExactReplyButtonName(text);

      if (studentSelection.kind === "not_found") {
        return "ignored";
      }

      if (studentSelection.kind === "ambiguous") {
        await sendTrainingPeaksMessage(
          parsedMessage.chatId,
          formatStudentAmbiguityMessage(studentSelection.matches)
        );
        return "handled";
      }

      await showTrainingPeaksStudentCardMenu(parsedMessage, studentSelection.student.id);
      return "handled";
    }

    if (action === "main_menu") {
      await showTrainingPeaksMainMenu(parsedMessage);
      return "handled";
    }

    if (action === "today") {
      await handleTrainingPeaksAttention(parsedMessage);
      return "handled";
    }

    if (action === "students") {
      await showTrainingPeaksStudentsPage(parsedMessage, 0);
      return "handled";
    }

    if (action === "add_student_help") {
      await showTrainingPeaksAddStudentInstructions(parsedMessage);
      return "handled";
    }

    if (action === "reports_menu") {
      await showTrainingPeaksReportsMenu(parsedMessage);
      return "handled";
    }

    if (action === "week_menu") {
      await showTrainingPeaksWeekMenu(parsedMessage);
      return "handled";
    }

    if (action === "races_menu") {
      await handleTrainingPeaksRacesMenu(parsedMessage);
      return "handled";
    }

    if (action === "jobs") {
      await showTrainingPeaksJobsMenu(parsedMessage);
      return "handled";
    }

    if (action === "cases_recent") {
      await handleTrainingPeaksRecentCoachCases(parsedMessage);
      return "handled";
    }

    if (action === "actions") {
      await showTpActionsList(parsedMessage);
      return "handled";
    }

    if (action === "signals") {
      await handleTrainingPeaksOperationalSignalsCommand(parsedMessage, "/tp_signals");
      return "handled";
    }

    if (action === "billing_hint") {
      await showTrainingPeaksMenuScreen(parsedMessage, getBillingHintText(), getBillingHintMarkup());
      return "handled";
    }

    if (action === "more_menu") {
      await showTrainingPeaksMoreMenu(parsedMessage);
      return "handled";
    }

    if (action === "back") {
      await showTrainingPeaksMainMenu(parsedMessage);
      return "handled";
    }

    if (action === "students_back") {
      await showTrainingPeaksStudentsPage(parsedMessage, 0);
      return "handled";
    }

    if (action === "week_last" || action === "week_current") {
      await showAllEnabledWeeklyRunPreview(
        parsedMessage,
        action === "week_last" ? "/tp_run_week last" : "/tp_run_week current"
      );
      return "handled";
    }

    if (action === "races_next_week") {
      await requestTrainingPeaksRaceScanAndReply(parsedMessage, getRacesNextWeekPeriod());
      return "handled";
    }

    if (action === "races_7_days") {
      await requestTrainingPeaksRaceScanAndReply(parsedMessage, getRaces7DaysPeriod());
      return "handled";
    }

    if (action === "races_30_days") {
      await requestTrainingPeaksRaceScanAndReply(parsedMessage, getRaces30DaysPeriod());
      return "handled";
    }

    if (action === "races_to_august") {
      await requestTrainingPeaksRaceScanAndReply(parsedMessage, getRacesToAugustPeriod());
      return "handled";
    }

    if (action === "jobs_refresh") {
      await showTrainingPeaksJobsMenu(parsedMessage);
      return "handled";
    }

    if (action === "cancel_job") {
      await handleTrainingPeaksCancelQueuedJob(parsedMessage);
      return "handled";
    }

    if (action === "student_report") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const student = await getTrainingPeaksStudentCardByInternalId(selectedStudent.selectedStudentId);

      if (!student) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const report = await getTrainingPeaksLatestReportSnapshotByInternalId(student.id);

      if (!report) {
        await showTrainingPeaksMenuScreen(
          parsedMessage,
          "Последний отчёт для этого ученика пока не найден.",
          getStudentReportMissingMarkup(student.id)
        );
        setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
          selectedStudentId: student.id,
          selectedStudentName: student.studentName,
        });
        return "handled";
      }

      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        `📝 ${report.studentName} — отчёт за ${formatWeek(report)}\n\n${report.reportMarkdown}`
      );
      setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
        selectedStudentId: student.id,
        selectedStudentName: student.studentName,
      });
      return "handled";
    }

    if (action === "student_link") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      await showTrainingPeaksStudentTelegramLinkMenu(parsedMessage, selectedStudent.selectedStudentId);
      return "handled";
    }

    if (action === "student_username") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      await promptTrainingPeaksStudentUsernameLookup(parsedMessage, selectedStudent.selectedStudentId);
      return "handled";
    }

    if (action === "student_link_code") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      await handleTrainingPeaksStudentLinkCodeRequest(parsedMessage, selectedStudent.selectedStudentId);
      return "handled";
    }

    if (action === "student_test") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const result = await sendTrainingPeaksStudentTestMessage(selectedStudent.selectedStudentId);

      if (result.kind === "not_found") {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const student = await getTrainingPeaksStudentCardByInternalId(selectedStudent.selectedStudentId);

      if (!student) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
        selectedStudentId: student.id,
        selectedStudentName: student.studentName,
      });

      if (result.kind === "not_configured") {
        await showTrainingPeaksMenuScreen(
          parsedMessage,
          "Не могу отправить тест: у ученика не привязан Telegram или доставка выключена.",
          getStudentCardMenuMarkup(student)
        );
        return "handled";
      }

      if (result.kind === "missing_business_connection") {
        await showTrainingPeaksMenuScreen(
          parsedMessage,
          "Не могу отправить тест: missing TELEGRAM_BUSINESS_CONNECTION_ID.",
          getStudentCardMenuMarkup(student)
        );
        return "handled";
      }

      if (result.kind === "sent") {
        await showTrainingPeaksMenuScreen(
          parsedMessage,
          `✅ Тестовое сообщение отправлено: ${result.studentName}.`,
          getStudentCardMenuMarkup(student)
        );
        return "handled";
      }

      await showTrainingPeaksMenuScreen(
        parsedMessage,
        `Не удалось отправить тестовое сообщение: ${result.errorMessage}.`,
        getStudentCardMenuMarkup(student)
      );
      return "handled";
    }

    if (action === "student_disable" || action === "student_enable") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const updatedStudent =
        action === "student_disable"
          ? await disableTrainingPeaksStudentByInternalId(selectedStudent.selectedStudentId)
          : await enableTrainingPeaksStudentByInternalId(selectedStudent.selectedStudentId);

      if (!updatedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
        selectedStudentId: updatedStudent.id,
        selectedStudentName: updatedStudent.studentName,
      });
      await showTrainingPeaksStudentCardMenu(parsedMessage, updatedStudent.id);
      return "handled";
    }
  } catch (error) {
    console.error("TrainingPeaks Telegram reply keyboard action failed", {
      chatId: parsedMessage.chatId,
      messageId: parsedMessage.messageId,
      text,
      error,
    });

    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      "Не смог загрузить данные TrainingPeaks. Попробуй позже."
    );
    return "handled";
  }

  return "handled";
}

async function handleTrainingPeaksMain(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await showTrainingPeaksMainMenu(parsedMessage);
}

async function handleTrainingPeaksStatus(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const { week, error } = parseStatusCommandWeek(text);

  if (error) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, error);
    return;
  }

  const result = await getTrainingPeaksStatusOverview(week ?? undefined);

  if (!result || result.students.length === 0) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      week
        ? `За неделю ${formatWeek(week)} данных TrainingPeaks пока нет.`
        : "В Supabase пока нет данных TrainingPeaks."
    );
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, formatStatusMessage(result.week, result.students));
}

async function handleTrainingPeaksStudents(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await showTrainingPeaksStudentsPage(parsedMessage, 0);
}

async function handleTrainingPeaksStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const studentQuery = parseStudentCommand(text);

  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Напиши так: /tp_student Имя Фамилия");
    return;
  }

  const result = await getTrainingPeaksStudentCard(studentQuery);

  if (result.kind === "not_found") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Ученик "${studentQuery}" не найден.\nПосмотри список: /tp_students`
    );
    return;
  }

  if (result.kind === "ambiguous") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, formatStudentAmbiguityMessage(result.matches));
    return;
  }

  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: result.student.id,
    selectedStudentName: result.student.studentName,
  });
  await showTrainingPeaksStudentCardMenu(parsedMessage, result.student.id);
}

async function handleTrainingPeaksDisableStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const studentQuery = parseDisableStudentCommand(text);

  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Напиши так: /tp_disable_student Имя Фамилия");
    return;
  }

  const result = await disableTrainingPeaksStudent(studentQuery);

  if (result.kind === "not_found") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Ученик "${studentQuery}" не найден.\nПосмотри список: /tp_students`
    );
    return;
  }

  if (result.kind === "ambiguous") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, formatStudentAmbiguityMessage(result.matches));
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    [
      `✅ Ученик отключён: ${result.student.studentName}`,
      "",
      "Он останется в Supabase и прошлых отчётах, но больше не попадёт в будущие недельные выгрузки TrainingPeaks.",
    ].join("\n")
  );
}

async function handleTrainingPeaksEnableStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const studentQuery = parseEnableStudentCommand(text);

  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Напиши так: /tp_enable_student Имя Фамилия");
    return;
  }

  const result = await enableTrainingPeaksStudent(studentQuery);

  if (result.kind === "not_found") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Ученик "${studentQuery}" не найден.\nПосмотри список: /tp_students`
    );
    return;
  }

  if (result.kind === "ambiguous") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, formatStudentAmbiguityMessage(result.matches));
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    [
      `✅ Ученик включён: ${result.student.studentName}`,
      "",
      "Теперь он будет попадать в будущие недельные выгрузки TrainingPeaks.",
    ].join("\n")
  );
}

async function handleTrainingPeaksAddStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const rawInput = parseAddStudentCommand(text);

  if (!rawInput) {
    await showTrainingPeaksAddStudentInstructions(parsedMessage);
    return;
  }

  await handleTrainingPeaksAddStudentInput(parsedMessage, rawInput);
}

async function handleTrainingPeaksReplyDraft(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const { studentQuery, studentMessage } = parseReplyDraftCommand(text);

  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, getReplyDraftUsageMessage());
    return;
  }

  if (!studentMessage) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, getReplyDraftUsageMessage());
    return;
  }

  let studentMatch = await getTrainingPeaksStudentCard(studentQuery);

  if (studentMatch.kind === "not_found" && /^[0-9a-f-]{36}$/i.test(studentQuery)) {
    const studentByUuid = await getTrainingPeaksStudentCardByInternalId(studentQuery);
    if (studentByUuid) {
      studentMatch = { kind: "student", student: studentByUuid };
    }
  }

  if (studentMatch.kind === "not_found") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Ученик "${studentQuery}" не найден.\nПосмотри список: /tp_students`
    );
    return;
  }

  if (studentMatch.kind === "ambiguous") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, formatStudentAmbiguityMessage(studentMatch.matches));
    return;
  }

  const draftContext = await buildTrainingPeaksReplyDraftContext({
    studentUuid: studentMatch.student.id,
    studentSlug: studentMatch.student.studentId,
    studentName: studentMatch.student.studentName,
  });

  if (draftContext.cacheStatus !== "ok") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      [
        `Черновик ответа для ${studentMatch.student.studentName} не сгенерирован.`,
        "",
        "Причина: workout context в кэше TrainingPeaks устарел или отсутствует.",
        draftContext.cacheStatusNote,
        "",
        "Ничего ученику не отправлено.",
        "Обнови кэш/синхронизацию TrainingPeaks и повтори /tp_reply_draft.",
      ].join("\n")
    );
    return;
  }

  const draftResult = await generateTrainingPeaksReplyDraft({
    studentMessage,
    context: draftContext,
  });

  if (!draftResult.ok) {
    if (draftResult.reason === "missing_api_key") {
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        "Не настроен OPENAI_API_KEY — черновик ответа недоступен."
      );
      return;
    }

    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      "Не смог сгенерировать черновик ответа. Попробуй позже."
    );
    return;
  }

  let savedDraftShortId: string | null = null;
  let saveWarning: string | null = null;
  try {
    const promptContextSha256 = sha256TelegramContextText(draftContext.promptContext);
    const studentMessageSha256 = sha256TelegramContextText(studentMessage);
    const draftSha256 = sha256TelegramContextText(draftResult.draftText);
    if (!promptContextSha256 || !studentMessageSha256 || !draftSha256) {
      throw new Error("missing reply draft hash payload");
    }

    const savedDraft = await insertTrainingPeaksReplyDraft({
      studentId: studentMatch.student.id,
      caseId: null,
      source: "telegram_command",
      actorTelegramChatId: String(parsedMessage.chatId),
      aiModel: getTrainingPeaksReplyDraftModel(),
      promptContextSha256,
      studentMessageSha256,
      studentMessagePreview: buildTelegramContextTextPreview(studentMessage)?.slice(0, 80) ?? null,
      draftSha256,
      draftText: draftResult.draftText,
      draftPreview: buildTelegramContextTextPreview(draftResult.draftText),
      draftCharCount: draftResult.draftText.trim().length,
      metadata: {
        cache_status: draftContext.cacheStatus,
        student_slug: studentMatch.student.studentId,
        student_name: studentMatch.student.studentName,
      },
    });
    savedDraftShortId = savedDraft.id.slice(0, 8);
  } catch (saveError) {
    console.warn("Failed to persist TrainingPeaks reply draft", {
      chatId: parsedMessage.chatId,
      studentId: studentMatch.student.id,
      error: saveError,
    });
    saveWarning =
      "⚠️ Черновик показан, но трекинг фидбека не сохранён. Попробуй сгенерировать заново позже.";
  }

  const draftMessage = formatTrainingPeaksReplyDraftTelegramMessage({
    studentName: studentMatch.student.studentName,
    contextBullets: draftContext.telegramContextBullets,
    draftText: draftResult.draftText,
    draftShortId: savedDraftShortId,
  });
  const draftMarkup = savedDraftShortId
    ? getReplyDraftPreviewMarkup(savedDraftShortId, Boolean(draftResult.draftText?.trim()))
    : undefined;

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    saveWarning ? `${draftMessage}\n\n${saveWarning}` : draftMessage,
    {
      replyMarkup: draftMarkup,
    }
  );
}

async function handleTrainingPeaksContextCommand(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const studentQuery = parseTpContextCommand(text);
  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Использование: /tp_context <имя ученика>");
    return;
  }

  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
  const lookup = getTpContextStudentLookupResult(students, studentQuery);
  if (lookup.kind === "not_found") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Не нашёл ученика. Уточни имя.");
    return;
  }

  if (lookup.kind === "ambiguous") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, formatTpContextAmbiguousMessage(lookup.matches));
    return;
  }

  await showTrainingPeaksStudentContext(parsedMessage, lookup.student);
}

async function handleTrainingPeaksReplyDraftFeedback(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const parsed = parseReplyDraftFeedbackCommand(text);
  if (!parsed.draftIdOrPrefix || !parsed.outcome) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, getReplyDraftFeedbackUsageMessage());
    return;
  }

  const result = await recordTrainingPeaksReplyDraftFeedback({
    draftIdOrPrefix: parsed.draftIdOrPrefix,
    outcome: parsed.outcome,
    actorTelegramChatId: String(parsedMessage.chatId),
    note: parsed.note,
  });

  if (result.kind === "ok") {
    const okMessage =
      parsed.outcome === "used"
        ? "Фидбек сохранён: черновик использован."
        : parsed.outcome === "edited"
          ? "Фидбек сохранён: черновик использован с правками."
          : "Фидбек сохранён: черновик проигнорирован.";
    await sendTrainingPeaksMessage(parsedMessage.chatId, okMessage);
    return;
  }

  if (result.kind === "not_found") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Черновик "${parsed.draftIdOrPrefix}" не найден.\n\n${getReplyDraftFeedbackUsageMessage()}`
    );
    return;
  }

  if (result.kind === "already_final") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Для этого черновика фидбек уже зафиксирован (${result.outcome}).`
    );
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    `Не удалось сохранить фидбек.\n\n${getReplyDraftFeedbackUsageMessage()}`
  );
}

async function handleTrainingPeaksReport(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const { studentQuery, week, error } = parseReportCommand(text);

  if (error) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, error);
    return;
  }

  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "После /tp_report нужно указать ученика.");
    return;
  }

  const report = await getTrainingPeaksReportSnapshot(studentQuery, week ?? undefined);

  if (!report) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Отчёт не найден");
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    `📝 ${report.studentName} — отчёт за ${formatWeek(report)}\n\n${report.reportMarkdown}`
  );
}

async function handleTrainingPeaksWeek(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await showTrainingPeaksWeekMenu(parsedMessage);
}

async function handleTrainingPeaksRacesMenu(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  setTrainingPeaksScreenContext(parsedMessage.chatId, "races");
  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getRacesMenuText(),
      getRacesMenuMarkup()
    );
    return;
  }
  await showTrainingPeaksMenuScreen(
    parsedMessage,
    [getRacesMenuText(), "", getRaceScanManualUsageMessage()].join("\n"),
    getRacesMenuMarkup()
  );
}

async function handleTrainingPeaksRacesCustomPeriod(parsedMessage: ParsedTelegramCallbackUpdate): Promise<void> {
  setTrainingPeaksScreenContext(parsedMessage.chatId, "races");
  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    [getRacesMenuText(), "", "Для своего периода пока используй команду:", "/tp_races YYYY-MM-DD YYYY-MM-DD"].join("\n"),
    getRacesMenuMarkup()
  );
}

async function requestTrainingPeaksRaceScanAndReply(
  parsedMessage: ParsedTelegramUpdate,
  period: { fromDate: string; toDate: string },
  options?: { callbackMessageId?: number }
): Promise<void> {
  const result = await requestTrainingPeaksRaceScan(period.fromDate, period.toDate, {
    chatId: parsedMessage.chatId,
    userId: parsedMessage.userId,
  });
  const text = presentTrainingPeaksRaceScanRequestResult({
    fromDate: period.fromDate,
    toDate: period.toDate,
    result,
  });
  setTrainingPeaksScreenContext(parsedMessage.chatId, "races");
  if (parsedMessage.kind === "callback_query" && options?.callbackMessageId) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      options.callbackMessageId,
      text,
      getRacesMenuMarkup()
    );
    return;
  }
  await showTrainingPeaksMenuScreen(parsedMessage, text, getRacesMenuMarkup());
}

async function handleTrainingPeaksRaces(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const parsedPeriod = parseRacesCommandPeriod(text);
  if (parsedPeriod.error) {
    await showTrainingPeaksMenuScreen(
      parsedMessage,
      [parsedPeriod.error, "", getRaceScanManualUsageMessage()].join("\n"),
      getRacesMenuMarkup()
    );
    return;
  }
  if (!parsedPeriod.fromDate || !parsedPeriod.toDate) {
    await handleTrainingPeaksRacesMenu(parsedMessage);
    return;
  }
  await requestTrainingPeaksRaceScanAndReply(parsedMessage, {
    fromDate: parsedPeriod.fromDate,
    toDate: parsedPeriod.toDate,
  });
}

async function handleTrainingPeaksRunStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const result = await requestTrainingPeaksWeeklyRunForStudent(text, {
    chatId: parsedMessage.chatId,
    userId: parsedMessage.userId,
  });
  setTrainingPeaksScreenContext(parsedMessage.chatId, "week");

  if (result.ok) {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getQueuedSingleStudentWeeklyJobSuccessMessage({
        studentName: result.student.studentName,
        studentId: result.student.studentId,
        weekFrom: result.job.weekFrom,
        weekTo: result.job.weekTo,
      }),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  if (result.reason === "duplicate" && result.activeJob) {
    const duplicateMessage =
      result.activeJob.status === "queued"
        ? [
            "Задача для этого ученика уже ожидает запуска на Mac.",
            `Ученик: ${result.activeJob.studentId ?? "—"}`,
            `Неделя: ${formatWeekIso(result.activeJob)}`,
          ].join("\n")
        : [
            "Задача для этого ученика уже выполняется на Mac.",
            `Ученик: ${result.activeJob.studentId ?? "—"}`,
            `Неделя: ${formatWeekIso(result.activeJob)}`,
          ].join("\n");

    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      duplicateMessage,
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    result.message,
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function handleTrainingPeaksRunWeek(
  parsedMessage: ParsedTelegramUpdate,
  text: string,
  options?: {
    useRunAliasMessage?: boolean;
  }
): Promise<void> {
  await showAllEnabledWeeklyRunPreview(parsedMessage, text, options);
}

async function handleTrainingPeaksCancelQueuedJob(
  parsedMessage: ParsedTelegramMessageUpdate
): Promise<void> {
  const cancellableJob = getTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);

  if (!cancellableJob) {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getCancelWeeklyJobMissingContextMessage(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  const result = await cancelTrainingPeaksWeeklyRun(cancellableJob.jobId);
  clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);

  if (result.ok) {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getCancelledWeeklyJobSuccessMessage(cancellableJob),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  if (result.reason === "already_started") {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      "Не удалось отменить задачу: она уже запущена на Mac.",
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getCancelWeeklyJobMissingContextMessage(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function handleTrainingPeaksJobs(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await showTrainingPeaksJobsMenu(parsedMessage);
}

async function handleTrainingPeaksBusinessTest(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const targetChatId = parseTpBusinessTestChatId(text);
  const businessConnectionId = process.env.TELEGRAM_BUSINESS_CONNECTION_ID?.trim();

  if (!businessConnectionId) {
    await sendTelegramMessage(
      parsedMessage.chatId,
      "Missing TELEGRAM_BUSINESS_CONNECTION_ID. Connect the business account first and copy the id from business_connection webhook logs."
    );
    return;
  }

  if (!targetChatId) {
    await sendTelegramMessage(parsedMessage.chatId, "/tp_business_test <chat_id>");
    return;
  }

  try {
    await sendTelegramMessageStrict(
      targetChatId,
      "Тестовое сообщение от Игоря через TrainingPeaks Reports Bot ✅",
      {
        businessConnectionId,
      }
    );
    await sendTelegramMessage(
      parsedMessage.chatId,
      `✅ Бизнес-сообщение отправлено в чат ${targetChatId}.`
    );
  } catch (error) {
    const detail = shortenTrainingPeaksTelegramDeliveryError(error);
    await sendTelegramMessage(
      parsedMessage.chatId,
      isTrainingPeaksTelegramBusinessPeerMissingError(error)
        ? detail
        : `Не удалось отправить бизнес-сообщение в чат ${targetChatId}: ${detail}`
    );
  }
}

async function handleTrainingPeaksSetTelegram(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const parsedCommand = parseTpSetTelegramCommand(text);

  if (!parsedCommand.studentId || !parsedCommand.chatId) {
    await sendTelegramMessage(parsedMessage.chatId, "Usage: /tp_set_telegram <student_id> <chat_id>");
    return;
  }

  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
  const student = students.find((entry) => entry.studentId === parsedCommand.studentId) ?? null;

  if (!student) {
    await sendTelegramMessage(
      parsedMessage.chatId,
      `Student with student_id "${parsedCommand.studentId}" not found.`
    );
    return;
  }

  const businessChat = await getTrainingPeaksBusinessChatByChatId(parsedCommand.chatId);

  if (businessChat) {
    const linked = await linkTrainingPeaksStudentToBusinessChat(
      student.id,
      businessChat.chatId,
      businessChat.businessConnectionId
    );

    if (!linked) {
      await sendTelegramMessage(
        parsedMessage.chatId,
        `Не удалось привязать Telegram для ${student.studentName}.`
      );
      return;
    }

    await sendTelegramMessage(
      parsedMessage.chatId,
      [
        `Telegram chat linked for ${linked.student.studentName}: ${linked.chat.chatId}`,
        linked.chat.username ? `Username: @${linked.chat.username}` : null,
        "Источник: существующий Business-чат.",
      ]
        .filter(Boolean)
        .join("\n")
    );
    return;
  }

  const updatedStudent = await updateTrainingPeaksStudentTelegramContact(student.id, {
    telegram_chat_id: parsedCommand.chatId,
    telegram_username: parsedCommand.username ?? undefined,
    telegram_delivery_enabled: true,
  });

  if (!updatedStudent) {
    await sendTelegramMessage(
      parsedMessage.chatId,
      `Student with student_id "${parsedCommand.studentId}" not found.`
    );
    return;
  }

  const confirmationLines = [
    `⚠️ ВНИМАНИЕ: chat_id не найден в trainingpeaks_telegram_business_chats.`,
    `Telegram chat linked for ${updatedStudent.studentName}: ${parsedCommand.chatId}`,
    "Привязка выполнена в обход Business-истории. Проверь имя/username в /admin/telegram-links перед отправкой отчётов.",
  ];

  if (parsedCommand.username) {
    confirmationLines.push(`Username: @${parsedCommand.username}`);
  }

  await sendTelegramMessage(parsedMessage.chatId, confirmationLines.join("\n"));
}

async function handleTrainingPeaksBind(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const parsedCommand = parseTpBindCommand(text);

  if (!parsedCommand.studentQuery || !parsedCommand.username) {
    await sendTelegramMessage(
      parsedMessage.chatId,
      "Напиши так: /tp_bind <student_name_or_id> <@username>"
    );
    return;
  }

  const studentMatch = await getTrainingPeaksStudentCard(parsedCommand.studentQuery);

  if (studentMatch.kind === "not_found") {
    await sendTelegramMessage(
      parsedMessage.chatId,
      `Ученик "${parsedCommand.studentQuery}" не найден.\nПосмотри список: /tp_students`
    );
    return;
  }

  if (studentMatch.kind === "ambiguous") {
    await sendTelegramMessage(parsedMessage.chatId, formatStudentAmbiguityMessage(studentMatch.matches));
    return;
  }

  await handleTrainingPeaksStudentUsernameLookup(
    parsedMessage,
    studentMatch.student.id,
    parsedCommand.username
  );
}

function getTopicReplyOptions(parsedMessage: ParsedTelegramUpdate): { messageThreadId?: number } {
  if (parsedMessage.kind !== "message") {
    return {};
  }

  return parsedMessage.messageThreadId !== null
    ? { messageThreadId: parsedMessage.messageThreadId }
    : {};
}

function isMessageInsideTopic(parsedMessage: ParsedTelegramUpdate): parsedMessage is ParsedTelegramMessageUpdate {
  return (
    parsedMessage.kind === "message" &&
    parsedMessage.isTopicMessage === true &&
    parsedMessage.messageThreadId !== null
  );
}

function formatThreadStudentLabel(student: { studentName: string; studentId: string } | null): string {
  if (!student) {
    return "unknown";
  }

  return student.studentId !== student.studentName
    ? `${student.studentName} (${student.studentId})`
    : student.studentName;
}

async function handleTrainingPeaksLinkThread(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  if (!isMessageInsideTopic(parsedMessage)) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Отправь команду внутри темы ученика.");
    return;
  }

  const studentQuery = parseTpLinkThreadCommand(text);

  if (!studentQuery) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      "Напиши так: /tp_link_thread <ученик>",
      getTopicReplyOptions(parsedMessage)
    );
    return;
  }

  const messageThreadId = parsedMessage.messageThreadId;
  if (messageThreadId === null) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Отправь команду внутри темы ученика.");
    return;
  }

  const result = await linkTrainingPeaksStudentThread({
    studentQuery,
    telegramChatId: String(parsedMessage.chatId),
    telegramMessageThreadId: messageThreadId,
    chatTitle: parsedMessage.chatTitle,
    threadTitle: parsedMessage.threadTitle,
    linkedByUserId: String(parsedMessage.userId ?? parsedMessage.chatId),
  });

  if (!result.ok) {
    if (result.reason === "student_ambiguous") {
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        formatStudentAmbiguityMessage(result.matches),
        getTopicReplyOptions(parsedMessage)
      );
      return;
    }

    if (result.reason === "linked_to_other_student") {
      const existingLabel = formatThreadStudentLabel(
        result.existingStudent
          ? {
              studentId: result.existingStudent.studentId,
              studentName: result.existingStudent.studentName,
            }
          : null
      );
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        `${result.message}\nСейчас: ${existingLabel}`,
        getTopicReplyOptions(parsedMessage)
      );
      return;
    }

    await sendTrainingPeaksMessage(parsedMessage.chatId, result.message, getTopicReplyOptions(parsedMessage));
    return;
  }

  const confirmation =
    result.kind === "already_linked"
      ? `Тема уже привязана к ученику ${formatThreadStudentLabel(result.student)}.`
      : `Тема привязана к ученику ${formatThreadStudentLabel(result.student)}.`;

  await sendTrainingPeaksMessage(parsedMessage.chatId, confirmation, getTopicReplyOptions(parsedMessage));
}

async function handleTrainingPeaksThreadInfo(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  if (!isMessageInsideTopic(parsedMessage)) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Отправь команду внутри темы ученика.");
    return;
  }

  const messageThreadId = parsedMessage.messageThreadId;
  if (messageThreadId === null) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Отправь команду внутри темы ученика.");
    return;
  }

  const info = await getTrainingPeaksThreadInfo({
    telegramChatId: String(parsedMessage.chatId),
    telegramMessageThreadId: messageThreadId,
    chatTitle: parsedMessage.chatTitle,
    threadTitle: parsedMessage.threadTitle,
  });

  const lines = [
    "Thread info",
    `chat.id: ${info.chatId}`,
    `message_thread_id: ${info.messageThreadId}`,
    `chat title: ${info.chatTitle ?? "—"}`,
    `thread title: ${info.threadTitle ?? "—"}`,
    `linked student: ${
      info.linked
        ? formatThreadStudentLabel(
            info.student
              ? {
                  studentId: info.student.studentId,
                  studentName: info.student.studentName,
                }
              : null
          )
        : "не привязана"
    }`,
  ];

  await sendTrainingPeaksMessage(parsedMessage.chatId, lines.join("\n"), getTopicReplyOptions(parsedMessage));
}

async function handleTrainingPeaksUnlinkThread(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  if (!isMessageInsideTopic(parsedMessage)) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Отправь команду внутри темы ученика.");
    return;
  }

  const messageThreadId = parsedMessage.messageThreadId;
  if (messageThreadId === null) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Отправь команду внутри темы ученика.");
    return;
  }

  const result = await unlinkTrainingPeaksStudentThread({
    telegramChatId: String(parsedMessage.chatId),
    telegramMessageThreadId: messageThreadId,
  });

  if (!result.ok) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, result.message, getTopicReplyOptions(parsedMessage));
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    `Тема отвязана от ученика ${formatThreadStudentLabel(
      result.student
        ? {
            studentId: result.student.studentId,
            studentName: result.student.studentName,
          }
        : null
    )}.`,
    getTopicReplyOptions(parsedMessage)
  );
}

function getWeekResultMarkup(options?: {
  includeJobsButton?: boolean;
  cancellableJobId?: string | null;
}): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = [];

  if (options?.cancellableJobId) {
    rows.push([
      createMenuButton(
        "❌ Отменить задачу",
        `${TP_CALLBACK_JOB_CANCEL_PREFIX}${options.cancellableJobId}`
      ),
    ]);
  }

  if (options?.includeJobsButton) {
    rows.push([createMenuButton("🧾 Задачи", TP_CALLBACK_JOBS)]);
  }

  rows.push([
    createMenuButton("⬅️ Назад", TP_CALLBACK_WEEK_MENU),
    createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU),
  ]);

  return createInlineKeyboardMarkup(rows);
}

function getAllEnabledWeeklyRunPreviewMarkup(studentCount: number): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton(`Подтвердить для всех (${studentCount})`, TP_CALLBACK_WEEK_RUN_CONFIRM)],
    [createMenuButton("Отмена", TP_CALLBACK_WEEK_RUN_CANCEL)],
  ]);
}

function formatAllEnabledWeeklyRunPreviewMessage(input: {
  week: TrainingPeaksWeek;
  students: { studentName: string }[];
}): string {
  const previewNames = input.students.slice(0, TP_ALL_ENABLED_WEEKLY_PREVIEW_NAME_LIMIT);
  const remainingCount = Math.max(0, input.students.length - previewNames.length);

  return [
    "⚠️ Подтвердите запуск недельных отчётов для всех включённых учеников.",
    "",
    `Неделя: ${formatWeekIso(input.week)}`,
    `Учеников: ${input.students.length}`,
    "",
    ...previewNames.map((student) => `• ${student.studentName}`),
    ...(remainingCount > 0 ? [`… и ещё ${remainingCount}`] : []),
    "",
    "Для одного ученика используй /tp_run_student …",
  ].join("\n");
}

async function showAllEnabledWeeklyRunPreview(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  rawInput: string,
  options?: {
    useRunAliasMessage?: boolean;
  }
): Promise<void> {
  const parsedWeek = parseTrainingPeaksWeeklyRunWeekInput(rawInput);

  if (!parsedWeek.ok) {
    clearPendingAllEnabledWeeklyRunContext(parsedMessage.chatId);
    const message = options?.useRunAliasMessage
      ? formatTpRunAliasMessage(parsedWeek.message)
      : parsedWeek.message;

    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        message,
        getWeekMenuMarkup()
      );
      return;
    }

    await showTrainingPeaksMenuScreen(parsedMessage, message, getReportsMenuMarkup());
    return;
  }

  const eligibleStudents = await listTrainingPeaksWeeklyReportEligibleStudents();
  setPendingAllEnabledWeeklyRunContext(parsedMessage.chatId, {
    weekFrom: parsedWeek.weekFrom,
    weekTo: parsedWeek.weekTo,
    previewCount: eligibleStudents.length,
  });
  setTrainingPeaksScreenContext(parsedMessage.chatId, "week");

  const previewText = formatAllEnabledWeeklyRunPreviewMessage({
    week: parsedWeek,
    students: eligibleStudents,
  });
  const previewMarkup = getAllEnabledWeeklyRunPreviewMarkup(eligibleStudents.length);

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      previewText,
      previewMarkup
    );
    return;
  }

  await sendTelegramMessage(parsedMessage.chatId, previewText, {
    replyMarkup: previewMarkup,
  });
}

async function presentAllEnabledWeeklyRunEnqueueResult(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  result: RequestTrainingPeaksWeeklyRunResult,
  options?: {
    useRunAliasMessage?: boolean;
    callbackMessageId?: number;
  }
): Promise<void> {
  if (result.ok) {
    if (result.job.status === "queued") {
      setTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId, {
        jobId: result.job.id,
        weekFrom: result.job.weekFrom,
        weekTo: result.job.weekTo,
      });
    } else {
      clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);
    }

    const successText = getQueuedWeeklyJobSuccessMessage(result.job, {
      allEnabledWarning: options?.useRunAliasMessage === true,
    });
    const successMarkup = getWeekResultMarkup({
      includeJobsButton: true,
      cancellableJobId: result.job.status === "queued" ? result.job.id : null,
    });

    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        options?.callbackMessageId ?? parsedMessage.messageId,
        successText,
        successMarkup
      );
      return;
    }

    await sendTelegramMessage(parsedMessage.chatId, successText, {
      replyMarkup: successMarkup,
    });
    return;
  }

  if (result.reason === "duplicate" && result.activeJob) {
    if (result.activeJob.status === "queued") {
      setTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId, {
        jobId: result.activeJob.id,
        weekFrom: result.activeJob.weekFrom,
        weekTo: result.activeJob.weekTo,
      });
    } else {
      clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);
    }

    const duplicateText =
      result.activeJob.status === "queued"
        ? getDuplicateQueuedWeeklyJobMessage(result.activeJob)
        : getDuplicateRunningWeeklyJobMessage(result.activeJob);
    const duplicateMarkup = getWeekResultMarkup({
      includeJobsButton: true,
      cancellableJobId:
        result.activeJob.status === "queued" ? result.activeJob.id : null,
    });

    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        options?.callbackMessageId ?? parsedMessage.messageId,
        duplicateText,
        duplicateMarkup
      );
      return;
    }

    await sendTelegramMessage(parsedMessage.chatId, duplicateText, {
      replyMarkup: duplicateMarkup,
    });
    return;
  }

  clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);
  const errorText = options?.useRunAliasMessage
    ? formatTpRunAliasMessage(result.message)
    : result.message;

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      options?.callbackMessageId ?? parsedMessage.messageId,
      errorText,
      getWeekResultMarkup()
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, errorText, getWeekResultMarkup());
}

async function handleTrainingPeaksConfirmAllEnabledWeeklyRun(
  parsedMessage: ParsedTelegramCallbackUpdate
): Promise<void> {
  const pending = getPendingAllEnabledWeeklyRunContext(parsedMessage.chatId);

  if (!pending) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Подтверждение истекло. Запусти неделю ещё раз.",
      getWeekMenuMarkup()
    );
    return;
  }

  clearPendingAllEnabledWeeklyRunContext(parsedMessage.chatId);

  const result = await requestTrainingPeaksWeeklyRun(
    `/tp_run_week ${pending.weekFrom} ${pending.weekTo}`,
    {
      chatId: parsedMessage.chatId,
      userId: parsedMessage.userId,
    }
  );

  await presentAllEnabledWeeklyRunEnqueueResult(parsedMessage, result, {
    callbackMessageId: parsedMessage.messageId,
  });
}

async function handleTrainingPeaksCancelAllEnabledWeeklyRunPreview(
  parsedMessage: ParsedTelegramCallbackUpdate
): Promise<void> {
  clearPendingAllEnabledWeeklyRunContext(parsedMessage.chatId);
  clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    "Запуск отменён.",
    getWeekMenuMarkup()
  );
}

async function handleTrainingPeaksCancelJobCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  jobId: string
): Promise<void> {
  const result = await cancelTrainingPeaksWeeklyRun(jobId);
  const cancellableJob = getTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);

  if (cancellableJob?.jobId === jobId) {
    clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);
  }

  if (result.ok) {
    await showTrainingPeaksJobsMenu(parsedMessage);
    return;
  }

  if (result.reason === "already_started") {
    const jobs = await getTrainingPeaksJobsStatus();
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      ["Уже на Mac, отмена недоступна.", "", getJobsScreenText(jobs)].join("\n"),
      getJobsMenuMarkup(jobs)
    );
    return;
  }

  await showTrainingPeaksJobsMenu(parsedMessage);
}

function getQueuedWeeklyJobSuccessMessage(
  week: TrainingPeaksWeek,
  options?: { allEnabledWarning?: boolean }
): string {
  return [
    "✅ Задача поставлена в очередь.",
    `Неделя: ${formatWeekIso(week)}`,
    ...(options?.allEnabledWarning
      ? [
          "",
          "⚠️ Эта задача запустит генерацию для всех учеников с включёнными недельными отчётами.",
          "Для одного ученика используй /tp_run_student.",
        ]
      : []),
    "",
    "Статус: ожидает запуска на Mac.",
    "Чтобы начать обработку, запусти локальный runner:",
    "npm run tp-agent-once",
  ].join("\n");
}

function getQueuedSingleStudentWeeklyJobSuccessMessage(input: {
  studentName: string;
  studentId: string;
  weekFrom: string;
  weekTo: string;
}): string {
  return [
    "✅ Задача для одного ученика поставлена в очередь.",
    `Ученик: ${input.studentName} (${input.studentId})`,
    `Неделя: ${formatWeekIso({ weekFrom: input.weekFrom, weekTo: input.weekTo })}`,
    "",
    "Отчёт не будет отправлен ученику автоматически.",
    "Статус: ожидает запуска на Mac.",
    "Чтобы начать обработку, запусти локальный runner:",
    "npm run tp-agent-once",
  ].join("\n");
}

function getDuplicateQueuedWeeklyJobMessage(week: TrainingPeaksWeek): string {
  return [
    "Задача за эту неделю уже ожидает запуска на Mac.",
    `Неделя: ${formatWeekIso(week)}`,
  ].join("\n");
}

function getDuplicateRunningWeeklyJobMessage(week: TrainingPeaksWeek): string {
  return [
    "Задача за эту неделю уже выполняется на Mac.",
    `Неделя: ${formatWeekIso(week)}`,
  ].join("\n");
}

function getCancelledWeeklyJobSuccessMessage(week: TrainingPeaksWeek): string {
  return [
    "✅ Задача отменена.",
    `Неделя: ${formatWeekIso(week)}`,
  ].join("\n");
}

function getCancelWeeklyJobMissingContextMessage(): string {
  return [
    "Не вижу задачу для отмены.",
    "Открой «🧾 Задачи» или попробуй поставить неделю в очередь ещё раз.",
  ].join("\n");
}

async function handleTrainingPeaksSendReportToStudentCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  reportId: string
): Promise<void> {
  const report = await getTrainingPeaksWeeklyReportByInternalId(reportId);

  if (!report) {
    await notifyCoachReportAction(parsedMessage.chatId, "Отчёт не найден.");
    return;
  }

  const deliveryResult = await sendTrainingPeaksWeeklyReportToStudent(report.id);

  if (!deliveryResult.ok) {
    await notifyCoachReportAction(parsedMessage.chatId, deliveryResult.message);
    return;
  }

  await notifyCoachReportAction(
    parsedMessage.chatId,
    deliveryResult.deliveredChunks > 1
      ? `Отчёт отправлен ученику: ${deliveryResult.studentName} (${deliveryResult.deliveredChunks} сообщения).`
      : `Отчёт отправлен ученику: ${deliveryResult.studentName}.`
  );
}

async function handleTrainingPeaksSkipReportCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  reportId: string
): Promise<void> {
  const report = await getTrainingPeaksWeeklyReportByInternalId(reportId);

  if (!report) {
    await notifyCoachReportAction(parsedMessage.chatId, "Отчёт не найден.");
    return;
  }

  if (report.reviewStatus === "sent") {
    await notifyCoachReportAction(
      parsedMessage.chatId,
      `Отчёт уже отправлен ученику: ${report.studentName}.`
    );
    return;
  }

  await updateTrainingPeaksWeeklyReportStateByInternalId(report.id, {
    reviewStatus: "skipped",
  });
  await notifyCoachReportAction(parsedMessage.chatId, `Отчёт пропущен: ${report.studentName}.`);
}

async function handleTrainingPeaksReplyDraftSendCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  draftIdPrefix: string
): Promise<void> {
  await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Отправляю…");
  const result = await sendTrainingPeaksReplyDraftToStudent({
    draftId: draftIdPrefix,
    actorTelegramChatId: String(parsedMessage.chatId),
  });

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    formatReplyDraftSendCallbackResultText({ result }),
    getReplyDraftFinalMarkup()
  );
}

async function handleTrainingPeaksReplyDraftCancelCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  draftIdPrefix: string
): Promise<void> {
  await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Отменяю…");
  const draft = await getTrainingPeaksReplyDraftByIdPrefix(draftIdPrefix);
  if (!draft) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Черновик не найден.",
      getReplyDraftFinalMarkup()
    );
    return;
  }

  if (draft.outcome !== "generated") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Черновик уже обработан.",
      getReplyDraftFinalMarkup()
    );
    return;
  }

  const updatedDraft = await updateTrainingPeaksReplyDraftOutcome({
    draftId: draft.id,
    outcome: "ignored",
  });
  if (!updatedDraft) {
    const reloaded = await getTrainingPeaksReplyDraftByIdPrefix(draft.id);
    const alreadyFinal = reloaded && reloaded.outcome !== "generated";
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      alreadyFinal ? "Черновик уже обработан." : "Не удалось отменить черновик. Попробуй позже.",
      getReplyDraftFinalMarkup()
    );
    return;
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    ["Черновик отменён.", "Ничего не отправлено ученику."].join("\n"),
    getReplyDraftFinalMarkup()
  );
}

export async function handleTrainingPeaksTelegramCallback(
  parsedMessage: ParsedTelegramCallbackUpdate
): Promise<"handled" | "ignored"> {
  const groupWorkoutReportReviewCallback = parseGroupWorkoutReportReviewCallback(parsedMessage.data);
  if (groupWorkoutReportReviewCallback) {
    if (!isCoachChat(parsedMessage.chatId)) {
      await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
      return "handled";
    }

    await handleGroupWorkoutReportReviewCallback({
      callback: groupWorkoutReportReviewCallback,
      coachChatId: String(parsedMessage.chatId),
      coachMessageId: parsedMessage.messageId,
      callbackQueryId: parsedMessage.callbackQueryId,
      deps: {
        answerCallback: async (callbackQueryId, text) => {
          await answerTelegramCallbackQuery(callbackQueryId, text);
        },
      },
    });
    return "handled";
  }

  const callback = parseTrainingPeaksCallback(parsedMessage.data);

  if (!callback) {
    return "ignored";
  }

  if (!isCoachChat(parsedMessage.chatId)) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return "handled";
  }

  try {
    if (callback.kind === "main_menu") {
      await showTrainingPeaksMainMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "students_page") {
      await showTrainingPeaksStudentsPage(parsedMessage, callback.page);
      return "handled";
    }

    if (callback.kind === "student_card") {
      await showTrainingPeaksStudentCardMenu(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_link") {
      await showTrainingPeaksStudentTelegramLinkMenu(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_username_prompt") {
      await promptTrainingPeaksStudentUsernameLookup(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_link_code") {
      await handleTrainingPeaksStudentLinkCodeRequest(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_choose_chat") {
      await handleTrainingPeaksStudentChooseBusinessChatCallback(
        parsedMessage,
        callback.studentId,
        callback.chatKey
      );
      return "handled";
    }

    if (callback.kind === "student_test") {
      await handleTrainingPeaksStudentTestMessageCallback(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_tools_menu") {
      await showTrainingPeaksStudentToolsMenu(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_context") {
      const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
      const student = resolveTpContextStudentByPrefix(students, callback.studentId);
      if (!student) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Ученик не найден. Запусти /tp_context <имя ученика> заново.",
          getStudentNotFoundMarkup()
        );
        return "handled";
      }
      await showTrainingPeaksStudentContext(parsedMessage, student);
      return "handled";
    }

    if (callback.kind === "student_race_results_probe") {
      await handleTrainingPeaksStudentRaceResultsProbeCallback(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_report") {
      const student = await getTrainingPeaksStudentCardByInternalId(callback.studentId);

      if (!student) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Ученик больше не найден.",
          getStudentNotFoundMarkup()
        );
        return "handled";
      }

      const report = await getTrainingPeaksLatestReportSnapshotByInternalId(callback.studentId);

      if (!report) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Последний отчёт для этого ученика пока не найден.",
          getStudentReportMissingMarkup(callback.studentId)
        );
        return "handled";
      }

      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        `📝 ${report.studentName} — отчёт за ${formatWeek(report)}\n\n${report.reportMarkdown}`
      );
      return "handled";
    }

    if (callback.kind === "student_disable") {
      const student = await disableTrainingPeaksStudentByInternalId(callback.studentId);

      if (!student) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Ученик больше не найден.",
          getStudentNotFoundMarkup()
        );
        return "handled";
      }

      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentCardMessageLines(student).join("\n"),
        getStudentCardMenuMarkup(student)
      );
      return "handled";
    }

    if (callback.kind === "student_enable") {
      const student = await enableTrainingPeaksStudentByInternalId(callback.studentId);

      if (!student) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Ученик больше не найден.",
          getStudentNotFoundMarkup()
        );
        return "handled";
      }

      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentCardMessageLines(student).join("\n"),
        getStudentCardMenuMarkup(student)
      );
      return "handled";
    }

    if (callback.kind === "report_send") {
      await handleTrainingPeaksSendReportToStudentCallback(parsedMessage, callback.reportId);
      return "handled";
    }

    if (callback.kind === "report_skip") {
      await handleTrainingPeaksSkipReportCallback(parsedMessage, callback.reportId);
      return "handled";
    }

    if (callback.kind === "reply_draft_send") {
      await handleTrainingPeaksReplyDraftSendCallback(parsedMessage, callback.draftIdPrefix);
      return "handled";
    }

    if (callback.kind === "reply_draft_cancel") {
      await handleTrainingPeaksReplyDraftCancelCallback(parsedMessage, callback.draftIdPrefix);
      return "handled";
    }

    if (callback.kind === "reply_draft_close") {
      await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Закрыто");
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Предпросмотр черновика закрыт.",
        getReplyDraftFinalMarkup()
      );
      return "handled";
    }

    if (callback.kind === "action_approve") {
      await handleTrainingPeaksActionDecisionCallback(parsedMessage, "approve", callback.actionId);
      return "handled";
    }

    if (callback.kind === "action_reject") {
      await handleTrainingPeaksActionDecisionCallback(parsedMessage, "reject", callback.actionId);
      return "handled";
    }

    if (callback.kind === "action_execute_request") {
      await handleTrainingPeaksActionExecuteRequestCallback(parsedMessage, callback.actionId);
      return "handled";
    }

    if (callback.kind === "action_recheck_dry_run") {
      await handleTrainingPeaksActionDryRunRecheckCallback(parsedMessage, callback.actionId);
      return "handled";
    }

    if (callback.kind === "action_execute_cancel") {
      await handleTrainingPeaksActionExecuteCancelCallback(parsedMessage, callback.actionId);
      return "handled";
    }

    if (callback.kind === "action_confirm_source_date") {
      await handleTrainingPeaksActionConfirmSourceDateCallback(parsedMessage, callback.actionId);
      return "handled";
    }

    if (callback.kind === "action_list_cancel") {
      await handleTpActionsCancelCallback(parsedMessage, callback.actionId);
      return "handled";
    }

    if (callback.kind === "action_detail") {
      await showTpActionDetail(parsedMessage, callback.actionId);
      return "handled";
    }

    if (callback.kind === "action_detail_cancel") {
      await handleTpActionDetailCancelCallback(parsedMessage, callback.actionId);
      return "handled";
    }

    if (callback.kind === "action_detail_back") {
      await showTpActionsList(parsedMessage);
      return "handled";
    }

    if (callback.kind === "case_resolve") {
      const result = await resolveTrainingPeaksCoachCase({
        caseId: callback.shortId,
        actorTelegramChatId: String(parsedMessage.chatId),
        note: "closed via Telegram button",
      });

      if (result.kind === "resolved" || result.kind === "dismissed") {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          appendTrainingPeaksCoachCaseFinalState(parsedMessage.messageText, "✓ Закрыто", callback.shortId),
          getTrainingPeaksCoachCaseResolvedMarkup()
        );
        return "handled";
      }

      if (result.kind === "ambiguous") {
        await sendTrainingPeaksMessage(
          parsedMessage.chatId,
          `Неоднозначный ID кейса ${callback.shortId}, укажи больше символов.`
        );
        return "handled";
      }

      if (result.kind === "not_found") {
        await sendTrainingPeaksMessage(parsedMessage.chatId, `Кейс ${callback.shortId} не найден.`);
        return "handled";
      }

      if (result.kind === "invalid_prefix") {
        await sendTrainingPeaksMessage(parsedMessage.chatId, `Некорректный ID кейса ${callback.shortId}.`);
        return "handled";
      }

      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        `Ошибка. Попробуй: /tp case resolve ${callback.shortId}`
      );
      return "handled";
    }

    if (callback.kind === "case_dismiss") {
      const result = await dismissTrainingPeaksCoachCase({
        caseId: callback.shortId,
        actorTelegramChatId: String(parsedMessage.chatId),
        note: "dismissed as noise via Telegram button",
      });

      if (result.kind === "dismissed" || result.kind === "resolved") {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          appendTrainingPeaksCoachCaseFinalState(parsedMessage.messageText, "🙈 Скрыто", callback.shortId),
          getTrainingPeaksCoachCaseResolvedMarkup()
        );
        return "handled";
      }

      if (result.kind === "ambiguous") {
        await sendTrainingPeaksMessage(
          parsedMessage.chatId,
          `Неоднозначный ID кейса ${callback.shortId}, укажи больше символов.`
        );
        return "handled";
      }

      if (result.kind === "not_found") {
        await sendTrainingPeaksMessage(parsedMessage.chatId, `Кейс ${callback.shortId} не найден.`);
        return "handled";
      }

      if (result.kind === "invalid_prefix") {
        await sendTrainingPeaksMessage(parsedMessage.chatId, `Некорректный ID кейса ${callback.shortId}.`);
        return "handled";
      }

      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        `Ошибка. Попробуй: /tp case dismiss ${callback.shortId}`
      );
      return "handled";
    }

    if (callback.kind === "case_create_proposals") {
      await handleTrainingPeaksCoachCaseCreateProposalsCallback(parsedMessage, callback.shortId);
      return "handled";
    }

    if (callback.kind === "actions_list") {
      await showTpActionsList(parsedMessage);
      return "handled";
    }

    if (callback.kind === "signals_list") {
      await handleTrainingPeaksOperationalSignalsCommand(parsedMessage, "/tp_signals");
      return "handled";
    }

    if (callback.kind === "week_menu") {
      await showTrainingPeaksWeekMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "races_menu") {
      await handleTrainingPeaksRacesMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "week_last" || callback.kind === "week_current") {
      await showAllEnabledWeeklyRunPreview(
        parsedMessage,
        callback.kind === "week_last" ? "/tp_run_week last" : "/tp_run_week current"
      );
      return "handled";
    }

    if (callback.kind === "week_run_confirm") {
      await handleTrainingPeaksConfirmAllEnabledWeeklyRun(parsedMessage);
      return "handled";
    }

    if (callback.kind === "week_run_cancel") {
      await handleTrainingPeaksCancelAllEnabledWeeklyRunPreview(parsedMessage);
      return "handled";
    }

    if (callback.kind === "job_cancel") {
      await handleTrainingPeaksCancelJobCallback(parsedMessage, callback.jobId);
      return "handled";
    }

    if (callback.kind === "races_next_week") {
      await requestTrainingPeaksRaceScanAndReply(parsedMessage, getRacesNextWeekPeriod(), {
        callbackMessageId: parsedMessage.messageId,
      });
      return "handled";
    }

    if (callback.kind === "races_7_days") {
      await requestTrainingPeaksRaceScanAndReply(parsedMessage, getRaces7DaysPeriod(), {
        callbackMessageId: parsedMessage.messageId,
      });
      return "handled";
    }

    if (callback.kind === "races_30_days") {
      await requestTrainingPeaksRaceScanAndReply(parsedMessage, getRaces30DaysPeriod(), {
        callbackMessageId: parsedMessage.messageId,
      });
      return "handled";
    }

    if (callback.kind === "races_to_august") {
      await requestTrainingPeaksRaceScanAndReply(parsedMessage, getRacesToAugustPeriod(), {
        callbackMessageId: parsedMessage.messageId,
      });
      return "handled";
    }

    if (callback.kind === "races_custom") {
      await handleTrainingPeaksRacesCustomPeriod(parsedMessage);
      return "handled";
    }

    if (callback.kind === "jobs") {
      await showTrainingPeaksJobsMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "cases_recent") {
      await handleTrainingPeaksRecentCoachCases(parsedMessage);
      return "handled";
    }

    if (callback.kind === "cases_page") {
      await handleTrainingPeaksCasesList(parsedMessage, {
        query: callback.query,
        offset: callback.offset,
      });
      return "handled";
    }

    if (callback.kind === "help") {
      await showTrainingPeaksHelpMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "reports_menu") {
      await showTrainingPeaksReportsMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "reports_status_last") {
      await handleTrainingPeaksReportsStatusLast(parsedMessage);
      return "handled";
    }

    if (callback.kind === "reports_from_student") {
      await showTrainingPeaksReportsFromStudent(parsedMessage);
      return "handled";
    }

    if (callback.kind === "reports_eligible") {
      await showTrainingPeaksReportsEligibleStudents(parsedMessage);
      return "handled";
    }

    if (callback.kind === "more_menu") {
      await showTrainingPeaksMoreMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "attention") {
      await handleTrainingPeaksAttention(parsedMessage);
      return "handled";
    }

    if (callback.kind === "reply_draft_hint") {
      await showTrainingPeaksMenuScreen(
        parsedMessage,
        getReplyDraftHintText(),
        getReplyDraftHintMarkup()
      );
      return "handled";
    }

    if (callback.kind === "billing_hint") {
      await showTrainingPeaksMenuScreen(parsedMessage, getBillingHintText(), getBillingHintMarkup());
      return "handled";
    }

    if (callback.kind === "health") {
      await handleTrainingPeaksHealth(parsedMessage);
      return "handled";
    }

    if (callback.kind === "cron_status") {
      await handleTrainingPeaksCronStatus(parsedMessage);
      return "handled";
    }

    if (callback.kind === "intents") {
      await showTrainingPeaksMenuScreen(parsedMessage, getIntentsHintText(), getIntentsHintMarkup());
      return "handled";
    }

    if (callback.kind === "telegram_links_hint") {
      await showTrainingPeaksMenuScreen(
        parsedMessage,
        getTelegramLinksHintText(),
        getTelegramLinksHintMarkup()
      );
      return "handled";
    }

    if (callback.kind === "voice_drafts_close") {
      await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Закрыто");
      try {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Предпросмотр голосовых черновиков закрыт.",
          createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]])
        );
      } catch {
        await sendTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          "Предпросмотр голосовых черновиков закрыт.",
          createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]])
        );
      }
      return "handled";
    }

    if (callback.kind === "voice_pick_none") {
      const context = getPendingVoicePickContext(callback.key);
      clearPendingVoicePickContext(callback.key);
      await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Понял");
      if (!context || context.chatId !== String(parsedMessage.chatId)) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Выбор уже недоступен.",
          createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]])
        );
        return "handled";
      }

      const noneText = [
        "Черновик не создан.",
        `Я не выбрал ученика для «${context.recipientQuery}».`,
        "",
        "Ничего не отправлено ученикам.",
      ].join("\n");
      try {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          noneText,
          getVoicePickNoneMarkup()
        );
      } catch {
        await sendTrainingPeaksMenuMessage(parsedMessage.chatId, noneText, getVoicePickNoneMarkup());
      }
      return "handled";
    }

    if (callback.kind === "voice_pick") {
      const context = getPendingVoicePickContext(callback.key);
      clearPendingVoicePickContext(callback.key);
      if (!context || context.chatId !== String(parsedMessage.chatId)) {
        await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Выбор устарел");
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Выбор уже недоступен.",
          createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]])
        );
        return "handled";
      }
      const pickedStudentId = context.candidateStudentIds[callback.candidateIndex] ?? null;
      if (!pickedStudentId) {
        await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Кандидат недоступен");
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Кандидат больше недоступен. Повтори голосовую команду.",
          createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]])
        );
        return "handled";
      }

      const studentsRegistry = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
      const student = studentsRegistry.find(
        (item) => item.isActive && item.id === pickedStudentId
      );
      if (!student) {
        await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Ученик не найден");
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Ученик больше не найден.",
          createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]])
        );
        return "handled";
      }

      const extracted: ExtractedVoiceStudentMessage = {
        recipientQuery: context.recipientQuery,
        messageText: context.messageText,
        confidence: context.confidence,
      };

      try {
        const created = await createVoiceDraftFromMatch({
          parsedMessage,
          student,
          extracted,
          promptContextSha256: context.promptContextSha256,
          transcriptPreview: context.transcriptPreview,
          extractionModel: context.extractionModel,
          batchKey: callback.key,
          batchIndex: 1,
          batchTotal: 1,
          selectedFromAmbiguity: true,
          voiceCommandMessageId: context.voiceCommandMessageId,
        });
        await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Черновик создан");
        if (!created) {
          await editTrainingPeaksMenuMessage(
            parsedMessage.chatId,
            parsedMessage.messageId,
            "Не удалось создать черновик. Повтори голосовую команду.",
            createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]])
          );
          return "handled";
        }
        const successText = [
          "✅ Черновик создан.",
          "",
          "Ученик:",
          created.studentName,
          "",
          "Текст:",
          `«${created.draftPreview}»`,
          "",
          "Ничего не отправлено ученику без подтверждения.",
        ].join("\n");
        const successMarkup = getReplyDraftPreviewMarkup(created.draftIdShort, created.hasDraftText);
        try {
          await editTrainingPeaksMenuMessage(
            parsedMessage.chatId,
            parsedMessage.messageId,
            successText,
            successMarkup
          );
        } catch {
          await sendTrainingPeaksMenuMessage(parsedMessage.chatId, successText, successMarkup);
        }
      } catch {
        await answerTelegramCallbackQuery(parsedMessage.callbackQueryId, "Ошибка");
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Не удалось создать черновик. Повтори голосовую команду.",
          createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]])
        );
      }
      return "handled";
    }

    if (callback.kind === "student_weekly_hint") {
      await showTrainingPeaksStudentWeeklyReportHint(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_weekly_run") {
      await handleTrainingPeaksStudentWeeklyRunCallback(
        parsedMessage,
        callback.studentId,
        callback.weekKeyword
      );
      return "handled";
    }
  } catch (error) {
    console.error("TrainingPeaks Telegram callback failed", {
      chatId: parsedMessage.chatId,
      messageId: parsedMessage.messageId,
      callbackData: parsedMessage.data,
      error,
    });

    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не смог загрузить данные TrainingPeaks. Попробуй позже.",
      getCallbackErrorMarkup()
    );
    return "handled";
  }

  return "handled";
}

export async function handleTrainingPeaksTelegramCommand(
  parsedMessage: ParsedTelegramUpdate,
  text: string,
  chatType?: TelegramChatType
): Promise<"handled" | "ignored"> {
  const command = getTrainingPeaksCommand(text);

  if (!command) {
    return "ignored";
  }

  if (command === "tp_group_test") {
    if (!isCoachAuthorizedForTelegramChat(parsedMessage, chatType)) {
      await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
      return "handled";
    }

    await handleTrainingPeaksGroupTest(parsedMessage, chatType);
    return "handled";
  }

  if (
    command === "tp_link_thread" ||
    command === "tp_thread_info" ||
    command === "tp_unlink_thread"
  ) {
    if (!isCoachAuthorizedForTelegramChat(parsedMessage, chatType)) {
      await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
      return "handled";
    }

    try {
      if (command === "tp_link_thread") {
        await handleTrainingPeaksLinkThread(parsedMessage, text);
        return "handled";
      }

      if (command === "tp_thread_info") {
        await handleTrainingPeaksThreadInfo(parsedMessage);
        return "handled";
      }

      await handleTrainingPeaksUnlinkThread(parsedMessage);
    } catch (error) {
      console.error("TrainingPeaks Telegram thread command failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        command,
        error,
      });

      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        "Не смог загрузить данные TrainingPeaks. Попробуй позже."
      );
    }

    return "handled";
  }

  if (!isCoachChat(parsedMessage.chatId)) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return "handled";
  }

  try {
    if (command === "tp") {
      await handleTrainingPeaksMain(parsedMessage);
      return "handled";
    }

    if (command === "tp_start") {
      if (!isParsedTelegramMessageUpdate(parsedMessage)) {
        await sendTrainingPeaksMessage(parsedMessage.chatId, TP_UNKNOWN_COMMAND_MESSAGE);
        return "handled";
      }
      await handleTrainingPeaksStartPayload(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_status") {
      await handleTrainingPeaksStatus(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_students") {
      await handleTrainingPeaksStudents(parsedMessage);
      return "handled";
    }

    if (command === "tp_student") {
      await handleTrainingPeaksStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_disable_student") {
      await handleTrainingPeaksDisableStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_enable_student") {
      await handleTrainingPeaksEnableStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_add") {
      await handleTrainingPeaksAddStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_add_student") {
      await handleTrainingPeaksAddStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_report") {
      await handleTrainingPeaksReport(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_week") {
      await handleTrainingPeaksWeek(parsedMessage);
      return "handled";
    }

    if (command === "tp_run_student") {
      await handleTrainingPeaksRunStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_run") {
      await handleTrainingPeaksRunWeek(parsedMessage, normalizeTpRunCommand(text), {
        useRunAliasMessage: true,
      });
      return "handled";
    }

    if (command === "tp_run_week") {
      await handleTrainingPeaksRunWeek(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_races") {
      await handleTrainingPeaksRaces(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_jobs") {
      await handleTrainingPeaksJobs(parsedMessage);
      return "handled";
    }

    if (command === "tp_attention") {
      await handleTrainingPeaksAttention(parsedMessage);
      return "handled";
    }

    if (command === "tp_signals") {
      await handleTrainingPeaksOperationalSignalsCommand(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_cases_recent") {
      await handleTrainingPeaksRecentCoachCases(parsedMessage);
      return "handled";
    }

    if (command === "tp_cases") {
      await handleTrainingPeaksCasesCommand(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_case") {
      await handleTrainingPeaksCaseCommand(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_case_resolve") {
      await handleTrainingPeaksCoachCaseResolveOrDismiss(parsedMessage, text, "resolve");
      return "handled";
    }

    if (command === "tp_case_dismiss") {
      await handleTrainingPeaksCoachCaseResolveOrDismiss(parsedMessage, text, "dismiss");
      return "handled";
    }

    if (command === "tp_health") {
      await handleTrainingPeaksHealth(parsedMessage);
      return "handled";
    }

    if (command === "tp_cron_status") {
      await handleTrainingPeaksCronStatus(parsedMessage);
      return "handled";
    }

    if (command === "tp_digest_now") {
      await handleTrainingPeaksDigestNow(parsedMessage);
      return "handled";
    }

    if (command === "tp_weekly") {
      await sendTrainingPeaksMessage(parsedMessage.chatId, TP_WEEKLY_DISABLED_MESSAGE);
      return "handled";
    }

    if (command === "tp_business_test") {
      await handleTrainingPeaksBusinessTest(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_set_telegram") {
      await handleTrainingPeaksSetTelegram(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_bind") {
      await handleTrainingPeaksBind(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_actions") {
      await showTpActionsList(parsedMessage);
      return "handled";
    }

    if (command === "tp_context") {
      await handleTrainingPeaksContextCommand(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_intents") {
      await handleTrainingPeaksIntents(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_reply_draft") {
      await handleTrainingPeaksReplyDraft(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_draft_feedback") {
      await handleTrainingPeaksReplyDraftFeedback(parsedMessage, text);
      return "handled";
    }

    await sendTrainingPeaksMessage(parsedMessage.chatId, TP_UNKNOWN_COMMAND_MESSAGE);
  } catch (error) {
    console.error("TrainingPeaks Telegram command failed", {
      chatId: parsedMessage.chatId,
      messageId: parsedMessage.messageId,
      command,
      error,
    });

    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      "Не смог загрузить данные TrainingPeaks. Попробуй позже."
    );
  }

  return "handled";
}

export function getCoachReplyKeyboardLayoutForTest(): string[][] {
  return getTrainingPeaksMainReplyKeyboardMarkup().keyboard.map((row) => row.map((button) => button.text));
}

export function getCoachReplyKeyboardRouteForTest(text: string): string | null {
  return getTrainingPeaksReplyKeyboardAction(text);
}
