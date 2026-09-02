/**
 * Типы базы обуви и ответов опросника подборщика кроссовок.
 *
 * Схема записи — раздел 3 ТЗ, поле в поле. Расширять её молча нельзя: новое
 * поле означает второй проход по всем источникам, то есть пересбор базы.
 *
 * Единственное, чего в разделе 3 нет и что добавлено осознанно, — обёртка
 * каталога (`catalog_kind`) и метка `demo` у записи. Без них демонстрационные
 * числа, на которых собрано приложение, невозможно отличить от сверенных, и
 * первая же подмена файла тихо выдала бы выдуманные цифры за настоящие.
 */

export type ShoeCategory =
  | "daily"
  | "tempo"
  | "race"
  | "max"
  | "stability"
  | "trail"
  | "winter";
export type Surface = "road" | "trail";
export type LastWidth = "narrow" | "std" | "wide";
export type Plate = "none" | "nylon" | "carbon";
/** Мембрана: фирменная защита (Nike Shield, Saucony RunShield) — это `shield`. */
export type Membrane = "none" | "gtx" | "shield";
export type Market = "eu" | "ru";
export type Tier = "low" | "mid" | "top";
export type GenderKey = "m" | "w";

export type GenderVariant = {
  available: boolean;
  /** Заявленный вес пары этой версии. У женской замер идёт по US7, а не US9. */
  weight_g: number | null;
  durometer_ha: number | null;
  /** false — цифры взяты с мужской версии, женская в лаборатории не резалась. */
  measured: boolean;
};

export type Shoe = {
  id: string;
  brand: string;
  model: string;
  year: number;
  categories: ShoeCategory[];
  surface: Surface;

  weight_g: number;
  stack_heel_mm: number;
  stack_fore_mm: number;
  drop_mm: number;

  /** Лабораторный замер на разрезанном кроссовке. Снаружи мерить нельзя. */
  midsole_durometer_ha: number;
  /** 1–10, производное от дюрометра. Формула — softnessFromHa. */
  softness: number;
  foam_type: string;
  plate: Plate;

  /** 0 нейтраль, 1 лёгкая опора, 2 стабилизация. */
  stability: 0 | 1 | 2;
  last_width: LastWidth;
  platform_width_heel_mm: number;
  platform_width_fore_mm: number;

  outsole_durability: number;
  outsole_thickness_mm: number;

  /** Мембрана: за неё платят теплом и вентиляцией, поэтому не круглый год. */
  membrane: Membrane;
  /** 1–10, сцепление на мокром и холодном: состав резины плюс протектор. */
  winter_grip: number;
  /**
   * 1–5, лабораторный замер жёсткости пяточного задника: 1 мягкий и податливый,
   * 5 жёсткий. null — замера нет; тогда жалоба «натирало пятку» в подборе не
   * участвует и человеку об этом говорится прямо, а не заминается.
   */
  heel_counter_stiffness: number | null;
  lug_depth_mm: number;
  /**
   * id базовой модели, если это её вариант (GTX-версия), иначе null.
   *
   * GTX — не отдельный кроссовок: у него та же геометрия и та же пена, что у
   * базовой модели, плюс мембрана и 20–30 граммов. Лабораторные замеры
   * наследуются от базы, отдельно проверяются только вес, мембрана и протектор,
   * поэтому в JSON у варианта заполнены ТОЛЬКО его собственные поля.
   */
  variant_of: string | null;

  price: { eu: number; ru: number };
  available: Market[];
  /** Вычисляется из цены. Наружу не показывается — только словами. */
  tier: { eu: Tier; ru: Tier };

  genders: Record<GenderKey, GenderVariant>;

  image: string | null;
  sources: string[];
  verified_at: string | null;
  /** Метка демонстрационной записи: числа не сверены по источникам. */
  demo?: boolean;
};

/** Запись без цен — ровно то, что уезжает на клиент. */
export type ClientShoe = Omit<Shoe, "price">;

export type CatalogKind = "demo" | "production";

export type Catalog = {
  catalog_kind: CatalogKind;
  note?: string;
  shoes: Shoe[];
};

