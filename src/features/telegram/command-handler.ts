import {
  createBrainItemFromTelegram,
  createForwardedBrainItemFromTelegram,
  createReminderBrainItemFromTelegram,
  createTelegramBrainItem,
  getBrainItemsForStats,
  getRecentBrainItems,
  getReminderCommandText,
  getSearchQuery,
  getInboxBrainItems,
  getLatestBrainItem,
  getLatestBrainItems,
  isRemindCommand,
  isRemindersCommand,
  getSavedTelegramText,
  getSummaryPeriod,
  isHelpCommand,
  isInboxCommand,
  isLastCommand,
  isListCommand,
  isSearchCommand,
  isSaveCommand,
  isStatsCommand,
  isSummaryCommand,
  searchBrainItems,
  tryClassifyBrainItem,
} from "@/features/brain/service";
import {
  createManualReminder,
  createEveningReviewReminders,
  parseManualReminder,
  getUpcomingRemindersMessageForChat,
  sendForwardedMessageUnsupportedReply,
} from "@/features/reminders/service";
import {
  getTrainingPeaksHelpLines,
  handleTrainingPeaksTelegramCommand,
  isTrainingPeaksCommand,
} from "@/features/telegram/trainingpeaks";
import {
  type BrainItem,
  DEFAULT_BRAIN_ITEM_CATEGORY,
  DEFAULT_BRAIN_ITEM_TYPE,
} from "@/features/brain/types";
import type { ParsedTelegramUpdate } from "@/features/telegram/parser";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";

const TELEGRAM_ITEM_TEXT_LIMIT = 90;
const SUMMARY_ITEM_LIMIT = 50;
const SUMMARY_BULLET_LIMIT = 5;
const STATS_ITEM_LIMIT = 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type TelegramCommandHandlingOptions = {
  messageText?: string;
  brainItemSource?: string;
  brainItemTags?: string[];
  saveSuccessMessage?: string;
  replyPrefix?: string | null;
  fallbackSave?: {
    rawText: string;
    source?: string;
    tags?: string[];
    successMessage: string;
    preserveTagsForClassification?: string[];
  };
};

function formatBrainItemsList(
  items: { rawText: string; category: string; type: string }[]
): string {
  const lines = items.map((item, index) => {
    const compactText = item.rawText.replace(/\s+/g, " ").trim();
    const category = item.category || DEFAULT_BRAIN_ITEM_CATEGORY;
    const type = item.type || DEFAULT_BRAIN_ITEM_TYPE;

    return `${index + 1}. [${category}/${type}] ${compactText}`;
  });

  return ["🧠 Последние записи:", ...lines].join("\n");
}

function formatHelpMessage(): string {
  return [
    "🧠 Второй мозг",
    "",
    "/save текст — сохранить запись",
    "/remind время текст — поставить напоминание",
    "/reminders — ближайшие напоминания",
    "/list — последние записи",
    "/inbox — неразобранное",
    "/last — последняя запись подробно",
    "/search запрос — поиск",
    "/summary today — итоги за сегодня",
    "/summary week — итоги за неделю",
    "/stats — статистика мозга",
    "",
    ...getTrainingPeaksHelpLines(),
  ].join("\n");
}

function truncateTelegramItemText(text: string, maxLength: number): string {
  const symbols = Array.from(text);

  if (symbols.length <= maxLength) {
    return text;
  }

  return `${symbols.slice(0, maxLength - 1).join("").trimEnd()}…`;
}

function formatInboxItemsList(items: { rawText: string; type: string }[]): string {
  const lines = items.map((item, index) => {
    const compactText = truncateTelegramItemText(
      item.rawText.replace(/\s+/g, " ").trim(),
      TELEGRAM_ITEM_TEXT_LIMIT
    );
    const type = item.type || DEFAULT_BRAIN_ITEM_TYPE;

    return `${index + 1}. [${type}] ${compactText}`;
  });

  return ["📥 Inbox:", ...lines].join("\n");
}

