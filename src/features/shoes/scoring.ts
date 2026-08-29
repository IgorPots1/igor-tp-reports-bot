import { CRITERION_TITLES, CRITERION_WEIGHTS, TOTAL_WEIGHT } from "./weights";
import type {
  Answers,
  ClientShoe,
  CriterionId,
  CriterionNote,
  CriterionResult,
  GenderKey,
  Slot,
} from "./types";

/**
 * Критерии подбора — раздел 6.3 ТЗ. Каждый возвращает 0–1 и, если есть что
 * сказать, формулировку из данных: не «хорошая мягкость», а «стека и плотности
 * хватает под 90 кг». Эти же формулировки собираются в плюсы и минусы карточки.
 *
 * Ни один критерий не додумывает недостающее. Чего в базе нет — того нет в
 * оценке: жалоба «натирало пятку» в баллах не участвует вовсе, потому что поля
 * про пятку в схеме нет, а правдоподобная догадка здесь — брак.
 */

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Мягкость 1–10 из дюрометра HA: 14 HA → 10 (кисель), 36 HA → 1 (доска).
 * Держится в коде, а не только в данных, чтобы пересчитать мягкость женской
 * версии, у которой свой замер плотности.
 */
export function softnessFromHa(ha: number): number {
  return Math.min(10, Math.max(1, Math.round((10 - ((ha - 14) * 9) / 22) * 10) / 10));
}

/** Пол влияет ТОЛЬКО на наличие версии, её вес и плотность. Больше ни на что. */
export function pickVariant(
  shoe: ClientShoe,
  gender: Answers["gender"]
): { gender: GenderKey; weight_g: number; softness: number; borrowedFromMen: boolean } {
  const key: GenderKey = gender === "w" ? "w" : "m";
  const v = shoe.genders[key];
  if (key === "w" && v.available && v.weight_g != null && v.durometer_ha != null) {
    return {
      gender: "w",
      weight_g: v.weight_g,
      softness: v.measured ? softnessFromHa(v.durometer_ha) : shoe.softness,
      borrowedFromMen: !v.measured,
    };
  }
  return {
    gender: key,
    weight_g: shoe.weight_g,
    softness: shoe.softness,
    borrowedFromMen: false,
  };
}

type Ctx = {
  slot: Slot;
  /** Мягкость выбранной версии. */
  softness: number;
  /** Вес пары выбранной версии. */
  weight_g: number;
  ownedBrands: Set<string>;
};

type Raw = { score: number; notes: CriterionNote[] };

const plus = (text: string): CriterionNote => ({ text, tone: "plus" });
const minus = (text: string): CriterionNote => ({ text, tone: "minus" });

/** Куда целится ответ по шкале ощущения: 1 «жёстко и отзывчиво» … 5 «мягко». */
const FEEL_TARGET: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 2.5,
  2: 4,
  3: 5.5,
  4: 7,
  5: 8.5,
};

function softness(shoe: ClientShoe, a: Answers, c: Ctx): Raw {
  const target = FEEL_TARGET[a.feel];
  const diff = c.softness - target;
  const score = clamp01(1 - Math.abs(diff) / 4);
  if (Math.abs(diff) <= 0.8) {
    return { score, notes: [plus("ощущение под ногой ровно то, что просил")] };
  }
  if (diff > 2) return { score, notes: [minus("заметно мягче, чем ты просил")] };
  if (diff < -2) return { score, notes: [minus("заметно жёстче, чем ты просил")] };
  return { score, notes: [] };
}

