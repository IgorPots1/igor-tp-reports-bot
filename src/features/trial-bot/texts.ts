/* Все тексты пробной недели. Бот говорит КАК ИГОРЬ: от первого лица, на «ты».
 * Длинных тире «—» нет нигде (правило Игоря), вместо них запятые и двоеточия;
 * check:trial-bot прогоняет каждый текст отсюда и падает на «—». */

import { SITE_URL } from "@/lib/site";

import {
  DAY_PATTERNS,
  QUESTION_COUNT,
  plural,
  type Checkin,
  type NextStepAdvice,
  type Question,
  type ResultType,
} from "./logic";
import type { WorkoutText } from "./workouts";

export type Button = { text: string; data: string } | { text: string; url: string };
export type Keyboard = Button[][];

export const CHANNEL_URL = "https://t.me/Potseluevprobeg";
export const CONSULT_TOOL = "trial";

/** Ссылка «Написать Игорю» через /go/consult: клик пишется в consult_clicks с tool=trial. */
export function consultUrl(text: string): string {
  return `${SITE_URL}/go/consult?tool=${CONSULT_TOOL}&text=${encodeURIComponent(text)}`;
}

export const PREFILL_HEALTH = "Привет! Я из теста в боте, хочу обсудить нагрузку с учётом здоровья";
export const PREFILL_ALREADY = "Привет! Я уже бегаю и хочу обсудить свою цель";
export const PREFILL_BASE = "Хочу в Базу после пробной недели";
export const PREFILL_HINT = "Привет! Пишу из пробной недели в боте";

// ── вход и тест ──────────────────────────────────────────────────────────────

export const INTRO =
  "Привет, это Игорь, тренер по бегу. За 2 минуты разберёмся, почему бег у тебя не держится, и я дам тебе первую неделю тренировок. Начинаем?";
export const INTRO_KB: Keyboard = [[{ text: "Поехали", data: "tr:go" }]];

export function questionText(q: Question): string {
  return `Вопрос ${q.n} из ${QUESTION_COUNT}\n\n${q.text}`;
}

export function questionKb(q: Question): Keyboard {
  return q.options.map((o, i) => [{ text: o.label, data: `tr:a:${q.n}:${i}` }]);
}

export const TEST_DONE = "Готово, спасибо за ответы. Вот что получилось.";
export const STALE_BUTTON = "Эта кнопка уже неактуальна";

export function nudgeText(n: number): string {
  return `Тест ждёт тебя на вопросе ${n}, осталось меньше минуты.`;
}
export const NUDGE_KB: Keyboard = [[{ text: "Продолжить", data: "tr:cont" }]];

// ── исходы теста ─────────────────────────────────────────────────────────────

export const HEALTH_STOP =
  "Спасибо, что честно. В такой ситуации я не дам план вслепую: сначала стоит обсудить нагрузку с врачом. Если хочешь, напиши мне, разберём твою ситуацию лично.";
export const HEALTH_KB: Keyboard = [[{ text: "Написать Игорю", url: consultUrl(PREFILL_HEALTH) }]];

export const ALREADY_RUNNER =
  "Ты уже бегаешь\n\n" +
  "Больше 30 минут без остановки и регулярно: неделя для начинающих тебе не нужна, она будет слишком лёгкой. " +
  "Если есть цель, например первые 10 км, полумарафон или 5 км быстрее, напиши мне, разберём, как к ней идти.";
export const ALREADY_KB: Keyboard = [[{ text: "Написать Игорю", url: consultUrl(PREFILL_ALREADY) }]];

/** Вход по ссылке пробной недели от действующего ученика: без кнопок, без теста, без оферов. */
export const ALREADY_STUDENT =
  "Ты уже тренируешься со мной, пробная неделя тебе не нужна. Если есть вопрос, просто напиши мне.";

export const RESULT_NAMES: Record<ResultType, string> = {
  clean_start: "Чистый старт",
  too_fast: "Слишком быстро",
  no_system: "Нет системы",
  comeback: "Возвращение",
};

const RESULT_ABOUT: Record<ResultType, string> = {
  clean_start:
    "Ты начинаешь с нуля, и это хорошая точка: нет привычки бегать на износ и нет старых ошибок. Главное сейчас не торопиться и дать телу привыкнуть.",
  too_fast:
    "Бег не держится, потому что ты бежишь быстрее, чем готовы сердце и дыхание. Отсюда одышка и ощущение, что бег не твоё, а лечится это темпом, а не силой воли.",
  no_system:
    "Тело справляется, но бег держится на настроении, а не на плане. Без расписания любая загруженная неделя ломает привычку.",
  comeback:
    "Дыхание и мышцы вспоминают бег быстро, а связки и суставы медленнее. Поэтому возвращаться нужно постепенно, иначе всё упрётся в боль.",
};