export type ClientCatalog = {
  catalog_kind: CatalogKind;
  shoes: ClientShoe[];
};

/* ------------------------------- Опросник ------------------------------- */

export type WeeklyVolume = "lt20" | "20-40" | "40-60" | "60-80" | "80plus";
export type SurfaceAnswer = "road" | "mixed" | "trail";
export type Goal = "just_run" | "5_10" | "half" | "marathon" | "trail_ultra";
/** Зимний сценарий: «не бегаю» / «дождь и слякоть» / «снег и лёд». */
export type WinterRunning = "none" | "slush" | "snow";
export type GenderAnswer = GenderKey | "any";
export type FootWidth = LastWidth | "unknown";
export type Pronation = "neutral" | "over" | "unknown";
export type Issue = "shin" | "achilles" | "knee" | "foot" | "none";
export type Dislike =
  | "harsh"
  | "unstable"
  | "narrow"
  | "heavy"
  | "wear"
  | "heel_rub"
  | "none";
export type TierAnswer = Tier | "any";
export type MarketAnswer = Market | "any";
export type PairCount = 1 | 2 | 3;

export type Answers = {
  weeklyVolume: WeeklyVolume;
  surface: SurfaceAnswer;
  goal: Goal;
  winter: WinterRunning;
  speedwork: boolean;
  gender: GenderAnswer;
  bodyWeightKg: number;
  footWidth: FootWidth;
  pronation: Pronation;
  issues: Issue[];
  ownedShoeIds: string[];
  dislikes: Dislike[];
  /** 1 «жёстко и отзывчиво» … 5 «максимум мягкости». */
  feel: 1 | 2 | 3 | 4 | 5;
  tier: TierAnswer;
  market: MarketAnswer;
  pairs: PairCount;
};

/* -------------------------------- Выдача -------------------------------- */

export type SlotId = "daily" | "tempo" | "race" | "trail" | "trail_light" | "winter";

export type Slot = {
  id: SlotId;
  title: string;
  /** Зачем эта пара в ротации — человеческим языком. */
  subtitle: string;
  categories: ShoeCategory[];
  /** null — поверхность не ограничиваем (зимний слот берёт и дорогу, и трейл). */
  surface: Surface | null;
};

export type CriterionId =
  | "softness"
  | "runnerWeight"
  | "antiPattern"
  | "width"
  | "slotFit"
  | "injury"
  | "durability"
  | "tier"
  | "recency"
  | "brand"
  | "stability"
  | "weather";

/**
 * Пояснение из данных с явным знаком.
 *
 * Знак хранится отдельно от балла намеренно: один критерий умеет сказать
 * и хорошее, и плохое сразу. Зимняя модель с протектором 9, но без мембраны
 * получает средний балл — и если бы знак выводился из балла, обе фразы
 * пропали бы, хотя человеку важны обе.
 */
export type CriterionNote = { text: string; tone: "plus" | "minus" };

export type CriterionResult = {
  id: CriterionId;
  /** Человеческое имя критерия для разбора баллов. */
  title: string;
  /** 0–1. */
  score: number;
  weight: number;
  /** Вклад в итоговый балл, в тех же единицах, что и итог (0–100). */
  contribution: number;
  /** Формулировки из данных: «стека хватает под 90 кг». */
  notes: CriterionNote[];
};

export type Recommendation = {
  shoe: ClientShoe;
  /** 0–100. */
  score: number;
  criteria: CriterionResult[];
  pros: string[];
  cons: string[];
  /** Вес пары и пометка про женский замер — из выбранной версии. */
  variant: {
    gender: GenderKey;
    weight_g: number;
    /** Мягкость выбранной версии: у женской свой замер плотности, если он есть. */
    softnessShown: number;
    /** true — цифры сняты с мужской версии. */
    borrowedFromMen: boolean;
  };
};

export type SlotResult = {
  slot: Slot;
  picks: Recommendation[];
  /** Почему слот пуст: показываем прямым текстом, а не пустым местом. */
  emptyReason: string | null;
};