function formatSearchResults(
  query: string,
  items: { rawText: string; category: string; type: string }[]
): string {
  const lines = items.map((item, index) => {
    const compactText = truncateTelegramItemText(
      item.rawText.replace(/\s+/g, " ").trim(),
      TELEGRAM_ITEM_TEXT_LIMIT
    );
    const category = item.category || DEFAULT_BRAIN_ITEM_CATEGORY;
    const type = item.type || DEFAULT_BRAIN_ITEM_TYPE;

    return `${index + 1}. [${category}/${type}] ${compactText}`;
  });

  return [`🔎 Результаты поиска: ${query}`, "", ...lines].join("\n");
}

function formatBrainItemValue(value: string | null | undefined, fallback: string): string {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : fallback;
}

function formatBrainItemTags(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) {
    return "—";
  }

  const normalizedTags = tags.map((tag) => tag.trim()).filter(Boolean);
  return normalizedTags.length > 0 ? normalizedTags.join(", ") : "—";
}

function formatBrainItemSummary(summary: string | null | undefined): string {
  const normalizedSummary = summary?.trim();
  return normalizedSummary ? normalizedSummary : "—";
}

function formatLatestBrainItem(item: BrainItem): string {
  return [
    "🧠 Последняя запись",
    "",
    "Текст:",
    formatBrainItemValue(item.rawText, "—"),
    "",
    `Категория: ${formatBrainItemValue(item.category, DEFAULT_BRAIN_ITEM_CATEGORY)}`,
    `Тип: ${formatBrainItemValue(item.type, DEFAULT_BRAIN_ITEM_TYPE)}`,
    `Теги: ${formatBrainItemTags(item.tags)}`,
    "Summary:",
    formatBrainItemSummary(item.summary),
  ].join("\n");
}

function getSummaryText(item: BrainItem): string {
  return item.summary?.trim() || item.rawText.replace(/\s+/g, " ").trim();
}

function isDecisionItem(item: BrainItem): boolean {
  return item.type === "decision";
}

function isIdeaItem(item: BrainItem): boolean {
  return item.type === "idea" || item.type === "insight" || item.type === "product_note";
}

function isTaskOrReminderItem(item: BrainItem): boolean {
  return item.type === "task" || item.type === "reminder";
}

function isContentItem(item: BrainItem): boolean {
  return item.type === "content_idea" || item.category === "Контент";
}

function formatSummaryGroup(title: string, items: BrainItem[]): string[] {
  const lines = [`${title}:`];

  if (items.length === 0) {
    return [...lines, "- нет"];
  }

  return [
    ...lines,
    ...items
      .slice(0, SUMMARY_BULLET_LIMIT)
      .map((item) => `- ${truncateTelegramItemText(getSummaryText(item), TELEGRAM_ITEM_TEXT_LIMIT)}`),
  ];
}