const RESULT_ERRORS: Record<ResultType, [string, string, string]> = {
  clean_start: ["Бежать сразу долго", "Ставить цель по темпу", "Бегать каждый день в первую неделю"],
  too_fast: ["Темп выше разговорного", "Стыдно переходить на шаг", "Сравнивать себя с другими"],
  no_system: ["Нет дней в календаре", "Каждый раз одна и та же пробежка", "После пропуска бросать совсем"],
  comeback: ["Сразу вернуть прежний объём", "Терпеть боль", "Пропускать разминку"],
};

export function resultCard(type: ResultType, first: WorkoutText): string {
  const errors = RESULT_ERRORS[type].map((e, i) => `${i + 1}. ${e}`).join("\n");
  return (
    `Твой результат: ${RESULT_NAMES[type]}\n\n` +
    `${RESULT_ABOUT[type]}\n\n` +
    `3 ошибки, которые держат тебя на месте:\n${errors}\n\n` +
    `Первая тренировка: ${first.title}\n${first.body}`
  );
}

export const OFFER_WEEK =
  "Хочешь, проведу тебя всю первую неделю? Тренировки по плану, утром напомню, вечером спрошу, как прошло. Бесплатно.";
export const OFFER_WEEK_KB: Keyboard = [
  [{ text: "Да, веди", data: "tr:wk:y" }],
  [{ text: "Пока только посмотрю", data: "tr:wk:n" }],
];

export const DECLINED =
  "Договорились. Первая тренировка у тебя уже есть, сделай её в удобный день. Если захочешь, чтобы я провёл тебя всю неделю, нажми кнопку.";
export const DECLINED_KB: Keyboard = [[{ text: "Да, веди", data: "tr:wk:y" }]];

export function chooseDaysText(runs: 2 | 3): string {
  return `${runs} ${plural(runs, "тренировка", "тренировки", "тренировок")} в неделю. В какие дни тебе удобно?`;
}

export function chooseDaysKb(patterns: string[]): Keyboard {
  return patterns.map((p) => [{ text: DAY_PATTERNS[p].label, data: `tr:days:${p}` }]);
}

const WEEKDAYS_SHORT = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «вт 3 ноября» */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return `${WEEKDAYS_SHORT[wd]} ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`;
}

export function weekConfirmed(dates: string[], startsToday = false): string {
  return (
    `Договорились, веду тебя неделю. Тренировки: ${dates.map(dayLabel).join(", ")}.\n\n` +
    (startsToday
      ? "Первая уже сегодня, задание пришлю следующим сообщением. Дальше утром в день тренировки пришлю задание, вечером спрошу, как прошло."
      : "Утром в день тренировки пришлю задание, вечером спрошу, как прошло.")
  );
}

export function alreadyInWeek(nextDate: string | null): string {
  return nextDate
    ? `Ты уже в пробной неделе. Следующая тренировка: ${dayLabel(nextDate)}, утром пришлю задание.`
    : "Ты уже в пробной неделе, тренировки на ней закончились. Скоро пришлю итог.";
}

// ── неделя ───────────────────────────────────────────────────────────────────

/** immediate: первая тренировка, отправленная сразу после выбора дней (может быть и днём, без «Доброе утро!»). */
export function morningText(w: WorkoutText, immediate = false): string {
  const head = immediate ? `Первая тренировка сегодня: ${w.title}.` : `Доброе утро! Сегодня тренировка: ${w.title}.`;
  return (
    `${head}\n\n${w.body}\n\n` +
    "Главное правило: усилие 2-4 из 10, можешь говорить фразами. Если что-то заболит, переходи на шаг."
  );
}

/** Утро дня ходьбы после «Что-то болело»: без «переходи на шаг» и без второго напоминания про врача. */
export const MORNING_WALK =
  "Доброе утро! Сегодня вместо бега быстрая ходьба 30 минут. Спокойно, без рывков: это восстановление, а не пропуск.";

export const EVENING = "Как прошла тренировка?";

export const CHECKIN_LABELS: Record<Checkin, string> = {
  easy: "Легко",
  ok: "Нормально",
  hard: "Тяжело",
  miss: "Не получилось",
  pain: "Что-то болело",
};

export function eveningKb(idx: number): Keyboard {
  return [
    [
      { text: CHECKIN_LABELS.easy, data: `tr:ci:${idx}:easy` },
      { text: CHECKIN_LABELS.ok, data: `tr:ci:${idx}:ok` },
      { text: CHECKIN_LABELS.hard, data: `tr:ci:${idx}:hard` },
    ],
    [
      { text: CHECKIN_LABELS.miss, data: `tr:ci:${idx}:miss` },
      { text: CHECKIN_LABELS.pain, data: `tr:ci:${idx}:pain` },
    ],
  ];
}

