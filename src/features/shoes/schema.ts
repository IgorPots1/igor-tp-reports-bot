import { softnessFromHa } from "./scoring";
import type { Catalog, CatalogKind, Shoe, ShoeCategory } from "./types";

/**
 * Валидация базы обуви.
 *
 * Смысл проверки — не «красиво ли заполнен JSON», а не дать выдуманному числу
 * доехать до человека. Поэтому:
 *   • запись с null в обязательном поле ОТБРАКОВЫВАЕТСЯ, а не показывается;
 *   • внутренне противоречивая запись (дроп не равен разнице стеков, мягкость
 *     не соответствует дюрометру, уровень не соответствует цене) — тоже брак:
 *     значит, одно из полей взято не из источника;
 *   • в боевом каталоге (catalog_kind: "production") запись без источников,
 *     без даты сверки или с меткой demo не проходит вовсе.
 */

const CATEGORIES: ShoeCategory[] = [
  "daily",
  "tempo",
  "race",
  "max",
  "stability",
  "trail",
  "winter",
];

/** Пороги уровня из раздела 3. Перепроверить на реальных ценах перед запуском. */
export const TIER_THRESHOLDS = {
  eu: { low: 125, mid: 199 },
  ru: { low: 11000, mid: 19000 },
} as const;

export function tierFromPrice(market: "eu" | "ru", price: number): "low" | "mid" | "top" {
  const t = TIER_THRESHOLDS[market];
  return price <= t.low ? "low" : price <= t.mid ? "mid" : "top";
}

export type RejectedRecord = { id: string; problems: string[] };