function formatBrainSummary(period: "today" | "week", items: BrainItem[]): string {
  const decisions = items.filter(isDecisionItem);
  const ideas = items.filter(isIdeaItem);
  const tasksAndReminders = items.filter(isTaskOrReminderItem);
  const content = items.filter(isContentItem);
  const groupedItemIds = new Set(
    [...decisions, ...ideas, ...tasksAndReminders, ...content].map((item) => item.id)
  );
  const other = items.filter((item) => !groupedItemIds.has(item.id));
  const periodLabel = period === "today" ? "сегодня" : "неделю";

  return [
    `🧠 Summary за ${periodLabel}`,
    "",
    `Записей: ${items.length}`,
    "",
    ...formatSummaryGroup("Решения", decisions),
    "",
    ...formatSummaryGroup("Идеи", ideas),
    "",
    ...formatSummaryGroup("Задачи/напоминания", tasksAndReminders),
    "",
    ...formatSummaryGroup("Контент", content),
    "",
    ...formatSummaryGroup("Прочее", other),
  ].join("\n");
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function formatTopCounts(counts: Map<string, number>): string[] {
  const sortedCounts = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ru"))
    .slice(0, 8);

  if (sortedCounts.length === 0) {
    return ["- нет"];
  }

  return sortedCounts.map(([name, count]) => `- ${name}: ${count}`);
}

function formatBrainStats(items: BrainItem[]): string {
  const now = Date.now();
  const categoryCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  let lastDayCount = 0;
  let lastWeekCount = 0;

  for (const item of items) {
    const createdAt = new Date(item.createdAt).getTime();
    const age = now - createdAt;

    if (Number.isFinite(createdAt) && age <= ONE_DAY_MS) {
      lastDayCount += 1;
    }

    if (Number.isFinite(createdAt) && age <= 7 * ONE_DAY_MS) {
      lastWeekCount += 1;
    }

    incrementCount(categoryCounts, item.category || DEFAULT_BRAIN_ITEM_CATEGORY);
    incrementCount(typeCounts, item.type || DEFAULT_BRAIN_ITEM_TYPE);
  }

  return [
    "📊 Статистика второго мозга",
    "",
    `Всего активных записей: ${items.length}`,
    `Inbox: ${categoryCounts.get(DEFAULT_BRAIN_ITEM_CATEGORY) ?? 0}`,
    `За 24 часа: ${lastDayCount}`,
    `За 7 дней: ${lastWeekCount}`,
    "",
    "Категории:",
    ...formatTopCounts(categoryCounts),
    "",
    "Типы:",
    ...formatTopCounts(typeCounts),
  ].join("\n");
}

function withReplyPrefix(prefix: string | null | undefined, message: string): string {
  const normalizedPrefix = prefix?.trim();
  return normalizedPrefix ? `${normalizedPrefix}\n\n${message}` : message;
}

function getCommandFlags(messageText: string) {
  return {
    isTrainingPeaks: isTrainingPeaksCommand(messageText),
    isSave: isSaveCommand(messageText),
    isList: isListCommand(messageText),
    isInbox: isInboxCommand(messageText),
    isLast: isLastCommand(messageText),
    isSearch: isSearchCommand(messageText),
    isHelp: isHelpCommand(messageText),
    isSummary: isSummaryCommand(messageText),
    isStats: isStatsCommand(messageText),
    isRemind: isRemindCommand(messageText),
    isReminders: isRemindersCommand(messageText),
  };
}

function hasSupportedCommand(flags: ReturnType<typeof getCommandFlags>): boolean {
  return (
    flags.isTrainingPeaks ||
    flags.isSave ||
    flags.isList ||
    flags.isInbox ||
    flags.isLast ||
    flags.isSearch ||
    flags.isHelp ||
    flags.isSummary ||
    flags.isStats ||
    flags.isRemind ||
    flags.isReminders
  );
}

export async function handleTelegramCommand(
  parsedMessage: ParsedTelegramUpdate,
  options: TelegramCommandHandlingOptions = {}
): Promise<"handled" | "ignored"> {
  const messageText = options.messageText ?? parsedMessage.text ?? "";
  const flags = getCommandFlags(messageText);

  if (parsedMessage.isForwarded && !hasSupportedCommand(flags)) {
    if (!parsedMessage.text) {
      await sendForwardedMessageUnsupportedReply(parsedMessage.chatId);
      return "handled";
    }

    try {
      const brainItem = await createForwardedBrainItemFromTelegram(parsedMessage);
      await createEveningReviewReminders(brainItem.id, String(parsedMessage.chatId));
      await sendTelegramMessage(
        parsedMessage.chatId,
        "✅ Добавил в вечерний разбор\n⏰ Напомню сегодня в 19:00 и 20:00"
      );

      console.info("Telegram forwarded brain item saved", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        brainItemId: brainItem.id,
      });
    } catch (error) {
      console.error("Telegram forwarded message save failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        error,
      });

      await sendTelegramMessage(
        parsedMessage.chatId,
        "Не смог добавить в вечерний разбор. Попробуй ещё раз."
      );
    }

    return "handled";
  }

  if (!hasSupportedCommand(flags)) {
    if (!options.fallbackSave) {
      console.info("Telegram message ignored: unsupported command", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
      });

      return "ignored";
    }

    try {
      const brainItem = await createTelegramBrainItem(parsedMessage, options.fallbackSave.rawText, {
        source: options.fallbackSave.source,
        tags: options.fallbackSave.tags,
      });

      await sendTelegramMessage(parsedMessage.chatId, options.fallbackSave.successMessage);
      await tryClassifyBrainItem(brainItem, {
        preserveTags: options.fallbackSave.preserveTagsForClassification,
      });

      console.info("Telegram fallback brain item saved", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        brainItemId: brainItem.id,
      });
    } catch (error) {
      console.error("Telegram fallback save failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        error,
      });

      await sendTelegramMessage(parsedMessage.chatId, "Не смог сохранить. Попробуй ещё раз.");
    }

    return "handled";
  }

  if (flags.isTrainingPeaks) {
    return handleTrainingPeaksTelegramCommand(parsedMessage, messageText);
  }

  if (flags.isSave) {
    const rawText = getSavedTelegramText(messageText);

    if (!rawText) {
      await sendTelegramMessage(parsedMessage.chatId, "Напиши так: /save идея или мысль");
      return "handled";
    }

    try {
      const brainItem = await createBrainItemFromTelegram(parsedMessage, {
        source: options.brainItemSource,
        tags: options.brainItemTags,
        rawText,
      });
      const chatId = parsedMessage.chatId;

      await sendTelegramMessage(
        chatId,
        options.saveSuccessMessage ?? "✅ Сохранил во второй мозг"
      );
      await tryClassifyBrainItem(brainItem, {
        preserveTags: options.brainItemTags,
      });

      console.info("Telegram brain item saved", {
        chatId,
        messageId: parsedMessage.messageId,
        brainItemId: brainItem.id,
      });
    } catch (error) {
      console.error("Telegram /save failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        error,
      });

      await sendTelegramMessage(parsedMessage.chatId, "Не смог сохранить. Попробуй ещё раз.");
    }

    return "handled";
  }

  if (flags.isRemind) {
    const reminderInput = getReminderCommandText(messageText);
    const parsedReminder = parseManualReminder(reminderInput);

    if (!parsedReminder) {
      await sendTelegramMessage(
        parsedMessage.chatId,
        [
          "Не понял дату или время. Примеры:",
          " /remind вечером проверить перенос тренировки",
          " /remind завтра 09:00 написать ученику",
          " /remind через 30 минут проверить deploy",
          " /remind пятнадцатого июня в 11 купить подарок",
        ].join("\n")
      );
      return "handled";
    }

    try {
      const brainItem = await createReminderBrainItemFromTelegram(parsedMessage, parsedReminder.rawText, {
        source: options.brainItemSource,
        tags: options.brainItemTags,
      });
      await createManualReminder(brainItem.id, String(parsedMessage.chatId), parsedReminder.remindAt);
      await sendTelegramMessage(
        parsedMessage.chatId,
        withReplyPrefix(
          options.replyPrefix,
          `⏰ Напомню: ${parsedReminder.formattedLocalDateTime}\n${parsedReminder.rawText}`
        )
      );
    } catch (error) {
      console.error("Telegram /remind failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        error,
      });

      await sendTelegramMessage(
        parsedMessage.chatId,
        "Не смог сохранить напоминание. Попробуй ещё раз."
      );
    }

    return "handled";
  }

  if (flags.isHelp) {
    await sendTelegramMessage(parsedMessage.chatId, withReplyPrefix(options.replyPrefix, formatHelpMessage()));
    return "handled";
  }

  if (flags.isInbox) {
    try {
      const items = await getInboxBrainItems(10);

      if (items.length === 0) {
        await sendTelegramMessage(
          parsedMessage.chatId,
          withReplyPrefix(
            options.replyPrefix,
            "📥 Inbox пуст. Новые неразобранные записи появятся здесь."
          )
        );
        return "handled";
      }

      await sendTelegramMessage(
        parsedMessage.chatId,
        withReplyPrefix(options.replyPrefix, formatInboxItemsList(items))
      );
    } catch (error) {
      console.error("Telegram /inbox failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        error,
      });

      await sendTelegramMessage(
        parsedMessage.chatId,
        "Не смог загрузить Inbox. Попробуй позже."
      );
    }

    return "handled";
  }

  if (flags.isSummary) {
    const period = getSummaryPeriod(messageText);

    if (!period) {
      await sendTelegramMessage(
        parsedMessage.chatId,
        "Напиши так: /summary today или /summary week"
      );
      return "handled";
    }

    try {
      const items = await getRecentBrainItems(period, SUMMARY_ITEM_LIMIT);

      if (items.length === 0) {
        await sendTelegramMessage(
          parsedMessage.chatId,
          withReplyPrefix(
            options.replyPrefix,
            period === "today" ? "За сегодня новых записей нет." : "За неделю новых записей нет."
          )
        );
        return "handled";
      }

      await sendTelegramMessage(
        parsedMessage.chatId,
        withReplyPrefix(options.replyPrefix, formatBrainSummary(period, items))
      );
    } catch (error) {
      console.error(`Telegram /summary ${period} failed`, {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        error,
      });

      await sendTelegramMessage(
        parsedMessage.chatId,
        period === "today"
          ? "Не смог собрать summary за сегодня. Попробуй позже."
          : "Не смог собрать summary за неделю. Попробуй позже."
      );
    }

    return "handled";
  }

  if (flags.isStats) {
    try {
      const items = await getBrainItemsForStats(STATS_ITEM_LIMIT);

      await sendTelegramMessage(
        parsedMessage.chatId,
        withReplyPrefix(options.replyPrefix, formatBrainStats(items))
      );
    } catch (error) {
      console.error("Telegram /stats failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        error,
      });

      await sendTelegramMessage(
        parsedMessage.chatId,
        "Не смог загрузить статистику. Попробуй позже."
      );
    }

    return "handled";
  }

  if (flags.isLast) {
    try {
      const item = await getLatestBrainItem();

      if (!item) {
        await sendTelegramMessage(
          parsedMessage.chatId,
          withReplyPrefix(
            options.replyPrefix,
            "Во втором мозге пока нет записей. Добавь первую через /save"
          )
        );
        return "handled";
      }

      await sendTelegramMessage(
        parsedMessage.chatId,
        withReplyPrefix(options.replyPrefix, formatLatestBrainItem(item))
      );
    } catch (error) {
      console.error("Telegram /last failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        error,
      });

      await sendTelegramMessage(
        parsedMessage.chatId,
        "Не смог загрузить последнюю запись. Попробуй позже."
      );
    }

    return "handled";
  }

  if (flags.isSearch) {
    const query = getSearchQuery(messageText);

    if (!query) {
      await sendTelegramMessage(parsedMessage.chatId, "Напиши так: /search что искать");
      return "handled";
    }

    try {
      const items = await searchBrainItems(query, 10);

      if (items.length === 0) {
        await sendTelegramMessage(
          parsedMessage.chatId,
          withReplyPrefix(options.replyPrefix, "Ничего не нашёл. Попробуй другой запрос.")
        );
        return "handled";
      }

      await sendTelegramMessage(
        parsedMessage.chatId,
        withReplyPrefix(options.replyPrefix, formatSearchResults(query, items))
      );
    } catch (error) {
      console.error("Telegram /search failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        query,
        error,
      });

      await sendTelegramMessage(
        parsedMessage.chatId,
        "Не смог выполнить поиск. Попробуй позже."
      );
    }

    return "handled";
  }

  if (flags.isReminders) {
    try {
      const remindersMessage = await getUpcomingRemindersMessageForChat(String(parsedMessage.chatId));
      await sendTelegramMessage(
        parsedMessage.chatId,
        withReplyPrefix(options.replyPrefix, remindersMessage)
      );
    } catch (error) {
      console.error("Telegram /reminders failed", {
        chatId: parsedMessage.chatId,
        messageId: parsedMessage.messageId,
        error,
      });

      await sendTelegramMessage(
        parsedMessage.chatId,
        "Не смог загрузить напоминания. Попробуй позже."
      );
    }

    return "handled";
  }

  try {
    const items = await getLatestBrainItems(5);

    if (items.length === 0) {
      await sendTelegramMessage(
        parsedMessage.chatId,
        withReplyPrefix(
          options.replyPrefix,
          "Пока во втором мозге пусто. Добавь первую запись через /save"
        )
      );
      return "handled";
    }

    await sendTelegramMessage(
      parsedMessage.chatId,
      withReplyPrefix(options.replyPrefix, formatBrainItemsList(items))
    );
  } catch (error) {
    console.error("Telegram /list failed", {
      chatId: parsedMessage.chatId,
      messageId: parsedMessage.messageId,
      error,
    });

    await sendTelegramMessage(
      parsedMessage.chatId,
      "Не смог загрузить список. Попробуй позже."
    );
  }

  return "handled";
}
