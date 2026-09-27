/**
 * Лестница коротких форматов через шаг: куда вести человека на следующей неделе.
 *
 * ── ЗАЧЕМ [27.09.2026] ──────────────────────────────────────────────────────
 *
 * Пол «не ниже последней отданной недели» научил генератор не ходить назад, и
 * это была нужная половина. Второй половины не было: на 30.09 встало ровно то
 * же 7 × 4, что тренер дал рукой на 23.09. Человек повторял ту же работу вторую
 * неделю подряд, а цель цикла по минутам выбирала ближайший к ней формат и
 * упиралась в пол.
 *
 * Пол отвечает на «не хуже, чем было». Лестница отвечает на «а куда дальше».
 *
 * ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
 *
 * ШАГ ВПЕРЁД ПО УМОЛЧАНИЮ. Повтор — только когда есть названная причина, и
 * причина пишется в заметку недели. Причин ровно две, и обе уже считаются в
 * контуре, ничего нового измерять не надо:
 *
 *   · боль в чек-инах прошлой недели — разговор, а не прибавка;
 *   · тяжёлая полоса RPE за прошлую неделю (band = cut) — человек ещё не
 *     переварил то, что уже делал.
 *
 * РАЗГРУЗОЧНАЯ НЕДЕЛЯ СТУПЕНЬ НЕ ДВИГАЕТ ВООБЩЕ. Разгрузка существует, чтобы
 * дать переварить, а не чтобы переварить и сразу прибавить: сдвинуть ступень на
 * ней значило бы сделать разгрузку неделей прогресса. И «не двигает» здесь
 * значит именно не двигает — ни вперёд, ни назад. Объём на разгрузке срезает
 * конверт, а не лестница.
 *
 * ── ПОРЯДОК СТУПЕНЕЙ ────────────────────────────────────────────────────────
 *
 * Сначала растёт ЧИСЛО отрезков при той же длине, потом удлиняется отрезок.
 * На переходе 8 × 4 → 6 × 5 суммарная работа один раз проседает (32 → 30), и
 * это правильно: пять минут подряд тяжелее четырёх, и за длину отрезка платят
 * объёмом. Именно поэтому лестница задана СПИСКОМ, а не сортировкой по минутам:
 * по минутам 6 × 5 встало бы перед 8 × 4 и «шаг вперёд» оказался бы шагом назад.
 *
 * ЧИСТЫЕ ФУНКЦИИ, БЕЗ БАЗЫ: их гоняет check:interval-ladder.
 */

/** Ступени по порядку прохождения. Индекс в массиве и есть номер ступени. */
export const WALK_INTERVAL_LADDER: ReadonlyArray<{ code: string; workMinutes: number; labelRu: string }> = [
  { code: "int_walk_3x3", workMinutes: 9, labelRu: "3 x 3 мин" },
  { code: "int_walk_4x3", workMinutes: 12, labelRu: "4 x 3 мин" },
  { code: "int_walk_5x3", workMinutes: 15, labelRu: "5 x 3 мин" },
  { code: "int_walk_6x4", workMinutes: 24, labelRu: "6 x 4 мин" },
  { code: "int_walk_7x4", workMinutes: 28, labelRu: "7 x 4 мин" },
  { code: "int_walk_8x4", workMinutes: 32, labelRu: "8 x 4 мин" },
  { code: "int_walk_6x5", workMinutes: 30, labelRu: "6 x 5 мин" },
];

/** Ступень по коду пресета. null — формат не с этой лестницы. */
export function rungByCode(presetCode: string | null): number | null {
  if (!presetCode) return null;
  const index = WALK_INTERVAL_LADDER.findIndex((rung) => rung.code === presetCode);
  return index < 0 ? null : index;
}

/**
 * Ступень по минутам работы — для недель, написанных РУКОЙ.
 *
 * ЗАЧЕМ ЭТОТ ПУТЬ ВООБЩЕ. У сессии, которую тренер написал сам, preset_code
 * равен `coach_hand_authored`, а название «Интервальная» — по ним ступень не
 * узнать. Но минуты работы у неё считаются (released-work-volume.ts), и 28
 * минут в формате «бег и шаг» однозначно указывают на 7 × 4. Именно так
 * лестница узнаёт, откуда шагать, после рукописной недели.
 *
 * ТОЧНОЕ СОВПАДЕНИЕ, БЕЗ ОКРУГЛЕНИЙ. «Примерно похоже» здесь опасно: 30 и 32
 * минуты — это две разные ступени, и промах даёт человеку не ту работу. Не
 * совпало — лестница молчит, и выбор остаётся прежним, по минутам цели.
 *
 * ПРИ НЕОДНОЗНАЧНОСТИ БЕРЁМ МЕНЬШУЮ. 30 минут — это и 6 × 5, и ничего больше,
 * но если когда-нибудь совпадут две ступени, шагать надо от нижней: ошибиться
 * в сторону меньшей нагрузки дешевле.
 */
