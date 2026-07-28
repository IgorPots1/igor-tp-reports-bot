// Block 1 — "слова ученика как источник наблюдений". The student often NAMES why a run felt
// hard (жара, не пил, недосып, ремонт дома, болит колено). Those words reach the prompt but the
// deterministic planner never read them, so it asked a mechanical question ("пульс выше, а ты
// молчал") that contradicted what the student literally wrote. This module turns named factors
// into a cause the planner honors, and lets it suppress the "student said nothing → ask" branch.
//
// Two halves:
//   1. A deterministic keyword extractor (extractStatedFactorsDeterministic) — the FALLBACK, and
//      the fast path. Robust-ish to phrasing but leaky ("не брала воду" vs "забыла попить" vs
//      "пила мало" are three stems). The Haiku extractor (factor-extraction-ai.ts) is primary;
//      this catches at least heat + fatigue if the model is disabled or fails.
//   2. resolveStatedCause — pure, deterministic: pick the single most-explaining factor and map it
//      to a cause adviceKey. Numbers stay EMPTY (a stated factor is tone/cause, never a number).

import type { AdviceKey } from "./advice-keys.ts";
import type { ContextPacket, PlannerStudentMessage, StatedFactor, StatedFactorKind } from "./types.ts";

// Two windows. The TIGHT one (−1..+2, same as the verbatim panel) decides the cause of THIS run:
// a factor counts as the run's cause only if the student named it in the report ABOUT this run —
// otherwise a race report ("под дождём") or a rest-day note ("ноги забиты, не побегу") would bleed
// onto every run for a week. The WIDE one (−7..+2) is scanned ONLY to detect ACCUMULATION of the
// persistent life-state factors (life_stress / undersleep) — "несколько дней подряд про усталость =
// накопление" (design point 5) — which legitimately colors a run even without a same-day mention.
export const FACTOR_WINDOW_BACK_DAYS = 7; // wide scan (accumulation of persistent factors)
export const FACTOR_WINDOW_FWD_DAYS = 2;
export const FACTOR_TIGHT_BACK_DAYS = 1; // this run's own report (evening-of or next-morning)
export const FACTOR_TIGHT_FWD_DAYS = 1; // a message 2+ days LATER is about a later day, not this run
// Only these persist as a life-state and may attach from the wide window (as accumulation). A one-off
// heat / dehydration / soreness / conditions is about a specific run, so it must land in the tight window.
const PERSISTENT_FACTORS = new Set<StatedFactorKind>(["life_stress", "undersleep"]);

