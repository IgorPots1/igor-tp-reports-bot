import { entryById } from "./search";
import { buildProsCons, pickVariant, scoreShoe } from "./scoring";
import { resolveSlots } from "./slots";
import type {
  Answers,
  ClientCatalog,
  ClientShoe,
  Slot,
  SlotResult,
} from "./types";

/**
 * Жёсткие фильтры (6.2) и сборка выдачи (6.5).
 *
 * Фильтр по уровню намеренно мягкий: он отсекает только то, что на ДВА уровня
 * выше выбранного. Жёсткий обнулял бы стартовый слот у всех, кто выбрал
 * «доступные», хотя стартовые китайских брендов в этот бюджет попадают.
 */

const TIER_ORDER = { low: 0, mid: 1, top: 2 } as const;

type RejectReason =
  | "market"
  | "gender"
  | "tier"
  | "year"
  | "category"
  | "surface"
  | "notWinter"
  | "winterOnly";

function reject(shoe: ClientShoe, a: Answers, slot: Slot): RejectReason | null {
  if (a.market !== "any" && !shoe.available.includes(a.market)) return "market";
  if (a.gender !== "any" && !shoe.genders[a.gender].available) return "gender";
  if (shoe.year < 2023) return "year";

  if (slot.id === "winter") {
    // В зимний слот проходит модель с мембраной ИЛИ со сцеплением от 8.
    // Поверхность здесь не фильтр: трейловую пару на асфальте топит штраф
    // в критерии погоды, а на трейле она законно оказывается наверху.
    if (shoe.membrane === "none" && shoe.winter_grip < 8) return "notWinter";
  } else {
    // Мембрана делает кроссовок жарче и хуже вентилируемым — круглый год в
    // нём бегать не нужно, поэтому зимняя модель в обычные слоты не идёт.
    if (shoe.categories.includes("winter")) return "winterOnly";
    if (slot.surface !== null && shoe.surface !== slot.surface) return "surface";
    if (!shoe.categories.some((c) => slot.categories.includes(c))) return "category";
  }

  if (a.tier !== "any") {
    const market = a.market === "any" ? (shoe.available.includes("ru") ? "ru" : "eu") : a.market;
    if (TIER_ORDER[shoe.tier[market]] - TIER_ORDER[a.tier] >= 2) return "tier";
  }
  return null;
}

/**
 * Прямое сообщение вместо пустого места. Ничего не выдумываем: называем то
 * ограничение, которое реально вырезало больше всего моделей.
 */
function explainEmpty(counts: Record<RejectReason, number>, slot: Slot): string {
  const top = (Object.entries(counts) as [RejectReason, number][])
    .filter(([, n]) => n > 0)
    .sort((x, y) => y[1] - x[1])[0];
  const base = `В слот «${slot.title.toLowerCase()}» под твои ответы ничего не подошло. `;
  if (!top) return `${base}База пока слишком маленькая для этого сочетания.`;
  switch (top[0]) {
    case "tier":
      return `${base}Мешает ограничение по уровню — подними его на ступень.`;
    case "market":
      return `${base}Мешает рынок — сними ограничение «где покупаешь».`;
    case "gender":
      return `${base}В базе нет версий в выбранном поле — попробуй «любые».`;
    case "notWinter":
      return `${base}В базе нет моделей с мембраной или зимним сцеплением под твои ограничения.`;
    case "category":
    case "surface":
    case "winterOnly":
      return `${base}Под эту задачу в базе пока нет моделей.`;
    case "year":
    default:
      return `${base}Всё, что подходит, старше 2023 года.`;
  }
}

export function recommend(catalog: ClientCatalog, a: Answers): SlotResult[] {
  // Бренд знакомой пары ищем в ИНДЕКСЕ, а не в базе подбора: человек чаще
  // всего бегает в прошлой версии, которой в подборе уже нет, и по каталогу
  // такая пара не нашлась бы вовсе — бонус за знакомый бренд молча пропал бы.
  const ownedBrands = new Set(
    a.ownedShoeIds
      .map((id) => entryById(id)?.brand.toLowerCase())
      .filter((b): b is string => Boolean(b))
  );

  return resolveSlots(a).map((slot) => {
    const counts: Record<RejectReason, number> = {
      market: 0,
      gender: 0,
      tier: 0,
      year: 0,
      category: 0,
      surface: 0,
      notWinter: 0,
      winterOnly: 0,
    };

    const candidates = catalog.shoes.filter((shoe) => {
      const r = reject(shoe, a, slot);
      if (r) counts[r] += 1;
      return r === null;
    });

    const picks = candidates
      .map((shoe) => {
        const { score, criteria } = scoreShoe(shoe, a, slot, ownedBrands);
        const { pros, cons } = buildProsCons(criteria);
        const v = pickVariant(shoe, a.gender);
        return {
          shoe,
          score,
          criteria,
          pros,
          cons,
          variant: {
            gender: v.gender,
            weight_g: v.weight_g,
            softnessShown: v.softness,
            borrowedFromMen: v.borrowedFromMen,
          },
        };
      })
      // Ничья по баллу разводится свежестью версии, а не порядком в файле:
      // иначе выдача зависела бы от того, как отсортирован JSON.
      .sort((x, y) => y.score - x.score || y.shoe.year - x.shoe.year)
      .slice(0, 3);

    return {
      slot,
      picks,
      emptyReason: picks.length === 0 ? explainEmpty(counts, slot) : null,
    };
  });
}