export function eveningAnswered(value: Checkin): string {
  return `${EVENING}\n\nТвой ответ: ${CHECKIN_LABELS[value]}`;
}

export const CHECKIN_REPLIES: Record<Checkin, string> = {
  easy: "Отлично. Если и дальше будет легко, прибавим.",
  ok: "Так и должно быть. Именно в этом режиме растёт выносливость.",
  hard: "Спасибо, что честно. Прибавлять не будем. В следующий раз беги медленнее, чтобы можно было говорить, а если станет тяжело, сразу переходи на шаг.",
  miss: "Бывает. Ничего не наваливаем сверху, просто сделай следующую по плану.",
  pain: "Следующую тренировку замени на 30 минут быстрой ходьбы. Если боль не проходит 2-3 дня, лучше показаться врачу.",
};

const BASE_PITCH =
  "Если хочешь продолжать так же, но с планом под тебя: в Базе я веду тебя каждую неделю, корректирую план по твоей обратной связи и раз в неделю делаю разбор. 3000 ₽ в месяц.";

export function day4Text(done: number, planned: number): string {
  if (done === 0) {
    return (
      "Половина недели позади. Пока тренировок не было, и это не страшно: неделя ещё не закончилась, следующую просто сделай по плану. " +
      BASE_PITCH
    );
  }
  const word = planned === 1 ? "тренировки" : "тренировок";
  return (
    `Половина недели позади, и у тебя уже ${done} из ${planned} ${word}. ` +
    BASE_PITCH
  );
}

export function day4Kb(landingUrl: string | null): Keyboard {
  const rows: Keyboard = [];
  if (landingUrl) rows.push([{ text: "Подробнее о Базе", url: landingUrl }]);
  rows.push([{ text: "Сначала доделаю неделю", data: "tr:d4:later" }]);
  return rows;
}

// ── истории учеников (день 2 и день 5): фото с подписью ──────────────────────

/** Лимит подписи к фото в Telegram. Длиннее: фото отдельно, текст следом. */
export const CAPTION_LIMIT = 1024;

/** photoUrl: null → только текст (фото пришлёт Игорь позже, тогда вписать адрес сюда). */
export type CaseStory = { photoUrl: string | null; text: string };

/** День 2. */
export const CASE_MARINA: CaseStory = {
  photoUrl: "https://igorp.run/landing/16-review-marina.jpg",
  text:
    "Расскажу про Марину. В мае 2025 она написала мне в директ: накануне пробежала 10 км за 1:02:31 и была уверена, что медленно бегать не умеет и не любит.\n\n" +
    "Первое, чему мы научились, как раз медленный бег. Летом 2025 её лёгкий темп был 7:03 на пульсе 145. Через год на том же пульсе 5:59.\n\n" +
    "За 14 месяцев: 214 тренировок из 216 по плану и ни одного пропуска из-за травм. Итог: десятка за 48:09, минус 14 минут.\n\n" +
    "Никакого секрета: спокойный бег, терпение и система. Ровно то, что ты делаешь на этой неделе.",
};

/** День 5. */
export const CASE_LENA: CaseStory = {
  photoUrl: null,
  text:
    "Ещё одна история, Лена. В мае она пробежала десятку за 55:01. В сентябре уже за 48:26: минус 6 минут 35 секунд за четыре месяца.\n\n" +
    "Скорость не появляется от того, что каждую тренировку бежишь через силу. Она приходит, когда есть план и кто-то следит, чтобы не было перегруза.",
};

/** Отдельным сообщением после дожима дня 8. */
export const CASE_NADYA: CaseStory = {
  photoUrl: null,
  text: "Надя в сентябре 2025 пробежала полумарафон за 1:51:54. Через 11 месяцев за 1:39:29: минус 12 минут на той же дистанции.",
};

/** Отдельным сообщением после дожима дня 10. */
export const CASE_SASHA: CaseStory = {
  photoUrl: null,
  text: "Саша в ноябре пробежал 5 км за 26:35. В феврале уже за 22:49: почти 4 минуты за два месяца.",
};

export const D4_LATER = "Договорились, доделываем неделю. Следующая тренировка по плану.";