// Deterministic patterns per factor (the FALLBACK). Order matters only for which quote is captured;
// resolveStatedCause decides precedence across factors. Each pattern is Russian-lowercased-tested.
// `neg` is an optional guard: when it matches, the factor is REJECTED for that message — the keyword
// stemmer is blind to negation, so "было не жарко, свежо" would otherwise assert heat (Haiku reads
// the negation itself; the fallback needs this). Kept narrow: only the common denials.
const FACTOR_PATTERNS: Array<{ factor: StatedFactorKind; re: RegExp; neg?: RegExp }> = [
  { factor: "illness", re: /бол(е|ь)ю|болел|заболел|просты|прострыл|температур|горло|насморк|сопл|недомога|подхватил|орви|орз|грипп/iu, neg: /не\s+болел|уже\s+не\s+бол|не\s+заболел/iu },
  // Крепатура/забитость мышц после силовой — НОРМА, НЕ травма. СТОИТ ПЕРЕД soreness, чтобы «мышцы
  // забиты/ноют после приседаний» не ушли в травму-сигнал (Надя: «мышцы бедра, вчера приседания»).
  // neg: суставно-острое (колено/сустав/потянул) — это уже soreness, отдаём ему.
  { factor: "muscle_doms", re: /крепатур|заб(и|ъ)т[ыао]|забились|мышц[а-яё]*\s+(?:ноют|болят|тянут|наливш|налит|деревян|чувству)|(?=[\s\S]*мышц)(?=[\s\S]*(?:присед|силов|качал|выпад|штанг|становая|планк|в\s+зал))/iu, neg: /колен|сустав|голеностоп|ахилл|надрыв|надорвал|потянул|прострел|остр(ая|ую)\s+бол/iu },
  // soreness = ТРАВМА/сигнал: сустав/колено/стопа/спина болит, потянул, острое. Бытовое «забиты/
  // ноют мышцы» ушло в muscle_doms выше; здесь только суставно-болевое.
  { factor: "soreness", re: /болит|заболел[аои]? (колен|стоп|спин|ног|бедр|икр)|потянул|надорвал|мозол|прострел|(?:колен|сустав|стоп|голеностоп|ахилл|спин)[а-яё]*\s+(?:ноет|тянет|беспоко)/iu, neg: /ничего\s+не\s+болит|не\s+болит|боли\s+не\s+чувству|не\s+беспоко/iu },
  // No neg needed: every alternative here is already a negative-sleep phrasing (мало/не выспал/плохо/
  // недосып). "выспалась/спал хорошо" simply don't match the pattern.
  { factor: "undersleep", re: /недоспал|недосып|мало спал|не выспал|плохо спал|поздно лёг|поздно лег|не спал|бессонниц/iu },
  { factor: "dehydration", re: /(не|забыл[а-яё]*)\s+(пил|попи|брал[а-яё]*\s+вод)|воду?\s+не\s+(брал|взял|пил)|без\s+воды|мало\s+(пил|воды)|пил[а-яё]*\s+мало|обезвож/iu, neg: /воды\s+хватил|пил[а-яё]*\s+достаточно|воды\s+достаточно|напил/iu },
  // ЕДА/гели как контекст (не вода, не диета). «поел/не поел/без гелей/натощак/съел кашу-банан/не хватило углеводов».
  { factor: "nutrition", re: /гел[ья]|без\s+гел|натощак|голодн|не\s+поел|не\s+ел|мало\s+(?:поел|ел|еды)|плохо\s+поел|(?:съел|поел|ел|позавтракал|перекусил)[а-яё]*\s|каш[иуа]|банан|батончик|финик|изотоник|энергетическ[а-яё]*\s+гел|углевод|не\s+хватило\s+(?:сил|энерги|углевод)|подкрепи|перед\s+(?:стартом|бегом|пробежк)[а-яё]*\s+(?:съел|поел|ел|каш|банан)/iu, neg: /не\s+про\s+еду|воды/iu },
  { factor: "heat", re: /жар|пекл|духот|парил|очень тепло|[+]?[23]\d\s*(?:°|градус|[сc]\b)/iu, neg: /не\s+жарк|без\s+жар|не\s+душно|прохладн|свеж|не\s+пекл/iu },
  { factor: "life_stress", re: /ремонт|переезд|аврал|завал на работе|работ[а-яё]* (много|завал|запар)|нервотрёп|стресс|устаю по жизни|вымотал|замотал|не высыпаюсь из-за|напряжённ[а-яё]* недел/iu },
  { factor: "conditions", re: /горк|в гору|рельеф|подъём|подъем|дорожк|манеж|тредмил|бегов[а-яё]* дорож|ветер|встречный ветер|против ветра|грязь|снег|гололёд|гололед/iu },
  // Device distrust — NOT a fatigue cause, a signal to stop trusting pulse this workout. Allows one
  // intervening word ("часы СЕГОДНЯ глючат", "пульс НАВЕРНОЕ кривой") since the stemmer is blind to it.
  // Watch/pulse OR GPS/track/distance unreliability. The GPS branches matter for the SCOPE
  // (deviceGlitchScope): a GPS/track/distance glitch must gate pace+distance, not just pulse.
  { factor: "device_glitch", re: /час[ыои][а-яё]*\s+(?:[а-яё]+\s+)?(?:вр[ёе]т|глюч|бар?ах|стран|сбо|подвис|туп|врал)|глюч[а-яё]*\s+час|датчик[а-яё]*\s+(?:[а-яё]+\s+)?(?:вр[ёе]т|глюч|бар?ах|сбо|отвал|потерял|врал)|пульс[а-яё]*\s+(?:[а-яё]+\s+)?(?:вр[ёе]т|завыш|занижен|кривой|не\s+тот|странн|врал)|странно\s+себя\s+вед[а-яё]т|сбой\s+(?:часов|датчика|пульса|gps|джипиэс)|потерял[а-яё]*\s+сигнал|неверн[а-яё]*\s+пульс|(?:gps|джипиэс|спутник[а-яё]*|навигац[а-яё]*)\s+(?:[а-яё]+\s+)?(?:не\s+(?:пойм|нашл|виде|слови|раб|подключ)|глюч|сбо|потерял|пропал|отвал|вр[ёе]т|врал|крив)|трек[а-яё]*\s+(?:крив|сбил|наврал|поехал|непра|порва|битый)|дистанц[а-яё]*\s+(?:вр[ёе]т|крив|наврал|неточн|завыш|занижен|не\s+та|неправ)/iu },
];