function runnerWeight(shoe: ClientShoe, a: Answers, c: Ctx): Raw {
  const bw = a.bodyWeightKg;
  const stack = shoe.stack_heel_mm;

  if (bw >= 85) {
    let s = 1;
    const notes: CriterionNote[] = [];
    if (stack < 36) {
      s -= 0.45;
      notes.push(minus(`${stack} мм стека мало под ${bw} кг — пена кончится раньше ноги`));
    }
    if (c.softness > 8) {
      s -= 0.3;
      notes.push(minus(`слишком мягкая пена под ${bw} кг — будет проваливаться`));
    }
    if (notes.length === 0) notes.push(plus(`стека и плотности хватает под ${bw} кг`));
    return { score: clamp01(s), notes };
  }

  if (bw >= 72) {
    let s = 1;
    const notes: CriterionNote[] = [];
    if (stack < 30) {
      s -= 0.25;
      notes.push(minus(`низкий стек под ${bw} кг — на длинных будет жёстко`));
    }
    if (c.softness > 8.5) s -= 0.15;
    return { score: clamp01(s), notes };
  }

  // До 72 кг низкий стек допустим — лёгкому бегуну он ничего не ломает.
  return {
    score: 1,
    notes: stack < 32 ? [plus(`при ${bw} кг низкий стек тебе не мешает`)] : [],
  };
}

function antiPattern(shoe: ClientShoe, a: Answers, c: Ctx): Raw {
  if (a.ownedShoeIds.includes(shoe.id)) {
    return {
      score: 0.4,
      notes: [minus("эта пара у тебя уже есть — в ротации нужна другая")],
    };
  }
  const d = a.dislikes;
  if (d.length === 0 || d.includes("none")) return { score: 1, notes: [] };

  const parts: number[] = [];
  const notes: CriterionNote[] = [];

  if (d.includes("harsh")) {
    if (c.softness < 5.5) {
      parts.push(0.15);
      notes.push(minus("жёсткая — а это уже не подошло"));
    } else if (c.softness >= 7) {
      parts.push(1);
      notes.push(plus("мягче того, в чём забивались ноги"));
    } else parts.push(0.6);
  }
  if (d.includes("unstable")) {
    const wide = shoe.platform_width_fore_mm >= 110;
    if (shoe.stability >= 1 || wide) {
      parts.push(1);
      notes.push(plus("широкая платформа — нога не будет гулять"));
    } else if (c.softness > 8) {
      parts.push(0.2);
      notes.push(minus("мягкая и узкая платформа — снова будет проваливаться"));
    } else parts.push(0.5);
  }
  if (d.includes("narrow")) {
    if (shoe.last_width === "wide") {
      parts.push(1);
      notes.push(plus("широкая колодка, как раз чего не хватало"));
    } else if (shoe.last_width === "narrow") {
      parts.push(0.1);
      notes.push(minus("узкая колодка — та же история, что и раньше"));
    } else parts.push(0.55);
  }
  if (d.includes("heavy")) {
    if (c.weight_g <= 250) {
      parts.push(1);
      notes.push(plus(`${c.weight_g} г — легче того, что показалось тяжёлым`));
    } else if (c.weight_g > 285) {
      parts.push(0.15);
      notes.push(minus(`${c.weight_g} г — снова тяжёлая`));
    } else parts.push(0.55);
  }
  if (d.includes("wear")) {
    if (shoe.outsole_durability >= 8) {
      parts.push(1);
      notes.push(plus("подошва из износостойких в базе"));
    } else if (shoe.outsole_durability <= 5) {
      parts.push(0.15);
      notes.push(minus("подошва снашивается быстро — как в прошлый раз"));
    } else parts.push(0.55);
  }
  // «Натирало пятку» осознанно не оценивается: поля про пятку в схеме нет.

  if (parts.length === 0) return { score: 1, notes: [] };
  return { score: parts.reduce((x, y) => x + y, 0) / parts.length, notes };
}

