/**
 * Расчёт "что надеть на пробежку". Один источник правды под калькулятор
 * /tools/dress — таблицы комплектов и формула считаются здесь, компонент
 * только рендерит результат.
 *
 * eff = t + wind + precip + run + feel (эффективная температура)
 * dress = eff + 10 (поправка на то, что бег греет)
 */

export type WindLevel = 0 | -2 | -5;
export type Precip = "none" | "rain" | "snow";
export type RunType = 0 | -1 | 3;

export type DressState = {
  t: number;
  wind: WindLevel;
  precip: Precip;
  run: RunType;
  feel: number;
};

export type ZoneItem = {
  text: string;
  note?: string;
  muted?: boolean;
};

export type Outfit = {
  head: ZoneItem | null;
  neck: ZoneItem | null;
  body: ZoneItem;
  hands: ZoneItem | null;
  legs: ZoneItem;
  socks: string;
  shoeNote: string;
  tip: string;
};

export type DressResult = {
  eff: number;
  dress: number;
  outfit: Outfit;
  why: string;
};

export function formatDegrees(n: number): string {
  const prefix = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${prefix}${Math.abs(n)}°`;
}

function outfitFor(eff: number, rain: boolean, snow: boolean, tReal: number): Outfit {
  const wet = rain || snow;
  // Дождь просит непромокаемую куртку, иначе достаточно ветровки.
  const jacket = rain ? "водоотталкивающая куртка" : "ветровка";

  let head: ZoneItem | null;
  let neck: ZoneItem | null;
  let body: ZoneItem;
  let hands: ZoneItem | null;
  let legs: ZoneItem;
  let tip = "";

  if (eff >= 24) {
    head = { text: "кепка или козырёк от солнца" };
    neck = null;
    body = { text: "майка", note: "самая лёгкая и светлая, что есть" };
    hands = null;
    legs = { text: "шорты" };
    tip = "Жарко: возьми воду и выбирай тень, темп пусть будет спокойнее обычного.";
  } else if (eff >= 18) {
    head = { text: "кепка, если солнце", muted: true };
    neck = null;
    body = { text: "майка или футболка" };
    hands = null;
    legs = { text: "шорты" };
  } else if (eff >= 12) {
    head = null;
    neck = null;
    body = {
      text: "футболка",
      note: rain ? "в тепле дождь не страшен, главное сухая одежда после" : undefined,
    };
    hands = null;
    legs = { text: "шорты" };
  } else if (eff >= 7) {
    head = { text: "повязка на уши по желанию", muted: true };
    neck = null;
    body = {
      text: rain ? `футболка или лонгслив + лёгкая ${jacket}` : "футболка или лонгслив",
    };
    hands = { text: "тонкие перчатки по желанию", muted: true };
    legs = { text: "шорты или тайтсы" };
  } else if (eff >= 2) {
    head = { text: "повязка на уши" };
    neck = null;
    body = { text: rain ? `лонгслив + ${jacket}` : "лонгслив", note: "синтетика, не хлопок" };
    hands = { text: "тонкие перчатки" };
    legs = { text: "тайтсы" };
  } else if (eff >= -3) {
    head = { text: "шапка или повязка" };
    neck = { text: "бафф" };
    body = { text: `лонгслив + ${jacket}`, note: "база прилегает к телу" };
    hands = { text: "перчатки" };
    legs = { text: "тайтсы" };
  } else if (eff >= -8) {
    head = { text: "шапка" };
    neck = { text: "бафф" };
    body = {
      text: `термобельё + флиска или жилет + ${jacket}`,
      note: "три слоя: отвести пот, удержать тепло, защитить",
    };
    hands = { text: "тёплые перчатки" };
    legs = { text: "утеплённые тайтсы" };
  } else if (eff >= -14) {
    head = { text: "тёплая шапка" };
    neck = { text: "бафф, поднять на лицо" };
    body = {
      text: "термобельё + флиска + ветрозащитная куртка",
      note: "верхний слой обязателен",
    };
    hands = { text: "варежки или две пары перчаток" };
    legs = { text: "утеплённые тайтсы" };
  } else {
    head = { text: "тёплая шапка" };
    neck = { text: "бафф или балаклава на лицо" };
    body = { text: "термобельё + флиска + утеплённая куртка" };
    hands = { text: "варежки" };
    legs = { text: "утеплённые тайтсы + ветрозащитные брюки" };
    tip = "Сильный мороз: сократи пробежку и береги открытую кожу лица.";
  }

  const socks =
    eff < -8
      ? "утеплённые синтетические носки"
      : eff >= 24
        ? "тонкие синтетические носки"
        : "синтетические носки";

  // Условие про обувь смотрит на РЕАЛЬНУЮ температуру, не на eff: мембрана
  // перегревает из-за настоящего тепла на улице, поправка на бег тут ни при чём.
  let shoeNote: string;
  if (wet && tReal < 10) {
    shoeNote =
      "мембрана подойдёт, если луж мало. Если глубоко, лучше сетка: мембрана воду, попавшую внутрь, не выпустит";
  } else if (wet) {
    shoeNote = "обычные сетчатые кроссовки. В тепле мембрана будет перегревать";
  } else {
    shoeNote = "обычные беговые кроссовки";
  }

  return { head, neck, body, hands, legs, socks, shoeNote, tip };
}

export function calcDress(state: DressState): DressResult {
  const rain = state.precip === "rain";
  const snow = state.precip === "snow";
  const wet = rain ? -3 : snow ? -1 : 0;
  const eff = state.t + state.wind + wet + state.run + state.feel;
  const dress = eff + 10;
  const outfit = outfitFor(eff, rain, snow, state.t);

  const parts: string[] = [];
  if (state.wind === -2) parts.push("умеренный ветер отнимает 2 градуса");
  if (state.wind === -5) parts.push("сильный ветер отнимает 5 градусов");
  if (rain) parts.push("дождь отнимает ещё 3");
  if (snow) parts.push("снег отнимает 1");
  if (state.run === 3) parts.push("на интервалах тело греет сильнее");
  if (state.run === -1) parts.push("на длительной под конец остываешь");
  if (state.feel < 0) parts.push("поправка на то, что тебе обычно холодно");
  if (state.feel > 0) parts.push("поправка на то, что тебе обычно жарко");

  let why = parts.length
    ? `Учтено: ${parts.join(", ")}.`
    : "К температуре на улице добавлено 10 градусов, которые даст бег.";
  if (outfit.tip) why = `${outfit.tip} ${why}`;

  return { eff, dress, outfit, why };
}
