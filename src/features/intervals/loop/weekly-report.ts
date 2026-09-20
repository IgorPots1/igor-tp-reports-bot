/**
 * Недельная форма: три вопроса про неделю целиком.
 *
 * ЧЕМ ОНА ОТЛИЧАЕТСЯ ОТ ЧЕК-ИНА. Чек-ин закрывает ОДНУ тренировку и отвечает
 * на вопрос «как далась». Сигнал недели, посчитанный из чек-инов, видит только
 * это — и потому слеп к двум вещам, которые знает только сам человек:
 *
 *   · ГРАФИК. Три спокойные пробежки из шести запланированных дают прекрасные
 *     RPE. По отметкам неделя выглядит лёгкой, хотя половина её не состоялась.
 *   · НАКОПЛЕННАЯ УСТАЛОСТЬ. Каждая тренировка по отдельности может даваться
 *     нормально, а к воскресенью человек всё равно выжат. Усталость копится
 *     между тренировками, и в отметке про одну из них её не видно.
 *
 * ПОЧЕМУ ВАРИАНТЫ НАЗВАНЫ ТАК. Тем же правилом, что и развилка цели в анкете:
 * человек выбирает то, что с ним происходит, а не термин. «Почти ничего не
 * получилось» — это фраза, которую произносят вслух; «низкая комплаентность» —
 * нет.
 */

export type ScheduleCode = "all_done" | "some_missed" | "almost_none";
export type WellbeingCode = "fresh" | "normal" | "tired";

export type WeeklyOption<T extends string> = {
  code: T;
  labelRu: string;
  hintRu: string;
};

export const SCHEDULE_OPTIONS: Array<WeeklyOption<ScheduleCode>> = [
  {
    code: "all_done",
    labelRu: "Всё успела",
    hintRu: "неделя прошла так, как была написана",
  },
  {
    code: "some_missed",
    labelRu: "Что-то пропустила",
    hintRu: "одну или две тренировки не получилось сделать",
  },
  {
    code: "almost_none",
    labelRu: "Почти ничего не получилось",
    hintRu: "неделя не сложилась, бегала мало или совсем не бегала",
  },
];

export const WELLBEING_OPTIONS: Array<WeeklyOption<WellbeingCode>> = [
  {
    code: "fresh",
    labelRu: "Свежесть",
    hintRu: "сил к концу недели не меньше, чем в начале",
  },
  {
    code: "normal",
    labelRu: "Нормально",
    hintRu: "обычная усталость, за ночь восстанавливаюсь",
  },
  {
    code: "tired",
    labelRu: "Усталость",
    hintRu: "накопилась, восстановиться не успеваю",
  },
];

export const SCHEDULE_QUESTION_RU = "Как прошла неделя по графику?";
export const WELLBEING_QUESTION_RU = "Как общее самочувствие?";
export const COMMENT_PLACEHOLDER_RU = "Пожелания и что сказать тренеру. Необязательно.";

export function scheduleByCode(code: string): WeeklyOption<ScheduleCode> | null {
  return SCHEDULE_OPTIONS.find((option) => option.code === code) ?? null;
}

export function wellbeingByCode(code: string): WeeklyOption<WellbeingCode> | null {
  return WELLBEING_OPTIONS.find((option) => option.code === code) ?? null;
}

/**
 * Ответ человеку после отправки. Без обещаний: форма не меняет план сама,
 * она кладётся тренеру на стол.
 */
export function weeklyReportReplyRu(schedule: ScheduleCode, wellbeing: WellbeingCode): string {
  if (schedule === "almost_none") {
    return (
      "Спасибо, что сказали. Неделя не сложилась — это бывает, и догонять пропущенное не нужно. " +
      "Я посмотрю и напишу вам, прежде чем ставить следующую."
    );
  }
  if (wellbeing === "tired") {
    return (
      "Спасибо. Усталость — важное, что вы могли сказать: следующую неделю я соберу с учётом этого, " +
      "а не по одному расписанию."
    );
  }
  return "Спасибо, записал. Это поможет мне собрать следующую неделю под вас.";
}

const DAY_MS = 86_400_000;

function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // 0 = понедельник
  return new Date(date.getTime() - weekday * DAY_MS).toISOString().slice(0, 10);
}

/**
 * За какую неделю человек отчитывается, если открыл форму сегодня.
 * null — сегодня форму не показываем.
 *
 * ВОСКРЕСЕНЬЕ И ПОНЕДЕЛЬНИК, А НЕ ОДНО ВОСКРЕСЕНЬЕ. Напоминание приходит в
 * воскресенье в 10–12 по местному времени. Человек, который увидел его вечером
 * и открыл приложение утром понедельника, не должен терять ответ — мы это уже
 * проходили с черновиком формы отчёта. В понедельник форма спрашивает про
 * НЕДЕЛЮ, КОТОРАЯ ЗАКОНЧИЛАСЬ ВЧЕРА, а не про начавшуюся сегодня.
 *
 * Дальше вторника не пускаем: отчёт о неделе, про которую человек уже забыл,
 * хуже отсутствия отчёта — он выглядит как факт, а является догадкой.
 */
export function reportedWeekStart(todayIso: string): string | null {
  const weekday = (new Date(`${todayIso}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = пн
  if (weekday === 6) return mondayOf(todayIso); // воскресенье: неделя, которая кончается сегодня
  if (weekday === 0) {
    return new Date(Date.parse(`${mondayOf(todayIso)}T00:00:00Z`) - 7 * DAY_MS)
      .toISOString()
      .slice(0, 10); // понедельник: неделя, которая кончилась вчера
  }
  return null;
}