function width(shoe: ClientShoe, a: Answers): Raw {
  const table: Record<Answers["footWidth"], Record<ClientShoe["last_width"], number>> = {
    narrow: { narrow: 1, std: 0.7, wide: 0.35 },
    std: { narrow: 0.4, std: 1, wide: 0.75 },
    wide: { narrow: 0.1, std: 0.5, wide: 1 },
    unknown: { narrow: 0.75, std: 1, wide: 0.75 },
  };
  const score = table[a.footWidth][shoe.last_width];
  if (a.footWidth === "wide" && shoe.last_width === "wide") {
    return { score, notes: [plus("широкая колодка под широкую стопу")] };
  }
  if (a.footWidth === "wide" && shoe.last_width === "narrow") {
    return { score, notes: [minus("узкая колодка — пальцам будет тесно")] };
  }
  if (a.footWidth === "narrow" && shoe.last_width === "narrow") {
    return { score, notes: [plus("узкая колодка — нога не будет болтаться")] };
  }
  return { score, notes: [] };
}

function slotFit(shoe: ClientShoe, a: Answers, c: Ctx): Raw {
  switch (c.slot.id) {
    case "race": {
      const plate = shoe.plate === "carbon" ? 1 : shoe.plate === "nylon" ? 0.7 : 0.3;
      const light = clamp01(1 - Math.max(0, c.weight_g - 200) / 60);
      const score = plate * 0.6 + light * 0.4;
      const notes: CriterionNote[] = [];
      if (shoe.plate === "carbon") {
        notes.push(plus(`карбон и ${c.weight_g} г — стартовая по назначению`));
      } else if (shoe.plate === "nylon") {
        notes.push(plus(`нейлоновая пластина и ${c.weight_g} г — быстрая, но мягче карбона`));
      } else {
        notes.push(minus("без пластины — на старте отдашь секунды"));
      }
      return { score, notes };
    }
    case "tempo": {
      const light = clamp01(1 - Math.max(0, c.weight_g - 220) / 70);
      const responsive = clamp01(1 - Math.abs(c.softness - 6.5) / 4);
      const plate = shoe.plate === "none" ? 0.75 : 1;
      const score = light * 0.4 + responsive * 0.3 + plate * 0.3;
      const notes: CriterionNote[] = [];
      if (c.weight_g <= 240) notes.push(plus(`${c.weight_g} г — не мешает разгоняться`));
      else if (c.weight_g > 285) notes.push(minus(`${c.weight_g} г — тяжеловата для работы`));
      return { score, notes };
    }
    case "trail": {
      const grip = clamp01((shoe.lug_depth_mm - 2.5) / 2.5);
      return {
        score: grip,
        notes: [
          shoe.lug_depth_mm >= 4.5
            ? plus(`протектор ${shoe.lug_depth_mm} мм — держит на грязи и камнях`)
            : minus("протектор невысокий — для техничных троп мало"),
        ],
      };
    }
    case "trail_light": {
      // Парк и мягкий грунт: слишком агрессивный протектор мешает на асфальте.
      const score = clamp01(1 - Math.abs(shoe.lug_depth_mm - 3.6) / 2.2);
      return {
        score,
        notes:
          shoe.lug_depth_mm <= 4
            ? [plus("умеренный протектор — не мешает на асфальте")]
            : [],
      };
    }
    case "winter": {
      // Зимой задачу слота держит критерий «Защита от погоды», а здесь важно
      // лишь то, годится ли пара под объём: зимняя обувь ходит один сезон.
      return {
        score: shoe.outsole_durability / 10,
        notes: [],
      };
    }
    case "daily":
    default: {
      const durable = shoe.outsole_durability / 10;
      const cushion = clamp01((shoe.stack_heel_mm - 26) / 14);
      const score = durable * 0.55 + cushion * 0.45;
      return {
        score,
        notes:
          shoe.outsole_durability >= 8
            ? [plus("рабочая лошадка: подошва терпит объём")]
            : [],
      };
    }
  }
}

