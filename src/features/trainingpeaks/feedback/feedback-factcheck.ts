// Iron fact-check at the generation seam (мост, часть 1). A draft that names any
// number NOT in the packet's allowedNumbers, or uses the wrong grammatical gender
// for the student's sex, is REJECTED (job → failed, never done). Mirrors the
// nutrition validateNutritionDayProse pattern (build allow-set → any offending
// token fails). The voice rule (v2/v3) forbids absolute workout numbers entirely,
// so allowedNumbers holds ONLY comparison-base deltas; every pace token and every
// other number in the draft must trace to that set.

import type { FeedbackContextPacket } from "./context-packet.ts";
import { isSensitiveTopic } from "./sensitive-topics.ts";

export type FeedbackFactCheckResult = { ok: true } | { ok: false; reason: string };

// Gender (род) is checked morphologically, not by a fixed denylist (the old 18-word list missed the
// majority of forms — была/начала/готова/разложилась/… all passed). We flag the ATHLETE-directed
// feminine (-ла/-лась + short predicatives) and masculine (-л/-лся + short predicatives) forms, and
// exclude verbs that normally take a workout NOUN as subject («тренировка прошла», «бег удался»), which
// are correct for any athlete sex. Reflexive -лась/-лся is matched by morphology (no common NOUN ends
// that way, so it's safe); the non-reflexive forms use a curated list (a bare -ла also matches feminine
// nouns like «сила/школа», so morphology alone would false-flag them).
// Reflexives whose subject is a workout noun, not the athlete — «тренировка удалась», «бег начался».
const NOUN_SUBJECT_REFLEXIVE = new Set(["удалась", "удался", "получилась", "получился", "началась", "начался", "закончилась", "закончился", "сложилась", "сложился", "оказалась", "оказался", "продолжалась", "продолжался", "получалась", "получался"]);
// Verbs that in THIS domain almost always describe the pulse/tempo/workout, not the athlete («пульс
// держался/поднялся/дёрнулся», «концовка далась», «темп просел») — never a gender marker, whatever
// precedes them (adverbs like «почти не», «до конца» sit between the noun and its verb, so a positional
// check can't catch them). Measured against 97 live drafts: these were the only source of false hits.
const AMBIGUOUS_WORKOUT_VERBS = new Set(["держался", "держалась", "поднялся", "поднялась", "опустился", "опустилась", "восстановился", "восстановилась", "дёрнулся", "дёрнулась", "дернулся", "дернулась", "просел", "просела", "снизился", "снизилась", "выровнялся", "выровнялась", "стабилизировался", "стабилизировалась", "сбился", "сбилась", "полз", "ползла", "пополз", "поползла", "далась", "дался", "разогнался", "разогналась"]);
// Workout NOUNS that legitimately govern a gendered verb: «пульс держался» (masc) / «тренировка прошла»
// (fem) are correct for ANY athlete sex. If a gendered form is DIRECTLY preceded by such a noun, it's the
// noun's verb, not the athlete's, so it's not a gender violation. (declensions included where common.)
const MASC_NOUN_SUBJECT = new Set(["пульс", "чсс", "темп", "бег", "разгон", "финиш", "отрезок", "разбег", "организм", "пейс", "сплит", "километр", "круг", "результат", "прогресс", "график", "набор", "старт", "разброс", "второй", "первый"]);
const FEM_NOUN_SUBJECT = new Set(["тренировка", "тренировку", "пробежка", "пробежку", "дистанция", "дистанцию", "серия", "серию", "нагрузка", "нагрузку", "концовка", "концовку", "длительная", "длительную", "работа", "работу", "погода", "погоду", "разминка", "заминка", "скорость", "выносливость", "вторая", "первая", "половина", "часть"]);
const FEM_FORMS = new Set(["пробежала", "побежала", "добежала", "отбежала", "сделала", "выполнила", "начала", "начинала", "закончила", "заканчивала", "продолжила", "разложила", "подняла", "держала", "удержала", "отбегала", "просела", "устала", "уставала", "отработала", "поплыла", "смогла", "сумела", "хотела", "захотела", "решила", "потерпела", "выдержала", "отдохнула", "поработала", "почувствовала", "добавила", "прибавила", "сбавила", "замедлила", "ускорила", "показала", "взяла", "поймала", "растянула", "преодолела", "рада", "готова", "довольна", "счастлива", "спокойна", "уверена", "горда", "свободна", "больна", "здорова", "вымотана", "измотана", "расстроена", "удивлена"]);
const MASC_FORMS = new Set(["пробежал", "побежал", "добежал", "отбежал", "сделал", "выполнил", "начал", "начинал", "закончил", "заканчивал", "продолжил", "разложил", "поднял", "отбегал", "просел", "устал", "уставал", "отработал", "поплыл", "смог", "сумел", "хотел", "захотел", "решил", "потерпел", "выдержал", "отдохнул", "поработал", "почувствовал", "добавил", "прибавил", "сбавил", "замедлил", "ускорил", "показал", "взял", "поймал", "растянул", "преодолел", "рад", "готов", "доволен", "счастлив", "спокоен", "уверен", "горд", "свободен", "болен", "здоров", "вымотан", "измотан", "расстроен", "удивлён", "удивлен"]);