export type ValidationResult = {
  catalog_kind: CatalogKind;
  shoes: Shoe[];
  rejected: RejectedRecord[];
  /** Модели, у которых пустует необязательное поле: вход в отчёт о пропусках. */
  gaps: { id: string; field: string }[];
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function checkRecord(raw: unknown, kind: CatalogKind): { shoe: Shoe | null; problems: string[] } {
  const problems: string[] = [];
  const r = raw as Record<string, unknown>;

  const requireNum = (field: string) => {
    if (!isNum(r?.[field])) problems.push(`${field}: не число (${String(r?.[field])})`);
  };
  const requireStr = (field: string) => {
    if (!isStr(r?.[field])) problems.push(`${field}: пусто`);
  };

  requireStr("id");
  requireStr("brand");
  requireStr("model");
  requireStr("foam_type");
  [
    "year",
    "weight_g",
    "stack_heel_mm",
    "stack_fore_mm",
    "drop_mm",
    "midsole_durometer_ha",
    "softness",
    "stability",
    "platform_width_heel_mm",
    "platform_width_fore_mm",
    "outsole_durability",
    "outsole_thickness_mm",
    "winter_grip",
    "lug_depth_mm",
  ].forEach(requireNum);

  if (!["none", "gtx", "shield"].includes(String(r?.membrane))) {
    problems.push("membrane: не none/gtx/shield");
  }
  if (isNum(r?.winter_grip) && (r.winter_grip < 1 || r.winter_grip > 10)) {
    problems.push(`winter_grip ${r.winter_grip} вне шкалы 1–10`);
  }
  if (r?.variant_of !== null && !isStr(r?.variant_of)) {
    problems.push("variant_of: должен быть id базовой модели или null");
  }

  if (!Array.isArray(r?.categories) || r.categories.length === 0) {
    problems.push("categories: пусто");
  } else if (!r.categories.every((c) => CATEGORIES.includes(c as ShoeCategory))) {
    problems.push(`categories: неизвестное значение (${r.categories.join(", ")})`);
  }
  if (r?.surface !== "road" && r?.surface !== "trail") problems.push("surface: не road/trail");
  if (!["none", "nylon", "carbon"].includes(String(r?.plate))) problems.push("plate: неизвестна");
  if (!["narrow", "std", "wide"].includes(String(r?.last_width))) {
    problems.push("last_width: неизвестна");
  }

  const price = r?.price as Record<string, unknown> | undefined;
  const available = r?.available;
  if (!Array.isArray(available) || available.length === 0) {
    problems.push("available: пусто");
  } else {
    for (const m of available as string[]) {
      if (m !== "eu" && m !== "ru") problems.push(`available: неизвестный рынок ${m}`);
      else if (!isNum(price?.[m])) problems.push(`price.${m}: нет цены для рынка из available`);
    }
  }

  const genders = r?.genders as Record<string, Record<string, unknown>> | undefined;
  for (const g of ["m", "w"] as const) {
    const v = genders?.[g];
    if (!v || typeof v.available !== "boolean") {
      problems.push(`genders.${g}: нет флага available`);
      continue;
    }
    if (v.available && (!isNum(v.weight_g) || !isNum(v.durometer_ha))) {
      problems.push(`genders.${g}: версия есть, но вес или дюрометр пустые`);
    }
  }

  // Внутренние сходимости: расхождение = поле взято не из источника.
  if (isNum(r?.stack_heel_mm) && isNum(r?.stack_fore_mm) && isNum(r?.drop_mm)) {
    const expected = r.stack_heel_mm - r.stack_fore_mm;
    if (Math.abs(expected - r.drop_mm) > 0.51) {
      problems.push(`drop_mm ${r.drop_mm} не равен разнице стеков (${expected})`);
    }
  }
  if (isNum(r?.midsole_durometer_ha) && isNum(r?.softness)) {
    const expected = softnessFromHa(r.midsole_durometer_ha);
    if (Math.abs(expected - r.softness) > 0.6) {
      problems.push(`softness ${r.softness} не сходится с дюрометром ${r.midsole_durometer_ha} (ожидалось ${expected})`);
    }
  }
  // Мембрана — это и есть зимнее назначение: без категории winter такая пара
  // попала бы в обычные слоты и предлагалась бы бегать в ней круглый год.
  if (r?.membrane !== "none" && Array.isArray(r?.categories)) {
    if (!(r.categories as string[]).includes("winter")) {
      problems.push("есть мембрана, но нет категории winter");
    }
  }

  const tier = r?.tier as Record<string, unknown> | undefined;
  if (Array.isArray(available)) {
    for (const m of available as ("eu" | "ru")[]) {
      if (m !== "eu" && m !== "ru") continue;
      const p = price?.[m];
      if (isNum(p) && tier?.[m] !== tierFromPrice(m, p)) {
        problems.push(`tier.${m} ${String(tier?.[m])} не соответствует цене ${p}`);
      }
    }
  }

  if (kind === "production") {
    if (r?.demo === true) problems.push("демонстрационная запись в боевом каталоге");
    if (!Array.isArray(r?.sources) || r.sources.length === 0) problems.push("sources: пусто");
    else if ((r.sources as string[]).includes("demo")) problems.push("sources: demo в боевом каталоге");
    if (!isStr(r?.verified_at)) problems.push("verified_at: нет даты сверки");
  }

  return { shoe: problems.length === 0 ? (raw as Shoe) : null, problems: problems.map((p) => p) };
}

/**
 * Разворачивает варианты базовых моделей (GTX-версии).
 *
 * У варианта в JSON заполнены только собственные поля: вес, мембрана,
 * протектор, цена, наличие. Лабораторные замеры — стек, дюрометр, пена,
 * колодка, платформа — берутся у базовой модели, потому что у GTX-версии
 * та же геометрия и та же пена. Дублировать замеры в данных незачем: копия
 * разъедется с оригиналом на первом же обновлении базы.
 */
function resolveVariants(rawShoes: unknown[]): { shoes: unknown[]; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const s of rawShoes) {
    const r = s as Record<string, unknown>;
    if (typeof r?.id === "string") byId.set(r.id, r);
  }

  const shoes = rawShoes.map((s) => {
    const r = s as Record<string, unknown>;
    const parentId = r?.variant_of;
    if (typeof parentId !== "string") return s;

    const parent = byId.get(parentId);
    if (!parent) {
      problems.push(`${String(r.id)}: variant_of ссылается на несуществующую модель ${parentId}`);
      return s;
    }
    if (typeof parent.variant_of === "string") {
      problems.push(`${String(r.id)}: variant_of ссылается на другой вариант, а не на базовую модель`);
      return s;
    }

    const own = Object.fromEntries(
      Object.entries(r).filter(([, v]) => v !== undefined)
    );
    const parentGenders = (parent.genders ?? {}) as Record<string, Record<string, unknown>>;
    const ownGenders = (r.genders ?? {}) as Record<string, Record<string, unknown>>;
    const genders = Object.fromEntries(
      (["m", "w"] as const).map((g) => [g, { ...parentGenders[g], ...ownGenders[g] }])
    );
    return { ...parent, ...own, genders };
  });

  return { shoes, problems };
}

export function validateCatalog(raw: unknown): ValidationResult {
  const c = raw as Partial<Catalog>;
  const kind: CatalogKind = c?.catalog_kind === "production" ? "production" : "demo";
  if (!Array.isArray(c?.shoes)) {
    throw new Error("Каталог обуви: нет массива shoes");
  }

  const resolved = resolveVariants(c.shoes);

  const shoes: Shoe[] = [];
  const rejected: RejectedRecord[] = [];
  const gaps: { id: string; field: string }[] = [];
  const seen = new Set<string>();

  if (resolved.problems.length > 0) {
    rejected.push({ id: "<варианты моделей>", problems: resolved.problems });
  }

  for (const raw of resolved.shoes) {
    const { shoe, problems } = checkRecord(raw, kind);
    const id = (raw as { id?: string })?.id ?? "<без id>";
    if (seen.has(id)) problems.push("дубль id");
    seen.add(id);

    if (!shoe || problems.length > 0) {
      rejected.push({ id, problems });
      continue;
    }
    if (shoe.image === null) gaps.push({ id, field: "image" });
    if (shoe.genders.w.available && !shoe.genders.w.measured) {
      gaps.push({ id, field: "genders.w.measured" });
    }
    shoes.push(shoe);
  }

  return { catalog_kind: kind, shoes, rejected, gaps };
}
