/**
 * English version of ../../dress/dress-logic.ts. Same formula and the same
 * temperature bands; only the texts are in English.
 *
 * eff = t + wind + precip + run + feel (effective temperature)
 * dress = eff + 10 (running warms you up by about 10 degrees)
 */

import type { DressResult, DressState, Outfit, ZoneItem } from "../../dress/dress-logic";

export { formatDegrees } from "../../dress/dress-logic";

/** Celsius to Fahrenheit, rounded, for readers who think in °F. */
export function toF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

function outfitFor(eff: number, rain: boolean, snow: boolean, tReal: number): Outfit {
  const wet = rain || snow;
  const jacket = rain ? "water-resistant jacket" : "windbreaker";

  let head: ZoneItem | null;
  let neck: ZoneItem | null;
  let body: ZoneItem;
  let hands: ZoneItem | null;
  let legs: ZoneItem;
  let tip = "";

  if (eff >= 24) {
    head = { text: "cap or visor against the sun" };
    neck = null;
    body = { text: "singlet", note: "the lightest and brightest one you have" };
    hands = null;
    legs = { text: "shorts" };
    tip = "It's hot: take water, pick shady routes and run slower than usual.";
  } else if (eff >= 18) {
    head = { text: "cap if it's sunny", muted: true };
    neck = null;
    body = { text: "singlet or T-shirt" };
    hands = null;
    legs = { text: "shorts" };
  } else if (eff >= 12) {
    head = null;
    neck = null;
    body = {
      text: "T-shirt",
      note: rain ? "warm rain is fine, just have dry clothes for after" : undefined,
    };
    hands = null;
    legs = { text: "shorts" };
  } else if (eff >= 7) {
    head = { text: "headband over the ears if you like", muted: true };
    neck = null;
    body = {
      text: rain ? `T-shirt or long sleeve + light ${jacket}` : "T-shirt or long sleeve",
    };
    hands = { text: "thin gloves if you like", muted: true };
    legs = { text: "shorts or tights" };
  } else if (eff >= 2) {
    head = { text: "headband over the ears" };
    neck = null;
    body = { text: rain ? `long sleeve + ${jacket}` : "long sleeve", note: "synthetic, not cotton" };
    hands = { text: "thin gloves" };
    legs = { text: "tights" };
  } else if (eff >= -3) {
    head = { text: "beanie or headband" };
    neck = { text: "neck gaiter (buff)" };
    body = { text: `long sleeve + ${jacket}`, note: "a close-fitting base layer" };
    hands = { text: "gloves" };
    legs = { text: "tights" };
  } else if (eff >= -8) {
    head = { text: "beanie" };
    neck = { text: "neck gaiter (buff)" };
    body = {
      text: `thermal base layer + fleece or vest + ${jacket}`,
      note: "three layers: move sweat away, keep heat in, block the wind",
    };
    hands = { text: "warm gloves" };
    legs = { text: "thermal tights" };
  } else if (eff >= -14) {
    head = { text: "warm beanie" };
    neck = { text: "neck gaiter, pulled up over your face" };
    body = {
      text: "thermal base layer + fleece + windproof jacket",
      note: "the outer layer is a must",
    };
    hands = { text: "mittens or two pairs of gloves" };
    legs = { text: "thermal tights" };
  } else {
    head = { text: "warm beanie" };
    neck = { text: "neck gaiter or balaclava over your face" };
    body = { text: "thermal base layer + fleece + insulated jacket" };
    hands = { text: "mittens" };
    legs = { text: "thermal tights + windproof pants" };
    tip = "Very cold: keep the run shorter and protect the skin on your face.";
  }

  const socks = eff < -8 ? "warm synthetic socks" : eff >= 24 ? "thin synthetic socks" : "synthetic socks";

  // The shoe note looks at the REAL temperature, not eff: a waterproof membrane
  // overheats because of real heat outside, the running correction doesn't matter here.
  let shoeNote: string;
  if (wet && tReal < 10) {
    shoeNote =
      "waterproof (membrane) shoes are fine if puddles are small. If it's deep, mesh is better: a membrane won't let water out once it gets in";
  } else if (wet) {
    shoeNote = "normal mesh running shoes. In warm weather a membrane will overheat";
  } else {
    shoeNote = "your normal running shoes";
  }

  return { head, neck, body, hands, legs, socks, shoeNote, tip };
}

export function calcDressEn(state: DressState): DressResult {
  const rain = state.precip === "rain";
  const snow = state.precip === "snow";
  const wet = rain ? -3 : snow ? -1 : 0;
  const eff = state.t + state.wind + wet + state.run + state.feel;
  const dress = eff + 10;
  const outfit = outfitFor(eff, rain, snow, state.t);

  const parts: string[] = [];
  if (state.wind === -2) parts.push("moderate wind");
  if (state.wind === -5) parts.push("strong wind");
  if (rain) parts.push("rain");
  if (snow) parts.push("snow");
  if (state.run === 3) parts.push("intervals warm you up more");
  if (state.run === -1) parts.push("on a long run you cool down towards the end");
  if (state.feel < 0) parts.push("you usually feel cold");
  if (state.feel > 0) parts.push("you usually feel hot");

  let why = parts.length
    ? `Taken into account: ${parts.join(", ")}.`
    : "We added the 10 degrees that running gives you to the temperature outside.";
  if (outfit.tip) why = `${outfit.tip} ${why}`;

  return { eff, dress, outfit, why };
}