function injury(shoe: ClientShoe, a: Answers, c: Ctx): Raw {
  const issues = a.issues.filter((i) => i !== "none");
  if (issues.length === 0) return { score: 1, notes: [] };

  const parts: Raw[] = [];
  if (issues.includes("achilles")) {
    const drop = shoe.drop_mm;
    parts.push(
      drop >= 8
        ? { score: 1, notes: [plus(`дроп ${drop} мм — ахилл и икру не тянет`)] }
        : drop >= 6
          ? { score: 0.6, notes: [] }
          : { score: 0.2, notes: [minus(`дроп ${drop} мм — для ахилла низковато`)] }
    );
  }
  if (issues.includes("foot")) {
    const drop = shoe.drop_mm;
    parts.push(
      drop >= 5
        ? { score: 1, notes: [] }
        : { score: 0.3, notes: [minus(`дроп ${drop} мм — стопе достанется больше работы`)] }
    );
  }
  if (issues.includes("shin")) {
    parts.push(
      c.softness >= 5.5
        ? { score: 1, notes: [plus("мягкая — надкостнице легче")] }
        : c.softness >= 4.5
          ? { score: 0.6, notes: [] }
          : { score: 0.25, notes: [minus("жёсткая — для надкостницы рискованно")] }
    );
  }
  if (issues.includes("knee")) {
    // Правила по колену в методике нет: колено не даёт однозначного требования
    // к дропу или мягкости. Не выдумываем — критерий остаётся нейтральным.
    parts.push({ score: 0.85, notes: [] });
  }

  // Берём самое строгое требование: травма не усредняется.
  return parts.reduce((min, p) => (p.score < min.score ? p : min), parts[0]);
}

function durability(shoe: ClientShoe, a: Answers): Raw {
  const high = a.weeklyVolume === "60-80" || a.weeklyVolume === "80plus";
  const mid = a.weeklyVolume === "40-60";
  if (high) {
    return shoe.outsole_durability >= 8
      ? { score: 1, notes: [plus("подошва выдержит твой объём")] }
      : shoe.outsole_durability >= 6
        ? { score: 0.55, notes: [] }
        : { score: 0.2, notes: [minus("на твоём объёме подошва уйдёт быстро")] };
  }
  if (mid) {
    return shoe.outsole_durability >= 6
      ? { score: 1, notes: [] }
      : { score: 0.6, notes: [] };
  }
  return { score: 1, notes: [] };
}

const TIER_ORDER = { low: 0, mid: 1, top: 2 } as const;

function tier(shoe: ClientShoe, a: Answers): Raw {
  if (a.tier === "any") return { score: 1, notes: [] };
  const market = a.market === "any" ? (shoe.available.includes("ru") ? "ru" : "eu") : a.market;
  const distance = Math.abs(TIER_ORDER[shoe.tier[market]] - TIER_ORDER[a.tier]);
  if (distance === 0) return { score: 1, notes: [] };
  if (distance === 1) return { score: 0.55, notes: [] };
  return { score: 0.2, notes: [] };
}

function recency(shoe: ClientShoe): Raw {
  if (shoe.year >= 2025) return { score: 1, notes: [] };
  if (shoe.year === 2024) return { score: 0.6, notes: [] };
  return { score: 0.3, notes: [minus(`модель ${shoe.year} года — версия уже не свежая`)] };
}

function brand(shoe: ClientShoe, a: Answers, c: Ctx): Raw {
  if (c.ownedBrands.has(shoe.brand.toLowerCase())) {
    return {
      score: 1,
      notes: [plus(`${shoe.brand} тебе знаком — колодка не будет сюрпризом`)],
    };
  }
  return { score: 0.5, notes: [] };
}

function stability(shoe: ClientShoe, a: Answers): Raw {
  const hasIssues = a.issues.some((i) => i !== "none");
  // Работает только в связке заваливания и истории травм — раздел 6.3.
  if (a.pronation !== "over" || !hasIssues) return { score: 0.8, notes: [] };
  return shoe.stability >= 1
    ? { score: 1, notes: [plus("есть опора под заваливание внутрь")] }
    : { score: 0.3, notes: [] };
}

/** Мембрана в формуле — число: своя защита бренда слабее полноценной Gore-Tex. */
const MEMBRANE_VALUE = { none: 0, shield: 0.6, gtx: 1 } as const;

