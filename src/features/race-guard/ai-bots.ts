/* ИИ-сборщики для robots.txt (наряд 20.10.2026, защита календаря забегов от выкачивания). Токен
 * User-Agent и источник у каждой строки. robots.txt — просьба, не замок: честные сборщики её
 * соблюдают, остальных держат лимит частоты (src/middleware.ts) и закрытая база.
 * Google-Extended и Applebot-Extended — не отдельные обходчики, а метки «не учить ИИ на этом»:
 * поиск Google и Apple они не задевают. */

/** Сбор для обучения моделей и датасетов — закрыт весь сайт. */
export const AI_TRAINING_BOTS = [
  "GPTBot", // OpenAI — https://platform.openai.com/docs/bots
  "CCBot", // Common Crawl — https://commoncrawl.org/ccbot
  "ClaudeBot", // Anthropic — https://support.anthropic.com («Does Anthropic crawl data from the web…»)
  "anthropic-ai", // Anthropic, старый токен — там же
  "Claude-Web", // Anthropic, старый токен — там же
  "Google-Extended", // Google — https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
  "Applebot-Extended", // Apple — https://support.apple.com/en-us/119829
  "PerplexityBot", // Perplexity — https://docs.perplexity.ai/guides/bots
  "Bytespider", // ByteDance — своей страницы нет; https://darkvisitors.com/agents/bytespider
  "Amazonbot", // Amazon — https://developer.amazon.com/amazonbot
  "Diffbot", // Diffbot — https://docs.diffbot.com
  "meta-externalagent", // Meta, обучение ИИ — https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  "FacebookBot", // Meta, обучение речевых моделей — там же (НЕ facebookexternalhit: тот делает превью ссылок)
  "cohere-ai", // Cohere — https://darkvisitors.com/agents/cohere-ai
  "cohere-training-data-crawler", // Cohere — https://darkvisitors.com/agents/cohere-training-data-crawler
  "AI2Bot", // Allen Institute for AI — https://allenai.org/crawler
  "Ai2Bot-Dolma", // Allen Institute, датасет Dolma — там же
  "omgili", // Webz.io — https://webz.io/bot.html
  "omgilibot", // Webz.io — там же
  "Timpibot", // Timpi — https://darkvisitors.com/agents/timpibot
  "ImagesiftBot", // ImageSift — https://darkvisitors.com/agents/imagesiftbot
  "YouBot", // You.com — https://about.you.com/youbot/
  "PanguBot", // Huawei, обучение PanGu — https://darkvisitors.com/agents/pangubot
  "img2dataset", // сборщик датасетов — https://github.com/rom1504/img2dataset
  "Scrapy", // фреймворк скрейпинга, токен по умолчанию — https://docs.scrapy.org/en/latest/topics/settings.html
];

/** Ассистенты и ИИ-поиск, которые ходят по ссылке за пользователем: им закрыт только календарь
 *  забегов (данные), остальной сайт открыт — иначе тренерский сайт пропадёт из ответов ИИ-поиска. */
export const AI_ASSISTANT_BOTS = [
  "ChatGPT-User", // OpenAI — https://platform.openai.com/docs/bots
  "OAI-SearchBot", // OpenAI — там же
  "Claude-User", // Anthropic — статья поддержки о сборщиках
  "Claude-SearchBot", // Anthropic — там же
  "Perplexity-User", // Perplexity — https://docs.perplexity.ai/guides/bots
  "DuckAssistBot", // DuckDuckGo — https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot
  "MistralAI-User", // Mistral — https://docs.mistral.ai/robots
];
