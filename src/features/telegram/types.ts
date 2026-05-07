export type TelegramUser = {
  id: number;
  username?: string;
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
  title?: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
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
};
