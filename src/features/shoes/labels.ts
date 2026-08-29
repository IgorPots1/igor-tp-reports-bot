import type { ClientShoe, Recommendation, Tier } from "./types";

/**
 * Перевод характеристик в человеческий язык.
 *
 * Миллиметры и термины на первом экране карточки не показываются: «мягкая,
 * широкая колодка, без пластины» человек читает сразу, а «41/33, дроп 8» —
 * только если сам раскроет разбор. Уровень называется словом и никогда ценой:
 * цен в интерфейсе нет вообще.
 */

export const TIER_WORDS: Record<Tier, string> = {
  low: "доступные",
  mid: "средние",
  top: "топовые",
};

export function softnessWord(softness: number): string {
  if (softness < 3.5) return "жёсткая";
  if (softness < 5) return "плотная";
  if (softness < 6.5) return "средняя";
  if (softness < 8) return "мягкая";
  return "очень мягкая";
}

export function weightWord(weightG: number): string {
  if (weightG < 200) return "очень лёгкие";
  if (weightG < 240) return "лёгкие";
  if (weightG < 285) return "средние по весу";
  return "тяжёлые";
}

export function widthWord(shoe: ClientShoe): string {
  if (shoe.last_width === "narrow") return "узкая колодка";
  if (shoe.last_width === "wide") return "широкая колодка";
  return "обычная колодка";
}

export function plateWord(shoe: ClientShoe): string | null {
  if (shoe.plate === "carbon") return "карбон";
  if (shoe.plate === "nylon") return "нейлоновая пластина";
  return null;
}

export function supportWord(shoe: ClientShoe): string | null {
  if (shoe.stability === 2) return "стабилизация";
  if (shoe.stability === 1) return "лёгкая опора";
  return null;
}

export function membraneWord(shoe: ClientShoe): string | null {
  if (shoe.membrane === "gtx") return "мембрана Gore-Tex";
  if (shoe.membrane === "shield") return "защита от воды";
  return null;
}

/** Ярлыки первого экрана карточки. */
export function shoeLabels(rec: Recommendation): string[] {
  const s = rec.shoe;
  return [
    softnessWord(rec.variant.softnessShown),
    weightWord(rec.variant.weight_g),
    widthWord(s),
    plateWord(s),
    supportWord(s),
    membraneWord(s),
    s.lug_depth_mm >= 4 ? "глубокий протектор" : null,
  ].filter((x): x is string => x !== null);
}