export function rungByWorkMinutes(workMinutes: number | null): number | null {
  if (workMinutes === null || !Number.isFinite(workMinutes) || workMinutes <= 0) return null;
  const index = WALK_INTERVAL_LADDER.findIndex((rung) => rung.workMinutes === workMinutes);
  return index < 0 ? null : index;
}

export type LadderHoldReason = "deload" | "pain" | "hard_week";

export type LadderStep = {
  /** Код пресета, который надо предпочесть. null — лестница не применяется. */
  code: string | null;
  /**
   * Та же ступень и все, что НИЖЕ неё, по порядку предпочтения.
   *
   * ЗАЧЕМ СПИСОК, А НЕ ОДИН КОД [27.09.2026]. Просимая ступень может не влезть в
   * бюджет недели: 8 × 4 весит 73 минуты сессии, а неделя на 165 столько не
   * даёт. Раньше в этом случае выбор уходил из лестницы вовсе и брал ближайший
   * по минутам формат — им оказался НЕПРЕРЫВНЫЙ темповый, то есть другая работа,
   * а не меньшая доза той же.
   *
   * Правильный отход — на ступень ниже, а не в другое семейство. Человек
   * остаётся на лестнице, и пол от последней отданной недели всё равно не даст
   * опуститься слишком низко.
   */
  codesPreferred: string[];
  /** Ступень, с которой шагнули (для заметки). */
  fromRung: number | null;
  /** Ступень, на которую встали. */
  toRung: number | null;
  /** Почему НЕ шагнули. null — шагнули. */
  heldBy: LadderHoldReason | null;
  /** Словами, для заметки недели. null — говорить нечего. */
  noteRu: string | null;
};

const NO_STEP: LadderStep = { code: null, codesPreferred: [], fromRung: null, toRung: null, heldBy: null, noteRu: null };

/** Ступень и все ниже неё, от просимой к самой лёгкой. */
function preferredFrom(rung: number): string[] {
  return WALK_INTERVAL_LADDER.slice(0, rung + 1).map((r) => r.code).reverse();
}

/**
 * Куда вести эту неделю.
 *
 * `fromRung` — ступень последней ОТДАННОЙ (или уже собранной ранее в этом же
 * прогоне) интервальной. null — ступень неизвестна, и лестница молчит: гадать
 * о том, где человек стоит, нельзя.
 */
export function decideLadderStep(input: {
  fromRung: number | null;
  isDeload: boolean;
  /** Боль в чек-инах прошлой недели. */
  hasPain: boolean;
  /** Полоса RPE прошлой недели: "cut" — далась тяжело. */
  rpeBand: "calm" | "hold" | "cut" | null;
}): LadderStep {
  const from = input.fromRung;
  if (from === null || from < 0 || from >= WALK_INTERVAL_LADDER.length) return NO_STEP;

  const stay = (heldBy: LadderHoldReason, why: string): LadderStep => ({
    code: WALK_INTERVAL_LADDER[from].code,
    codesPreferred: preferredFrom(from),
    fromRung: from,
    toRung: from,
    heldBy,
    noteRu: `Ступень оставлена на ${WALK_INTERVAL_LADDER[from].labelRu}: ${why}.`,
  });

  // Порядок проверок — от самого сильного основания к самому слабому.
  if (input.isDeload) return stay("deload", "разгрузочная неделя ступень не двигает");
  if (input.hasPain) return stay("pain", "в чек-инах была отмечена боль, сначала разговор");
  if (input.rpeBand === "cut") return stay("hard_week", "прошлая неделя далась тяжело по отметкам");

  const next = from + 1;
  if (next >= WALK_INTERVAL_LADDER.length) {
    return {
      code: WALK_INTERVAL_LADDER[from].code,
      codesPreferred: preferredFrom(from),
      fromRung: from,
      toRung: from,
      heldBy: null,
      noteRu:
        `✋ ${WALK_INTERVAL_LADDER[from].labelRu} — последняя ступень лестницы коротких форматов. ` +
        `Дальше вести некуда: нужен следующий формат работы, а его выбирает тренер.`,
    };
  }

  return {
    code: WALK_INTERVAL_LADDER[next].code,
    codesPreferred: preferredFrom(next),
    fromRung: from,
    toRung: next,
    heldBy: null,
    noteRu: `Ступень: ${WALK_INTERVAL_LADDER[from].labelRu} → ${WALK_INTERVAL_LADDER[next].labelRu}.`,
  };
}
