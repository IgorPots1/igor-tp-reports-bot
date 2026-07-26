import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { detectTrainingReport, normalizeObserverText } from "./report-detector.ts";

// The report_like detector is the load-bearing gate for message-triggered feedback generation:
// a missed report = the coach never sees the student's words. These cases pin the recall fixes
// (past-tense verbs, numeric results, report phrases, Cyrillic-safe boundaries) and the precision
// guards (future intent, schedule requests, questions, negation) so a regression is caught.
const isReport = (text: string): boolean => detectTrainingReport(normalizeObserverText(text)) !== null;

describe("detectTrainingReport — recall (must be reports)", () => {
  const reports = [
    "Привет! Побегал, все хорошо",
    "Побегала, все норм Много горок было, снижала темп",
    "Бегала на улице. Эмоционально легче на секунды не смотреть",
    "На стадионе бегала, где нет перепада высот",
    "10 км за 55 мин, тяжело дались последние",
    "сделала интервалы по 5:30, пульс 165",
    "Интервалы сделала, все хорошо, запас был",
    "Длительная во вторник хорошо прошла, по лесу с горочками",
    "Вчерашняя длительная, всё хорошо, но солнце изжарило",
    "мои интервалы готовы) на 7/10, все хорошо",
    "Загрузила новую тренировку, чувствовала себя хорошо!",
    "Утренний отчет. Было хорошо) в выходные будет тренировка?",
    "Вот вернулся с пробежки",
    // widening: impersonal / passive completion
    "Привет Под проливным дождем отбегано полтора часа Ух",
    "12 км пройдено, доволен собой",
    "Длительная намотана, ноги живые",
    // widening: deliberate Garmin/Strava share
    "Просмотрите мое занятие «бег» в Garmin Connect",
    // widening: descriptive segment, no run verb
    "Как договаривались, очень медленно. Первые 600 метров я отчудила, потом норм",
    "Последние 2 км совсем тяжело шли",
    // widening: how it felt
    "Ноги ватные после вчерашней длительной",
    "Тяжело далось сегодня, спалось трудно ночью",
    "Легко пошло, прям в удовольствие",
  ];
  for (const text of reports) {
    test(`report: ${text.slice(0, 40)}`, () => assert.equal(isReport(text), true));
  }
});

describe("detectTrainingReport — precision (must NOT be reports)", () => {
  const nonReports = [
    "Готова умирать. Будет тяжело. Попробую начать по 5:30 первые 2 км",
    "А обычно на 10 км берут гель или нет?",
    "5 км по 5:0 я бы точно смогла",
    "Проверь счет, оплатила тренировки Подписка продлена",
    "https://tomskmarathon.ru/kuznight26/",
    "Я буду стараться. 1 августа побегу забег на 5 км",
    "Спасибо большое!",
    "А какие есть альтернативы?",
    "Вчера не бегала, сегодня планирую",
    "не побегала сегодня",
    "перенеси длительную на среду, тяжело так рано вставать",
    "Поставите на завтра тренировку, пожалуйста",
    "А можно завтра длительную побежать? Я боюсь не успею",
    // widening guards: plan/advice with a segment/pace word must NOT read as a report
    "Давай первые 2 км помедленнее в следующий раз",
    "В следующий раз первые 500 метров не гони",
    "Попробую первые 600 метров быстрее",
    "Ноги будут ватные, если рано вставать",
  ];
  for (const text of nonReports) {
    test(`not: ${text.slice(0, 40)}`, () => assert.equal(isReport(text), false));
  }
});
