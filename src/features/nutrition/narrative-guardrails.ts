export const NUTRITION_ATHLETE_FORBIDDEN_MEDICAL_TERMS = [
  "RED-S",
  "REDs",
  "LEA",
  "low energy availability",
  "энергодоступность",
  "энергодоступности",
  "дефицит энергии",
  "дефицит",
  "медицинский риск",
  "медицинский",
  "диагноз",
  "гормоны",
  "эндокринка",
  "аменорея",
  "костная плотность",
] as const;

export const NUTRITION_ATHLETE_ALLOWED_ENERGY_WORDING = [
  "энергии для такого дня маловато",
  "для дня с нагрузкой это нижняя граница",
  "лучше поддержать питание вокруг нагрузки",
] as const;

export const NUTRITION_PRACTICAL_TARGET_REQUIRED_WORDING = [
  "Цифры ниже — ориентиры, не обязательство.",
  "Не нужно резко прыгать к ним за один день.",
  "Главный шаг — поднять энергию и углеводы в дни нагрузки.",
] as const;

export const NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES = [
  "EA/energyAvailability — только coach screening. Не пиши ученику: RED-S, REDs, LEA, энергодоступность, дефицит энергии, медицинский риск, диагноз.",
  "Допустимо ученику: «энергии для такого дня маловато», «для дня с нагрузкой это нижняя граница», «лучше поддержать питание вокруг нагрузки».",
  "macroGuardrails детерминированы в facts: не пересчитывай г/кг и не переопределяй protein ok как оправдание низкой энергии/углеводов.",
  "Если weekly protein avg >= 1.5, summary может сказать, что белок в целом ближе к норме; borderline days — мягко.",
  "Жиры: «низковаты / на нижней границе» без гормональных/медицинских объяснений.",
  "Практические ориентиры — step from previous week, не ideal target как обязательство. Не предлагай резкий прыжок carbs/kcal к идеалу за один день.",
  "Padel => падел; Cycling => вело/велосипед. Cross-training — нагрузка, но не hard interval без evidence.",
  "Ключевые тренировки: интервалы, темп/порог, long_run по правилу (>70 мин или explicit title), combined high-load day.",
] as const;

export const NUTRITION_PLAN_NARRATIVE_PROMPT_LINES = [
  "Практический target — шаг от прошлой недели, ideal target — ориентир, не обязательство.",
  "Обязательные формулировки в athlete draft: «Цифры ниже — ориентиры, не обязательство.» и «Не нужно резко прыгать к ним за один день.»",
  "Главный шаг — поднять энергию и углеводы в дни нагрузки; не презентуй ideal kcal/carbs как must-hit за день.",
  "No RED-S/REDs/LEA/энергодоступность/дефицит энергии/медицинский риск/диагноз in athlete draft.",
] as const;