// Return the athlete-directed feminine and masculine forms in the (lowercased) draft. Reflexive -лась/
// -лся is matched morphologically; every candidate is skipped when DIRECTLY preceded by a same-gender
// workout noun (its subject is that noun, not the athlete). «держал/поднял» (masc, common noun-verbs)
// are NOT in MASC_FORMS to avoid «пульс поднял…»-style false hits — the female-side leak is carried by
// the reflexive «-лся» morphology and the curated forms.
function detectGenderForms(low: string): { fem: string[]; masc: string[] } {
  const tokens = low.match(/[а-яё]+/giu) ?? [];
  const fem: string[] = [];
  const masc: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (AMBIGUOUS_WORKOUT_VERBS.has(t)) continue; // pulse/tempo verb, not the athlete
    const prev = i > 0 ? tokens[i - 1] : "";
    const isFem = FEM_FORMS.has(t) || (t.length >= 5 && t.endsWith("лась") && !NOUN_SUBJECT_REFLEXIVE.has(t));
    const isMasc = MASC_FORMS.has(t) || (t.length >= 4 && t.endsWith("лся") && !NOUN_SUBJECT_REFLEXIVE.has(t));
    if (isFem && !FEM_NOUN_SUBJECT.has(prev)) fem.push(t);
    if (isMasc && !MASC_NOUN_SUBJECT.has(prev)) masc.push(t);
  }
  return { fem: [...new Set(fem)], masc: [...new Set(masc)] };
}
const PULSE_WORDS = ["пульс", "чсс"];
// A draft that claims the session PROGRESSIVELY faded / got harder toward the end («отрезки стали
// тяжелее», «темп начал проседать», «под финиш тяжелее давалось», «с трудом»). Deliberately NOT a
// general condition-difficulty («в жару чуть тяжелее», «по тропам тяжелее, чем по асфальту») — that is
// legit context when a heat/terrain cause or the student's words back it, and false-flagging it rejected
// good drafts (Железникова/Левина). Matched against a real fade/fatigue signal or the student's words.
const FATIGUE_CLAIM_RE = /просе[дл]|просад|(?:стал[аио]?|начал[аио]?)\s+[^.!?]{0,15}(?:тяжел|трудн|тяжко|сложн)|(?:под\s+конец|под\s+финиш|к\s+концу|к\s+финишу|ближе\s+к\s+концу)[^.!?]{0,25}(?:тяжел|трудн|тяжко|сложн|част|устал|сдал)|(?:тяжел|трудн)[^.!?]{0,15}(?:под\s+конец|под\s+финиш|к\s+концу|к\s+финишу)|давал(?:ось|ась|ись|ся)\s+(?:тяжел|труд)|с\s+трудом|выдох(?:ся|лась|лись)|вымота(?:л|ло)/iu;
// Signals that genuinely license a "got harder/faded" claim: an interval fade, an HR drift, a fatigue
// CAUSE the student named, or an elevated-pulse / recovery question. Heat/humidity/comparison/praise do
// NOT (Сорокин had heat + only praise, yet the draft invented «отрезки стали тяжелее»).
const FATIGUE_SUPPORT_KEY_RE = /correction_interval_fade|correction_hr_drift|cause_confirmed_(?:tired|undersleep|illness|soreness|muscle_doms)|question_high_pulse|question_accumulated/;
const STUDENT_SAID_HARD_RE = /тяжел|устал|трудно|сложно|вымот|выдох|тяжко|сдал|не\s*тян|заморил|умотал/i;
// Unambiguous "ты"-address markers for the register check: the pronouns ты/тебя/тебе/тобой, the
// possessive твой/твоя/твоё/твои/твоего/… (тво + й/я/и/е/ю/ё), and 2nd-person-singular verbs ending
// -ешь/-ишь (держишь, пишешь). Cyrillic-safe boundaries (JS \b is ASCII-only). Deliberately NOT the
// past-tense -ла number case ("дождалась") — it collides with workout-subject verbs ("прошла").
const TY_ADDRESS_MARKERS = /(?<![а-яё])(?:ты|тебя|тебе|тобой|тво[йяиеюё][а-яё]*)(?![а-яё])|[а-яё](?:ешь|ишь)(?![а-яё])/iu;

function extractNumbers(text: string): { paces: string[]; nums: number[] } {
  const paces = [...text.matchAll(/\d+:\d\d/g)].map((m) => m[0]);
  const stripped = text
    .replace(/\d+:\d\d/g, " ")
    // RPE / субъективная оценка усилия «N из 10» или «N/10» — это СЛОВА ученика (его ощущение),
    // не выдуманная и не абсолютная метрика темпа/пульса/дистанции. Пропускаем (Назаров: «8 из 10»).
    // Выдуманные пейс/пульс/дистанция по-прежнему ловятся ниже.
    .replace(/\b\d{1,2}\s*(?:из|\/)\s*10(?!\d)/giu, " ")
    .replace(/👍|🙌|🔥|😁/g, " ");
  const nums = [...stripped.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => Number.parseFloat(m[0].replace(",", ".")));
  return { paces, nums };
}