function weather(shoe: ClientShoe, a: Answers, c: Ctx): Raw {
  // Вне зимнего слота критерий постоянен и на ранжирование не влияет.
  if (c.slot.id !== "winter") return { score: 0.7, notes: [] };

  const membrane = MEMBRANE_VALUE[shoe.membrane];
  const grip = shoe.winter_grip / 10;
  const notes: CriterionNote[] = [];
  let score: number;

  if (a.winter === "slush") {
    score = membrane * 0.7 + grip * 0.3;
    // Штраф обязателен: глубокий протектор на твёрдом покрытии мешает и быстрее
    // стирается. Без него трейловые модели вытесняют дорожные из выдачи.
    if (a.surface === "road" && shoe.surface === "trail") {
      score *= 0.5;
      notes.push(minus("трейловый протектор, на асфальте лишний"));
    }
    if (shoe.membrane !== "none") {
      notes.push(plus("мембрана, не промокает в дождь и слякоть"));
    }
  } else {
    // Снег и лёд: мембрана приятна, но вторична — упасть опаснее, чем промокнуть.
    score = grip * 0.75 + membrane * 0.25;
    if (shoe.membrane === "none") {
      notes.push(minus("без мембраны, в слякоть промокнет"));
    }
  }

  if (shoe.winter_grip >= 8) {
    notes.push(plus("агрессивный протектор, держит на льду и снегу"));
  }
  return { score: clamp01(score), notes };
}

export type ScoreBreakdown = {
  score: number;
  criteria: CriterionResult[];
};

export function scoreShoe(
  shoe: ClientShoe,
  a: Answers,
  slot: Slot,
  ownedBrands: Set<string>
): ScoreBreakdown {
  const variant = pickVariant(shoe, a.gender);
  const ctx: Ctx = {
    slot,
    softness: variant.softness,
    weight_g: variant.weight_g,
    ownedBrands,
  };

  const raws: Record<CriterionId, Raw> = {
    softness: softness(shoe, a, ctx),
    runnerWeight: runnerWeight(shoe, a, ctx),
    antiPattern: antiPattern(shoe, a, ctx),
    width: width(shoe, a),
    slotFit: slotFit(shoe, a, ctx),
    injury: injury(shoe, a, ctx),
    durability: durability(shoe, a),
    tier: tier(shoe, a),
    recency: recency(shoe),
    brand: brand(shoe, a, ctx),
    stability: stability(shoe, a),
    weather: weather(shoe, a, ctx),
  };

  const criteria: CriterionResult[] = (Object.keys(raws) as CriterionId[]).map((id) => {
    const weight = CRITERION_WEIGHTS[id];
    const score = clamp01(raws[id].score);
    return {
      id,
      title: CRITERION_TITLES[id],
      score,
      weight,
      contribution: (score * weight * 100) / TOTAL_WEIGHT,
      notes: raws[id].notes,
    };
  });

  const score = criteria.reduce((sum, c) => sum + c.contribution, 0);
  return { score: Math.round(score), criteria };
}

/**
 * Плюсы и минусы карточки — из тех же формулировок, что дали баллы.
 *
 * Порядок по весу критерия: сначала то, что сильнее повлияло на решение.
 * Знак берётся из самой заметки, а не из балла: критерий умеет одновременно
 * похвалить протектор и отметить, что мембраны нет.
 */
export function buildProsCons(criteria: CriterionResult[]): {
  pros: string[];
  cons: string[];
} {
  const flat = criteria
    .flatMap((c) => c.notes.map((n) => ({ ...n, weight: c.weight })))
    .sort((x, y) => y.weight - x.weight);
  return {
    pros: flat.filter((n) => n.tone === "plus").slice(0, 3).map((n) => n.text),
    cons: flat.filter((n) => n.tone === "minus").slice(0, 2).map((n) => n.text),
  };
}
