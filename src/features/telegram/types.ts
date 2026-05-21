export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
};

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data: string;
};

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramReplyKeyboardButton = {
  text: string;
};

export type TelegramReplyKeyboardMarkup = {
  keyboard: TelegramReplyKeyboardButton[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
};

export type TelegramReplyMarkup = TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup;

export type TelegramChat = {
  id: number;
  type?: TelegramChatType;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramForumTopicCreated = {
  name: string;
  icon_color: number;
  icon_custom_emoji_id?: string;
};

export type TelegramForumTopicEdited = {
  name?: string;
  icon_custom_emoji_id?: string;
};

export type TelegramForumTopicClosed = {
  [key: string]: unknown;
};

export type TelegramForumTopicReopened = {
  [key: string]: unknown;
};

export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  date?: number;
  business_connection_id?: string;
  is_topic_message?: boolean;
  message_thread_id?: number;
  forum_topic_created?: TelegramForumTopicCreated;
  forum_topic_edited?: TelegramForumTopicEdited;
  forum_topic_closed?: TelegramForumTopicClosed;
  forum_topic_reopened?: TelegramForumTopicReopened;
};

export type TelegramBusinessConnection = {
  id: string;
  user_chat_id?: number;
  is_enabled?: boolean;
  can_reply?: boolean;
};

export type TelegramBusinessMessagesDeleted = {
  business_connection_id: string;
  chat: TelegramChat;
  message_ids: number[];
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  business_connection?: TelegramBusinessConnection;
  business_message?: TelegramMessage;
  edited_business_message?: TelegramMessage;
  deleted_business_messages?: TelegramBusinessMessagesDeleted;
};
