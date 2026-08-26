/**
 * ЕДИНСТВЕННОЕ место, где способ авторизации превращается в заголовок.
 *
 * Ради этого файла credential и auth_method разведены на два поля в базе. Когда
 * зарегистрируют OAuth-приложение, переезд выглядит так: в student_data_sources
 * у ученика меняется auth_method на 'oauth', в credential ложится токен — и
 * дальше НИЧЕГО. Ни клиент API, ни приём тренировок, ни скрипты не знают, каким
 * способом получен доступ; они спрашивают заголовок и уходят работать.
 *
 * Поэтому здесь нет и не должно быть ничего, кроме сборки строки: ни запросов в
 * сеть, ни обращений к базе, ни обновления протухших токенов. Обновление токена
 * — отдельная забота того куска, который придёт вместе с OAuth; ему хватит
 * подменить credential в строке источника до вызова этой функции.
 */

export type IntervalsAuthMethod = "api_key" | "oauth";

/** Ровно то, что нужно для заголовка, — и ничего лишнего. */
export type DataSourceCredentials = {
  authMethod: IntervalsAuthMethod;
  /** СЕКРЕТ: ключ ученика или OAuth-токен. Не логировать. */
  credential: string;
};

/**
 * Логин для basic auth у Intervals.icu — константа, а не имя пользователя.
 * Пароль — личный ключ ученика. Так требует их API, это не наша выдумка.
 */
const API_KEY_BASIC_USER = "API_KEY";

export function buildAuthorizationHeader(source: DataSourceCredentials): string {
  const credential = source.credential?.trim();
  if (!credential) {
    // Пустой ключ дал бы 401 на каждом запросе и выглядел бы как поломка на
    // стороне провайдера. Лучше упасть здесь, с понятной причиной.
    throw new Error("Пустой credential у источника данных — нечем авторизоваться");
  }

  switch (source.authMethod) {
    case "api_key":
      return `Basic ${Buffer.from(`${API_KEY_BASIC_USER}:${credential}`).toString("base64")}`;
    case "oauth":
      return `Bearer ${credential}`;
    default: {
      // Значение приходит из базы, где его сторожит check-констрейнт. Если оно
      // всё же оказалось чужим — это не «неизвестный способ», это испорченная
      // строка, и молча пробовать basic нельзя.
      const unknown: never = source.authMethod;
      throw new Error(`Неизвестный способ авторизации источника: ${String(unknown)}`);
    }
  }
}

/**
 * Вырезает секреты из любого текста, который собираемся показать или записать.
 *
 * Нужна не «на всякий случай»: сообщение об ошибке fetch легко утаскивает за
 * собой заголовки запроса, а ключ ученика в логе — это ключ ученика в логе
 * навсегда. Прогонять через неё ВСЁ, что уходит в console и в текст ошибки.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 «скрыто»")
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1«скрыто»");
}