function daysFrom(date: string, workoutDate: string): number {
  return (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${workoutDate}T00:00:00Z`).getTime()) / 86_400_000;
}

/** Turn raw per-mention hits (from keywords OR Haiku) into the StatedFactor set, applying the
 *  tight-window / accumulation rule. A factor is kept when it is either NAMED in the tight window
 *  (this run's report) OR is a persistent life-state (life_stress/undersleep) mentioned on ≥2 days
 *  in the wide window. `recurring` = named on ≥2 distinct days. Shared by both extractors so the
 *  Haiku and fallback paths behave identically. */
export function assembleFactorsFromHits(hits: Array<{ factor: StatedFactorKind; quote: string; date: string }>, workoutDate: string): StatedFactor[] {
  // newest first so the captured quote/date is the most recent mention
  const sorted = [...hits].sort((a, b) => b.date.localeCompare(a.date));
  const byFactor = new Map<StatedFactorKind, { quote: string; date: string; days: Set<string>; tight: boolean }>();
  for (const h of sorted) {
    const d = daysFrom(h.date, workoutDate);
    if (!Number.isFinite(d) || d < -FACTOR_WINDOW_BACK_DAYS || d > FACTOR_WINDOW_FWD_DAYS) continue;
    const isTight = d >= -FACTOR_TIGHT_BACK_DAYS && d <= FACTOR_TIGHT_FWD_DAYS;
    const existing = byFactor.get(h.factor);
    if (existing) {
      existing.days.add(h.date);
      existing.tight = existing.tight || isTight;
    } else {
      byFactor.set(h.factor, { quote: h.quote.trim().slice(0, 200), date: h.date, days: new Set([h.date]), tight: isTight });
    }
  }
  const out: StatedFactor[] = [];
  for (const [factor, v] of byFactor) {
    const keep = v.tight || (PERSISTENT_FACTORS.has(factor) && v.days.size >= 2);
    if (keep) out.push({ factor, quote: v.quote, date: v.date, recurring: v.days.size >= 2 });
  }
  return out;
}

/** Deterministic keyword extractor (the FALLBACK). Scans the wide window, then assembleFactorsFromHits
 *  applies the tight-window / accumulation rule. Same shape the Haiku extractor returns. */
export function extractStatedFactorsDeterministic(messages: PlannerStudentMessage[], workoutDate: string): StatedFactor[] {
  const hits: Array<{ factor: StatedFactorKind; quote: string; date: string }> = [];
  for (const m of messages) {
    if (!m.date) continue;
    const d = daysFrom(m.date, workoutDate);
    if (!Number.isFinite(d) || d < -FACTOR_WINDOW_BACK_DAYS || d > FACTOR_WINDOW_FWD_DAYS) continue;
    const text = m.text.toLowerCase();
    for (const { factor, re, neg } of FACTOR_PATTERNS) {
      if (re.test(text) && !(neg && neg.test(text))) hits.push({ factor, quote: m.text, date: m.date });
    }
  }
  return assembleFactorsFromHits(hits, workoutDate);
}

// Which factor explains the run best when several are named. Care-worthy signals (illness/soreness)
// win — you never brush past "болит колено" to talk pacing. Then recovery (недосып), then the run's
// own conditions (обезвоживание/жара), then life-load, then external conditions.
// device_glitch is NOT a cause (it's a data-trust signal), so it never appears in these cause maps.
type CauseFactorKind = Exclude<StatedFactorKind, "device_glitch">;
const FACTOR_PRIORITY: Record<CauseFactorKind, number> = {
  illness: 7,
  soreness: 6,
  muscle_doms: 2, // benign — real injury (soreness) or fatigue outrank it; still honored over bare conditions
  undersleep: 5,
  dehydration: 4,
  nutrition: 4,
  heat: 4,
  life_stress: 3,
  conditions: 2,
};

const FACTOR_ADVICE_KEY: Record<CauseFactorKind, AdviceKey> = {
  illness: "cause_confirmed_illness",
  soreness: "cause_confirmed_soreness",
  muscle_doms: "cause_confirmed_muscle_doms",
  undersleep: "cause_confirmed_undersleep",
  dehydration: "cause_confirmed_dehydration",
  nutrition: "cause_confirmed_nutrition",
  heat: "cause_confirmed_heat",
  life_stress: "cause_confirmed_life_stress",
  conditions: "cause_confirmed_conditions",
};

/** WHAT the student said glitched, so the caller gates the RIGHT metric. A GPS/track/distance glitch
 *  breaks pace + distance (not pulse); a pulse/watch glitch breaks HR. A generic or unspecified glitch
 *  («часы странно себя ведут») keeps the prior behaviour — HR only — since a watch commonly means the
 *  HR sensor. Reading the quotes, not just presence: «GPS не поймал» must NOT leave pace trusted. */
export function deviceGlitchScope(factors: StatedFactor[] | undefined): { hr: boolean; paceDistance: boolean } {
  const quotes = (factors ?? []).filter((f) => f.factor === "device_glitch").map((f) => f.quote.toLowerCase()).join("  ");
  if (!quotes) return { hr: false, paceDistance: false };
  const gps = /gps|джипиэс|спутник|навигац|трек|дистанц|расстоян|км\s+навр|путь/u.test(quotes);
  const pulse = /пульс|сердц|чсс|hr\b/u.test(quotes);
  const watch = /час[ыои]|датчик|устройств|прибор|секундомер/u.test(quotes);
  return {
    // any non-GPS-specific glitch keeps gating HR (unchanged); a pure GPS glitch leaves HR alone
    hr: pulse || watch || (!gps && !pulse && !watch),
    // pace + distance gated ONLY when the student pointed at GPS/track/distance
    paceDistance: gps,
  };
}

/** True when the student flagged their watch/sensor as unreliable this workout. The caller then
 *  drops HR trust so the arc/fact-check stop asserting pulse on data the student themselves distrusts. */
export function hasDeviceGlitch(factors: StatedFactor[] | undefined): boolean {
  return (factors ?? []).some((f) => f.factor === "device_glitch");
}

export type StatedCause = { adviceKey: AdviceKey; numbers: Record<string, number>; reason: string; factor: StatedFactorKind; recurring: boolean };

/** Pick the single most-explaining stated factor and map it to a cause. Pure/deterministic — the
 *  planner calls this and, when it returns non-null, honors it as the workout's cause and skips the
 *  mechanical "ask" questions. numbers is ALWAYS empty: a stated factor never leaks a number. */
export function resolveStatedCause(packet: ContextPacket): StatedCause | null {
  // device_glitch is a data-trust signal, not a cause — it never becomes a cause_confirmed_* here.
  const factors = (packet.statedFactors ?? []).filter((f): f is StatedFactor & { factor: CauseFactorKind } => f.factor !== "device_glitch");
  if (factors.length === 0) return null;
  // recurring bumps recovery/life-load a tier: repeated «устал/ремонт/недосып» is accumulation,
  // which matters more than a one-off mention (design point 5).
  const score = (f: StatedFactor & { factor: CauseFactorKind }) => FACTOR_PRIORITY[f.factor] + (f.recurring && (f.factor === "life_stress" || f.factor === "undersleep") ? 2 : 0);
  const best = [...factors].sort((a, b) => score(b) - score(a))[0]!;
  const recurringNote = best.recurring ? " (упоминает не первый день — накопление)" : "";
  return {
    adviceKey: FACTOR_ADVICE_KEY[best.factor],
    numbers: {},
    reason: `student named a factor for this run: «${best.quote}» → ${best.factor}${recurringNote}; honoring it as the cause (причина, не вина), not asking a mechanical question`,
    factor: best.factor,
    recurring: best.recurring,
  };
}