export function validateFeedbackDraft(input: { draft: string; packet: FeedbackContextPacket }): FeedbackFactCheckResult {
  const { draft, packet } = input;
  const low = draft.toLowerCase();
  const allowed = new Set(packet.allowedNumbers.map((n) => Math.round(Math.abs(n))));
  const { paces, nums } = extractNumbers(draft);

  // Absolute workout pace/HR are forbidden entirely (only comparison deltas ok).
  // A pace token (M:SS) is never a comparison delta (those read "на N сек"), so any
  // pace token is an absolute workout number → reject.
  if (paces.length > 0) {
    return { ok: false, reason: `абсолютный темп тренировки в тексте (${paces.join(", ")}) — должно быть словами` };
  }
  for (const n of nums) {
    if (![...allowed].some((a) => Math.abs(a - Math.abs(n)) <= 1)) {
      return { ok: false, reason: `число ${n} не из пакета (allowedNumbers=${[...allowed].join(", ") || "нет"}) — выдуманная/абсолютная метрика` };
    }
  }

  // Gender must match sex. sex=null is NO LONGER silently treated as feminine (that accepted a wrong
  // female draft for an unmarked man AND rejected his correct masculine one). Instead: male → no feminine
  // forms; female → no masculine forms; null → the draft must be gender-NEUTRAL (any gendered form → fail
  // so the coach sets the sex or the model rewrites neutrally, never a silent guess).
  const { fem, masc } = detectGenderForms(low);
  if (packet.sex === "male") {
    if (fem.length) return { ok: false, reason: `женский род при sex=male (${fem.join(", ")})` };
  } else if (packet.sex === "female") {
    if (masc.length) return { ok: false, reason: `мужской род при sex=female (${masc.join(", ")})` };
  } else {
    // sex unknown → don't guess. A gendered draft is blocked (→ failed, coach sees it) so nobody is
    // addressed in the wrong gender by default.
    if (fem.length || masc.length) return { ok: false, reason: `пол не задан, а черновик в роде (${[...fem, ...masc].join(", ")}) — проставь пол или напиши нейтрально` };
  }

  // Register must match a formal ("вы") student. The greeting is already forced deterministically
  // (enforceGreeting), but the BODY drifts to "ты" ("Здравствуйте! …Ты написала…") and the prompt
  // alone doesn't hold it. Flag only UNAMBIGUOUS ты-address: the pronouns ты/тебя/тебе/тобой/твой and
  // 2nd-person-singular verbs on -ешь/-ишь (держишь, пишешь). The number/род case ("дождалась" vs
  // "дождались") is NOT flagged here — its -ла singular collides with workout-subject verbs
  // ("тренировка прошла", correct), so it can't be told apart deterministically; the prompt covers it.
  if (packet.register === "vy" && TY_ADDRESS_MARKERS.test(low)) {
    return { ok: false, reason: `обращение на «ты» при регистре «вы» (тело: ${(low.match(TY_ADDRESS_MARKERS) ?? []).slice(0, 1).join("")})` };
  }

  // C7: untrusted HR → the draft must not discuss pulse at all.
  if (!packet.hrTrusted && PULSE_WORDS.some((w) => low.includes(w))) {
    return { ok: false, reason: "hr_trusted=false, но черновик про пульс (недостоверный датчик)" };
  }

  // Anti-fabricated-fatigue (Сорокин): the draft claims the session got HARDER / faded («стало тяжелее»,
  // «давались с трудом», «под конец тяжело») but NO fatigue/fade signal fired AND the student didn't say
  // so. The model invented the arc (his reps were even, fade negative, only praise signals fired). Reject.
  const claimsFatigue = FATIGUE_CLAIM_RE.test(low);
  if (claimsFatigue) {
    const hasFatigueSignal = packet.observations.some((o) => FATIGUE_SUPPORT_KEY_RE.test(o.adviceKey));
    const studentSaidHard = STUDENT_SAID_HARD_RE.test(packet.studentWords.join(" ").toLowerCase());
    if (!hasFatigueSignal && !studentSaidHard) {
      return { ok: false, reason: "черновик утверждает «стало тяжелее/просело/с трудом», но нет сигнала усталости/fade и ученик так не писал (выдуманная усталость)" };
    }
  }

  // Privacy (б) insurance gate: a GROUP-bound draft must not carry any personal/medical topic (operation,
  // illness, врач, diagnosis, injury, burnout) — the context filter already strips such input, this is the
  // last line before a leak reaches a 70-person topic (Трофимова: «операция» в групповой черновик).
  if (packet.groupBound && isSensitiveTopic(draft)) {
    return { ok: false, reason: "групповой черновик с личной/медицинской темой (операция/болезнь/врач/травма) — не для группы" };
  }

  return { ok: true };
}