export function checkinsLine(counts: Partial<Record<Checkin, number>>): string {
  const order: Checkin[] = ["easy", "ok", "hard", "pain"];
  const names: Record<Checkin, string> = { easy: "легко", ok: "нормально", hard: "тяжело", pain: "что-то болело", miss: "не получилось" };
  const parts = order.filter((k) => (counts[k] ?? 0) > 0).map((k) => `${names[k]} ${counts[k]}`);
  return parts.length ? `по ощущениям ${parts.join(", ")}` : "без отметок по ощущениям";
}

export function adviceText(advice: NextStepAdvice, title: string): string {
  if (advice.kind === "up") return `немного добавить бега, следующая тренировка будет чуть длиннее: ${title}`;
  if (advice.kind === "careful") return `сначала убедиться, что ничего не болит, и повторить ${title} без прибавки`;
  return `закрепить ${title} ещё на неделю`;
}

/** «2 пробежки и 1 прогулка», «3 пробежки», «1 прогулка». */
export function doneLine(runs: number, walks: number): string {
  const r = `${runs} ${plural(runs, "пробежка", "пробежки", "пробежек")}`;
  const w = `${walks} ${plural(walks, "прогулка", "прогулки", "прогулок")}`;
  if (runs > 0 && walks > 0) return `${r} и ${w}`;
  return walks > 0 ? w : r;
}

export function day7Text(
  runs: number,
  walks: number,
  counts: Partial<Record<Checkin, number>>,
  advice: NextStepAdvice,
  nextTitle: string,
): string {
  const done = runs + walks;
  const head =
    done === 0
      ? "Неделя закончилась. Итог: в этот раз тренировки не сложились. Так бывает, это не приговор."
      : `Неделя закончилась. Итог: ${doneLine(runs, walks)}, ${checkinsLine(counts)}.`;
  const step = done === 0 ? `начать заново с ${nextTitle}` : adviceText(advice, nextTitle);
  return `${head} Следующий шаг для тебя: ${step}. Дальше можем идти вместе в Базе.`;
}

export const BASE_KB: Keyboard = [
  [{ text: "Хочу в Базу", data: "tr:base:y" }],
  [{ text: "Подумаю", data: "tr:base:n" }],
];

export const BASE_YES = "Отлично! Напиши мне в личку, договоримся о старте.";
export const BASE_YES_KB: Keyboard = [[{ text: "Написать Игорю", url: consultUrl(PREFILL_BASE) }]];
export const BASE_NO = "Хорошо, без спешки. Если появятся вопросы, просто напиши мне.";

export const FOLLOWUP_8 =
  "Пробная неделя позади, и сейчас самое время не потерять ритм. В Базе я дам план на следующую неделю под твои ощущения, 3000 ₽ в месяц.";
export const FOLLOWUP_10 =
  "Самое трудное начинается, когда пропадает новизна. В Базе я рядом каждую неделю, чтобы бег не бросить.";
export const FOLLOWUP_KB: Keyboard = [[{ text: "Хочу в Базу", data: "tr:base:y" }]];

export const CHANNEL_TEXT =
  "Больше писать не буду, чтобы не надоедать. Если хочешь просто читать про бег, у меня есть канал: короткие разборы и советы для тех, кто бегает.";
export const CHANNEL_KB: Keyboard = [[{ text: "Открыть канал", url: CHANNEL_URL }]];

/** Ответ на свободный текст от участника пробной недели (вместо «Не поняла команду»). */
export const TEXT_HINT = "Я отвечаю кнопками под сообщениями. Если хочешь написать мне лично, жми кнопку ниже.";
export const TEXT_HINT_KB: Keyboard = [[{ text: "Написать Игорю", url: consultUrl(PREFILL_HINT) }]];

// ── тренеру ──────────────────────────────────────────────────────────────────

export type Who = { firstName: string | null; username: string | null; id: number; source: string | null };

function who(w: Who): string {
  const name = w.firstName?.trim() || "без имени";
  const handle = w.username ? ` (@${w.username})` : "";
  return `${name}${handle}, id ${w.id}`;
}

function src(w: Who): string {
  return w.source ? ` Источник: ${w.source}.` : "";
}

export function coachHealth(w: Who): string {
  return `Пробная неделя: ${who(w)} отметил(а) в тесте пункт про здоровье. План не выдан, предложено написать тебе.${src(w)}`;
}

export function coachPain(w: Who, idx: number, title: string): string {
  return `Пробная неделя: ${who(w)} после тренировки ${idx} (${title}) отметил(а) «Что-то болело». Следующая заменена на 30 минут быстрой ходьбы.${src(w)}`;
}

export function coachBase(w: Who, done: number, planned: number): string {
  return `Пробная неделя: ${who(w)} нажал(а) «Хочу в Базу». Сделано тренировок: ${done} из ${planned}.${src(w)}`;
}
